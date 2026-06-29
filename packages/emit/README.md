# @callsitehq/emit

Pure renderers for Callsite artifacts.

Use this package to turn a Callsite IR into static agent-facing files.
The first implemented renderer emits MCP tool configuration.

```ts
import { emitMcpJson } from "@callsitehq/emit";
```

## Status

Early `0.x` package. MCP output is implemented first; other surfaces are still
being rebuilt against the current IR.
