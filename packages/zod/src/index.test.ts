import { describe, expect, it } from "vitest";
import { z } from "zod";

import { capability } from "@callsitehq/core";

import { defineConfig, toJsonSchema } from "./index.js";

const input = z.object({
  name: z.string().default("Ada")
});

const output = z.object({
  greeting: z.string()
});

const greet = capability({
  id: "demo.greet",
  intent: "Greet a person by name.",
  input,
  output,
  run(value) {
    return { greeting: `Hello, ${value.name}` };
  }
});

describe("defineConfig", () => {
  it("adds the Zod JSON Schema adapter to capability configs", () => {
    const config = defineConfig({
      capabilities: [greet],
      emit: {
        mcp: { name: "demo" },
        openapi: { name: "Demo API", baseUrl: "https://api.example.com" }
      }
    });

    expect(config.capabilities).toEqual([greet]);
    expect(config.toJsonSchema).toBe(toJsonSchema);
    expect(config.emit?.openapi?.baseUrl).toBe("https://api.example.com");
  });
});

describe("toJsonSchema", () => {
  it("uses the requested Zod input/output direction", () => {
    expect(toJsonSchema(input, { direction: "input" })).toMatchObject({
      properties: {
        name: { default: "Ada" }
      }
    });
    expect(toJsonSchema(input, { direction: "output" })).toMatchObject({
      required: ["name"],
      additionalProperties: false
    });
  });
});
