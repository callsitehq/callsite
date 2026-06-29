import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { toIR } from "@callsitehq/core";
import { emitMcpJson, emitOpenApi } from "@callsitehq/emit";

import config from "../callsite.config.js";
import { fetchHandler } from "./server.js";

const ir = toIR(config.capabilities, config.toJsonSchema);
const mcpOptions = config.emit?.mcp;
const openApiOptions = config.emit?.openapi;

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
          code: "not_found",
          intent: "No paid order exists for the provided orderId."
        },
        {
          code: "conflict",
          intent:
            "The order is already refunded or the requested refund exceeds the refundable amount."
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

  it("serves the standard error envelope through runtime", async () => {
    const response = await fetchHandler(
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
    const response = await fetchHandler(
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
});

async function writeExampleArtifacts(outDir: URL): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(new URL("mcp.json", outDir), emitMcpJson(ir, mcpOptions)),
    writeFile(new URL("openapi.json", outDir), emitOpenApi(ir, openApiOptions))
  ]);
}
