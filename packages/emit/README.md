# @callsitehq/emit

Pure renderers for Callsite artifacts.

Use this package to turn a Callsite IR into static agent-facing files.
The implemented renderers emit MCP tool configuration and OpenAPI 3.2.

```ts
import { emitMcpJson, emitOpenApi } from "@callsitehq/emit";
```

OpenAPI output is capability-shaped RPC over HTTP: each capability is rendered
as `POST /capabilities/{id}` with JSON input and output schemas.
Declared capability errors render as OpenAPI responses with a standard JSON
error envelope and as MCP Callsite metadata.

## Status

Early `0.x` package. MCP and OpenAPI output are implemented first; other
surfaces are still being rebuilt against the current IR.
