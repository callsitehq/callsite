import { describe, expect, it } from "vitest";

import type { CapabilityIR } from "@callsitehq/core";

import { emitMcpJson, emitOpenApi } from "./index.js";

const ir: CapabilityIR = {
  version: 1,
  capabilities: [
    {
      id: "demo.greet",
      intent: "Greet a person by name.",
      inputSchema: { type: "object", properties: { name: { type: "string" } } },
      outputSchema: { type: "object", properties: { greeting: { type: "string" } } },
      destructive: false,
      examples: []
    }
  ]
};

describe("emit", () => {
  it("emits mcp.json", () => {
    expect(JSON.parse(emitMcpJson(ir))).toMatchObject({
      name: "callsite",
      tools: [
        {
          name: "demo.greet",
          description: "Greet a person by name."
        }
      ]
    });
  });

  it("emits OpenAPI 3.1", () => {
    expect(JSON.parse(emitOpenApi(ir))).toMatchObject({
      openapi: "3.1.0",
      paths: {
        "/capabilities/demo.greet": {
          post: {
            operationId: "demo_greet"
          }
        }
      }
    });
  });
});
