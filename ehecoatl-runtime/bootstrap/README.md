# Runtime Bootstraps

This folder holds the runtime bootstrap entrypoints.

## Files

- `bootstrap.js`
  Thin launcher that forks the main bootstrap process.
- `bootstrap-main.js`
  Root supervisor bootstrap. Starts the main kernel, delegates supervised forks to `multiProcessOrchestrator`, and leaves tenant/app process reconciliation to the director scan flow.
- `bootstrap-director.js`
  Director process bootstrap.
- `bootstrap-transport.js`
  Tenant transport process bootstrap.
- `bootstrap-isolated-runtime.js`
  Per-app isolated runtime bootstrap.
- `../utils/process/bootstrap-capabilities.js`
  Shared bootstrap capability-sanitization helper used by all runtime bootstrap entrypoints.

## Current Boot Flow

```text
index.js
  -> bootstrap/bootstrap.js
    -> fork bootstrap/bootstrap-main.js
      -> multiProcessOrchestrator.forkProcess('supervisionScope', 'director')
      -> director scan completes
      -> main-side ensure tenantScope.transport per active tenant
      -> main-side ensure appScope.isolatedRuntime per active app
```

## Responsibilities

### `bootstrap.js`

- runs as the privileged root launcher started by `systemd`
- attaches signal forwarding from the launcher process
- forks the main bootstrap as a child process
- mirrors the child exit code back to the launcher process
- remains the only runtime bootstrap stage allowed to retain privileged host capabilities
- executes the privileged firewall CLI command implementations forwarded by `bootstrap-main.js`
- executes privileged Nginx validate/reload operations forwarded by `bootstrap-main.js`

### `bootstrap-main.js`

- starts under the root launcher envelope and immediately switches to `ehecoatl:ehecoatl`
- retains only the capability subset required to supervise child identity changes
- loads runtime config
- boots the main kernel
- starts only the first supervised child process: `director`, via `multiProcessOrchestrator`
- registers temporary isolated-runtime spawning with canonical `e_app_{tenant_id}_{app_id}` labels
- supervises the child tree after director scan/reconciliation signals
- owns the direct launcher bridge used for single-purpose network setup or update requests
- forwards tenant-registry firewall sync requests to the launcher parent, which is the only bootstrap stage allowed to execute the firewall command implementations

### Child bootstraps

The child bootstraps are executable process entrypoints.

Each one is responsible for:

- sanitizing inherited capabilities before boot continues
- loading merged config
- booting its kernel
- wiring lifecycle hooks
- applying contract-rendered process identity from supervised fork env
- applying `PROCESS_SECOND_GROUP` as a supplementary group before `setgid()`/`setuid()` when present
- reporting readiness back to the main process

## Notes

- `bootstrap-main.js` is no longer required and executed directly by `index.js`; it is now forked through `bootstrap.js`.
- capability sanitization is centralized in `utils/process/bootstrap-capabilities.js`.
- `systemd` starts `index.js` as `root:root`, and `bootstrap.js` remains the privileged bridge process.
- `bootstrap-main.js` is launched by `bootstrap.js` with `CAP_SETUID` and `CAP_SETGID`, then immediately drops to `ehecoatl:ehecoatl`.
- `bootstrap-director.js`, `bootstrap-transport.js`, and `bootstrap-isolated-runtime.js` now apply contract-rendered identity first and only then re-execute through `setpriv` to drop any remaining inherited capabilities.
- this keeps privileged host operations isolated to the launcher path and inaccessible to custom third-party scripts running inside forked runtime processes.
- the direct bridge from `bootstrap-main.js` to the launcher is intended for deterministic firewall sync/clear and Nginx validate/reload triggers owned by `MAIN` only; it is not a general privileged shell escape surface.
- `main` is the process root of the `supervisionScope` layer, while `director` is the first supervised child and the owner of the first scan and later tenant/app reconciliation.
- `multiProcessOrchestrator` is the high-level spawn facade in `MAIN`; `processForkRuntime` remains the low-level supervised fork runtime.
