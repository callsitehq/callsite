import { toIR, type AnyCapability, type ToJsonSchema } from "@callsitehq/core";
import { mcpToolsFromIR } from "@callsitehq/emit";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
  type ServerNotification,
  type ServerRequest,
  type ToolAnnotations
} from "@modelcontextprotocol/sdk/types.js";

import {
  createRuntimeManifest,
  execute,
  type RuntimeContext,
  type RuntimeResult
} from "./index.js";

export type McpRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export type McpContextProvider =
  | RuntimeContext
  | ((extra: McpRequestExtra, capabilityId: string) => RuntimeContext | Promise<RuntimeContext>);

export interface RegisterCallsiteToolsOptions {
  readonly toJsonSchema: ToJsonSchema;
  readonly context?: McpContextProvider;
}

type SdkRequestHandler = (request: unknown, extra: McpRequestExtra) => unknown | Promise<unknown>;

interface SdkProtocolInternals {
  readonly _requestHandlers?: Map<string, SdkRequestHandler>;
}

export function registerCallsiteTools(
  server: McpServer,
  capabilities: readonly AnyCapability[],
  options: RegisterCallsiteToolsOptions
): void {
  const ir = toIR(capabilities, options.toJsonSchema);
  const manifest = createRuntimeManifest(capabilities);
  const tools = mcpToolsFromIR(ir) as ListToolsResult["tools"];
  if (tools.length === 0) {
    return;
  }

  const capabilityIdByToolName = toolNameMap(tools, capabilities);
  const callsiteToolNames = new Set(capabilityIdByToolName.keys());
  const sdkHandlers = reserveSdkTools(server, tools);

  server.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const sdkResult = await sdkListResult(sdkHandlers, request, extra);

    return {
      ...sdkResult,
      tools: [...sdkResult.tools.filter((tool) => !callsiteToolNames.has(tool.name)), ...tools]
    };
  });

  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = request.params.name;
    const capabilityId = capabilityIdByToolName.get(toolName);

    if (capabilityId === undefined) {
      return (await sdkHandlers.call(request, extra)) as CallToolResult;
    }

    const result = await execute(
      manifest,
      {
        capabilityId,
        input: request.params.arguments ?? {}
      },
      await contextFor(options.context, extra, capabilityId)
    );

    return toolResult(result);
  });
}

function toolNameMap(
  tools: readonly ListToolsResult["tools"][number][],
  capabilities: readonly AnyCapability[]
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();

  tools.forEach((tool, index) => {
    const capability = capabilities[index];
    if (capability === undefined) {
      return;
    }

    if (result.has(tool.name)) {
      throw new TypeError(`Duplicate MCP tool name "${tool.name}".`);
    }

    result.set(tool.name, capability.id);
  });

  return result;
}

function reserveSdkTools(
  server: McpServer,
  tools: readonly ListToolsResult["tools"][number][]
): {
  readonly list: SdkRequestHandler;
  readonly call: SdkRequestHandler;
} {
  // Reserve names in the SDK registry so host tools compose normally, then
  // wrap the SDK handlers to expose Callsite's already-lowered JSON Schema.
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        ...(tool.title === undefined ? {} : { title: tool.title }),
        ...(tool.description === undefined ? {} : { description: tool.description }),
        ...sdkToolAnnotations(tool),
        ...sdkToolMeta(tool)
      },
      () =>
        toolErrorResult({
          error: {
            code: "internal",
            message: "Callsite MCP tool was not routed through the Callsite runtime."
          }
        })
    );
  }

  return {
    list: sdkRequestHandler(server, "tools/list"),
    call: sdkRequestHandler(server, "tools/call")
  };
}

async function sdkListResult(
  sdkHandlers: {
    readonly list: SdkRequestHandler;
  },
  request: unknown,
  extra: McpRequestExtra
): Promise<ListToolsResult> {
  return (await sdkHandlers.list(request, extra)) as ListToolsResult;
}

function sdkRequestHandler(server: McpServer, method: string): SdkRequestHandler {
  const internals = server.server as unknown as SdkProtocolInternals;
  const handler = internals._requestHandlers?.get(method);

  if (handler === undefined) {
    throw new TypeError(`The MCP SDK did not install a ${method} request handler.`);
  }

  return handler;
}

function sdkToolAnnotations(tool: ListToolsResult["tools"][number]): {
  readonly annotations?: ToolAnnotations;
} {
  if (tool.annotations === undefined) {
    return {};
  }

  return { annotations: tool.annotations as ToolAnnotations };
}

function sdkToolMeta(tool: ListToolsResult["tools"][number]): {
  readonly _meta?: Record<string, unknown>;
} {
  if (tool._meta === undefined) {
    return {};
  }

  return { _meta: tool._meta };
}

async function contextFor(
  provider: McpContextProvider | undefined,
  extra: McpRequestExtra,
  capabilityId: string
): Promise<RuntimeContext> {
  if (provider === undefined) {
    return {};
  }

  return typeof provider === "function" ? provider(extra, capabilityId) : provider;
}

function toolResult(result: RuntimeResult): CallToolResult {
  if (!result.ok) {
    return toolErrorResult({
      error: result.error
    });
  }

  if (!isJsonObject(result.value)) {
    return toolErrorResult({
      error: {
        code: "internal",
        message: "Capability returned non-object MCP output."
      }
    });
  }

  return {
    content: [
      {
        type: "text",
        text: jsonText(result.value)
      }
    ],
    structuredContent: result.value,
    isError: false
  };
}

function toolErrorResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: jsonText(value)
      }
    ],
    isError: true
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonText(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}
