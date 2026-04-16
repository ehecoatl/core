// _core/runtimes/rpc-runtime/rpc-runtime.js


'use strict';

const RpcChannel = require("./rpc-channel");
const MessageSchema = require(`./schemas/message-schema`);
const PendingQuestion = require(`./schemas/pending-question`);
const AdaptableUseCase = require(`@/_core/_ports/adaptable-use-case`);
const timeoutPromise = require(`@/utils/timeout-promise`);

/** Endpoint for Question -> Wait -> Answer protocol */
/** Shared RPC endpoint that manages question listeners, pending answers, and hook dispatch. */
class RpcRuntime extends AdaptableUseCase {
  /** @type {typeof import('@/config/default.config').adapters.rpcRuntime} */
  config;

  /** @type {RpcChannel}  */
  channel;
  /** @type {import('@/_core/orchestrators/plugin-orchestrator')} */
  plugin;
  /** @type {import('@/_core/_ports/outbound/rpc-port')} */
  adapter = null;
  routeAnswer;

  #questionListeners;
  #pendingQuestions;

  /** Initializes question/answer state and optionally starts transport listening. */
  constructor(kernelContext, { channel = null, routeAnswer = null } = {}) {
    super(kernelContext.config._adapters.rpcRuntime);
    this.config = kernelContext.config.adapters.rpcRuntime;
    this.plugin = kernelContext.pluginOrchestrator;
    this.routeAnswer = routeAnswer;
    super.loadAdapter();
    this.channel = channel ?? new RpcChannel(this.adapter);

    this.currentId = 0;
    this.MAX_ID = 1_000;
    this.#questionListeners = new Map();
    this.#pendingQuestions = new Array(this.MAX_ID);

    if (channel !== null) return; // Supervisor router endpoint
    this.channel.rpcStartListening((p) => this.onReceive(p));
  }

  /** Dispatches one inbound payload to the question or answer handling path. */
  async onReceive(payload) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const { CHANNEL } = hooks.SHARED.RPC_ENDPOINT;
    const isQuestion = MessageSchema.isQuestion(payload);
    await plugin.run(CHANNEL.RECEIVE, { payload, isQuestion }, CHANNEL.ERROR).catch(() => { });

    if (isQuestion)
      this.onQuestionHandler(payload);
    else
      this.onAnswerHandler(payload);
  }

  /** Finds the next available pending slot id for an outbound question. */
  async nextId() {
    if (this.currentId++ === this.MAX_ID) { this.currentId = 0; }
    const pendingSlot = this.#pendingQuestions[this.currentId];
    if (!pendingSlot) { return this.currentId; } // EMPTY SLOT, SO LETSGO

    return -1; // FULL, NOT EMPTY
  }

  /** Sends a question to a target process and resolves when the answer arrives. */
  async ask({ target, question, data, internalMeta = undefined }) {
    return this.#ask({ target, question, data, internalMeta, detailed: false });
  }

  /** Sends a question and resolves with both answer data and internal RPC metadata. */
  async askDetailed({ target, question, data, internalMeta = undefined }) {
    return this.#ask({ target, question, data, internalMeta, detailed: true });
  }

  /** Sends one question through the shared RPC channel and resolves on answer or timeout. */
  async #ask({ target, question, data, internalMeta, detailed }) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const { ASK, CHANNEL } = hooks.SHARED.RPC_ENDPOINT;
    await plugin.run(ASK.BEFORE, { target, question, data }, ASK.ERROR);

    const id = await this.nextId();

    if (id === -1) { // PENDING FULL!
      await plugin.run(ASK.ERROR, { target, question, reason: `pending_full` });
      return false;
    }

    //Register Pending Before Sending
    const pendingSchema = new PendingQuestion({
      id,
      target,
      question,
      requestData: data,
      detailed,
      resolve: (answer) => {
        pendingSchema.complete({ answer });
        delete this.#pendingQuestions[id];
      },
      reject: (error) => {
        pendingSchema.complete({ error });
        delete this.#pendingQuestions[id];
      }
    });
    this.#pendingQuestions[id] = pendingSchema;

    const request = MessageSchema.createQuestion({
      id,
      target,
      question,
      data,
      internalMeta
    });

    try {
      this.channel.sendMessage(target, request);
      await plugin.run(CHANNEL.SEND, { id, target, question, data, request }, CHANNEL.ERROR);
    } catch (error) {
      await plugin.run(CHANNEL.ERROR, { id, target, question, data, reason: `send_failed`, error });
      return false;
    }

    const askTimeoutMs = this.config.askTimeoutMs ?? 30_000;
    return await timeoutPromise(
      pendingSchema.attachTimeoutHandlers.bind(pendingSchema),
      askTimeoutMs,
      `RPC ask timeout after ${askTimeoutMs}ms`
    ).catch(async (error) => {
      delete this.#pendingQuestions[id];
      error.code = error.code ?? `RPC_ASK_TIMEOUT`;
      await plugin.run(CHANNEL.TIMEOUT, { id, target, question, data, reason: `ask_timeout`, error }, CHANNEL.ERROR).catch(() => { });
      throw error;
    });
  }

  async resolveAskResponse({ id, target, question, data, answerData, internalMeta, detailed }) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const { ASK } = hooks.SHARED.RPC_ENDPOINT;
    await plugin.run(ASK.AFTER, { id, target, question, data, answerData, internalMeta }, ASK.ERROR);
    if (detailed) {
      return {
        data: answerData,
        internalMeta: internalMeta ?? null
      };
    }
    return answerData;
  }

  /** Executes a question listener and sends the produced answer back to the origin. */
  async onQuestionHandler(payload) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const { ANSWER, CHANNEL } = hooks.SHARED.RPC_ENDPOINT;
    const callback = this.#questionListeners.get(payload.question);
    if (!callback) {
      await plugin.run(ANSWER.ERROR, { payload, reason: `missing_listener` });
      try {
        this.channel.sendMessage(payload.origin ?? null, MessageSchema.createAnswer({
          payload,
          origin: this.channel.getPID(),
          data: {
            success: false,
            error: `RPC listener not ready for question "${payload.question}"`
          }
        }));
        await plugin.run(CHANNEL.SEND, {
          payload,
          origin: this.channel.getPID(),
          reason: `missing_listener`,
          message: `missing_listener_answer`
        }, CHANNEL.ERROR).catch(() => { });
      } catch (error) {
        await plugin.run(CHANNEL.ERROR, { payload, reason: `missing_listener_answer_send_failed`, error }).catch(() => { });
      }
      return;
    }

    const origin = this.channel.getPID();
    await plugin.run(ANSWER.BEFORE, { payload, origin }, ANSWER.ERROR);
    const answerTimeoutMs = this.config.answerTimeoutMs ?? 30_000;
    (timeoutPromise((resolve, reject) => {
      const data = {
        origin: payload.origin,
        ...payload.data,
        internalMeta: payload.internalMeta ?? null
      };
      const resolveAnswer = (answerData, internalMeta = undefined) => {
        resolve({ answerData, internalMeta });
      };
      Promise.resolve()
        .then(() => callback(data, resolveAnswer))
        .then((result) => {
          if (result !== false) resolveAnswer(result);
        })
        .catch(reject);
    }, answerTimeoutMs, `RPC answer timeout after ${answerTimeoutMs}ms`)).then(
      async ({ answerData, internalMeta }) => {
        await plugin.run(ANSWER.AFTER, { payload, origin, answerData, internalMeta }, ANSWER.ERROR);
        return MessageSchema.createAnswer({
          payload,
          origin,
          data: answerData,
          internalMeta
        });
      },
      async (error) => {
        if (error?.message?.includes(`timeout`)) {
          error.code = error.code ?? `RPC_ANSWER_TIMEOUT`;
          await plugin.run(CHANNEL.TIMEOUT, { payload, origin, reason: `answer_timeout`, error }, CHANNEL.ERROR).catch(() => { });
        }

        if (error?.code === `RPC_ANSWER_TIMEOUT`) {
          return MessageSchema.createAnswer({
            payload,
            origin,
            data: { success: false, error: error?.message ?? error }
          });
        }

        await plugin.run(ANSWER.ERROR, { payload, origin, reason: `listener_error`, error });
        return MessageSchema.createAnswer({
          payload,
          origin,
          data: { success: false, error: error?.message ?? error }
        });
      }
    ).then((msg) => {
      try {
        const shouldRouteLocally = typeof payload.origin === `string` && payload.origin.length > 0 && typeof this.routeAnswer === `function`;
        if (shouldRouteLocally) {
          this.routeAnswer(payload.origin, msg);
          plugin.run(CHANNEL.SEND, { payload, origin, message: msg, routedLocally: true }, CHANNEL.ERROR).catch(() => { });
          return;
        }

        const delivered = this.channel.sendMessage(payload.origin ?? null, msg);
        if ((delivered === undefined || delivered === false) && typeof this.routeAnswer === `function`) {
          this.routeAnswer(payload.origin ?? null, msg);
        }
        plugin.run(CHANNEL.SEND, { payload, origin, message: msg }, CHANNEL.ERROR).catch(() => { });
      } catch (error) {
        plugin.run(CHANNEL.ERROR, { payload, origin, reason: `answer_send_failed`, error }).catch(() => { });
      }
    });
  }

  /** Resolves a pending outbound question from an inbound answer payload. */
  onAnswerHandler(payload) {
    const promise = this.#pendingQuestions[payload.id];
    if (promise) {
      delete this.#pendingQuestions[payload.id];
      promise.resolve?.(this.resolveAskResponse({
        id: payload.id,
        target: payload.origin,
        question: payload.question,
        data: promise.requestData,
        answerData: payload.data,
        internalMeta: payload.internalMeta,
        detailed: promise.detailed
      }));
      promise.next?.(payload.id);
    }
  }

  /** Registers a callback for one logical RPC question name. */
  addListener(question, callback) {
    this.#questionListeners.set(question, callback);
  }

  /** Removes a callback for one logical RPC question name. */
  removeListener(question) {
    this.#questionListeners.delete(question);
  }
}

module.exports = RpcRuntime;
Object.freeze(module.exports);
