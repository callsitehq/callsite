import { describe, expect, it } from "vitest";

import {
  capability,
  CapabilityError,
  toIR,
  type AnyCapability,
  type StandardResult,
  type StandardSchemaV1,
  type ToJsonSchema
} from "@callsitehq/core";
import { mcpToolsFromIR } from "@callsitehq/emit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCallsiteTools, type RegisterCallsiteToolsOptions } from "./mcp.js";

interface GreetInput {
  readonly name: string;
}

interface GreetOutput {
  readonly greeting: string;
}

const greetInput = schema<GreetInput>((value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("name" in value) ||
    typeof value.name !== "string"
  ) {
    return issue("Expected { name: string }", ["name"]);
  }

  return { value: { name: value.name } };
});

const greetOutput = schema<GreetOutput>((value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("greeting" in value) ||
    typeof value.greeting !== "string"
  ) {
    return issue("Expected { greeting: string }", ["greeting"]);
  }

  return { value: { greeting: value.greeting } };
});

const greetInputJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" }
  },
  required: ["name"],
  additionalProperties: false
} as const;

const greetOutputJsonSchema = {
  type: "object",
  properties: {
    greeting: { type: "string" }
  },
  required: ["greeting"],
  additionalProperties: false
} as const;

const toJsonSchema: ToJsonSchema = (schema) => {
  if (schema === greetInput) {
    return greetInputJsonSchema;
  }

  if (schema === greetOutput) {
    return greetOutputJsonSchema;
  }

  throw new TypeError("Unknown schema.");
};

const greet = capability({
  id: "demo.greet",
  intent: "Greet a person by name.",
  input: greetInput,
  output: greetOutput,
  run(input) {
    return { greeting: `Hello, ${input.name}` };
  }
});

describe("registerCallsiteTools", () => {
  it("registers Callsite capabilities as SDK-listed MCP tools", async () => {
    const session = await connectSdkClient([greet]);

    try {
      await expect(session.client.listTools()).resolves.toEqual({
        tools: mcpToolsFromIR(toIR([greet], toJsonSchema))
      });
    } finally {
      await session.close();
    }
  });

  it("composes with SDK tools registered before and after Callsite tools", async () => {
    const server = new McpServer({ name: "callsite-test", version: "0.0.0" });

    server.registerTool("host.before", { description: "A host-owned tool." }, () => ({
      content: [{ type: "text", text: "before" }]
    }));
    registerCallsiteTools(server, [greet], {
      toJsonSchema
    });
    server.registerTool("host.after", { description: "Another host-owned tool." }, () => ({
      content: [{ type: "text", text: "after" }]
    }));

    const session = await connectServerClient(server);

    try {
      const list = await session.client.listTools();

      expect(list.tools.map((tool) => tool.name).sort()).toEqual([
        "demo.greet",
        "host.after",
        "host.before"
      ]);
      expect(list.tools.find((tool) => tool.name === "demo.greet")).toEqual(
        mcpToolsFromIR(toIR([greet], toJsonSchema))[0]
      );

      await expect(
        session.client.callTool({
          name: "host.before",
          arguments: {}
        })
      ).resolves.toEqual({
        content: [{ type: "text", text: "before" }]
      });
      await expect(
        session.client.callTool({
          name: "host.after",
          arguments: {}
        })
      ).resolves.toEqual({
        content: [{ type: "text", text: "after" }]
      });
      await expect(
        session.client.callTool({
          name: "demo.greet",
          arguments: {
            name: "Ada"
          }
        })
      ).resolves.toMatchObject({
        structuredContent: {
          greeting: "Hello, Ada"
        },
        isError: false
      });
    } finally {
      await session.close();
    }
  });

  it("fails clearly if the SDK handler internals are unavailable", () => {
    const incompatibleServer = {
      server: {},
      registerTool() {}
    } as unknown as McpServer;

    expect(() =>
      registerCallsiteTools(incompatibleServer, [greet], {
        toJsonSchema
      })
    ).toThrow("The MCP SDK did not install a tools/list request handler.");
  });

  it("calls capabilities through the SDK tool path and returns structured content", async () => {
    const session = await connectSdkClient([greet]);

    try {
      await expect(
        session.client.callTool({
          name: "demo.greet",
          arguments: {
            name: "Ada"
          }
        })
      ).resolves.toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify({ greeting: "Hello, Ada" })
          }
        ],
        structuredContent: {
          greeting: "Hello, Ada"
        },
        isError: false
      });
    } finally {
      await session.close();
    }
  });

  it("passes SDK request context to capabilities", async () => {
    const subject = capability({
      id: "demo.subject",
      intent: "Return the current subject.",
      input: greetInput,
      output: greetOutput,
      run(_input, context) {
        return { greeting: String(context.subject) };
      }
    });
    const session = await connectSdkClient([subject], {
      context(_extra, capabilityId) {
        return {
          subject: capabilityId
        };
      }
    });

    try {
      await expect(
        session.client.callTool({
          name: "demo.subject",
          arguments: {
            name: "Ada"
          }
        })
      ).resolves.toMatchObject({
        structuredContent: {
          greeting: "demo.subject"
        },
        isError: false
      });
    } finally {
      await session.close();
    }
  });

  it("returns validation failures as tool execution errors", async () => {
    let ran = false;
    const validate = capability({
      id: "demo.validate",
      intent: "Validate input.",
      input: greetInput,
      output: greetOutput,
      run() {
        ran = true;
        return { greeting: "unreachable" };
      }
    });
    const session = await connectSdkClient([validate]);

    try {
      const result = await session.client.callTool({
        name: "demo.validate",
        arguments: {
          name: 123
        }
      });

      expect(ran).toBe(false);
      expect(result.isError).toBe(true);
      expect(errorBody(result)).toMatchObject({
        error: {
          code: "invalid_input"
        }
      });
    } finally {
      await session.close();
    }
  });

  it("returns declared capability failures as tool execution errors", async () => {
    const fail = capability({
      id: "demo.fail",
      intent: "Fail intentionally.",
      input: greetInput,
      output: greetOutput,
      run() {
        throw new CapabilityError("forbidden", "Not allowed.");
      }
    });
    const session = await connectSdkClient([fail]);

    try {
      const result = await session.client.callTool({
        name: "demo.fail",
        arguments: {
          name: "Ada"
        }
      });

      expect(result.isError).toBe(true);
      expect(errorBody(result)).toMatchObject({
        error: {
          code: "forbidden",
          message: "Not allowed."
        }
      });
    } finally {
      await session.close();
    }
  });

  it("returns output validation failures as tool execution errors", async () => {
    const badOutput = capability({
      id: "demo.bad_output",
      intent: "Return invalid output.",
      input: greetInput,
      output: greetOutput,
      run() {
        return { greeting: 123 } as never;
      }
    });
    const session = await connectSdkClient([badOutput]);

    try {
      const result = await session.client.callTool({
        name: "demo.bad_output",
        arguments: {
          name: "Ada"
        }
      });

      expect(result.isError).toBe(true);
      expect(errorBody(result)).toMatchObject({
        error: {
          code: "internal",
          message: "Capability returned invalid output."
        }
      });
    } finally {
      await session.close();
    }
  });

  it("routes calls by the tool name exposed through MCP passthrough", async () => {
    const renamed = capability({
      id: "demo.renamed",
      intent: "Use a raw MCP tool name.",
      input: greetInput,
      output: greetOutput,
      passthrough: {
        mcp: {
          name: "raw_tool_name"
        }
      },
      run(input) {
        return { greeting: `Hello, ${input.name}` };
      }
    });
    const session = await connectSdkClient([renamed]);

    try {
      await expect(session.client.listTools()).resolves.toMatchObject({
        tools: [
          {
            name: "raw_tool_name"
          }
        ]
      });
      await expect(
        session.client.callTool({
          name: "raw_tool_name",
          arguments: {
            name: "Ada"
          }
        })
      ).resolves.toMatchObject({
        structuredContent: {
          greeting: "Hello, Ada"
        },
        isError: false
      });
    } finally {
      await session.close();
    }
  });

  it("lets the SDK return protocol errors for unknown tools", async () => {
    const session = await connectSdkClient([greet]);

    try {
      const result = await session.client.callTool({
        name: "demo.missing",
        arguments: {}
      });

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "MCP error -32602: Tool demo.missing not found"
          }
        ],
        isError: true
      });
    } finally {
      await session.close();
    }
  });
});

interface ConnectedSdkClient {
  readonly client: Client;
  close(): Promise<void>;
}

interface ConnectOptions {
  readonly context?: RegisterCallsiteToolsOptions["context"];
}

async function connectSdkClient(
  capabilities: readonly AnyCapability[],
  options: ConnectOptions = {}
): Promise<ConnectedSdkClient> {
  const server = new McpServer({ name: "callsite-test", version: "0.0.0" });

  registerCallsiteTools(server, capabilities, {
    toJsonSchema,
    ...(options.context === undefined ? {} : { context: options.context })
  });

  return connectServerClient(server);
}

async function connectServerClient(server: McpServer): Promise<ConnectedSdkClient> {
  const client = new Client({ name: "vitest", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    async close() {
      await client.close();
      await server.close();
    }
  };
}

function errorBody(result: unknown): unknown {
  const callResult = result as {
    readonly content: readonly [
      {
        readonly text: string;
        readonly type: "text";
      }
    ];
  };

  return JSON.parse(callResult.content[0].text);
}

function schema<T>(
  validate: (value: unknown) => StandardResult<T> | Promise<StandardResult<T>>
): StandardSchemaV1<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "runtime-mcp-test",
      validate
    }
  };
}

function issue(message: string, path: readonly string[]): StandardResult<never> {
  return {
    issues: [
      {
        message,
        path
      }
    ]
  };
}
