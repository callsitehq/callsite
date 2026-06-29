export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface Schema<T> {
  readonly description?: string;
  readonly jsonSchema?: JsonObject;
  readonly parse: (value: unknown) => T;
}

export interface CapabilityContext {
  readonly request: Request;
}

export type CapabilityRun<Input, Output> = (
  input: Input,
  context: CapabilityContext
) => Output | Promise<Output>;

export interface CapabilityDefinition<Input, Output> {
  readonly id: string;
  readonly intent: string;
  readonly input: Schema<Input>;
  readonly output: Schema<Output>;
  readonly destructive?: boolean;
  readonly examples?: readonly CapabilityExample<Input, Output>[];
  readonly run: CapabilityRun<Input, Output>;
}

export interface CapabilityExample<Input, Output> {
  readonly input: Input;
  readonly output?: Output;
  readonly intent?: string;
}

export interface Capability<Input = unknown, Output = unknown> extends CapabilityDefinition<
  Input,
  Output
> {
  readonly kind: "callsite.capability";
}

export type AnyCapability = Capability<any, any>;

export interface CapabilityIR {
  readonly version: 1;
  readonly capabilities: readonly CapabilityIRNode[];
}

export interface CapabilityIRNode {
  readonly id: string;
  readonly intent: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly destructive: boolean;
  readonly examples: readonly CapabilityIRExample[];
}

export interface CapabilityIRExample {
  readonly input: JsonValue;
  readonly output?: JsonValue;
  readonly intent?: string;
}

export class CapabilityError extends Error {
  public readonly code: CapabilityErrorCode;
  public readonly details: JsonValue | undefined;

  public constructor(
    code: CapabilityErrorCode,
    message: string,
    options: CapabilityErrorOptions = {}
  ) {
    super(message);
    this.name = "CapabilityError";
    this.code = code;
    this.details = options.details;
  }
}

export type CapabilityErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal";

export interface CapabilityErrorOptions {
  readonly details?: JsonValue;
}

export function capability<Input, Output>(
  definition: CapabilityDefinition<Input, Output>
): Capability<Input, Output> {
  assertCapabilityId(definition.id);

  return {
    ...definition,
    kind: "callsite.capability"
  };
}

export function defineCallsite(capabilities: readonly AnyCapability[]): CapabilityIR {
  return {
    version: 1,
    capabilities: capabilities.map(toIRNode)
  };
}

function toIRNode(capabilityDefinition: AnyCapability): CapabilityIRNode {
  return {
    id: capabilityDefinition.id,
    intent: capabilityDefinition.intent,
    inputSchema: capabilityDefinition.input.jsonSchema ?? {},
    outputSchema: capabilityDefinition.output.jsonSchema ?? {},
    destructive: capabilityDefinition.destructive ?? false,
    examples: (capabilityDefinition.examples ?? []).map((example) => ({
      input: example.input,
      ...(example.output === undefined ? {} : { output: example.output }),
      ...(example.intent === undefined ? {} : { intent: example.intent })
    }))
  };
}

function assertCapabilityId(id: string): void {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(id)) {
    throw new TypeError(`Invalid capability id "${id}". Use lowercase dot-separated identifiers.`);
  }
}
