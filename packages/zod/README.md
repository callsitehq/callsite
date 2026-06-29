# @callsitehq/zod

Zod adapter for Callsite capability configs.

Use this package when your capabilities use Zod schemas and you want the CLI to
compile capabilities into Callsite IR without writing a JSON Schema mapper.

```ts
import { defineConfig } from "@callsitehq/zod";

import { capabilities } from "./src/capabilities.js";

export default defineConfig({
  capabilities
});
```

## Status

Early `0.x` package. It targets Zod 4's native JSON Schema emission.
