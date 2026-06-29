# @callsitehq/runtime

Runtime dispatch engine for Callsite capabilities.

Use this package to execute Callsite capabilities through one transport-neutral
validation and dispatch path. HTTP and other surfaces should adapt into this
runtime instead of reimplementing validation, error mapping, and handler lookup.

```ts
import { createRuntimeManifest, execute } from "@callsitehq/runtime";
```

`createFetchHandler()` is also exported as a thin web-standard
`Request -> Response` adapter over `execute()`.

## Status

Early `0.x` package. The transport-neutral runtime path is implemented first;
surface-specific adapters are intentionally thin.
