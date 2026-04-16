// config/plugin-hooks.config.js


'use strict';


let i = 0;

const HOOKS = {
  SHARED: {
    min: i,
    RPC_ENDPOINT: { // SETUP IN RPC ENDPOINT
      ASK: wrapperHooks(),
      ANSWER: wrapperHooks(),
      CHANNEL: channelWrapperHooks()
    },
    RPC_ROUTER: rpcRouterHooks(), // SETUP IN RPC ROUTER
    STORAGE: wrapperHooks(),
    SHARED_CACHE: wrapperHooks(),
    max: i - 1,
  },

  MAIN: {
    min: i,

    PROCESS: processHooks(), // SETUP IN KERNEL CONTEXT & BOOTSTRAP

    SUPERVISOR: supervisorHooks(), // SETUP IN PROCESS SUPERVISOR & HEALTH

    max: i - 1,
  },

  ENGINE: {
    min: i,

    PROCESS: processHooks(), // SETUP IN KERNEL CONTEXT & BOOTSTRAP

    REQUEST: { // SETUP IN NETWORK ENGINE
      ...flowHooks(),
      LIMITER: wrapperHooks(),
      GET_ROUTER: wrapperHooks(),
      GET_COOKIE: wrapperHooks(),
      AUTH_CSRF: wrapperHooks(),
      GET_SESSION: wrapperHooks(),

      BODY: flowHooks(), //body read
    },
    PIPELINE: { // SETUP IN REQUEST PIPELINE
      ...flowHooks(),
      STAGE: flowHooks(),
    },
    RESPONSE: {// change from adapter to nEngine
      UPDATE_SESSION: wrapperHooks(),
      UPDATE_COOKIE: wrapperHooks(),

      WRITE: flowHooks(),//body write
    },
    SESSION: {
      GET_COOKIE: wrapperHooks(),
      UPDATE_COOKIE: wrapperHooks(),
      AUTH_CSRF: wrapperHooks(),
      GET_SESSION: wrapperHooks(),
      UPDATE_SESSION: wrapperHooks(),
      CREATE: wrapperHooks(),
      CACHE_GET: wrapperHooks(),
      CACHE_SET: wrapperHooks(),
    },

    max: i - 1,
  },

  MANAGER: {
    min: i,

    PROCESS: processHooks(), // SETUP IN KERNEL CONTEXT & BOOTSTRAP

    QUEUE_BROKER: {
      QUEUE: createHooks(),
      TASK: createHooks(),
    },
    TENANCY: {
      SCAN: wrapperHooks(),
      FIND: wrapperHooks()
    },

    max: i - 1,
  },

  TENANT: {
    min: i,

    PROCESS: processHooks(), // SETUP IN KERNEL CONTEXT & BOOTSTRAP

    max: i - 1,
  }
};

HOOKS.MAX_HOOKS = i;

//10 HOOKS MAX 0-9
function processHooks() {
  return {
    DEAD: i++,
    SPAWN: i++,
    READY: i++,
    ERROR: i++,
    CRASH: i++,
    RESTART: i++,
    SHUTDOWN: i++,
    HEARTBEAT: i++,
    BOOTSTRAP: i++,
  };
}

function supervisorHooks() {
  return {
    DEAD: i++,
    READY: i++,
    ERROR: i++,
    CRASH: i++,
    RESTART: i++,
    SHUTDOWN: i++,
    HEARTBEAT: i++,
    BOOTSTRAP: i++,
    LAUNCH: wrapperHooks(),
    EXIT: wrapperHooks(),
  };
}

function flowHooks() {
  return {
    START: i++,
    ERROR: i++,
    END: i++,
    BREAK: i++,
  };
}

function createHooks() {
  return {
    NEW: i++,
    POOL: i++,
    REUSE: i++,
    ERROR: i++,
  };
}

function channelWrapperHooks() {
  return {
    RECEIVE: i++,
    SEND: i++,
    TIMEOUT: i++,
    ERROR: i++,
  };
}

function rpcRouterHooks() {
  return {
    RECEIVED: i++,
    ROUTED: i++,
    ERROR: i++
  };
}

function wrapperHooks() {
  return {
    BEFORE: i++,
    AFTER: i++,
    ERROR: i++,
  };
}

function deepFreeze(obj) {
  Object.freeze(obj);
  Object.values(obj).forEach(v => {
    if (v && typeof v === 'object' && !Object.isFrozen(v))
      deepFreeze(v);
  });
  return obj;
}

deepFreeze(HOOKS)
module.exports = HOOKS;
