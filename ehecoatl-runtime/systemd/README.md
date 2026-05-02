# Systemd Unit

This folder contains the packaged systemd unit template for Ehecoatl.

## Why The Unit Runs As Root

The service starts as `root` because the bootstrap path is responsible for applying the configured runtime process identity and handing off controlled privilege boundaries during startup.

The unit does not rely on systemd's `User=` handoff for the full runtime tree. Instead, the bootstrap path:

- starts the launcher
- applies the configured runtime identity
- sanitizes capabilities
- starts supervised child processes with the identities defined by contracts and runtime policy

## Resource Limits And Delegated Cgroups

The packaged unit sets a whole-service memory boundary and delegates a child cgroup subtree to the runtime:

- `MemoryMax=1G`
- `OOMPolicy=continue`
- `Delegate=yes`
- `DelegateSubgroup=supervisor`
- `MemoryAccounting=yes`
- `CPUAccounting=yes`
- `TasksAccounting=yes`

`DelegateSubgroup=supervisor` places the launcher and main supervisor processes in the `supervisor` subgroup. This leaves the unit cgroup root available for managed child cgroups named with the `ehecoatl-managed_...` prefix.

The runtime creates one managed cgroup for every supervised process launch. Per-process limits come from `adapters.processForkRuntime.cgroups`:

- `memoryMaxMb` maps to cgroup v2 `memory.max`.
- `cpuMaxPercent` maps to cgroup v2 `cpu.max`.
- `memory.oom.group=1` kills descendants in the same cgroup when the memory limit causes a cgroup OOM.

The service-level `MemoryMax=1G` is a final boundary for the whole tree. The per-process cgroup memory limit is the normal boundary for child crash containment.

## Why Identity Switching Happens Inside Bootstrap

Ehecoatl needs fine-grained control over:

- root bootstrap behavior
- process identity switching
- capability sanitization
- child-process supervision

That is why the runtime performs identity switching inside the bootstrap code instead of delegating the full transition to the service manager alone.
