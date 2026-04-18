// test/e-renderer-template-parser.test.js


'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const TemplateParser = require(`@adapter/inbound/e-renderer-runtime/default-renderer/template-parser`);

test(`template parser recognizes escaping, layout, and loop-control snippets`, () => {
  const parser = new TemplateParser([
    `@extends('layouts/base.e.html')`,
    `@section('body')`,
    `@markdown('docs/page.md')`,
    `{{value}}`,
    `@{{value}}`,
    `@{!! value !!}`,
    `@yield('slot')`,
    `@if(show)@continue@else@break@endif`,
    `@endsection`
  ].join(``));

  const nodes = parser.parseNodes();

  assert.equal(nodes[0].type, `extends`);
  assert.equal(nodes[1].type, `section`);
  assert.deepEqual(
    nodes[1].nodes.map((node) => node.type),
    [`markdown`, `variable`, `escapedVariable`, `rawVariable`, `yield`, `if`]
  );
  assert.deepEqual(
    nodes[1].nodes[5].branches[0].nodes.map((node) => node.type),
    [`continue`]
  );
  assert.deepEqual(
    nodes[1].nodes[5].elseNodes.map((node) => node.type),
    [`break`]
  );
});
