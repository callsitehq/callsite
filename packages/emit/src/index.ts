import type {
  CapabilityErrorCode,
  CapabilityErrorSpec,
  CapabilityIR,
  DeclaredCapabilityErrorCode,
  IR,
  JsonObject,
  JsonValue
} from "@callsitehq/core";

export interface EmitMcpJsonOptions {
  readonly name?: string;
  readonly version?: string;
}

export interface EmitOpenApiOptions extends EmitMcpJsonOptions {
  readonly baseUrl?: string;
}

export type EmitOptions = EmitOpenApiOptions;

const CANONICAL_MCP_TOOL_FIELDS = new Set(["name", "description", "inputSchema", "outputSchema"]);
const CANONICAL_OPENAPI_OPERATION_FIELDS = new Set(["operationId", "requestBody", "responses"]);
const CALLSITE_ERRORS_META_KEY = "callsitehq.com/errors";
const STATUS_BY_ERROR_CODE: Record<DeclaredCapabilityErrorCode, string> = {
  unauthorized: "401",
  forbidden: "403",
  not_found: "404",
  conflict: "409",
  rate_limited: "429",
  unavailable: "503"
};

interface OpenApiErrorResponseDefinition {
  readonly status: string;
  readonly description: string;
  readonly codes: readonly CapabilityErrorCode[];
}

interface DeclaredErrorStatusGroup {
  readonly status: string;
  readonly errors: readonly CapabilityErrorSpec[];
}

export function emitMcpJson(ir: IR, options: EmitMcpJsonOptions = {}): string {
  return stringify({
    name: options.name ?? "callsite",
    version: options.version ?? "0.0.0",
    tools: ir.capabilities.map(capabilityToMcpTool)
  });
}

export function emitOpenApi(ir: IR, options: EmitOpenApiOptions = {}): string {
  return stringify({
    openapi: "3.2.0",
    info: {
      title: options.name ?? "Callsite API",
      version: options.version ?? "0.0.0"
    },
    ...(options.baseUrl === undefined ? {} : { servers: [{ url: options.baseUrl }] }),
    paths: Object.fromEntries(
      ir.capabilities.map((capability) => [
        `/capabilities/${capability.id}`,
        { post: capabilityToOpenApiOperation(capability) }
      ])
    )
  });
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

function capabilityToOpenApiOperation(capability: CapabilityIR): JsonObject {
  const override = capability.overrides.openapi ?? {};
  const passthrough = capability.passthrough.openapi ?? {};
  const operation: JsonObject = {
    operationId: capability.id.replaceAll(".", "_"),
    summary: capability.id,
    description: capability.intent,
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: capability.input
        }
      }
    },
    responses: {
      "200": {
        description: "Capability result",
        content: {
          "application/json": {
            schema: capability.output
          }
        }
      },
      ...openApiResponsesForCapability(capability)
    },
    "x-callsite-destructive": capability.destructive,
    ...omitCanonicalOpenApiOperationFields(override)
  };

  return { ...operation, ...passthrough };
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
  const meta = mcpMetaForCapability(capability, override);

  const tool: JsonObject = {
    name: capability.id,
    description: capability.intent,
    inputSchema: capability.input,
    outputSchema: capability.output,
    ...omitReservedMcpFields(override),
    ...(Object.keys(meta).length === 0 ? {} : { _meta: meta }),
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

function openApiResponsesForCapability(capability: CapabilityIR): JsonObject {
  return Object.fromEntries(
    openApiErrorResponseDefinitions(capability).map((response) => [
      response.status,
      openApiErrorResponse(response)
    ])
  );
}

function openApiErrorResponseDefinitions(
  capability: CapabilityIR
): readonly OpenApiErrorResponseDefinition[] {
  const declaredErrorResponses = groupDeclaredErrorsByStatus(capability.errors).map(
    declaredErrorGroupToOpenApiResponse
  );

  return [
    {
      status: "400",
      description: "Invalid request",
      codes: ["invalid_input"]
    },
    ...declaredErrorResponses,
    {
      status: "500",
      description: "Capability error",
      codes: ["internal"]
    }
  ];
}

function groupDeclaredErrorsByStatus(
  errors: readonly CapabilityErrorSpec[]
): readonly DeclaredErrorStatusGroup[] {
  const errorsByStatus = new Map<string, CapabilityErrorSpec[]>();

  for (const error of errors) {
    const status = STATUS_BY_ERROR_CODE[error.code];
    const statusErrors = errorsByStatus.get(status) ?? [];

    errorsByStatus.set(status, [...statusErrors, error]);
  }

  return Array.from(errorsByStatus, ([status, statusErrors]) => ({
    status,
    errors: statusErrors
  }));
}

function declaredErrorGroupToOpenApiResponse(
  group: DeclaredErrorStatusGroup
): OpenApiErrorResponseDefinition {
  return {
    status: group.status,
    description: group.errors.map((error) => error.intent).join("\n"),
    codes: unique(group.errors.map((error) => error.code))
  };
}

function mcpMetaForCapability(capability: CapabilityIR, override: JsonObject): JsonObject {
  const overrideMeta = jsonObjectValue(override._meta);

  return {
    ...overrideMeta,
    ...(capability.errors.length === 0
      ? {}
      : { [CALLSITE_ERRORS_META_KEY]: errorsToJson(capability.errors) })
  };
}

function openApiErrorResponse(response: OpenApiErrorResponseDefinition): JsonObject {
  return {
    description: response.description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: {
                  type: "string",
                  enum: response.codes
                },
                message: {
                  type: "string"
                },
                details: {
                  type: "object",
                  additionalProperties: true
                }
              },
              required: ["code", "message"],
              additionalProperties: false
            }
          },
          required: ["error"],
          additionalProperties: false
        }
      }
    }
  };
}

function errorsToJson(errors: readonly CapabilityErrorSpec[]): JsonValue {
  return errors.map((error) => ({
    code: error.code,
    intent: error.intent
  }));
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Array.from(new Set(values));
}

function omitReservedMcpFields(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => key !== "annotations" && key !== "_meta" && !CANONICAL_MCP_TOOL_FIELDS.has(key)
    )
  );
}

function omitCanonicalOpenApiOperationFields(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !CANONICAL_OPENAPI_OPERATION_FIELDS.has(key))
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
