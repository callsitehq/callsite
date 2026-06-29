---
"@callsitehq/cli": minor
"@callsitehq/runtime": patch
---

Remove generated runtime handlers and `callsite dev` from the CLI. `callsite build` now emits static artifacts only, and host applications compose Callsite runtime adapters inside their own entrypoints.

Update runtime package metadata to describe the host-composed capability dispatch model.
