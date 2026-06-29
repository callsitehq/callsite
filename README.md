# Callsite

Define intent-level TypeScript capabilities once and generate agent-facing artifacts from that
source of truth.

## Packages

- `@callsitehq/core`: authoring API, IR types, and the validation boundary.
- `@callsitehq/emit`: pure renderers from IR to static artifacts.
- `@callsitehq/runtime`: `Request -> Response` dispatch engine.
- `@callsitehq/zod`: Zod adapter for capability config files.
- `@callsitehq/cli`: `callsite` command for building outputs and running local dev.

## Examples

- `examples/orders`: full Zod-backed orders flow from capabilities to generated
  MCP/OpenAPI artifacts, a runtime handler, and local runtime execution.

## Development

```sh
pnpm install
pnpm check
pnpm build
```

To regenerate only the orders example artifacts and any workspace dependencies
it needs:

```sh
pnpm --filter @callsitehq/example-orders... build
```
