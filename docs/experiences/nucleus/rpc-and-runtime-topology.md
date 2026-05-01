# RPC and Runtime Topology

This experience keeps the runtime understandable by splitting work across named process roles that communicate through explicit RPC surfaces instead of hidden shared state.

## Experience

- `main`, `director`, `transport`, and `isolatedRuntime` each own a distinct part of the runtime lifecycle.
- Process boundaries stay useful because communication happens through explicit message and RPC paths.
- Runtime control can add direct process-local RPC ingress where a flow benefits from bypassing extra routing.

## Implementation

- Bootstrap entrypoints create the process role graph and register their runtime surfaces.
- The shared RPC runtime carries structured questions and answers between processes.
- Direct local ingress, such as the director socket, can expose selected control operations without changing the broader topology.

## Key Files

- `ehecoatl-runtime/bootstrap/process-main.js`
- `ehecoatl-runtime/bootstrap/process-director.js`
- `ehecoatl-runtime/bootstrap/process-transport.js`
- `ehecoatl-runtime/bootstrap/process-isolated-runtime.js`
- `ehecoatl-runtime/_core/runtimes/rpc-runtime/rpc-runtime.js`

## Related Docs

- [Architecture](../../core-concepts/architecture.md)
- [Registry Scan and Reconciliation](../surface/registry-scan-and-reconciliation.md)
- [Process Supervision and Restart Policy](process-supervision-and-restart-policy.md)
