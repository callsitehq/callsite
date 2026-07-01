import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { toIR } from "@callsitehq/core";
import { emitMcpJson, emitOpenApi } from "@callsitehq/emit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import config from "../callsite.config.js";
import { createOrdersApp } from "./app.js";
import { createOrdersFetchHandler } from "./http.js";
import { createOrdersMcpServer } from "./mcp.js";
import type { OrderEvent } from "./services.js";

const ir = toIR(config.capabilities, config.toJsonSchema);
const mcpOptions = config.emit?.mcp;
const openApiOptions = config.emit?.openapi;
const fetchHandler = createOrdersFetchHandler();

describe("orders example", () => {
  it("defines intent-rich capabilities and compiles them to IR", () => {
    expect(ir.capabilities.map((capability) => capability.id)).toEqual([
      "orders.find",
      "orders.refund"
    ]);
    expect(ir.capabilities[1]).toMatchObject({
      destructive: true,
      errors: [
        {
          code: "unauthorized",
          intent: "A signed-in support subject is required to refund orders."
        },
        {
          code: "forbidden",
          intent: "Refunding orders is disabled for the current support subject."
        },
        {
          code: "not_found",
          intent: "No paid order exists for the provided orderId."
        },
        {
          code: "conflict",
          intent:
            "The order is not in a refundable state, is already refunded, or the requested refund exceeds the refundable amount."
        }
      ]
    });
  });

  it("builds MCP and OpenAPI artifacts from the same IR", async () => {
    const outDir = pathToFileURL(`${await mkdtemp(join(tmpdir(), "callsite-orders-"))}/`);

    await writeExampleArtifacts(outDir);

    await expect(readFile(new URL("mcp.json", outDir), "utf8")).resolves.toBe(
      emitMcpJson(ir, mcpOptions)
    );
    await expect(readFile(new URL("openapi.json", outDir), "utf8")).resolves.toBe(
      emitOpenApi(ir, openApiOptions)
    );
  });

  it("keeps tracked generated artifacts current", async () => {
    await expect(readFile(new URL("../generated/mcp.json", import.meta.url), "utf8")).resolves.toBe(
      emitMcpJson(ir, mcpOptions)
    );
    await expect(
      readFile(new URL("../generated/openapi.json", import.meta.url), "utf8")
    ).resolves.toBe(emitOpenApi(ir, openApiOptions));
  });

  it("serves the OpenAPI-shaped success response through runtime", async () => {
    const response = await fetchHandler(
      new Request("https://api.example.com/capabilities/orders.find", {
        body: JSON.stringify({ email: "ada@example.com", status: "paid" }),
        method: "POST"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      orders: [
        {
          orderId: "ord_1001",
          status: "paid",
          totalCents: 12_500,
          refundedCents: 0
        }
      ]
    });
  });

  it("serves the same capabilities through MCP runtime", async () => {
    const server = createOrdersMcpServer();
    const client = new Client({ name: "orders-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      await expect(client.listTools()).resolves.toMatchObject({
        tools: [
          {
            name: "orders.find"
          },
          {
            name: "orders.refund"
          }
        ]
      });
      await expect(
        client.callTool({
          name: "orders.find",
          arguments: {
            email: "ada@example.com",
            status: "paid"
          }
        })
      ).resolves.toMatchObject({
        structuredContent: {
          orders: [
            {
              orderId: "ord_1001",
              status: "paid",
              totalCents: 12_500,
              refundedCents: 0
            }
          ]
        },
        isError: false
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("shares app-owned state across short-lived MCP server instances", async () => {
    const ordersApp = createOrdersApp();

    await withOrdersMcpClient(
      createOrdersMcpServer(ordersApp.capabilities, {
        context: { subject: "support_123" }
      }),
      async (client) => {
        await expect(
          client.callTool({
            name: "orders.refund",
            arguments: {
              orderId: "ord_1001"
            }
          })
        ).resolves.toMatchObject({
          structuredContent: {
            refundId: "re_ord_1001",
            status: "refunded",
            refundedCents: 12_500
          },
          isError: false
        });
      }
    );

    await withOrdersMcpClient(createOrdersMcpServer(ordersApp.capabilities), async (client) => {
      await expect(
        client.callTool({
          name: "orders.find",
          arguments: {
            email: "ada@example.com",
            status: "refunded"
          }
        })
      ).resolves.toMatchObject({
        structuredContent: {
          orders: [
            {
              orderId: "ord_1001",
              status: "refunded",
              totalCents: 12_500,
              refundedCents: 12_500
            }
          ]
        },
        isError: false
      });
    });
  });

  it("serves the standard error envelope through runtime", async () => {
    const refundHandler = createOrdersFetchHandler({
      context: { subject: "support_123" }
    });
    const response = await refundHandler(
      new Request("https://api.example.com/capabilities/orders.refund", {
        body: JSON.stringify({ orderId: "ord_missing" }),
        method: "POST"
      })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "not_found",
        message: "No paid order exists for that id.",
        details: {
          orderId: "ord_missing"
        }
      }
    });
  });

  it("serves declared conflict errors through runtime", async () => {
    const refundHandler = createOrdersFetchHandler({
      context: { subject: "support_123" }
    });
    const response = await refundHandler(
      new Request("https://api.example.com/capabilities/orders.refund", {
        body: JSON.stringify({ orderId: "ord_2001" }),
        method: "POST"
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "conflict",
        message: "Order has already been refunded.",
        details: {
          orderId: "ord_2001"
        }
      }
    });
  });

  it("rejects non-paid orders that are not refundable", async () => {
    const refundHandler = createOrdersFetchHandler({
      context: { subject: "support_123" }
    });
    const response = await refundHandler(
      new Request("https://api.example.com/capabilities/orders.refund", {
        body: JSON.stringify({ orderId: "ord_1002" }),
        method: "POST"
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "conflict",
        message: "Order is not in a refundable state.",
        details: {
          orderId: "ord_1002",
          status: "shipped"
        }
      }
    });
  });

  it("requires per-request subject for destructive capabilities", async () => {
    const response = await fetchHandler(
      new Request("https://api.example.com/capabilities/orders.refund", {
        body: JSON.stringify({ orderId: "ord_1001" }),
        method: "POST"
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthorized",
        message: "A signed-in subject is required."
      }
    });
  });

  it("lets the host app compose services and per-request context around capabilities", async () => {
    const events: [string, Record<string, unknown> | undefined][] = [];
    const publishedEvents: OrderEvent[] = [];
    const hostOwnedHandler = createOrdersFetchHandler({
      app: {
        events: {
          publish(event) {
            publishedEvents.push(event);
          }
        }
      },
      context(request) {
        const subject = request.headers.get("x-subject");

        return {
          ...(subject === null ? {} : { subject }),
          log(event, data) {
            events.push([event, data]);
          }
        };
      }
    });

    const response = await hostOwnedHandler(
      new Request("https://api.example.com/capabilities/orders.refund", {
        body: JSON.stringify({ orderId: "ord_1001" }),
        headers: { "x-subject": "support_123" },
        method: "POST"
      })
    );

    expect(response.status).toBe(200);
    expect(events).toEqual([["orders.refund.start", { orderId: "ord_1001" }]]);
    expect(publishedEvents).toEqual([
      {
        type: "order.refunded",
        actorId: "support_123",
        orderId: "ord_1001",
        refundedCents: 12_500
      }
    ]);
  });

  it("lets host-owned services affect capability behavior", async () => {
    const hostOwnedHandler = createOrdersFetchHandler({
      app: {
        featureFlags: {
          enabled() {
            return false;
          }
        }
      },
      context: { subject: "support_123" }
    });

    const response = await hostOwnedHandler(
      new Request("https://api.example.com/capabilities/orders.refund", {
        body: JSON.stringify({ orderId: "ord_1001" }),
        method: "POST"
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "forbidden",
        message: "Refunding orders is disabled for this subject.",
        details: {
          actorId: "support_123"
        }
      }
    });
  });
});

async function withOrdersMcpClient(
  server: ReturnType<typeof createOrdersMcpServer>,
  run: (client: Client) => Promise<void>
): Promise<void> {
  const client = new Client({ name: "orders-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

async function writeExampleArtifacts(outDir: URL): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(new URL("mcp.json", outDir), emitMcpJson(ir, mcpOptions)),
    writeFile(new URL("openapi.json", outDir), emitOpenApi(ir, openApiOptions))
  ]);
}
