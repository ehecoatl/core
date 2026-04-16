// _core/runtimes/e-renderer-runtime/e-renderer-context.js


'use strict';


const path = require(`node:path`);

class ERendererContext {
  config;
  templatePath;
  assetsRoot;
  scopes;
  request;
  session;
  route;
  meta;
  i18n;
  compiledI18nReplacer;
  ignored;
  templateStateStack;
  loopIterations;
  loopControlStack;
  sections;
  renderTemplateCallback;
  renderNodesCallback;

  constructor({
    config = {},
    templatePath,
    assetsRoot,
    renderContextSeed = {},
    i18n = {},
    compiledI18nReplacer = null
  } = {}) {
    this.config = config ?? {};
    this.templatePath = String(templatePath ?? ``);
    this.assetsRoot = path.resolve(String(assetsRoot ?? path.dirname(this.templatePath) ?? ``));
    this.request = renderContextSeed?.request ?? null;
    this.session = renderContextSeed?.session ?? null;
    this.route = renderContextSeed?.route ?? null;
    this.meta = renderContextSeed?.meta ?? null;
    this.i18n = { ...(i18n ?? {}) };
    this.compiledI18nReplacer = typeof compiledI18nReplacer === `function`
      ? compiledI18nReplacer
      : null;
    this.ignored = false;
    this.templateStateStack = [];
    this.loopIterations = 0;
    this.loopControlStack = [];
    this.sections = new Map();
    this.renderTemplateCallback = null;
    this.renderNodesCallback = null;

    const view = isPlainObject(renderContextSeed?.view) ? renderContextSeed.view : {};
    this.scopes = [{
      ...view,
      view,
      request: this.request,
      session: this.session,
      route: this.route,
      meta: this.meta
    }];
  }

  bindRenderer({
    renderTemplate,
    renderNodes
  } = {}) {
    this.renderTemplateCallback = typeof renderTemplate === `function` ? renderTemplate : null;
    this.renderNodesCallback = typeof renderNodes === `function` ? renderNodes : null;
  }

  get(pathExpression, defaultValue = undefined) {
    const normalizedPath = String(pathExpression ?? ``).trim();
    if (!normalizedPath) return defaultValue;

    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const candidate = resolvePath(this.scopes[i], normalizedPath);
      if (candidate.found) {
        return candidate.value;
      }
    }

    return defaultValue;
  }

  set(pathExpression, value) {
    const normalizedPath = String(pathExpression ?? ``).trim();
    if (!normalizedPath) return;
    setPath(this.scopes[this.scopes.length - 1], normalizedPath, value);
  }

  pushScope(scope = {}) {
    this.scopes.push(isPlainObject(scope) ? { ...scope } : {});
  }

  popScope() {
    if (this.scopes.length <= 1) return;
    this.scopes.pop();
  }

  setIgnored(value) {
    this.ignored = Boolean(value);
  }

  isIgnored() {
    return this.ignored === true;
  }

  setSection(name, content) {
    const normalizedName = String(name ?? ``).trim();
    if (!normalizedName) return;
    this.sections.set(normalizedName, String(content ?? ``));
  }

  getSection(name) {
    return this.sections.get(String(name ?? ``).trim()) ?? ``;
  }

  hasSection(name) {
    return this.sections.has(String(name ?? ``).trim());
  }

  beginTemplate(templatePath) {
    const normalizedPath = String(templatePath ?? ``).trim();
    const maxIncludeDepth = Number(this.config.maxIncludeDepth ?? 10);
    if (this.templateStateStack.length >= Math.max(1, maxIncludeDepth)) {
      throw new Error(`e-renderer template depth exceeded configured maximum`);
    }

    this.templateStateStack.push({
      templatePath: normalizedPath,
      parentLayout: null
    });
    this.templatePath = normalizedPath;
  }

  endTemplate() {
    this.templateStateStack.pop();
    const current = this.currentTemplateState();
    if (current?.templatePath) {
      this.templatePath = current.templatePath;
    }
  }

  currentTemplateState() {
    return this.templateStateStack[this.templateStateStack.length - 1] ?? null;
  }

  setParentLayout(targetPath) {
    const current = this.currentTemplateState();
    if (!current) {
      throw new Error(`e-renderer parent layout requires an active template state`);
    }
    if (current.parentLayout && current.parentLayout !== targetPath) {
      throw new Error(`e-renderer template declares multiple @extends targets`);
    }
    current.parentLayout = String(targetPath ?? ``);
  }

  consumeParentLayout() {
    const current = this.currentTemplateState();
    if (!current) return null;
    const parentLayout = current.parentLayout ?? null;
    current.parentLayout = null;
    return parentLayout;
  }

  beginRepeat(iterable = []) {
    const values = Array.isArray(iterable) ? iterable : [];
    return values[Symbol.iterator]();
  }

  nextRepeat(iterator) {
    if (!iterator || typeof iterator.next !== `function`) return { done: true, value: undefined };
    return iterator.next();
  }

  translate(key) {
    const normalizedKey = String(key ?? ``);
    return this.i18n[normalizedKey] ?? normalizedKey;
  }

  replaceI18nTokens(source) {
    const normalizedSource = String(source ?? ``);
    if (typeof this.compiledI18nReplacer !== `function`) {
      return normalizedSource;
    }
    return this.compiledI18nReplacer(normalizedSource);
  }

  resolveInclude(includeTarget) {
    const normalizedTarget = String(includeTarget ?? ``).trim();
    if (!normalizedTarget || path.isAbsolute(normalizedTarget)) {
      throw new Error(`e-renderer include requires a relative path inside assets root`);
    }

    const resolvedPath = path.resolve(this.assetsRoot, normalizedTarget);
    if (
      resolvedPath !== this.assetsRoot &&
      !resolvedPath.startsWith(`${this.assetsRoot}${path.sep}`)
    ) {
      throw new Error(`e-renderer include escaped assets root: ${normalizedTarget}`);
    }

    return resolvedPath;
  }

  async renderInclude(includeTarget) {
    const includePath = this.resolveInclude(includeTarget);
    if (typeof this.renderTemplateCallback !== `function`) {
      throw new Error(`e-renderer context is missing renderTemplate callback`);
    }
    return await this.renderTemplateCallback(includePath);
  }

  async renderNodes(nodes = []) {
    if (typeof this.renderNodesCallback !== `function`) {
      throw new Error(`e-renderer context is missing renderNodes callback`);
    }
    return await this.renderNodesCallback(nodes);
  }

  bumpLoopIteration() {
    this.loopIterations += 1;
    const maxLoopIterations = Number(this.config.maxLoopIterations ?? 1000);
    if (this.loopIterations > Math.max(1, maxLoopIterations)) {
      throw new Error(`e-renderer loop iterations exceeded configured maximum`);
    }
  }

  enterLoop() {
    this.loopControlStack.push({
      breakRequested: false,
      continueRequested: false
    });
  }

  exitLoop() {
    this.loopControlStack.pop();
  }

  requestBreak() {
    const currentLoop = this.loopControlStack[this.loopControlStack.length - 1] ?? null;
    if (!currentLoop) {
      throw new Error(`@break is only valid inside @for or @foreach`);
    }
    currentLoop.breakRequested = true;
  }

  requestContinue() {
    const currentLoop = this.loopControlStack[this.loopControlStack.length - 1] ?? null;
    if (!currentLoop) {
      throw new Error(`@continue is only valid inside @for or @foreach`);
    }
    currentLoop.continueRequested = true;
  }

  consumeBreak() {
    const currentLoop = this.loopControlStack[this.loopControlStack.length - 1] ?? null;
    if (!currentLoop?.breakRequested) return false;
    currentLoop.breakRequested = false;
    return true;
  }

  consumeContinue() {
    const currentLoop = this.loopControlStack[this.loopControlStack.length - 1] ?? null;
    if (!currentLoop?.continueRequested) return false;
    currentLoop.continueRequested = false;
    return true;
  }

  hasPendingLoopControl() {
    const currentLoop = this.loopControlStack[this.loopControlStack.length - 1] ?? null;
    return Boolean(currentLoop?.breakRequested || currentLoop?.continueRequested);
  }

  resetLoopControl() {
    const currentLoop = this.loopControlStack[this.loopControlStack.length - 1] ?? null;
    if (!currentLoop) return;
    currentLoop.breakRequested = false;
    currentLoop.continueRequested = false;
  }

  evaluateExpression(expression) {
    return evaluateExpression(String(expression ?? ``), this);
  }

  evaluateValue(expression) {
    return evaluateValue(String(expression ?? ``), this);
  }
}

module.exports = ERendererContext;
Object.freeze(module.exports);

function isPlainObject(value) {
  return value != null && typeof value === `object` && !Array.isArray(value);
}

function resolvePath(target, pathExpression) {
  const parts = String(pathExpression ?? ``)
    .split(`.`)
    .map((part) => part.trim())
    .filter(Boolean);

  let current = target;
  if (parts.length === 0) {
    return { found: false, value: undefined };
  }

  for (const part of parts) {
    if (current == null || typeof current !== `object` || !(part in current)) {
      return { found: false, value: undefined };
    }
    current = current[part];
  }

  return { found: true, value: current };
}

function setPath(target, pathExpression, value) {
  const parts = String(pathExpression ?? ``)
    .split(`.`)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return;

  let current = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!isPlainObject(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function evaluateExpression(expression, context) {
  const tokenizer = new ExpressionTokenizer(expression);
  const value = parseOr(tokenizer, context);
  tokenizer.expectEnd();
  return value;
}

function evaluateValue(expression, context) {
  return evaluateExpression(expression, context);
}

function parseOr(tokenizer, context) {
  let left = parseAnd(tokenizer, context);
  while (tokenizer.consume(`||`)) {
    left = Boolean(left) || Boolean(parseAnd(tokenizer, context));
  }
  return left;
}

function parseAnd(tokenizer, context) {
  let left = parseEquality(tokenizer, context);
  while (tokenizer.consume(`&&`)) {
    left = Boolean(left) && Boolean(parseEquality(tokenizer, context));
  }
  return left;
}

function parseEquality(tokenizer, context) {
  let left = parseComparison(tokenizer, context);
  while (true) {
    if (tokenizer.consume(`===`) || tokenizer.consume(`==`)) {
      left = left === parseComparison(tokenizer, context);
      continue;
    }
    if (tokenizer.consume(`!==`) || tokenizer.consume(`!=`)) {
      left = left !== parseComparison(tokenizer, context);
      continue;
    }
    return left;
  }
}

function parseComparison(tokenizer, context) {
  let left = parseUnary(tokenizer, context);
  while (true) {
    if (tokenizer.consume(`>=`)) {
      left = left >= parseUnary(tokenizer, context);
      continue;
    }
    if (tokenizer.consume(`<=`)) {
      left = left <= parseUnary(tokenizer, context);
      continue;
    }
    if (tokenizer.consume(`>`)) {
      left = left > parseUnary(tokenizer, context);
      continue;
    }
    if (tokenizer.consume(`<`)) {
      left = left < parseUnary(tokenizer, context);
      continue;
    }
    return left;
  }
}

function parseUnary(tokenizer, context) {
  if (tokenizer.consume(`!`)) {
    return !Boolean(parseUnary(tokenizer, context));
  }
  return parsePrimary(tokenizer, context);
}

function parsePrimary(tokenizer, context) {
  if (tokenizer.consume(`(`)) {
    const value = parseOr(tokenizer, context);
    tokenizer.expect(`)`);
    return value;
  }

  const token = tokenizer.nextToken();
  if (token == null) {
    throw new Error(`Unexpected end of expression`);
  }
  if (token.type === `number`) return Number(token.value);
  if (token.type === `string`) return token.value;
  if (token.type === `identifier`) {
    if (token.value === `true`) return true;
    if (token.value === `false`) return false;
    if (token.value === `null`) return null;
    if (token.value === `undefined`) return undefined;
    return context.get(token.value);
  }
  throw new Error(`Unsupported token in expression: ${token.value}`);
}

class ExpressionTokenizer {
  constructor(source = ``) {
    this.source = String(source ?? ``);
    this.index = 0;
  }

  consume(operator) {
    this.#skipWhitespace();
    if (this.source.startsWith(operator, this.index)) {
      this.index += operator.length;
      return true;
    }
    return false;
  }

  expect(operator) {
    if (!this.consume(operator)) {
      throw new Error(`Expected "${operator}"`);
    }
  }

  expectEnd() {
    this.#skipWhitespace();
    if (this.index < this.source.length) {
      throw new Error(`Unexpected trailing expression content`);
    }
  }

  nextToken() {
    this.#skipWhitespace();
    if (this.index >= this.source.length) return null;

    const current = this.source[this.index];
    if (current === `'` || current === `"`) {
      return this.#readString(current);
    }
    if (/[0-9]/.test(current)) {
      return this.#readNumber();
    }
    if (/[A-Za-z_$]/.test(current)) {
      return this.#readIdentifier();
    }
    throw new Error(`Unexpected token "${current}"`);
  }

  #readString(quote) {
    let value = ``;
    this.index += 1;
    while (this.index < this.source.length) {
      const current = this.source[this.index];
      if (current === `\\`) {
        this.index += 1;
        if (this.index < this.source.length) {
          value += this.source[this.index];
          this.index += 1;
        }
        continue;
      }
      if (current === quote) {
        this.index += 1;
        return { type: `string`, value };
      }
      value += current;
      this.index += 1;
    }
    throw new Error(`Unterminated string literal`);
  }

  #readNumber() {
    const start = this.index;
    while (this.index < this.source.length && /[0-9.]/.test(this.source[this.index])) {
      this.index += 1;
    }
    return {
      type: `number`,
      value: this.source.slice(start, this.index)
    };
  }

  #readIdentifier() {
    const start = this.index;
    while (this.index < this.source.length && /[A-Za-z0-9_$.\[\]]/.test(this.source[this.index])) {
      this.index += 1;
    }
    return {
      type: `identifier`,
      value: this.source.slice(start, this.index).replace(/\[(\w+)\]/g, `.$1`)
    };
  }

  #skipWhitespace() {
    while (this.index < this.source.length && /\s/.test(this.source[this.index])) {
      this.index += 1;
    }
  }
}
