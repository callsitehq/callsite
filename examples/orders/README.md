# Orders Example

Private example showing the full Callsite loop:

- define Zod-backed capabilities in `src/capabilities.ts`
- compose app-owned services in `src/app.ts`
- configure the CLI in `callsite.config.ts`
- emit `generated/mcp.json` and `generated/openapi.json`
- compose the capabilities into an app-owned Node server in `src/server.ts`

See [How To Build With Callsite](../../docs/how-to-build-with-callsite.md) for
the full development guide.

```sh
pnpm --filter @callsitehq/example-orders... build
pnpm --filter @callsitehq/example-orders dev
pnpm --filter @callsitehq/example-orders test
```

The example keeps the Callsite boundary thin:

- `src/services.ts` owns use cases, feature flags, events, and in-memory data
- `src/capabilities.ts` maps validated input and domain errors to Callsite
  capabilities
- `src/server.ts` supplies per-request context such as identity and logging

Long-lived app services are closed over by capability factories. Per-request
facts flow through Callsite context.
