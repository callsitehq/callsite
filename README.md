# Callsite

Define intent-level TypeScript capabilities once, then use the same source of
truth for agent-facing files and hosted runtime surfaces.

Callsite is for teams that want one application-owned capability definition to
serve multiple consumers:

- `mcp.json` for MCP tool discovery
- an OpenAPI spec for HTTP clients and docs
- a hosted HTTP runtime for `POST /capabilities/{id}`
- hosted MCP tools registered on an MCP SDK server
- future surfaces such as docs, SDKs, and additional agent manifests

The important constraint is inversion: Callsite does not own your app process.
Your app owns auth, services, databases, logging, deployment, and local
development. Callsite gives you small libraries and static emitters that you
compose inside the entrypoints you already control.

## How It Works

1. Define capabilities in TypeScript with `id`, `intent`, Standard
   Schema-compatible `input`/`output`, optional declared errors, and `run`.
2. Use `@callsitehq/zod` or another adapter to lower schemas into JSON Schema.
3. Run `callsite build` to emit static artifacts such as `mcp.json` and
   `openapi.json`.
4. Import `@callsitehq/runtime` in your own server, Lambda, Express app, or MCP
   SDK host to execute the same capabilities.

```ts
import { capability, CapabilityError } from "@callsitehq/core";
import { z } from "zod";

export const refundOrder = capability({
  id: "orders.refund",
  intent:
    "Refund a customer's paid order. Use after the customer has selected a specific paid order and wants money returned.",
  input: z.object({
    orderId: z.string(),
    amountCents: z.number().int().positive().optional()
  }),
  output: z.object({
    refundId: z.string(),
    status: z.enum(["refunded", "pending"])
  }),
  destructive: true,
  errors: [
    {
      code: "unauthorized",
      intent: "A signed-in support subject is required to refund orders."
    },
    {
      code: "conflict",
      intent: "The order is not refundable or the requested amount is too high."
    }
  ],
  async run(input, context) {
    if (context.subject === undefined) {
      throw new CapabilityError("unauthorized", "A signed-in subject is required.");
    }

    return { refundId: "re_123", status: "refunded" as const };
  }
});
```

The capability is above transport. It does not know whether it is being called
from MCP, HTTP, Express, Lambda, or a test.

## Packages

| Package               | npm                                                        | Description                                                         |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `@callsitehq/core`    | [`npm`](https://www.npmjs.com/package/@callsitehq/core)    | Authoring API, IR types, and the validation boundary.               |
| `@callsitehq/emit`    | [`npm`](https://www.npmjs.com/package/@callsitehq/emit)    | Pure renderers from IR to `mcp.json` and OpenAPI.                   |
| `@callsitehq/runtime` | [`npm`](https://www.npmjs.com/package/@callsitehq/runtime) | Validation, dispatch, HTTP adapters, and MCP SDK tool registration. |
| `@callsitehq/zod`     | [`npm`](https://www.npmjs.com/package/@callsitehq/zod)     | Zod adapter for capability config files.                            |
| `@callsitehq/cli`     | [`npm`](https://www.npmjs.com/package/@callsitehq/cli)     | `callsite` command for building generated outputs.                  |

## CLI

`callsite build` loads `callsite.config.ts` by default and writes static files to
`dist/callsite`.

```ts
import { defineConfig } from "@callsitehq/zod";

import { capabilities } from "./src/app.js";

export default defineConfig({
  capabilities,
  emit: {
    mcp: {
      name: "orders",
      version: "0.1.0"
    },
    openapi: {
      baseUrl: "https://api.example.com",
      name: "Orders API",
      version: "0.1.0"
    }
  }
});
```

```sh
pnpm exec callsite build --config callsite.config.ts --out dist/callsite
```

The CLI emits static artifacts only. It does not generate a server or host your
capabilities.

## Runtime

Host applications import the runtime and pass request-scoped context from their
own composition root:

```ts
import { createFetchHandler } from "@callsitehq/runtime";

import { capabilities } from "./src/app.js";

export const callsiteHandler = createFetchHandler(capabilities, {
  context(request) {
    return {
      subject: request.headers.get("x-subject") ?? undefined,
      log(event, data) {
        console.log(JSON.stringify({ event, data }));
      }
    };
  }
});
```

Use `@callsitehq/runtime/node`, `@callsitehq/runtime/express`, and
`@callsitehq/runtime/aws-lambda` as thin adapters over that fetch-native
handler. Use `@callsitehq/runtime/mcp` to register the same capabilities on an
MCP SDK server, alongside any host-owned MCP tools.

## Examples

- `examples/orders`: full Zod-backed orders flow from capabilities to generated
  MCP/OpenAPI artifacts, host-owned HTTP runtime execution, and MCP SDK hosting.

## Docs

- [How To Build With Callsite](docs/how-to-build-with-callsite.md): guide to
  defining capabilities, composing app services, passing request context, and
  emitting artifacts.
- [Design Doc](docs/design-doc.md): product design and architecture notes.

## Development

```sh
pnpm install
pnpm check
pnpm build
```

To regenerate only the orders example artifacts and any workspace dependencies
it needs:

```sh
pnpm --filter @callsitehq/example-orders... build
```
