import type { AnyCapability } from "@callsitehq/core";
import { toJsonSchema } from "@callsitehq/zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCallsiteTools, type McpContextProvider } from "@callsitehq/runtime/mcp";

import { createOrdersApp, type OrdersAppOptions } from "./app.js";

export interface OrdersMcpServerOptions {
  readonly context?: McpContextProvider | undefined;
}

export interface DefaultOrdersMcpServerOptions extends OrdersMcpServerOptions {
  readonly app?: OrdersAppOptions | undefined;
}

export function createOrdersMcpServer(
  capabilities: readonly AnyCapability[] = createOrdersApp().capabilities,
  options: OrdersMcpServerOptions = {}
): McpServer {
  const server = new McpServer({ name: "orders", version: "0.1.0" });

  registerCallsiteTools(server, capabilities, {
    toJsonSchema,
    ...(options.context === undefined ? {} : { context: options.context })
  });

  return server;
}

export function createDefaultOrdersMcpServer(
  options: DefaultOrdersMcpServerOptions = {}
): McpServer {
  return createOrdersMcpServer(createOrdersApp(options.app).capabilities, options);
}
