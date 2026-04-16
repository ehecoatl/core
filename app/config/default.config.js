// config/default.config.js


'use strict';


module.exports = {
  "_adapters": {},

  "app": {
    "customConfigPath": "/etc/opt/ehecatl/config", // Future get from runtime policy
    
    "customSkeletonsPath": "/srv/opt/ehecatl/skeletons",
    "customAdaptersPath": "/srv/opt/ehecatl/adapters",
    "customPluginsPath": "/srv/opt/ehecatl/plugins",
  },

  "plugins": {
    "logger-runtime": {
      "enabled": true,
      "fileLogging": {
        "enabled": true,
        "baseDir": "/var/opt/ehecatl/logs/hourly",
        "maxFiles": 336, //14 days hourly
        "cleanupIntervalMs": 300000 //5minutes
      },
      "tenantReport": {
        "enabled": true,
        "relativePath": "src/report.json",
        "flushIntervalMs": 5000
      }
    },

    "error-reporter": {
      "enabled": true
    },
    
    "process-firewall": {
      "enabled": true,
      "contexts": ["MAIN"],
      "applyTo": {
        "manager": true,
        "tenant": true,
        "engine": false,
        "otherNonEngine": false
      },
      "refreshAfterLaunch": true,
      "commandTimeoutMs": 5000,
      "failOnSetupError": true
    },
  },

  "rpc": {
    "adapter": "ipc",
    "askTimeoutMs": 30000,
    "answerTimeoutMs": 30000
  },

  "queueBroker": {
    "adapter": "event-memory",
    "defaultTTL": 1000
  },

  "networkEngine": {
    "adapter": "uws",
    "trust_proxy": true,
    "port": 443,
    "ssl": {
      "keyPath": "/etc/ssl/key.pem",
      "certPath": "/etc/ssl/cert.pem"
    },
    "limiter": {
      "capacity": 100,
      "time": 10
    },
    "question": {
      "tenancyRouter": "tenancyRouter",
      "authCSRF": "sessionAuthCSRF",
      "getSessionData": "getSessionData",
      "updateSessionData": "setSessionData",
      "cookiesResponse": "sessionCookiesResponse",
      "setSharedObject": "setSharedObject",
      "getSharedObject": "getSharedObject"
    },
  },

  "tenancyRouter": {
    "adapter": "default-tenancy",
    "routeMatchTTL": 60000, //1minute
    "routeMissTTL": 5000, //5seconds
    "spawnTenantAppAfterScan": true,
    "scanActiveCacheKey": "tenancyScanActive",
    "scanActiveTTL": 30000, //30seconds
    "asyncCacheTimeoutMs": 500,
    "scanIntervalMs": 300000, //5minutes
    "responseCacheCleanupIntervalMs": 300000, //5minutes
    "tenantsPath": "/var/opt/ehecatl/tenants",
  },

  "sessionRouter": {
    "adapter": "default-session",
    "cacheTTL": 3600000, //1hour
    "path": "session",
  },

  "processSupervisor": {
    "adapter": "child-process", // child_process, worker_threads

    "engine": {
      "path": "@/bootstrap/bootstrap-engine",
      "concurrentInstances": "max"
    },
    "manager": {
      "path": "@/bootstrap/bootstrap-manager"
    },
    "tenantApp": {
      "path": "@/bootstrap/bootstrap-tenant-app"
    },

    "defaultTimeout": 30000,
    "reloadDrainTimeoutMs": 1000,
    "reloadGracefulExitTimeoutMs": 1500,
    "reloadForceKillFailSafeTimeoutMs": 1000,
    "heartbeat": {
      "timeoutMs": 30000,
      "maxElu": 0.98,
      "maxLagP99Ms": 500,
      "maxLagMaxMs": 1500
    },
    "question": {
      "reloadProcess": "reloadProcess",
      "shutdownProcess": "shutdownProcess",
      "ensureProcess": "ensureProcess",
      "listProcesses": "listProcesses",
      "processCounts": "processCounts"
    }
  },

  "requestPipeline": {
    "adapter": "default-pipeline",
    "maxInputBytes": "1MB",
    "latencyClassification": {
      "enabled": true,
      "profiles": {
        "staticAsset": { "fastMs": 50, "okMs": 120, "slowMs": 300 },
        "cacheHit": { "fastMs": 30, "okMs": 90, "slowMs": 250 },
        "controller": { "fastMs": 150, "okMs": 450, "slowMs": 1200 },
        "sessionController": { "fastMs": 200, "okMs": 600, "slowMs": 1500 },
        "default": { "fastMs": 120, "okMs": 350, "slowMs": 900 }
      }
    },
    "controllerRetryOnProcessRespawn": {
      "enabled": true,
      "maxAttempts": 1,
      "methods": ["GET", "HEAD"],
      "retryDelayMs": 25
    },
    "diskLimit": {
      "enabled": true,
      "defaultMaxBytes": "1GB",
      "trackedPaths": ["cache", "log", "spool"],
      "cleanupFirst": true,
      "cleanupTargetRatio": 0.9
    },
    "queue": {
      "perTenantMaxConcurrent": 5,
      "perSessionMaxConcurrent": 1,
      "staticMaxConcurrent": 10,
      "controllerMaxConcurrent": 5,

      "staticWaitTimeoutMs": 500,
      "controllerWaitTimeoutMs": 1000,
      "sessionWaitTimeoutMs": 1000,
      "waitTimeoutMs": 1000,
      "retryAfterMs": 500
    },
    "responseCacheAsyncTimeoutMs": 1500,
    "question": {
      "enqueue": "queue",
      "dequeue": "dequeue",
      "cleanupByOrigin": "queueCleanupByOrigin",
      "tenantController": "tenantController"
    }
  },

  "storageService": {
    "adapter": "local", // local, s3, gcs
    "s3": {
      "bucket": "ehecatl-storage",
      "region": "us-east-1"
    }
  },

  "sharedCacheService": {
    "adapter": "local-memory", // local-memory, redis
    "defaultTTL": 3600,
    "failurePolicy": {
      "get": { "failOpen": true, "warn": true },
      "set": { "failOpen": true, "warn": true },
      "delete": { "failOpen": true, "warn": true },
      "deleteByPrefix": { "failOpen": true, "warn": true },
      "has": { "failOpen": true, "warn": true },
      "appendList": { "failOpen": true, "warn": true },
      "getList": { "failOpen": true, "warn": true }
    }
  },

}

Object.freeze(module.exports);
