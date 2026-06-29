import { z } from "zod";

import type { AnyCapability, JsonSchema, ToJsonSchema } from "@callsitehq/core";

export interface DefineConfigOptions<
  Capabilities extends readonly AnyCapability[] = readonly AnyCapability[]
> {
  readonly capabilities: Capabilities;
  readonly emit?: CallsiteEmitConfig;
}

export interface CallsiteEmitConfig {
  readonly mcp?: CallsiteMcpEmitConfig;
  readonly openapi?: CallsiteOpenApiEmitConfig;
}

export interface CallsiteMcpEmitConfig {
  readonly name?: string;
  readonly version?: string;
}

export interface CallsiteOpenApiEmitConfig extends CallsiteMcpEmitConfig {
  readonly baseUrl?: string;
}

export interface ZodCallsiteConfig<
  Capabilities extends readonly AnyCapability[] = readonly AnyCapability[]
> extends DefineConfigOptions<Capabilities> {
  readonly toJsonSchema: ToJsonSchema;
}

export const toJsonSchema: ToJsonSchema = (schema, options) =>
  z.toJSONSchema(schema as z.ZodType, { io: options.direction }) as JsonSchema;

export function defineConfig<Capabilities extends readonly AnyCapability[]>(
  config: DefineConfigOptions<Capabilities>
): ZodCallsiteConfig<Capabilities> {
  return {
    ...config,
    toJsonSchema
  };
}
