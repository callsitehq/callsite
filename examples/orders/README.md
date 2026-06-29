# Orders Example

Private example showing the full Callsite loop:

- define Zod-backed capabilities in `src/capabilities.ts`
- configure the CLI in `callsite.config.ts`
- emit `generated/mcp.json` and `generated/openapi.json`
- serve the same capabilities through the runtime fetch handler in `src/server.ts`

```sh
pnpm --filter @callsitehq/example-orders... build
pnpm --filter @callsitehq/example-orders test
```
