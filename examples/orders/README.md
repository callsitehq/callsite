# Orders Example

Private example showing the full Callsite loop:

- define Zod-backed capabilities in `src/capabilities.ts`
- compose app-owned services in `src/app.ts`
- configure the CLI in `callsite.config.ts`
- emit `generated/mcp.json` and `generated/openapi.json`
- compose the capabilities into app-owned HTTP and MCP hosts

See [How To Build With Callsite](../../docs/how-to-build-with-callsite.md) for
the full development guide.

```sh
pnpm --filter @callsitehq/example-orders... build
pnpm --filter @callsitehq/example-orders dev:http
pnpm --filter @callsitehq/example-orders dev:mcp:stdio
pnpm --filter @callsitehq/example-orders dev:mcp:express
pnpm --filter @callsitehq/example-orders test
```

The example keeps the Callsite boundary thin:

- `src/services.ts` owns use cases, feature flags, events, and in-memory data
- `src/capabilities.ts` maps validated input and domain errors to Callsite
  capabilities
- `src/http.ts` builds the reusable `Request -> Response` handler
- `src/node-server.ts` hosts that handler in a Node HTTP server
- `src/mcp.ts` builds an MCP SDK server from the same capabilities
- `src/mcp-stdio.ts` hosts that MCP server over stdio
- `src/mcp-express.ts` hosts that MCP server over Express Streamable HTTP

Long-lived app services are closed over by capability factories. Per-request
facts flow through Callsite context.
