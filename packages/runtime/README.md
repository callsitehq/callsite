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

Node-specific hosting code lives behind a subpath so the default runtime export
stays fetch-native:

```ts
import { createNodeHandler } from "@callsitehq/runtime/node";
```

Express hosting code is also a shallow adapter over the same fetch handler:

```ts
import { createFetchHandler } from "@callsitehq/runtime";
import { createExpressHandler } from "@callsitehq/runtime/express";

const callsiteHandler = createFetchHandler(capabilities, {
  context(request) {
    return {
      subject: request.headers.get("x-subject"),
      log(event, data) {
        console.log({ event, data });
      }
    };
  }
});

app.use("/capabilities", createExpressHandler(callsiteHandler));
```

AWS Lambda hosting for API Gateway HTTP API v2 and Lambda Function URLs lives
behind its own subpath:

```ts
import { createFetchHandler } from "@callsitehq/runtime";
import { createLambdaHandler } from "@callsitehq/runtime/aws-lambda";

const callsiteHandler = createFetchHandler(capabilities, {
  context(request) {
    return {
      subject: request.headers.get("x-subject"),
      log(event, data) {
        console.log({ event, data });
      }
    };
  }
});

export const handler = createLambdaHandler(callsiteHandler);
```

The Lambda adapter intentionally targets payload format v2 first. API Gateway
v1, ALB events, and streaming responses are not normalized by this adapter.
For custom domains with API mappings, configure
`createFetchHandler(capabilities, { basePath })` to match the Lambda event route
path; API Gateway v2 `rawPath` does not include the public custom-domain mapping
prefix.

MCP tool registration lives behind `@callsitehq/runtime/mcp`. It registers
Callsite capabilities on an MCP SDK server; the SDK owns protocol handling and
transports. Install `@modelcontextprotocol/sdk` alongside this package when you
use the MCP adapter:

```ts
import { toJsonSchema } from "@callsitehq/zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCallsiteTools } from "@callsitehq/runtime/mcp";

import { capabilities } from "./src/app.js";

const server = new McpServer({ name: "orders", version: "0.1.0" });

registerCallsiteTools(server, capabilities, {
  toJsonSchema,
  context(extra) {
    return {
      subject: extra.authInfo?.clientId,
      log(event, data) {
        console.log({ event, data });
      }
    };
  }
});
```

Connect the SDK server to whatever MCP transport your host uses, such as stdio
or Streamable HTTP. Callsite does not start a server, mount HTTP, read
`mcp.json`, or own auth; it maps capabilities onto SDK tools and routes
`tools/call` through the same runtime validation path. Host-owned SDK tools can
be registered on the same server before or after Callsite tools.

## Status

Early `0.x` package. The transport-neutral runtime path is implemented first;
surface-specific adapters are intentionally thin.
