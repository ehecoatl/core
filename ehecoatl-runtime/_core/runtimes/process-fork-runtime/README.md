# Process Fork Runtime

## Purpose

Main-process low-level supervisor runtime use case for spawning, tracking, and stopping child processes.

## Context

- Kernel context: `MAIN`
- Core files: `process-fork-runtime.js`, `managed-process.js`
- Adapter-backed: yes
- Default adapter: `child-process`

## Current Behavior

- Owns the process registry and PID-to-label mapping.
- Binds supervisor RPC listeners such as `shutdownProcess`, `ensureProcess`, `listProcesses`, and `processCounts`.
- Launches managed child processes and records lifecycle events for the watchdog and plugin hooks.
- Acts as the execution layer behind `multiProcessOrchestrator`, which now decides how layer/process intent becomes a concrete child fork.
- Creates one managed cgroup per supervised launch when `adapters.processForkRuntime.cgroups.enabled` is true.
- Registers each child PID with the privileged launcher so it can be attached to the managed cgroup before the child drops privileges.
- Releases managed cgroups on child exit and lets the privileged cleanup scan remove empty stale cgroups.

## Resource Configuration

Default supervised process resources are configured under `adapters.processForkRuntime`:

```js
adapters: {
  processForkRuntime: {
    nodeMaxOldSpaceSizeMb: 192,
    cgroups: {
      enabled: true,
      memoryMaxMb: 192,
      cpuMaxPercent: 50,
      cleanupIntervalMs: 30000,
      delegateSubgroup: "supervisor",
      registryFile: "/var/lib/ehecoatl/registry/managed-cgroups.json"
    }
  }
}
```

- `nodeMaxOldSpaceSizeMb` becomes Node.js `--max-old-space-size`.
- `cgroups.memoryMaxMb` becomes cgroup v2 `memory.max`.
- `cgroups.cpuMaxPercent` becomes cgroup v2 `cpu.max`; `50` is written as `50000 100000`.
- Managed cgroups write `memory.oom.group=1`, so descendants in the same cgroup are killed together on cgroup OOM.
- A process restart always gets a new cgroup id.

Memory pressure over the cgroup limit can kill the process. CPU pressure over the cgroup quota throttles the process instead of killing it.

## Ambiguities

- The default config comments mention possible alternatives like `worker_threads`, but the repo only ships the `child-process` adapter.
- Supervision behavior is implemented here, while restart policy is shared with `watchdog-orchestrator`, so responsibility is intentionally split across two use cases.

## Not Implemented Yet

- A bundled `worker_threads` or other non-fork supervision adapter is not implemented in this repo snapshot.
