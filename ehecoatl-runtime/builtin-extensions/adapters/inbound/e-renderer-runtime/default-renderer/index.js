// adapters/outbound/e-renderer-runtime/default-renderer.js


'use strict';


const ERendererRuntimePort = require(`@/_core/_ports/inbound/e-renderer-runtime-port`);
const fs = require(`node:fs`);
const path = require(`node:path`);
const { Readable } = require(`node:stream`);
const hljs = require(`highlight.js`);
const MarkdownIt = require(`markdown-it`);
const TemplateParser = require(`./template-parser`);

const markdownRenderer = createMarkdownRenderer();

ERendererRuntimePort.streamRenderingAdapter = async function streamRenderingAdapter({
  template
}) {
  return fs.createReadStream(String(template ?? ``), {
    encoding: `utf8`
  });
};

ERendererRuntimePort.parseTemplateAdapter = async function parseTemplateAdapter({
  source
}) {
  const parser = new TemplateParser(String(source ?? ``));
  return parser.parseNodes();
};

ERendererRuntimePort.processSnippetAdapter = async function processSnippetAdapter({
  snippet,
  context
}) {
  const rendered = await renderSnippet(snippet, context);
  return Readable.from([String(rendered ?? ``)], { encoding: `utf8` });
};

module.exports = ERendererRuntimePort;
Object.freeze(module.exports);

async function renderSnippet(snippet, context) {
  switch (snippet?.type) {
    case `variable`: {
      return escapeHtml(resolveRenderableValue(snippet.expression, context));
    }
    case `escapedVariable`: {
      return escapeHtml(resolveRenderableValue(snippet.expression, context));
    }
    case `rawVariable`: {
      return resolveRenderableValue(snippet.expression, context);
    }
    case `translate`: {
      const keyValue = resolveArgumentValue(snippet.expression, context);
      return escapeHtml(String(context.translate(keyValue)));
    }
    case `include`: {
      const includeTarget = resolveArgumentValue(snippet.expression, context);
      return await context.renderInclude(String(includeTarget ?? ``));
    }
    case `markdown`: {
      const markdownTarget = resolveArgumentValue(snippet.expression, context);
      return await renderMarkdownSnippet(markdownTarget, context);
    }
    case `extends`: {
      const includeTarget = resolveArgumentValue(snippet.expression, context);
      context.setParentLayout(context.resolveInclude(String(includeTarget ?? ``)));
      return ``;
    }
    case `section`: {
      const sectionName = String(resolveArgumentValue(snippet.expression, context) ?? ``).trim();
      const rendered = await context.renderNodes(snippet.nodes ?? []);
      context.setSection(sectionName, rendered);
      return ``;
    }
    case `yield`: {
      const sectionName = String(resolveArgumentValue(snippet.expression, context) ?? ``).trim();
      return context.getSection(sectionName);
    }
    case `if`: {
      return await renderIfSnippet(snippet, context);
    }
    case `for`: {
      return await renderForSnippet(snippet, context);
    }
    case `foreach`: {
      return await renderForeachSnippet(snippet, context);
    }
    case `forentries`: {
      return await renderForentriesSnippet(snippet, context);
    }
    case `continue`: {
      context.requestContinue();
      return ``;
    }
    case `break`: {
      context.requestBreak();
      return ``;
    }
    default:
      return ``;
  }
}

async function renderIfSnippet(snippet, context) {
  for (const branch of snippet.branches ?? []) {
    if (context.evaluateExpression(branch.condition)) {
      return await context.renderNodes(branch.nodes ?? []);
    }
  }
  return await context.renderNodes(snippet.elseNodes ?? []);
}

async function renderForSnippet(snippet, context) {
  const [initExpression, conditionExpression, stepExpression] = splitForExpression(snippet.expression);
  context.pushScope({});
  context.enterLoop();
  try {
    applyAssignment(initExpression, context);
    let output = ``;
    while (context.evaluateExpression(conditionExpression)) {
      context.bumpLoopIteration();
      output += await context.renderNodes(snippet.nodes ?? []);
      if (context.consumeBreak()) {
        break;
      }
      if (context.consumeContinue()) {
        applyStep(stepExpression, context);
        continue;
      }
      applyStep(stepExpression, context);
    }
    return output;
  } finally {
    context.exitLoop();
    context.popScope();
  }
}

async function renderForeachSnippet(snippet, context) {
  const parsed = parseForeachExpression(snippet.expression);
  const collection = context.evaluateValue(parsed.collectionExpression);
  const iterable = buildForeachIterable(collection, parsed.mode);
  const iterator = context.beginRepeat(iterable);
  context.enterLoop();
  let output = ``;
  try {
    while (true) {
      const next = context.nextRepeat(iterator);
      if (next.done) break;
      context.bumpLoopIteration();
      context.pushScope({ [parsed.variableName]: next.value });
      try {
        output += await context.renderNodes(snippet.nodes ?? []);
        if (context.consumeBreak()) {
          break;
        }
        if (context.consumeContinue()) {
          continue;
        }
      } finally {
        context.popScope();
      }
    }
    return output;
  } finally {
    context.exitLoop();
  }
}

async function renderForentriesSnippet(snippet, context) {
  const parsed = parseForentriesExpression(snippet.expression);
  const directoryTarget = resolveArgumentValue(parsed.directoryExpression, context);
  const directoryPath = context.resolveInclude(String(directoryTarget ?? ``));
  const entries = await readDirectoryEntries(directoryPath, context);

  context.enterLoop();
  let output = ``;
  try {
    for (const entry of entries) {
      context.bumpLoopIteration();
      context.pushScope({
        [parsed.variableName]: entry
      });
      try {
        output += await context.renderNodes(snippet.nodes ?? []);
        if (context.consumeBreak()) {
          break;
        }
        if (context.consumeContinue()) {
          continue;
        }
      } finally {
        context.popScope();
      }
    }
    return output;
  } finally {
    context.exitLoop();
  }
}

function resolveArgumentValue(expression, context) {
  const normalized = String(expression ?? ``).trim();
  if (!normalized) return ``;
  if (
    (normalized.startsWith(`'`) && normalized.endsWith(`'`)) ||
    (normalized.startsWith(`"`) && normalized.endsWith(`"`))
  ) {
    return normalized.slice(1, -1);
  }
  const value = context.evaluateValue(normalized);
  return value == null ? normalized : value;
}

function resolveRenderableValue(expression, context) {
  const normalized = String(expression ?? ``).trim();
  if (!normalized) return ``;
  const translateMatch = normalized.match(/^@t\(([\s\S]*)\)$/);
  if (translateMatch) {
    const keyValue = resolveArgumentValue(translateMatch[1], context);
    return String(context.translate(keyValue));
  }
  const value = context.evaluateValue(normalized);
  return value == null ? `` : String(value);
}

function createMarkdownRenderer() {
  let renderer = null;

  renderer = new MarkdownIt({
    html: true,
    highlight(str, lang) {
      const normalizedLanguage = String(lang ?? ``).trim();
      if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
        try {
          return wrapHighlightedCode(
            hljs.highlight(str, {
              language: normalizedLanguage,
              ignoreIllegals: true
            }).value,
            normalizedLanguage
          );
        } catch (_) { }
      }

      try {
        const autoDetected = hljs.highlightAuto(str);
        return wrapHighlightedCode(autoDetected.value, autoDetected.language ?? ``);
      } catch (_) { }

      return wrapHighlightedCode(renderer.utils.escapeHtml(str), normalizedLanguage);
    }
  });

  return renderer;
}

function wrapHighlightedCode(highlightedHtml, languageName = ``) {
  const normalizedLanguage = String(languageName ?? ``).trim();
  const languageClass = normalizedLanguage
    ? ` language-${escapeHtmlAttribute(normalizedLanguage)}`
    : ``;
  return `<pre><code class="hljs${languageClass}">${String(highlightedHtml ?? ``)}</code></pre>`;
}

function escapeHtmlAttribute(value) {
  return String(value ?? ``)
    .replaceAll(`&`, `&amp;`)
    .replaceAll(`"`, `&quot;`)
    .replaceAll(`<`, `&lt;`)
    .replaceAll(`>`, `&gt;`);
}

async function renderMarkdownSnippet(markdownTarget, context) {
  if (context?.config?.markdownEnabled === false) {
    throw new Error(`e-renderer markdown rendering is disabled`);
  }

  const markdownPath = context.resolveInclude(String(markdownTarget ?? ``));
  const normalizedPath = String(markdownPath ?? ``).trim().toLowerCase();
  const compatibleFormats = normalizeCompatibleFormats(context?.config?.markdownFileFormats);
  if (compatibleFormats.length > 0 && !compatibleFormats.some((format) => normalizedPath.endsWith(format))) {
    throw new Error(`e-renderer markdown requires a supported markdown file format`);
  }

  const markdownSource = await fs.promises.readFile(markdownPath, `utf8`);
  return markdownRenderer.render(String(markdownSource ?? ``));
}

function normalizeCompatibleFormats(formats = []) {
  return [...new Set((Array.isArray(formats) ? formats : [])
    .map((format) => String(format ?? ``).trim().toLowerCase())
    .filter((format) => format.startsWith(`.`) && format.length > 1))];
}

function splitForExpression(expression) {
  const parts = [];
  let current = ``;
  let depth = 0;
  let quote = null;
  for (const char of String(expression ?? ``)) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === `'` || char === `"`) {
      quote = char;
      current += char;
      continue;
    }
    if (char === `(`) depth += 1;
    if (char === `)`) depth -= 1;
    if (char === `;` && depth === 0) {
      parts.push(current.trim());
      current = ``;
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  if (parts.length !== 3) {
    throw new Error(`@for requires init; condition; step`);
  }
  return parts;
}

function applyAssignment(expression, context) {
  const normalized = String(expression ?? ``).trim();
  if (!normalized) return;
  const match = normalized.match(/^([A-Za-z_$][\w.$]*)\s*=\s*(.+)$/);
  if (!match) {
    throw new Error(`Unsupported @for initializer: ${normalized}`);
  }
  context.set(match[1], context.evaluateValue(match[2]));
}

function applyStep(expression, context) {
  const normalized = String(expression ?? ``).trim();
  if (!normalized) return;

  let match = normalized.match(/^([A-Za-z_$][\w.$]*)\+\+$/);
  if (match) {
    context.set(match[1], Number(context.get(match[1], 0)) + 1);
    return;
  }
  match = normalized.match(/^([A-Za-z_$][\w.$]*)--$/);
  if (match) {
    context.set(match[1], Number(context.get(match[1], 0)) - 1);
    return;
  }
  match = normalized.match(/^([A-Za-z_$][\w.$]*)\s*\+=\s*(.+)$/);
  if (match) {
    context.set(match[1], Number(context.get(match[1], 0)) + Number(context.evaluateValue(match[2])));
    return;
  }
  match = normalized.match(/^([A-Za-z_$][\w.$]*)\s*-=\s*(.+)$/);
  if (match) {
    context.set(match[1], Number(context.get(match[1], 0)) - Number(context.evaluateValue(match[2])));
    return;
  }
  applyAssignment(normalized, context);
}

function parseForeachExpression(expression) {
  const match = String(expression ?? ``).trim().match(/^([A-Za-z_$][\w$]*)\s+(in|of)\s+(.+)$/);
  if (!match) {
    throw new Error(`@foreach requires "item in/of collection"`);
  }
  return {
    variableName: match[1],
    mode: match[2],
    collectionExpression: match[3].trim()
  };
}

function parseForentriesExpression(expression) {
  const match = String(expression ?? ``).trim().match(/^([A-Za-z_$][\w$]*)\s+in\s+(.+)$/);
  if (!match) {
    throw new Error(`@forentries requires "entry in directory"`);
  }
  return {
    variableName: match[1],
    directoryExpression: match[2].trim()
  };
}

function buildForeachIterable(collection, mode) {
  if (Array.isArray(collection)) {
    return mode === `in`
      ? collection.map((_, index) => index)
      : collection;
  }
  if (collection && typeof collection === `object`) {
    return mode === `in`
      ? Object.keys(collection)
      : Object.values(collection);
  }
  return [];
}

async function readDirectoryEntries(directoryPath, context) {
  let stats;
  try {
    stats = await fs.promises.stat(directoryPath);
  } catch (error) {
    throw new Error(`e-renderer forentries could not access directory "${directoryPath}": ${error?.message ?? error}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`e-renderer forentries requires a directory target: ${directoryPath}`);
  }

  let dirents;
  try {
    dirents = await fs.promises.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    throw new Error(`e-renderer forentries could not list directory "${directoryPath}": ${error?.message ?? error}`);
  }

  return dirents
    .slice()
    .sort((left, right) => String(left?.name ?? ``).localeCompare(String(right?.name ?? ``)))
    .map((entry) => ({
      name: String(entry?.name ?? ``),
      path: path.relative(context.assetsRoot, path.join(directoryPath, String(entry?.name ?? ``))),
      isFile: Boolean(entry?.isFile?.()),
      isFolder: Boolean(entry?.isDirectory?.())
    }));
}

function escapeHtml(value) {
  return String(value ?? ``)
    .replaceAll(`&`, `&amp;`)
    .replaceAll(`<`, `&lt;`)
    .replaceAll(`>`, `&gt;`)
    .replaceAll(`"`, `&quot;`)
    .replaceAll(`'`, `&#39;`);
}
