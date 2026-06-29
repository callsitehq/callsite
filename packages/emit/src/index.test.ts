import { describe, expect, it } from "vitest";

import type { IR } from "@callsitehq/core";

import {
  emitChatGptAppConfig,
  emitClaudeConnectorConfig,
  emitMcpJson,
  emitOpenApi
} from "./index.js";

const inputSchema = {
  type: "object",
  properties: {
    orderId: { type: "string" }
  },
  required: ["orderId"]
} as const;

const outputSchema = {
  type: "object",
  properties: {
    status: { type: "string" }
  },
  required: ["status"],
  additionalProperties: false
} as const;

const ir: IR = {
  version: 1,
  capabilities: [
    {
      id: "find_orders",
      intent: "Search orders before taking an action.",
      input: inputSchema,
      output: outputSchema,
      destructive: false,
      examples: [],
      overrides: {},
      passthrough: {}
    },
    {
      id: "refund_order",
      intent: "Refund a paid order.",
      input: inputSchema,
      output: outputSchema,
      destructive: true,
      examples: [],
      overrides: {
        mcp: {
          title: "Refund order",
          name: "ignored_override_name",
          inputSchema: { type: "string" },
          annotations: {
            destructiveHint: false,
            readOnlyHint: false
          }
        },
        openapi: {
          tags: ["billing"],
          operationId: "ignored_override_operation_id",
          requestBody: {
            description: "Ignored override request body."
          },
          responses: {
            "204": {
              description: "Ignored override response."
            }
          }
        }
      },
      passthrough: {}
    },
    {
      id: "archive_order",
      intent: "Archive an order record.",
      input: inputSchema,
      output: outputSchema,
      destructive: true,
      examples: [],
      overrides: {},
      passthrough: {
        mcp: {
          name: "archive_order_raw",
          _meta: {
            "callsitehq.com/category": "orders"
          },
          annotations: {
            destructiveHint: false,
            idempotentHint: true
          }
        },
        openapi: {
          operationId: "archiveOrderRaw",
          responses: {
            "202": {
              description: "Archive accepted."
            }
          },
          "x-raw-openapi": true
        }
      }
    }
  ]
};

const nonObjectSchemaIR: IR = {
  version: 1,
  capabilities: [
    {
      id: "echo_text",
      intent: "Echo text.",
      input: { type: "string" },
      output: outputSchema,
      destructive: false,
      examples: [],
      overrides: {},
      passthrough: {}
    }
  ]
};

describe("emitMcpJson", () => {
  it("emits stable pretty JSON with MCP tools from the IR", () => {
    const json = emitMcpJson(ir);
    const parsed = JSON.parse(json);

    expect(json.endsWith("\n")).toBe(true);
    expect(parsed).toMatchObject({
      name: "callsite",
      version: "0.0.0"
    });
    expect(parsed.tools).toHaveLength(3);
    expect(parsed.tools[0]).toMatchObject({
      name: "find_orders",
      description: "Search orders before taking an action.",
      inputSchema,
      outputSchema,
      annotations: {
        destructiveHint: false
      }
    });
  });

  it("uses configured top-level name and version", () => {
    expect(JSON.parse(emitMcpJson(ir, { name: "billing", version: "1.2.3" }))).toMatchObject({
      name: "billing",
      version: "1.2.3"
    });
  });

  it("applies MCP overrides without replacing canonical tool fields", () => {
    const tool = JSON.parse(emitMcpJson(ir)).tools[1];

    expect(tool).toMatchObject({
      name: "refund_order",
      title: "Refund order",
      description: "Refund a paid order.",
      inputSchema,
      outputSchema,
      annotations: {
        destructiveHint: true,
        readOnlyHint: false
      }
    });
  });

  it("applies MCP passthrough last as the raw escape hatch", () => {
    const tool = JSON.parse(emitMcpJson(ir)).tools[2];

    expect(tool).toMatchObject({
      name: "archive_order_raw",
      _meta: {
        "callsitehq.com/category": "orders"
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: true
      }
    });
  });

  it("lets MCP passthrough replace annotations wholesale", () => {
    const rawIR: IR = {
      version: 1,
      capabilities: [
        {
          id: "raw_tool",
          intent: "Render a raw tool.",
          input: inputSchema,
          output: outputSchema,
          destructive: true,
          examples: [],
          overrides: {},
          passthrough: {
            mcp: {
              annotations: {}
            }
          }
        }
      ]
    };

    expect(JSON.parse(emitMcpJson(rawIR)).tools[0].annotations).toEqual({});
  });

  it("rejects schemas that are not object-shaped for MCP tools", () => {
    expect(() => emitMcpJson(nonObjectSchemaIR)).toThrow(
      'MCP input schema for capability "echo_text" must be a JSON object schema.'
    );
  });
});

describe("emitOpenApi", () => {
  it("emits stable OpenAPI 3.2 JSON with capability-shaped RPC operations", () => {
    const json = emitOpenApi(ir);
    const parsed = JSON.parse(json);
    const operation = parsed.paths["/capabilities/find_orders"].post;

    expect(json.endsWith("\n")).toBe(true);
    expect(parsed).toMatchObject({
      openapi: "3.2.0",
      info: {
        title: "Callsite API",
        version: "0.0.0"
      }
    });
    expect(operation).toMatchObject({
      operationId: "find_orders",
      summary: "find_orders",
      description: "Search orders before taking an action.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: inputSchema
          }
        }
      },
      responses: {
        "200": {
          description: "Capability result",
          content: {
            "application/json": {
              schema: outputSchema
            }
          }
        },
        "400": {
          description: "Invalid request"
        },
        "500": {
          description: "Capability error"
        }
      },
      "x-callsite-destructive": false
    });
  });

  it("uses configured OpenAPI info and server options", () => {
    expect(
      JSON.parse(
        emitOpenApi(ir, {
          baseUrl: "https://api.example.com",
          name: "Billing API",
          version: "1.2.3"
        })
      )
    ).toMatchObject({
      info: {
        title: "Billing API",
        version: "1.2.3"
      },
      servers: [{ url: "https://api.example.com" }]
    });
  });

  it("normalizes dotted capability ids for operation ids", () => {
    const dottedIR: IR = {
      version: 1,
      capabilities: [
        {
          id: "orders.find",
          intent: "Find orders.",
          input: inputSchema,
          output: outputSchema,
          destructive: false,
          examples: [],
          overrides: {},
          passthrough: {}
        }
      ]
    };

    expect(
      JSON.parse(emitOpenApi(dottedIR)).paths["/capabilities/orders.find"].post.operationId
    ).toBe("orders_find");
  });

  it("applies OpenAPI overrides without replacing canonical wiring", () => {
    const operation = JSON.parse(emitOpenApi(ir)).paths["/capabilities/refund_order"].post;

    expect(operation).toMatchObject({
      operationId: "refund_order",
      tags: ["billing"],
      requestBody: {
        content: {
          "application/json": {
            schema: inputSchema
          }
        }
      },
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: outputSchema
            }
          }
        }
      },
      "x-callsite-destructive": true
    });
    expect(operation.responses["204"]).toBeUndefined();
  });

  it("applies OpenAPI passthrough last as the raw escape hatch", () => {
    const operation = JSON.parse(emitOpenApi(ir)).paths["/capabilities/archive_order"].post;

    expect(operation).toMatchObject({
      operationId: "archiveOrderRaw",
      responses: {
        "202": {
          description: "Archive accepted."
        }
      },
      "x-raw-openapi": true
    });
    expect(operation.responses["200"]).toBeUndefined();
  });
});

describe("deferred emitters", () => {
  it("keeps non-MCP exports but fails explicitly", () => {
    expect(() => emitChatGptAppConfig(ir)).toThrow("not implemented");
    expect(() => emitClaudeConnectorConfig(ir)).toThrow("not implemented");
  });
});
