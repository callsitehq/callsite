import type { CapabilityIR, CapabilityIRNode, JsonObject } from "@callsitehq/core";

export interface EmitOptions {
  readonly name?: string;
  readonly version?: string;
  readonly baseUrl?: string;
}

export function emitMcpJson(ir: CapabilityIR, options: EmitOptions = {}): string {
  return stringify({
    name: options.name ?? "callsite",
    version: options.version ?? "0.0.0",
    tools: ir.capabilities.map((capability) => ({
      name: capability.id,
      description: capability.intent,
      inputSchema: capability.inputSchema,
      annotations: {
        destructiveHint: capability.destructive
      }
    }))
  });
}

export function emitOpenApi(ir: CapabilityIR, options: EmitOptions = {}): string {
  const paths = Object.fromEntries(
    ir.capabilities.map((capability) => [
      `/capabilities/${capability.id}`,
      capabilityToOpenApiPath(capability)
    ])
  );

  return stringify({
    openapi: "3.1.0",
    info: {
      title: options.name ?? "Callsite API",
      version: options.version ?? "0.0.0"
    },
    ...(options.baseUrl === undefined ? {} : { servers: [{ url: options.baseUrl }] }),
    paths
  });
}

export function emitChatGptAppConfig(ir: CapabilityIR, options: EmitOptions = {}): string {
  return stringify({
    name: options.name ?? "callsite",
    version: options.version ?? "0.0.0",
    tools: ir.capabilities.map((capability) => ({
      id: capability.id,
      description: capability.intent,
      input_schema: capability.inputSchema
    }))
  });
}

export function emitClaudeConnectorConfig(ir: CapabilityIR, options: EmitOptions = {}): string {
  return stringify({
    name: options.name ?? "callsite",
    version: options.version ?? "0.0.0",
    capabilities: ir.capabilities.map((capability) => ({
      name: capability.id,
      description: capability.intent,
      input_schema: capability.inputSchema
    }))
  });
}

function capabilityToOpenApiPath(capability: CapabilityIRNode): JsonObject {
  return {
    post: {
      operationId: capability.id.replaceAll(".", "_"),
      summary: capability.intent,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: capability.inputSchema
          }
        }
      },
      responses: {
        "200": {
          description: "Capability result",
          content: {
            "application/json": {
              schema: capability.outputSchema
            }
          }
        },
        "400": {
          description: "Invalid request"
        },
        "500": {
          description: "Capability error"
        }
      }
    }
  };
}

function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
