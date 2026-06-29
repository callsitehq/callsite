# Orders Example

Private example showing the full Callsite loop:

- define Zod-backed capabilities in `src/capabilities.ts`
- configure the CLI in `callsite.config.ts`
- emit `generated/mcp.json`, `generated/openapi.json`, and `generated/handler.ts`
- serve the same capabilities through the generated runtime fetch handler

```sh
pnpm --filter @callsitehq/example-orders... build
pnpm --filter @callsitehq/example-orders test
```
