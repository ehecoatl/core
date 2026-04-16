// _core/runtimes/e-renderer-runtime/e-renderer-runtime.js


'use strict';


const { Readable } = require(`node:stream`);
const AdaptableUseCase = require(`@/_core/_ports/adaptable-use-case`);
const ERendererContext = require(`./e-renderer-context`);

class ERendererRuntime extends AdaptableUseCase {
  config;
  adapter = null;
  storageService;
  i18nCompiler;

  constructor(kernelContext) {
    super(kernelContext.config._adapters.eRendererRuntime);
    this.config = kernelContext.config.adapters.eRendererRuntime ?? {};
    this.storageService = kernelContext.useCases.storageService;
    this.i18nCompiler = kernelContext.useCases.i18nCompiler;
    super.loadAdapter();
    Object.freeze(this);
  }

  isCompatibleTemplate(template) {
    const normalizedTemplate = String(template ?? ``).trim().toLowerCase();
    if (!normalizedTemplate) return false;
    const formats = normalizeCompatibleFormats(this.config.compatibleFileFormats);
    return formats.some((format) => normalizedTemplate.endsWith(format));
  }

  async renderView(template, i18nJSONSources = [], renderContextSeed = {}) {
    return await this.streamRendering(template, i18nJSONSources, renderContextSeed);
  }

  async streamRendering(template, i18nJSONSources = [], renderContextSeed = {}) {
    super.loadAdapter();
    const streamRenderingAdapter = this.adapter?.streamRenderingAdapter;
    const parseTemplateAdapter = this.adapter?.parseTemplateAdapter;
    const processSnippetAdapter = this.adapter?.processSnippetAdapter;
    if (typeof streamRenderingAdapter !== `function`) {
      throw new Error(`e-renderer-runtime requires streamRenderingAdapter`);
    }
    if (typeof parseTemplateAdapter !== `function`) {
      throw new Error(`e-renderer-runtime requires parseTemplateAdapter`);
    }
    if (typeof processSnippetAdapter !== `function`) {
      throw new Error(`e-renderer-runtime requires processSnippetAdapter`);
    }

    const pairsMap = await this.#loadMergedI18nPairs(i18nJSONSources);
    const keyMask = resolveMask(this.i18nCompiler?.config?.keyMask, `?`);
    const replaceMask = resolveMask(this.i18nCompiler?.config?.replaceMask, `?`);
    const compiledReplacer = await this.i18nCompiler.compile(pairsMap, keyMask, replaceMask);
    const normalizedTemplate = String(template ?? ``);
    const assetsRoot = this.#resolveAssetsRoot(normalizedTemplate, renderContextSeed);
    const context = new ERendererContext({
      config: this.config,
      templatePath: normalizedTemplate,
      assetsRoot,
      renderContextSeed,
      i18n: pairsMap,
      compiledI18nReplacer: compiledReplacer
    });

    context.bindRenderer({
      renderTemplate: async (templatePath) => await this.#renderTemplateToString(templatePath, context, parseTemplateAdapter, processSnippetAdapter),
      renderNodes: async (nodes) => await this.#renderNodesToString(nodes, context, processSnippetAdapter)
    });

    const rendered = await this.#renderTemplateToString(normalizedTemplate, context, parseTemplateAdapter, processSnippetAdapter);
    return Readable.from([rendered], { encoding: `utf8` });
  }

  async #loadMergedI18nPairs(i18nJSONSources = []) {
    const sources = Array.isArray(i18nJSONSources) ? i18nJSONSources : [];
    const merged = {};

    for (const sourcePath of sources) {
      const normalizedSourcePath = String(sourcePath ?? ``).trim();
      if (!normalizedSourcePath) continue;
      const fileContent = await this.storageService.readFile(normalizedSourcePath, `utf8`);
      let parsed;
      try {
        parsed = JSON.parse(String(fileContent ?? ``));
      } catch (error) {
        throw new Error(`e-renderer-runtime failed to parse i18n JSON "${normalizedSourcePath}": ${error?.message ?? error}`);
      }

      if (!parsed || typeof parsed !== `object` || Array.isArray(parsed)) {
        throw new Error(`e-renderer-runtime requires i18n JSON objects: "${normalizedSourcePath}"`);
      }

      for (const [key, value] of Object.entries(parsed)) {
        merged[String(key)] = String(value ?? ``);
      }
    }

    return merged;
  }

  #resolveAssetsRoot(template, renderContextSeed = {}) {
    const routeAssetsRoot = String(renderContextSeed?.route?.folders?.assetsRootFolder ?? ``).trim();
    if (routeAssetsRoot) return routeAssetsRoot;
    return require(`node:path`).dirname(String(template ?? ``));
  }

  async #renderTemplateToString(template, context, parseTemplateAdapter, processSnippetAdapter) {
    super.loadAdapter();
    context.beginTemplate(template);
    try {
    const templateStream = await this.adapter.streamRenderingAdapter({
      config: this.config,
      template: String(template ?? ``)
    });
    const templateSource = await readStreamToString(templateStream);
    const nodes = await parseTemplateAdapter({
      config: this.config,
      source: templateSource
    });
      const topLevelExtends = nodes.filter((node) => node?.type === `extends`);
      if (topLevelExtends.length > 1) {
        throw new Error(`e-renderer template declares multiple top-level @extends directives`);
      }

      if (topLevelExtends.length === 1) {
        await this.#renderSnippetToString(topLevelExtends[0], context, processSnippetAdapter);
        const childNodes = nodes.filter((node) => node !== topLevelExtends[0]);
        await this.#renderNodesToString(childNodes, context, processSnippetAdapter, {
          collectSectionsOnly: true
        });
        const parentLayout = context.consumeParentLayout();
        if (!parentLayout) {
          return ``;
        }
        return await this.#renderTemplateToString(parentLayout, context, parseTemplateAdapter, processSnippetAdapter);
      }

      return await this.#renderNodesToString(nodes, context, processSnippetAdapter);
    } finally {
      context.endTemplate();
    }
  }

  async #renderNodesToString(nodes = [], context, processSnippetAdapter, {
    collectSectionsOnly = false
  } = {}) {
    let output = ``;
    for (const node of nodes) {
      if (collectSectionsOnly) {
        if (node?.type === `section`) {
          await this.#renderSnippetToString(node, context, processSnippetAdapter);
        } else if (node?.type === `extends`) {
          await this.#renderSnippetToString(node, context, processSnippetAdapter);
        }
        continue;
      }

      if (node.type === `text`) {
        output += node.value;
      } else {
        output += await this.#renderSnippetToString(node, context, processSnippetAdapter);
      }

      if (context.hasPendingLoopControl()) {
        break;
      }
    }
    return output;
  }

  async #renderSnippetToString(snippet, context, processSnippetAdapter) {
    const snippetStream = await processSnippetAdapter({
      config: this.config,
      snippet,
      context
    });
    return await readStreamToString(snippetStream);
  }
}

module.exports = ERendererRuntime;
Object.freeze(module.exports);

function normalizeCompatibleFormats(formats = []) {
  return [...new Set((Array.isArray(formats) ? formats : [])
    .map((format) => String(format ?? ``).trim().toLowerCase())
    .filter((format) => format.startsWith(`.`) && format.length > 1))];
}

function resolveMask(value, fallback) {
  return typeof value === `string` && value.length > 0
    ? value
    : fallback;
}

async function readStreamToString(stream) {
  if (!stream) return ``;
  let body = ``;
  stream.setEncoding?.(`utf8`);
  for await (const chunk of stream) {
    body += String(chunk);
  }
  return body;
}
