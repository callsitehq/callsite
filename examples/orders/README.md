# Orders Example

Private example showing the full Callsite loop:

- define Zod-backed capabilities in `src/capabilities.ts`
- configure the CLI in `callsite.config.ts`
- emit `generated/mcp.json` and `generated/openapi.json`
- compose the capabilities into an app-owned Node server in `src/server.ts`

```sh
pnpm --filter @callsitehq/example-orders... build
pnpm --filter @callsitehq/example-orders dev
pnpm --filter @callsitehq/example-orders test
```

Put host-owned composition such as logging, identity, credentials, and server
lifecycle in `src/server.ts`.
