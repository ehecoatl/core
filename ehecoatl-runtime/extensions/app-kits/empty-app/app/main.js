'use strict';

const path = require(`node:path`);

module.exports = {
  declareAppTopology(rootPath = path.resolve(__dirname, `..`)) {
    return {
      label: `standard`,
      root: rootPath,
      ehecoatl: {
        root: path.join(rootPath, `.ehecoatl`),
        log: path.join(rootPath, `.ehecoatl`, `log`),
        error: path.join(rootPath, `.ehecoatl`, `log`, `error`),
        debug: path.join(rootPath, `.ehecoatl`, `log`, `debug`),
        boot: path.join(rootPath, `.ehecoatl`, `log`, `boot`)
      },
      storage: {
        root: path.join(rootPath, `storage`),
        backups: path.join(rootPath, `storage`, `backups`),
        cache: path.join(rootPath, `storage`, `cache`),
        uploads: path.join(rootPath, `storage`, `uploads`),
        logs: path.join(rootPath, `storage`, `logs`),
        internal: path.join(rootPath, `storage`, `.ehecoatl`),
        internalArtifacts: path.join(rootPath, `storage`, `.ehecoatl`, `artifacts`),
        internalTmp: path.join(rootPath, `storage`, `.ehecoatl`, `tmp`)
      },
      assets: {
        root: path.join(rootPath, `assets`),
        i18n: path.join(rootPath, `assets`, `i18n`),
        templates: path.join(rootPath, `assets`, `templates`),
        static: path.join(rootPath, `assets`, `static`)
      },
      config: {
        root: path.join(rootPath, `config`)
      },
      routes: {
        root: path.join(rootPath, `routes`),
        http: path.join(rootPath, `routes`, `http`),
        ws: path.join(rootPath, `routes`, `ws`)
      },
      app: {
        root: path.join(rootPath, `app`),
        http: {
          root: path.join(rootPath, `app`, `http`),
          actions: path.join(rootPath, `app`, `http`, `actions`),
          middlewares: path.join(rootPath, `app`, `http`, `middlewares`)
        },
        ws: {
          root: path.join(rootPath, `app`, `ws`),
          actions: path.join(rootPath, `app`, `ws`, `actions`),
          middlewares: path.join(rootPath, `app`, `ws`, `middlewares`)
        }
      }
    };
  }
};

Object.freeze(module.exports);
