import { z } from "zod";

import { capability, CapabilityError } from "@callsitehq/core";

const orderStatus = z.enum(["paid", "shipped", "refunded"]);

const orders = [
  {
    orderId: "ord_1001",
    email: "ada@example.com",
    status: "paid",
    totalCents: 12_500,
    refundedCents: 0
  },
  {
    orderId: "ord_1002",
    email: "ada@example.com",
    status: "shipped",
    totalCents: 4_200,
    refundedCents: 0
  },
  {
    orderId: "ord_2001",
    email: "grace@example.com",
    status: "refunded",
    totalCents: 9_900,
    refundedCents: 9_900
  }
] as const;

const orderSummary = z.object({
  orderId: z.string(),
  status: orderStatus,
  totalCents: z.number().int().nonnegative(),
  refundedCents: z.number().int().nonnegative()
});

const findOrdersInput = z.object({
  email: z.email().describe("Customer email address to search."),
  status: orderStatus.optional().describe("Optional order status filter."),
  limit: z.number().int().min(1).max(25).default(10)
});

const findOrdersOutput = z.object({
  orders: z.array(orderSummary)
});

const refundOrderInput = z.object({
  orderId: z.string().describe("The paid order to refund, e.g. ord_1001."),
  amountCents: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Partial amount in cents. Omit to refund the remaining order total."),
  reason: z.string().optional().describe("Customer-facing reason for the refund.")
});

const refundOrderOutput = z.object({
  refundId: z.string(),
  status: z.enum(["refunded", "pending"]),
  refundedCents: z.number().int().positive()
});

export const findOrders = capability({
  id: "orders.find",
  intent:
    "Search a customer's orders by email and optional status. Use this before acting on a specific order, such as before issuing a refund.",
  input: findOrdersInput,
  output: findOrdersOutput,
  examples: [
    {
      input: { email: "ada@example.com", status: "paid" },
      output: {
        orders: [
          {
            orderId: "ord_1001",
            status: "paid",
            totalCents: 12_500,
            refundedCents: 0
          }
        ]
      },
      note: "Find paid orders for a customer before selecting one to refund."
    }
  ],
  run(input) {
    return {
      orders: orders
        .filter((order) => order.email === input.email)
        .filter((order) => input.status === undefined || order.status === input.status)
        .slice(0, input.limit)
        .map((order) => ({
          orderId: order.orderId,
          status: order.status,
          totalCents: order.totalCents,
          refundedCents: order.refundedCents
        }))
    };
  }
});

export const refundOrder = capability({
  id: "orders.refund",
  intent:
    "Refund a customer's paid order, either fully or partially. Use when the customer has selected a specific paid order and wants money returned. Do not use to cancel unpaid orders.",
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
      intent: "The order is already refunded or the requested refund exceeds the refundable amount."
    }
  ],
  examples: [
    {
      input: { orderId: "ord_1001", reason: "Customer returned the item." },
      output: {
        refundId: "re_ord_1001",
        status: "refunded",
        refundedCents: 12_500
      },
      note: "Full refund with amountCents omitted."
    }
  ],
  run(input, context) {
    context.log("orders.refund.start", { orderId: input.orderId });

    const order = orders.find((candidate) => candidate.orderId === input.orderId);
    if (order === undefined) {
      throw new CapabilityError("not_found", "No paid order exists for that id.", {
        orderId: input.orderId
      });
    }
    if (order.status === "refunded") {
      throw new CapabilityError("conflict", "Order has already been refunded.", {
        orderId: input.orderId
      });
    }

    const refundableCents = order.totalCents - order.refundedCents;
    const refundedCents = input.amountCents ?? refundableCents;
    if (refundedCents > refundableCents) {
      throw new CapabilityError("conflict", "Refund amount exceeds the refundable balance.", {
        orderId: input.orderId,
        refundableCents
      });
    }

    const status: z.infer<typeof refundOrderOutput>["status"] =
      refundedCents === refundableCents ? "refunded" : "pending";

    return {
      refundId: `re_${order.orderId}`,
      status,
      refundedCents
    };
  }
});

export const capabilities = [findOrders, refundOrder] as const;
