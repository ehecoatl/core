# Ehecatl Improvement Backlog - Pending

## 4. Observability, Logging And Operational Reporting

### 4.6 Per-tenant and per-process metrics
Track performance and runtime metrics at tenant and process granularity, not only globally.

### 4.7 Health thresholds and alert criteria
Define pass/warn/fail thresholds so generated reports can be interpreted operationally.

---

## 5. Performance, Stability And Capacity

### 5.3 Overload behavior under pressure
Validate throttling, degradation, backpressure, and recovery under overload conditions.

### 5.4 Cache/process churn under concurrency
Verify behavior when cache traffic, concurrent requests, and process churn all increase together.

### 5.5 Resource exhaustion boundaries
Define and test limits such as max child processes, queue growth, stalled workers, and saturation behavior.

---

## 6. Installation, Setup, Configuration And Upgrade Safety

### 6.2 Uninstall and setup-again flow
Define expected behavior for uninstall followed by reinstall/setup.

### 6.3 Easier adapter and plugin template generation
Improve developer experience for creating adapters and plugins, especially template generation into the `etc` folder.

### 6.4 External config validation before boot
Validate external configuration files before runtime startup.

### 6.5 Config schema/version compatibility
Define compatibility rules for future config structure changes.

### 6.6 Safe handling of invalid top-level config replacement
Verify safe behavior when config-section replacement is incomplete, invalid, or mismatched.

---

## 7. Security And Isolation

### 7.3 Static-file and controller-path safety
Validate path resolution and traversal protections for static assets and tenant controllers.

### 7.4 ACLs, proxy restrictions
Verify that filesystem ACLs are actually enforced.

### 7.5 Fail-open vs fail-closed security behavior
Confirm whether security-related failures lead to safe blocking behavior rather than unsafe access.

---

## 8. Dependency Failure And Degraded-Mode Behavior

### 8.3 Failure propagation across manager, storage, cache, and tenant layers
Verify how internal dependency failures propagate through the request path and client response.

### 8.4 Safe and observable degraded mode
Ensure degraded-mode behavior is intentional, visible in logs/metrics, and safe for production use.
