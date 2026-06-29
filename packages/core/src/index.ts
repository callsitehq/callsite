export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonSchema = JsonObject;

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
      options?: StandardSchemaOptions | undefined
    ) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?:
      | {
          readonly input: Input;
          readonly output: Output;
        }
      | undefined;
  };
}

export interface StandardSchemaOptions {
  readonly libraryOptions?: Record<string, unknown> | undefined;
}

export type StandardResult<Output> =
  | {
      readonly value: Output;
      readonly issues?: undefined;
    }
  | {
      readonly issues: readonly StandardIssue[];
    };

export interface StandardIssue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | StandardPathSegment)[] | undefined;
}

export interface StandardPathSegment {
  readonly key: PropertyKey;
}

export type Infer<Schema extends StandardSchemaV1> = NonNullable<
  Schema["~standard"]["types"]
>["output"];

export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
  Schema["~standard"]["types"]
>["input"];

export type JsonSchemaDirection = "input" | "output";

export interface ToJsonSchemaOptions {
  readonly direction: JsonSchemaDirection;
}

export type ToJsonSchema = (schema: StandardSchemaV1, options: ToJsonSchemaOptions) => JsonSchema;

export type CapabilityErrorCode =
  | "invalid_input"
  | "not_found"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "internal";

export class CapabilityError extends Error {
  public constructor(
    public readonly code: CapabilityErrorCode,
    message: string,
    public readonly details?: JsonObject
  ) {
    super(message);
    this.name = "CapabilityError";
  }
}

export type SurfaceName = "mcp" | "openapi" | "chatgpt" | "claude-connector";

export interface CapabilityContext {
  readonly subject?: unknown;
  readonly log: (event: string, data?: Record<string, unknown>) => void;
}

export type AnyStandardSchema = StandardSchemaV1<any, any>;

export type CapabilityRun<
  InputSchema extends AnyStandardSchema,
  OutputSchema extends AnyStandardSchema
> = (
  input: Infer<InputSchema>,
  context: CapabilityContext
) => InferInput<OutputSchema> | Promise<InferInput<OutputSchema>>;

export interface CapabilityExample<
  InputSchema extends AnyStandardSchema,
  OutputSchema extends AnyStandardSchema
> {
  readonly input: InferInput<InputSchema> & JsonValue;
  readonly output: Infer<OutputSchema> & JsonValue;
  readonly note?: string;
}

export type SurfaceExtensions = Partial<Record<SurfaceName, JsonObject>>;

export interface Capability<
  InputSchema extends AnyStandardSchema = AnyStandardSchema,
  OutputSchema extends AnyStandardSchema = AnyStandardSchema
> {
  readonly id: string;
  readonly intent: string;
  readonly input: InputSchema;
  readonly output: OutputSchema;
  readonly destructive?: boolean;
  readonly examples?: readonly CapabilityExample<InputSchema, OutputSchema>[];
  readonly run: CapabilityRun<InputSchema, OutputSchema>;
  readonly overrides?: SurfaceExtensions;
  readonly passthrough?: SurfaceExtensions;
}

export interface AnyCapability {
  readonly id: string;
  readonly intent: string;
  readonly input: AnyStandardSchema;
  readonly output: AnyStandardSchema;
  readonly destructive?: boolean;
  readonly examples?: readonly CapabilityIRExample[];
  readonly run: (input: any, context: CapabilityContext) => any;
  readonly overrides?: SurfaceExtensions;
  readonly passthrough?: SurfaceExtensions;
}

export function capability<
  InputSchema extends AnyStandardSchema,
  OutputSchema extends AnyStandardSchema
>(definition: Capability<InputSchema, OutputSchema>): Capability<InputSchema, OutputSchema> {
  assertCapabilityId(definition.id);

  return definition;
}

export interface CapabilityIR {
  readonly id: string;
  readonly intent: string;
  readonly input: JsonSchema;
  readonly output: JsonSchema;
  readonly destructive: boolean;
  readonly examples: readonly CapabilityIRExample[];
  readonly overrides: SurfaceExtensions;
  readonly passthrough: SurfaceExtensions;
}

export interface CapabilityIRExample {
  readonly input: JsonValue;
  readonly output: JsonValue;
  readonly note?: string;
}

export interface IR {
  readonly version: 1;
  readonly capabilities: readonly CapabilityIR[];
}

export function toIR(capabilities: readonly AnyCapability[], toJsonSchema: ToJsonSchema): IR {
  return {
    version: 1,
    capabilities: capabilities.map((capabilityDefinition) => ({
      id: capabilityDefinition.id,
      intent: capabilityDefinition.intent,
      input: toJsonSchema(capabilityDefinition.input, { direction: "input" }),
      output: toJsonSchema(capabilityDefinition.output, { direction: "output" }),
      destructive: capabilityDefinition.destructive ?? false,
      examples: (capabilityDefinition.examples ?? []).map((example) => ({
        input: example.input,
        output: example.output,
        ...(example.note === undefined ? {} : { note: example.note })
      })),
      overrides: capabilityDefinition.overrides ?? {},
      passthrough: capabilityDefinition.passthrough ?? {}
    }))
  };
}

function assertCapabilityId(id: string): void {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(id)) {
    throw new TypeError(
      `Invalid capability id "${id}". Use lowercase letters, digits, underscores, and dot-separated namespaces.`
    );
  }
}
