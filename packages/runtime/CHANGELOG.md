# @callsitehq/runtime

## 0.2.0

### Minor Changes

- 690012f: Add a shared MCP tool mapping helper and composable SDK-backed Callsite tool registration for MCP servers with a capabilities-first runtime API.
- d97a057: Add shallow runtime adapters over the existing fetch-native handler:

  - `@callsitehq/runtime/express` for Express middleware
  - `@callsitehq/runtime/aws-lambda` for API Gateway HTTP API v2 and Lambda Function URL events

### Patch Changes

- abc6616: Remove generated runtime handlers and `callsite dev` from the CLI. `callsite build` now emits static artifacts only, and host applications compose Callsite runtime adapters inside their own entrypoints.

  Update runtime package metadata to describe the host-composed capability dispatch model.

- Updated dependencies [690012f]
  - @callsitehq/emit@0.2.0
  - @callsitehq/core@0.2.0

## 0.1.0

### Minor Changes

- Initial Callsite package scaffold.

### Patch Changes

- Updated dependencies
  - @callsitehq/core@0.1.0
