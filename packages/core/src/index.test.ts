import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  capability,
  toIR,
  type CapabilityContext,
  type JsonSchema,
  type ToJsonSchema
} from "./index.js";

const toJsonSchema: ToJsonSchema = (schema, options) =>
  z.toJSONSchema(schema as z.ZodType, { io: options.direction }) as JsonSchema;

const refundOrderInput = z.object({
  orderId: z.string().describe("The order to refund, e.g. 'ord_1A2B'."),
  amountCents: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Partial amount in cents. Omit to refund the full order."),
  reason: z.string().optional()
});

const refundOrderOutput = z.object({
  refundId: z.string(),
  status: z.enum(["refunded", "pending"])
});

const findOrdersInput = z.object({
  email: z.email(),
  status: z.enum(["paid", "shipped", "refunded"]).optional(),
  limit: z.number().int().min(1).max(50).default(10)
});

const findOrdersOutput = z.object({
  orders: z.array(
    z.object({
      orderId: z.string(),
      status: z.string(),
      totalCents: z.number().int()
    })
  )
});

const refundOrder = capability({
  id: "refund_order",
  intent:
    "Refund a customer's order, fully or partially. Use when a customer asks for money back on a specific paid order. Do not use to cancel an unpaid order.",
  input: refundOrderInput,
  output: refundOrderOutput,
  destructive: true,
  errors: [
    {
      code: "not_found",
      intent: "No paid order exists for the provided orderId."
    },
    {
      code: "conflict",
      intent: "The order has already been fully refunded."
    }
  ],
  examples: [
    {
      input: { orderId: "ord_1A2B" },
      output: { refundId: "re_9Z", status: "refunded" },
      note: "Full refund with amountCents omitted."
    }
  ],
  overrides: {
    mcp: { title: "Refund order" }
  },
  passthrough: {
    openapi: { "x-callsite-category": "billing" }
  },
  async run(input, context) {
    context.log("refund.start", { orderId: input.orderId });
    const status: z.infer<typeof refundOrderOutput>["status"] =
      input.amountCents === undefined ? "refunded" : "pending";

    return {
      refundId: "re_TODO",
      status
    };
  }
});

const findOrders = capability({
  id: "find_orders",
  intent:
    "Search a customer's orders by email and optional status. Use to look up orders before acting on one, such as before issuing a refund.",
  input: findOrdersInput,
  output: findOrdersOutput,
  async run(input) {
    return {
      orders: [
        {
          orderId: "ord_1A2B",
          status: input.status ?? "paid",
          totalCents: 12_500
        }
      ].slice(0, input.limit)
    };
  }
});

describe("capability", () => {
  it("keeps the authored object as the executable definition", () => {
    expect(capability(findOrders)).toBe(findOrders);
  });

  it("rejects ids that cannot be used as stable tool names", () => {
    expect(() =>
      capability({
        id: "Refund Order",
        intent: "Refund an order.",
        input: refundOrderInput,
        output: refundOrderOutput,
        run() {
          return { refundId: "re_TODO", status: "pending" as const };
        }
      })
    ).toThrow(TypeError);
  });

  it("infers validated input and output types for run", async () => {
    const events: [string, Record<string, unknown> | undefined][] = [];
    const context: CapabilityContext = {
      log(event, data) {
        events.push([event, data]);
      }
    };

    await expect(
      refundOrder.run({ orderId: "ord_1A2B", amountCents: 500 }, context)
    ).resolves.toEqual({
      refundId: "re_TODO",
      status: "pending"
    });
    expect(events).toEqual([["refund.start", { orderId: "ord_1A2B" }]]);
  });
});

describe("toIR", () => {
  it("lowers real Zod-backed capabilities into a serializable intent-shaped IR", () => {
    const ir = toIR([refundOrder, findOrders], toJsonSchema);

    if (process.env.CALLSITE_PRINT_IR === "1") {
      console.log(JSON.stringify(ir, null, 2));
    }

    expect(ir.version).toBe(1);
    expect(ir.capabilities).toHaveLength(2);
    expect(ir.capabilities[0]).toMatchObject({
      id: "refund_order",
      destructive: true,
      errors: [
        {
          code: "not_found",
          intent: "No paid order exists for the provided orderId."
        },
        {
          code: "conflict",
          intent: "The order has already been fully refunded."
        }
      ],
      input: toJsonSchema(refundOrderInput, { direction: "input" }),
      output: toJsonSchema(refundOrderOutput, { direction: "output" }),
      examples: [
        {
          input: { orderId: "ord_1A2B" },
          output: { refundId: "re_9Z", status: "refunded" },
          note: "Full refund with amountCents omitted."
        }
      ],
      overrides: {
        mcp: { title: "Refund order" }
      },
      passthrough: {
        openapi: { "x-callsite-category": "billing" }
      }
    });
    expect(ir.capabilities[1]).toMatchObject({
      id: "find_orders",
      destructive: false,
      errors: [],
      input: toJsonSchema(findOrdersInput, { direction: "input" }),
      output: toJsonSchema(findOrdersOutput, { direction: "output" }),
      examples: [],
      overrides: {},
      passthrough: {}
    });
    expect(ir.capabilities[1]?.input).toMatchObject({
      properties: {
        limit: { default: 10 }
      },
      required: ["email"]
    });
  });
});
