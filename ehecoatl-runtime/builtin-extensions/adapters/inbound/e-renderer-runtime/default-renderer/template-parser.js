// adapters/outbound/e-renderer-runtime/default-renderer/template-parser.js


'use strict';


const SYNTAX = Object.freeze({
  escapedVariableOpen: `@{{`,
  rawVariableOpen: `@{!!`,
  rawVariableClose: `!!}`,
  variableOpen: `{{`,
  variableClose: `}}`,
  translateOpen: `@t(`,
  includeOpen: `@include(`,
  extendsOpen: `@extends(`,
  sectionOpen: `@section(`,
  endsectionToken: `@endsection`,
  yieldOpen: `@yield(`,
  ifOpen: `@if(`,
  elseifOpen: `@elseif(`,
  elseToken: `@else`,
  endifToken: `@endif`,
  forOpen: `@for(`,
  endforToken: `@endfor`,
  foreachOpen: `@foreach(`,
  endforeachToken: `@endforeach`,
  continueToken: `@continue`,
  breakToken: `@break`
});

class TemplateParser {
  constructor(source) {
    this.source = String(source ?? ``);
    this.index = 0;
  }

  parseNodes(stopTokens = []) {
    const nodes = [];
    while (this.index < this.source.length) {
      const stopToken = stopTokens.find((token) => this.source.startsWith(token, this.index));
      if (stopToken) {
        return { nodes, stopToken };
      }

      if (this.source.startsWith(SYNTAX.rawVariableOpen, this.index)) {
        nodes.push(this.#parseRawVariable());
        continue;
      }
      if (this.source.startsWith(SYNTAX.escapedVariableOpen, this.index)) {
        nodes.push(this.#parseEscapedVariable());
        continue;
      }
      if (this.source.startsWith(SYNTAX.variableOpen, this.index)) {
        nodes.push(this.#parseVariable());
        continue;
      }
      if (this.source.startsWith(SYNTAX.translateOpen, this.index)) {
        nodes.push(this.#parseCall(`translate`, SYNTAX.translateOpen));
        continue;
      }
      if (this.source.startsWith(SYNTAX.includeOpen, this.index)) {
        nodes.push(this.#parseCall(`include`, SYNTAX.includeOpen));
        continue;
      }
      if (this.source.startsWith(SYNTAX.extendsOpen, this.index)) {
        nodes.push(this.#parseCall(`extends`, SYNTAX.extendsOpen));
        continue;
      }
      if (this.source.startsWith(SYNTAX.yieldOpen, this.index)) {
        nodes.push(this.#parseCall(`yield`, SYNTAX.yieldOpen));
        continue;
      }
      if (this.source.startsWith(SYNTAX.sectionOpen, this.index)) {
        nodes.push(this.#parseSectionBlock());
        continue;
      }
      if (this.source.startsWith(SYNTAX.ifOpen, this.index)) {
        nodes.push(this.#parseIfBlock());
        continue;
      }
      if (this.source.startsWith(SYNTAX.forOpen, this.index)) {
        nodes.push(this.#parseLoopBlock(`for`, SYNTAX.forOpen, SYNTAX.endforToken));
        continue;
      }
      if (this.source.startsWith(SYNTAX.foreachOpen, this.index)) {
        nodes.push(this.#parseLoopBlock(`foreach`, SYNTAX.foreachOpen, SYNTAX.endforeachToken));
        continue;
      }
      if (this.source.startsWith(SYNTAX.continueToken, this.index)) {
        nodes.push(this.#parseStandalone(`continue`, SYNTAX.continueToken));
        continue;
      }
      if (this.source.startsWith(SYNTAX.breakToken, this.index)) {
        nodes.push(this.#parseStandalone(`break`, SYNTAX.breakToken));
        continue;
      }

      nodes.push(this.#parseText(stopTokens));
    }
    return nodes;
  }

  #parseText(stopTokens = []) {
    const tokenStarts = [
      SYNTAX.rawVariableOpen,
      SYNTAX.escapedVariableOpen,
      SYNTAX.variableOpen,
      SYNTAX.translateOpen,
      SYNTAX.includeOpen,
      SYNTAX.extendsOpen,
      SYNTAX.sectionOpen,
      SYNTAX.yieldOpen,
      SYNTAX.ifOpen,
      SYNTAX.forOpen,
      SYNTAX.foreachOpen,
      SYNTAX.continueToken,
      SYNTAX.breakToken
    ];
    const nextIndexes = tokenStarts
      .map((token) => this.source.indexOf(token, this.index))
      .filter((value) => value >= 0);
    const stopIndexes = stopTokens
      .map((token) => this.source.indexOf(token, this.index))
      .filter((value) => value >= 0);
    const candidates = [...nextIndexes, ...stopIndexes];
    const nextIndex = candidates.length > 0
      ? Math.min(...candidates)
      : this.source.length;
    const value = this.source.slice(this.index, nextIndex);
    this.index = nextIndex;
    return {
      type: `text`,
      value
    };
  }

  #parseEscapedVariable() {
    const endIndex = this.source.indexOf(SYNTAX.variableClose, this.index + SYNTAX.escapedVariableOpen.length);
    if (endIndex < 0) {
      throw new Error(`Unterminated escaped variable snippet`);
    }
    const expression = this.source.slice(this.index + SYNTAX.escapedVariableOpen.length, endIndex).trim();
    this.index = endIndex + SYNTAX.variableClose.length;
    return {
      type: `escapedVariable`,
      expression
    };
  }

  #parseRawVariable() {
    const endIndex = this.source.indexOf(SYNTAX.rawVariableClose, this.index + SYNTAX.rawVariableOpen.length);
    if (endIndex < 0) {
      throw new Error(`Unterminated raw variable snippet`);
    }
    const expression = this.source.slice(this.index + SYNTAX.rawVariableOpen.length, endIndex).trim();
    this.index = endIndex + SYNTAX.rawVariableClose.length;
    return {
      type: `rawVariable`,
      expression
    };
  }

  #parseVariable() {
    const endIndex = this.source.indexOf(SYNTAX.variableClose, this.index + SYNTAX.variableOpen.length);
    if (endIndex < 0) {
      throw new Error(`Unterminated variable snippet`);
    }
    const expression = this.source.slice(this.index + SYNTAX.variableOpen.length, endIndex).trim();
    this.index = endIndex + SYNTAX.variableClose.length;
    return {
      type: `variable`,
      expression
    };
  }

  #parseCall(type, token) {
    const expression = this.#readBalancedCall(token);
    return { type, expression };
  }

  #parseStandalone(type, token) {
    this.index += token.length;
    return { type };
  }

  #parseSectionBlock() {
    const expression = this.#readBalancedCall(SYNTAX.sectionOpen);
    const result = this.parseNodes([SYNTAX.endsectionToken]);
    if (result.stopToken !== SYNTAX.endsectionToken) {
      throw new Error(`Unterminated @section block`);
    }
    this.index += SYNTAX.endsectionToken.length;
    return {
      type: `section`,
      expression,
      nodes: result.nodes
    };
  }

  #parseIfBlock() {
    const branches = [];
    const firstCondition = this.#readBalancedCall(SYNTAX.ifOpen);
    let branchResult = this.parseNodes([SYNTAX.elseifOpen, SYNTAX.elseToken, SYNTAX.endifToken]);
    branches.push({
      condition: firstCondition,
      nodes: branchResult.nodes
    });

    while (branchResult.stopToken === SYNTAX.elseifOpen) {
      const condition = this.#readBalancedCall(SYNTAX.elseifOpen);
      branchResult = this.parseNodes([SYNTAX.elseifOpen, SYNTAX.elseToken, SYNTAX.endifToken]);
      branches.push({
        condition,
        nodes: branchResult.nodes
      });
    }

    let elseNodes = [];
    if (branchResult.stopToken === SYNTAX.elseToken) {
      this.index += SYNTAX.elseToken.length;
      branchResult = this.parseNodes([SYNTAX.endifToken]);
      elseNodes = branchResult.nodes;
    }

    if (branchResult.stopToken !== SYNTAX.endifToken) {
      throw new Error(`Unterminated @if block`);
    }
    this.index += SYNTAX.endifToken.length;

    return {
      type: `if`,
      branches,
      elseNodes
    };
  }

  #parseLoopBlock(type, openToken, closeToken) {
    const expression = this.#readBalancedCall(openToken);
    const result = this.parseNodes([closeToken]);
    if (result.stopToken !== closeToken) {
      throw new Error(`Unterminated ${openToken} block`);
    }
    this.index += closeToken.length;
    return {
      type,
      expression,
      nodes: result.nodes
    };
  }

  #readBalancedCall(token) {
    this.index += token.length;
    let depth = 1;
    let expression = ``;
    let quote = null;

    while (this.index < this.source.length) {
      const current = this.source[this.index];
      if (quote) {
        expression += current;
        if (current === `\\`) {
          this.index += 1;
          if (this.index < this.source.length) {
            expression += this.source[this.index];
          }
        } else if (current === quote) {
          quote = null;
        }
        this.index += 1;
        continue;
      }

      if (current === `'` || current === `"`) {
        quote = current;
        expression += current;
        this.index += 1;
        continue;
      }

      if (current === `(`) {
        depth += 1;
        expression += current;
        this.index += 1;
        continue;
      }
      if (current === `)`) {
        depth -= 1;
        if (depth === 0) {
          this.index += 1;
          return expression.trim();
        }
        expression += current;
        this.index += 1;
        continue;
      }

      expression += current;
      this.index += 1;
    }

    throw new Error(`Unterminated ${token} snippet`);
  }
}

module.exports = TemplateParser;
Object.freeze(module.exports);
