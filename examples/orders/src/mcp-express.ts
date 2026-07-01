import { realpathSync } from "node:fs";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";

import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { createOrdersApp, type OrdersAppOptions } from "./app.js";
import { createOrdersMcpServer, type OrdersMcpServerOptions } from "./mcp.js";

export interface OrdersMcpExpressAppOptions extends OrdersMcpServerOptions {
  readonly allowedHosts?: readonly string[] | undefined;
  readonly app?: OrdersAppOptions | undefined;
  readonly host?: string | undefined;
}

export interface OrdersMcpExpressServerOptions extends OrdersMcpExpressAppOptions {
  readonly port?: number | undefined;
}

export function createOrdersMcpExpressApp(options: OrdersMcpExpressAppOptions = {}) {
  const host = options.host ?? "127.0.0.1";
  const ordersApp = createOrdersApp(options.app);
  const app = createMcpExpressApp({
    host,
    ...(options.allowedHosts === undefined ? {} : { allowedHosts: [...options.allowedHosts] })
  });

  app.post("/mcp", async (request, response) => {
    const server = createOrdersMcpServer(ordersApp.capabilities, {
      context: options.context ?? expressMcpContext(request)
    });
    const transport = new StreamableHTTPServerTransport(statelessStreamableHttpOptions());
    let closed = false;
    const close = () => {
      if (closed) {
        return;
      }

      closed = true;
      void transport.close();
      void server.close();
    };

    response.on("close", close);

    try {
      await connectStreamableHttpTransport(server, transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      close();
      writeMcpInternalError(response, error);
    }
  });

  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return app;
}

export function serveOrdersMcpExpress(options: OrdersMcpExpressServerOptions = {}): Server {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3001;
  const app = createOrdersMcpExpressApp(options);
  const server = app.listen(port, host, () => {
    const address = server.address();
    const boundPort = typeof address === "object" && address !== null ? address.port : port;

    console.log(
      `Orders MCP Streamable HTTP example listening at http://${hostForUrl(host)}:${boundPort}/mcp`
    );
  });

  return server;
}

function expressMcpContext(request: ExpressRequest) {
  return () => {
    const subject = request.header("x-subject");

    return {
      ...(subject === undefined ? {} : { subject }),
      log(event: string, data?: Record<string, unknown>) {
        console.log(JSON.stringify({ event, data }));
      }
    };
  };
}

function statelessStreamableHttpOptions(): StreamableHTTPServerTransportOptions {
  // The SDK documents undefined as the stateless mode switch, but its current
  // type is not exactOptionalPropertyTypes-friendly.
  return { sessionIdGenerator: undefined } as unknown as StreamableHTTPServerTransportOptions;
}

async function connectStreamableHttpTransport(
  server: ReturnType<typeof createOrdersMcpServer>,
  transport: StreamableHTTPServerTransport
): Promise<void> {
  // StreamableHTTPServerTransport implements the SDK transport contract at
  // runtime; SDK 1.29.0's declarations are not exactOptionalPropertyTypes-friendly.
  await server.connect(transport as Transport);
}

function methodNotAllowed(_request: ExpressRequest, response: ExpressResponse): void {
  response.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  });
}

function writeMcpInternalError(response: ExpressResponse, error: unknown): void {
  console.error("Error handling MCP request:", error);

  if (response.headersSent) {
    return;
  }

  response.status(500).json({
    jsonrpc: "2.0",
    error: {
      code: -32603,
      message: "Internal server error."
    },
    id: null
  });
}

function hostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isDirectRun) {
  serveOrdersMcpExpress();
}
