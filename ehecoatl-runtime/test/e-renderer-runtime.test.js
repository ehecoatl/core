// test/e-renderer-runtime.test.js


'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs/promises`);
const os = require(`node:os`);
const path = require(`node:path`);
const { once } = require(`node:events`);
const ERendererRuntime = require(`@/_core/runtimes/e-renderer-runtime`);
const TenantRoute = require(`@/_core/runtimes/ingress-runtime/execution/tenant-route`);

test(`e-renderer-runtime renders variables, translations, conditionals, loops, and includes`, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `e-renderer-runtime-`));
  const assetsRoot = path.join(tempRoot, `assets`);
  const templatePath = path.join(assetsRoot, `index.e.html`);
  const includePath = path.join(assetsRoot, `partials`, `footer.e.html`);
  const sharedI18nPath = path.join(tempRoot, `shared.json`);
  const appI18nPath = path.join(tempRoot, `app.json`);

  await fs.mkdir(path.dirname(includePath), { recursive: true });
  await fs.writeFile(templatePath, [
    `@if(request.method == 'GET')`,
    `Hello {{user.name}}`,
    `@else`,
    `Nope`,
    `@endif`,
    `@foreach(item of items){{item}} @endforeach`,
    `@include('partials/footer.e.html')`,
    `@t('greeting')`
  ].join(`\n`), `utf8`);
  await fs.writeFile(includePath, `Included {{user.role}}`, `utf8`);
  await fs.writeFile(sharedI18nPath, JSON.stringify({
    greeting: `Hello`
  }), `utf8`);
  await fs.writeFile(appI18nPath, JSON.stringify({
    greeting: `Welcome`
  }), `utf8`);

  const runtime = new ERendererRuntime(createKernelContext());
  const stream = await runtime.renderView(templatePath, [sharedI18nPath, appI18nPath], {
    request: { method: `GET` },
    session: { userId: `session_1` },
    route: {
      folders: {
        assetsRootFolder: assetsRoot
      }
    },
    view: {
      user: {
        name: `Ada`,
        role: `admin`
      },
      items: [`A`, `B`]
    }
  });
  const rendered = await readStreamToString(stream);

  assert.match(rendered, /Hello Ada/);
  assert.match(rendered, /A B/);
  assert.match(rendered, /Included admin/);
  assert.match(rendered, /Welcome/);
  assert.equal(runtime.isCompatibleTemplate(templatePath), true);
});

test(`e-renderer-runtime exposes route params for template access`, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `e-renderer-runtime-route-params-`));
  const assetsRoot = path.join(tempRoot, `assets`);
  const templatePath = path.join(assetsRoot, `index.e.html`);

  await fs.mkdir(assetsRoot, { recursive: true });
  await fs.writeFile(templatePath, `Slug {{route.params.slug}}`, `utf8`);

  const runtime = new ERendererRuntime(createKernelContext());
  const rendered = await readStreamToString(await runtime.renderView(templatePath, [], {
    route: {
      params: {
        slug: `post-1`
      },
      folders: {
        assetsRootFolder: assetsRoot
      }
    }
  }));

  assert.equal(rendered, `Slug post-1`);
});

test(`e-renderer-runtime renders markdown files as HTML through @markdown`, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `e-renderer-runtime-markdown-`));
  const assetsRoot = path.join(tempRoot, `assets`);
  const templatePath = path.join(assetsRoot, `index.e.html`);
  const markdownPath = path.join(assetsRoot, `docs`, `page.md`);

  await fs.mkdir(path.dirname(markdownPath), { recursive: true });
  await fs.writeFile(templatePath, `@markdown('docs/page.md')`, `utf8`);
  await fs.writeFile(markdownPath, [
    `# Markdown Title`,
    ``,
    `- item one`,
    `- item two`,
    ``,
    '```js',
    `const answer = 42;`,
    '```',
    ``,
    `<aside>Trusted HTML</aside>`
  ].join(`\n`), `utf8`);

  const runtime = new ERendererRuntime(createKernelContext());
  const rendered = await readStreamToString(await runtime.renderView(templatePath, [], {
    route: {
      folders: {
        assetsRootFolder: assetsRoot
      }
    }
  }));

  assert.match(rendered, /<h1>Markdown Title<\/h1>/);
  assert.match(rendered, /<li>item one<\/li>/);
  assert.match(rendered, /<li>item two<\/li>/);
  assert.match(rendered, /<pre><code class="hljs language-js">/);
  assert.match(rendered, /const/);
  assert.match(rendered, /<aside>Trusted HTML<\/aside>/);
});

test(`e-renderer-runtime supports @for with controlled expressions`, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `e-renderer-runtime-lines-`));
  const templatePath = path.join(tempRoot, `index.e.txt`);
  await fs.writeFile(templatePath, `@for(i = 0; i < limit; i++){{i}}@endfor`, `utf8`);

  const runtime = new ERendererRuntime(createKernelContext());
  const rendered = await readStreamToString(await runtime.renderView(templatePath, [], {
    view: { limit: 3 }
  }));
  assert.equal(rendered, `012`);
});

test(`e-renderer-runtime escapes variables by default and supports explicit raw output`, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `e-renderer-runtime-escape-`));
  const templatePath = path.join(tempRoot, `index.e.html`);
  await fs.writeFile(
    templatePath,
    `{{value}}|@{{value}}|@{!! value !!}|@{!! @t('rich') !!}`,
    `utf8`
  );

  const i18nPath = path.join(tempRoot, `i18n.json`);
  await fs.writeFile(i18nPath, JSON.stringify({
    rich: `<strong>Hi</strong>`
  }), `utf8`);

  const runtime = new ERendererRuntime(createKernelContext());
  const rendered = await readStreamToString(await runtime.renderView(templatePath, [i18nPath], {
    view: {
      value: `<b>Ada</b>`
    }
  }));

  assert.equal(
    rendered,
    `&lt;b&gt;Ada&lt;/b&gt;|&lt;b&gt;Ada&lt;/b&gt;|<b>Ada</b>|<strong>Hi</strong>`
  );
});

test(`e-renderer-runtime supports extends, sections, and yields`, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `e-renderer-runtime-layout-`));
  const assetsRoot = path.join(tempRoot, `assets`);
  const childPath = path.join(assetsRoot, `pages`, `home.e.html`);
  const parentPath = path.join(assetsRoot, `layouts`, `base.e.html`);
  await fs.mkdir(path.dirname(childPath), { recursive: true });
  await fs.mkdir(path.dirname(parentPath), { recursive: true });

  await fs.writeFile(parentPath, [
    `<header>@yield('header')</header>`,
    `<main>@yield('body')</main>`,
    `<footer>@yield('missing')</footer>`
  ].join(``), `utf8`);
  await fs.writeFile(childPath, [
    `@extends('layouts/base.e.html')`,
    `@section('header')Header {{user.name}}@endsection`,
    `@section('body')@if(view.showBody)Visible@endif@endsection`
  ].join(``), `utf8`);

  const runtime = new ERendererRuntime(createKernelContext());
  const rendered = await readStreamToString(await runtime.renderView(childPath, [], {
    route: {
      folders: {
        assetsRootFolder: assetsRoot
      }
    },
    view: {
      showBody: true,
      user: {
        name: `Ada`
      }
    }
  }));

  assert.equal(rendered, `<header>Header Ada</header><main>Visible</main><footer></footer>`);
});

test(`e-renderer-runtime supports @continue and @break inside loops`, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `e-renderer-runtime-loop-control-`));
  const templatePath = path.join(tempRoot, `index.e.txt`);
  await fs.writeFile(templatePath, [
    `@foreach(item of items)`,
    `@if(item == 2)@continue@endif`,
    `@if(item == 4)@break@endif`,
    `{{item}}`,
    `@endforeach`
  ].join(``), `utf8`);

  const runtime = new ERendererRuntime(createKernelContext());
  const rendered = await readStreamToString(await runtime.renderView(templatePath, [], {
    view: {
      items: [1, 2, 3, 4, 5]
    }
  }));

  assert.equal(rendered, `13`);
});

test(`e-renderer-runtime supports @forentries with deterministic entry metadata`, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `e-renderer-runtime-forentries-`));
  const assetsRoot = path.join(tempRoot, `assets`);
  const templatePath = path.join(assetsRoot, `index.e.txt`);
  const entriesRoot = path.join(assetsRoot, `partials`);

  await fs.mkdir(path.join(entriesRoot, `zeta-dir`), { recursive: true });
  await fs.mkdir(path.join(entriesRoot, `alpha-dir`), { recursive: true });
  await fs.writeFile(path.join(entriesRoot, `beta.txt`), `beta`, `utf8`);
  await fs.writeFile(path.join(entriesRoot, `aardvark.txt`), `aardvark`, `utf8`);
  await fs.writeFile(templatePath, [
    `@forentries(entry in listPath)`,
    `@if(entry.name == 'alpha-dir'){{entry.name}}|{{entry.path}}|{{entry.isFolder}}|{{entry.isFile}};@endif`,
    `@if(entry.name == 'aardvark.txt'){{entry.name}}|{{entry.path}}|{{entry.isFolder}}|{{entry.isFile}};@endif`,
    `@if(entry.name == 'beta.txt'){{entry.name}}|{{entry.path}}|{{entry.isFolder}}|{{entry.isFile}};@endif`,
    `@if(entry.name == 'zeta-dir'){{entry.name}}|{{entry.path}}|{{entry.isFolder}}|{{entry.isFile}};@endif`,
    `@endforentries`
  ].join(``), `utf8`);

  const runtime = new ERendererRuntime(createKernelContext());
  const rendered = await readStreamToString(await runtime.renderView(templatePath, [], {
    route: {
      folders: {
        assetsRootFolder: assetsRoot
      }
    },
    view: {
      listPath: `partials`
    }
  }));

  assert.equal(
    rendered,
    `aardvark.txt|partials/aardvark.txt|false|true;alpha-dir|partials/alpha-dir|true|false;beta.txt|partials/beta.txt|false|true;zeta-dir|partials/zeta-dir|true|false;`
  );
});

test(`e-renderer-runtime supports @continue and @break inside @forentries`, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `e-renderer-runtime-forentries-loop-control-`));
  const assetsRoot = path.join(tempRoot, `assets`);
  const templatePath = path.join(assetsRoot, `index.e.txt`);
  const entriesRoot = path.join(assetsRoot, `partials`);

  await fs.mkdir(entriesRoot, { recursive: true });
  await fs.writeFile(path.join(entriesRoot, `alpha.txt`), `alpha`, `utf8`);
  await fs.writeFile(path.join(entriesRoot, `beta.txt`), `beta`, `utf8`);
  await fs.writeFile(path.join(entriesRoot, `gamma.txt`), `gamma`, `utf8`);
  await fs.writeFile(templatePath, [
    `@forentries(entry in 'partials')`,
    `@if(entry.name == 'alpha.txt')@continue@endif`,
    `@if(entry.name == 'gamma.txt')@break@endif`,
    `{{entry.name}}`,
    `@endforentries`
  ].join(``), `utf8`);

  const runtime = new ERendererRuntime(createKernelContext());
  const rendered = await readStreamToString(await runtime.renderView(templatePath, [], {
    route: {
      folders: {
        assetsRootFolder: assetsRoot
      }
    }
  }));

  assert.equal(rendered, `beta.txt`);
});

test(`e-renderer-runtime rejects @continue and @break outside loops`, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `e-renderer-runtime-invalid-loop-control-`));
  const continuePath = path.join(tempRoot, `continue.e.txt`);
  const breakPath = path.join(tempRoot, `break.e.txt`);
  await fs.writeFile(continuePath, `@continue`, `utf8`);
  await fs.writeFile(breakPath, `@break`, `utf8`);

  const runtime = new ERendererRuntime(createKernelContext());

  await assert.rejects(
    () => runtime.renderView(continuePath, [], {}),
    /only valid inside @for, @foreach, or @forentries/
  );
  await assert.rejects(
    () => runtime.renderView(breakPath, [], {}),
    /only valid inside @for, @foreach, or @forentries/
  );
});

test(`e-renderer-runtime blocks include paths outside assets root`, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `e-renderer-runtime-include-`));
  const assetsRoot = path.join(tempRoot, `assets`);
  const templatePath = path.join(assetsRoot, `index.e.html`);
  await fs.mkdir(assetsRoot, { recursive: true });
  await fs.writeFile(templatePath, `@include('../outside.e.html')`, `utf8`);

  const runtime = new ERendererRuntime(createKernelContext());
  await assert.rejects(
    () => runtime.renderView(templatePath, [], {
      route: {
        folders: {
          assetsRootFolder: assetsRoot
        }
      }
    }),
    /assets root/
  );
});

test(`e-renderer-runtime blocks markdown paths outside assets root`, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `e-renderer-runtime-markdown-include-`));
  const assetsRoot = path.join(tempRoot, `assets`);
  const templatePath = path.join(assetsRoot, `index.e.html`);
  await fs.mkdir(assetsRoot, { recursive: true });
  await fs.writeFile(templatePath, `@markdown('../outside.md')`, `utf8`);

  const runtime = new ERendererRuntime(createKernelContext());
  await assert.rejects(
    () => runtime.renderView(templatePath, [], {
      route: {
        folders: {
          assetsRootFolder: assetsRoot
        }
      }
    }),
    /assets root/
  );
});

test(`e-renderer-runtime blocks @forentries paths outside assets root`, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `e-renderer-runtime-forentries-include-`));
  const assetsRoot = path.join(tempRoot, `assets`);
  const templatePath = path.join(assetsRoot, `index.e.txt`);

  await fs.mkdir(assetsRoot, { recursive: true });
  await fs.writeFile(templatePath, `@forentries(entry in '../outside'){{entry.name}}@endforentries`, `utf8`);

  const runtime = new ERendererRuntime(createKernelContext());
  await assert.rejects(
    () => runtime.renderView(templatePath, [], {
      route: {
        folders: {
          assetsRootFolder: assetsRoot
        }
      }
    }),
    /assets root/
  );
});

test(`e-renderer-runtime rejects @forentries targets that are not directories`, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `e-renderer-runtime-forentries-file-target-`));
  const assetsRoot = path.join(tempRoot, `assets`);
  const templatePath = path.join(assetsRoot, `index.e.txt`);
  const fileTarget = path.join(assetsRoot, `partials.txt`);

  await fs.mkdir(assetsRoot, { recursive: true });
  await fs.writeFile(fileTarget, `not a directory`, `utf8`);
  await fs.writeFile(templatePath, `@forentries(entry in 'partials.txt'){{entry.name}}@endforentries`, `utf8`);

  const runtime = new ERendererRuntime(createKernelContext());
  await assert.rejects(
    () => runtime.renderView(templatePath, [], {
      route: {
        folders: {
          assetsRootFolder: assetsRoot
        }
      }
    }),
    /requires a directory target/
  );
});

test(`e-renderer-runtime rejects missing @forentries directories`, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `e-renderer-runtime-forentries-missing-target-`));
  const assetsRoot = path.join(tempRoot, `assets`);
  const templatePath = path.join(assetsRoot, `index.e.txt`);

  await fs.mkdir(assetsRoot, { recursive: true });
  await fs.writeFile(templatePath, `@forentries(entry in 'partials'){{entry.name}}@endforentries`, `utf8`);

  const runtime = new ERendererRuntime(createKernelContext());
  await assert.rejects(
    () => runtime.renderView(templatePath, [], {
      route: {
        folders: {
          assetsRootFolder: assetsRoot
        }
      }
    }),
    /could not access directory/
  );
});

test(`tenant route still treats i18n asset routes as static assets`, () => {
  const route = new TenantRoute({
    pointsTo: `asset > page.e.html`,
    i18n: [`default.json`],
    origin: {
      hostname: `www.example.test`,
      domain: `example.test`,
      appName: `www`,
      tenantId: `tenant_a`,
      appId: `app_a`
    },
    folders: {
      rootFolder: `/tmp/app`,
      actionsRootFolder: `/tmp/app/actions`,
      assetsRootFolder: `/tmp/app/assets`,
      httpMiddlewaresRootFolder: `/tmp/app/http/middlewares`,
      wsMiddlewaresRootFolder: `/tmp/app/ws/middlewares`,
      routesRootFolder: `/tmp/app/routes`
    }
  });

  assert.equal(route.isStaticAsset(), true);
  assert.deepEqual(route.i18n, [`assets/i18n/default.json`]);
});

test(`tenant route keeps canonical i18n paths and rejects absolute i18n entries`, () => {
  const canonicalRoute = new TenantRoute({
    pointsTo: `asset > page.e.html`,
    i18n: [`assets/i18n/default.json`]
  });

  assert.deepEqual(canonicalRoute.i18n, [`assets/i18n/default.json`]);
  assert.throws(
    () => new TenantRoute({
      pointsTo: `asset > page.e.html`,
      i18n: [`/etc/passwd`]
    }),
    /Route i18n must be a non-empty relative path/
  );
});

test(`tenant route exposes immutable params and defaults them when omitted`, () => {
  const route = new TenantRoute({
    pointsTo: `run > blog@show`,
    params: {
      slug: `post-1`
    }
  });
  const routeWithoutParams = new TenantRoute({
    pointsTo: `run > blog@index`
  });

  assert.deepEqual(route.params, { slug: `post-1` });
  assert.deepEqual(route.meta.params, { slug: `post-1` });
  assert.equal(Object.isFrozen(route.params), true);
  assert.deepEqual(routeWithoutParams.params, {});
});

function createKernelContext(overrides = {}) {
  const adapterPath = overrides.adapterPath ?? { bundled: `@adapter/inbound/e-renderer-runtime/default-renderer`, custom: `` };
  const storageService = overrides.storageService ?? {
    async readFile(filePath, encoding) {
      return await fs.readFile(filePath, encoding ?? `utf8`);
    },
    async pipeStreamByLine(readStream, writeStream, lineTransformCallback = null) {
      let firstLine = true;
      let buffered = ``;
      readStream.setEncoding(`utf8`);
      readStream.on(`data`, (chunk) => {
        buffered += String(chunk);
      });
      await once(readStream, `end`);
      const lines = buffered.split(/\n/);
      for (const line of lines) {
        const normalizedLine = line.replace(/\r$/, ``);
        const nextLine = lineTransformCallback
          ? await lineTransformCallback(normalizedLine)
          : normalizedLine;
        if (!firstLine) {
          writeStream.write(`\n`);
        }
        writeStream.write(String(nextLine ?? ``));
        firstLine = false;
      }
      writeStream.end();
      await once(writeStream, `finish`);
    }
  };
  const i18nCompiler = overrides.i18nCompiler ?? {
    config: {},
    async compile(pairsMap = null) {
      const snapshot = { ...(pairsMap ?? {}) };
      const keys = Object.keys(snapshot)
        .sort((left, right) => right.length - left.length)
        .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`));
      if (keys.length === 0) {
        return (source) => String(source ?? ``);
      }
      const expression = new RegExp(keys.join(`|`), `g`);
      return (source) => String(source ?? ``).replace(expression, (match) => snapshot[match] ?? match);
    }
  };

  return {
    config: {
      _adapters: {
        eRendererRuntime: adapterPath
      },
      adapters: {
        eRendererRuntime: {
          adapter: `default-renderer`,
          compatibleFileFormats: [`.e.htm`, `.e.html`, `.e.txt`]
        }
      }
    },
    useCases: {
      storageService,
      i18nCompiler
    },
    ...overrides
  };
}

async function readStreamToString(stream) {
  let body = ``;
  stream.setEncoding?.(`utf8`);
  stream.on(`data`, (chunk) => {
    body += String(chunk);
  });
  await once(stream, `end`);
  return body;
}
