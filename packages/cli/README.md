# @callsitehq/cli

Command-line interface for Callsite.

The package installs the `callsite` binary for generating agent-facing artifacts
and running capabilities locally from a Callsite config. The current build
command emits `mcp.json`, `openapi.json`, and a runtime `handler.ts` for
capability configs.

```sh
callsite build
```

Run the same capabilities locally during development:

```sh
callsite dev
```

By default the CLI looks for `callsite.config.ts`, then the JavaScript config
variants. Zod-backed projects can use `@callsitehq/zod`:

```ts
import { defineConfig } from "@callsitehq/zod";

import { capabilities } from "./src/capabilities.js";

export default defineConfig({ capabilities });
```

## Status

Early `0.x` package. CLI commands and config shape may change while the library
surface is finalized.
