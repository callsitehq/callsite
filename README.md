# Callsite

Define intent-level TypeScript capabilities once and generate agent-facing artifacts from that
source of truth.

## Packages

- `@callsitehq/core`: authoring API, IR types, and the validation boundary.
- `@callsitehq/emit`: pure renderers from IR to static artifacts.
- `@callsitehq/runtime`: `Request -> Response` dispatch engine.
- `@callsitehq/cli`: `callsite` command for building generated outputs.

## Development

```sh
pnpm install
pnpm check
pnpm build
```
