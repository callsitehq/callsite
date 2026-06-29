import type { CapabilityIR, IR, JsonObject, JsonValue } from "@callsitehq/core";

export interface EmitMcpJsonOptions {
  readonly name?: string;
  readonly version?: string;
}

export interface EmitOpenApiOptions extends EmitMcpJsonOptions {
  readonly baseUrl?: string;
}

export type EmitOptions = EmitOpenApiOptions;

const CANONICAL_MCP_TOOL_FIELDS = new Set(["name", "description", "inputSchema", "outputSchema"]);

export function emitMcpJson(ir: IR, options: EmitMcpJsonOptions = {}): string {
  return stringify({
    name: options.name ?? "callsite",
    version: options.version ?? "0.0.0",
    tools: ir.capabilities.map(capabilityToMcpTool)
  });
}

export function emitOpenApi(ir: IR, options: EmitOpenApiOptions = {}): string {
  void ir;
  void options;
  throw new Error("emitOpenApi is not implemented for the current IR yet.");
}

export function emitChatGptAppConfig(ir: IR, options: EmitMcpJsonOptions = {}): string {
  void ir;
  void options;
  throw new Error("emitChatGptAppConfig is not implemented for the current IR yet.");
}

export function emitClaudeConnectorConfig(ir: IR, options: EmitMcpJsonOptions = {}): string {
  void ir;
  void options;
  throw new Error("emitClaudeConnectorConfig is not implemented for the current IR yet.");
}

function capabilityToMcpTool(capability: CapabilityIR): JsonObject {
  assertObjectSchema(capability, "input", capability.input);
  assertObjectSchema(capability, "output", capability.output);

  const canonicalAnnotations: JsonObject = {
    destructiveHint: capability.destructive
  };
  const override = capability.overrides.mcp ?? {};
  const passthrough = capability.passthrough.mcp ?? {};
  const overrideAnnotations = jsonObjectValue(override.annotations);

  const tool: JsonObject = {
    name: capability.id,
    description: capability.intent,
    inputSchema: capability.input,
    outputSchema: capability.output,
    ...omitCanonicalMcpFields(override),
    annotations: {
      ...canonicalAnnotations,
      ...overrideAnnotations,
      destructiveHint: capability.destructive
    }
  };

  return { ...tool, ...passthrough };
}

function assertObjectSchema(
  capability: CapabilityIR,
  direction: "input" | "output",
  schema: JsonObject
): void {
  if (schema.type !== "object") {
    throw new TypeError(
      `MCP ${direction} schema for capability "${capability.id}" must be a JSON object schema.`
    );
  }
}

function omitCanonicalMcpFields(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => key !== "annotations" && !CANONICAL_MCP_TOOL_FIELDS.has(key)
    )
  );
}

function jsonObjectValue(value: JsonValue | undefined): JsonObject {
  if (value === undefined || value === null || Array.isArray(value) || typeof value !== "object") {
    return {};
  }

  return value as JsonObject;
}

function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
