# @callsitehq/core

Core authoring primitives for Callsite.

Use this package to define intent-level capabilities and build the intermediate
representation that Callsite renderers and runtimes consume.
Capabilities may also declare expected semantic errors; those errors become
part of the IR alongside input/output schemas.

```ts
import { capability, toIR } from "@callsitehq/core";
```

## Status

Early `0.x` package. APIs may change while the capability definition model is
being finalized.
