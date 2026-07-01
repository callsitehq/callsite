# @callsitehq/cli

## 0.2.0

### Minor Changes

- abc6616: Remove generated runtime handlers and `callsite dev` from the CLI. `callsite build` now emits static artifacts only, and host applications compose Callsite runtime adapters inside their own entrypoints.

  Update runtime package metadata to describe the host-composed capability dispatch model.

### Patch Changes

- Updated dependencies [690012f]
  - @callsitehq/emit@0.2.0
  - @callsitehq/core@0.2.0

## 0.1.0

### Minor Changes

- Initial Callsite package scaffold.

### Patch Changes

- Updated dependencies
  - @callsitehq/core@0.1.0
  - @callsitehq/emit@0.1.0
