# @callsitehq/emit

Pure renderers for Callsite artifacts.

Use this package to turn a Callsite IR into static agent-facing files such as
MCP config, OpenAPI, ChatGPT app config, and Claude connector config.

```ts
import { emitMcpJson, emitOpenApi } from "@callsitehq/emit";
```

## Status

Early `0.x` package. Output formats may change as surface support is expanded.
