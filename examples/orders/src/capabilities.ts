import { z } from "zod";

import { capability, CapabilityError } from "@callsitehq/core";

import {
  OrderAlreadyRefundedError,
  OrderNotFoundError,
  OrderNotRefundableError,
  RefundAmountExceedsBalanceError,
  RefundsDisabledError,
  type FindOrdersRequest,
  type FindOrdersResponse,
  type RefundOrderRequest,
  type RefundOrderResponse
} from "./services.js";

const orderStatus = z.enum(["paid", "shipped", "refunded"]);

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

export interface OrderCapabilityDeps {
  readonly findOrders: {
    execute(input: FindOrdersRequest): FindOrdersResponse | Promise<FindOrdersResponse>;
  };
  readonly refundOrder: {
    execute(input: RefundOrderRequest): RefundOrderResponse | Promise<RefundOrderResponse>;
  };
}

export function createOrderCapabilities(deps: OrderCapabilityDeps) {
  const findOrders = capability({
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
      return deps.findOrders.execute(input);
    }
  });

  const refundOrder = capability({
    id: "orders.refund",
    intent:
      "Refund a customer's paid order, either fully or partially. Use when the customer has selected a specific paid order and wants money returned. Do not use to cancel unpaid orders.",
    input: refundOrderInput,
    output: refundOrderOutput,
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
    async run(input, context) {
      context.log("orders.refund.start", { orderId: input.orderId });

      const actorId = subjectAsActorId(context.subject);
      if (actorId === undefined) {
        throw new CapabilityError("unauthorized", "A signed-in subject is required.");
      }

      try {
        return await deps.refundOrder.execute({
          ...input,
          actorId
        });
      } catch (error) {
        throw mapRefundError(error);
      }
    }
  });

  return [findOrders, refundOrder] as const;
}

function subjectAsActorId(subject: unknown): string | undefined {
  return typeof subject === "string" && subject.length > 0 ? subject : undefined;
}

function mapRefundError(error: unknown): CapabilityError {
  if (error instanceof RefundsDisabledError) {
    return new CapabilityError("forbidden", "Refunding orders is disabled for this subject.", {
      actorId: error.actorId
    });
  }

  if (error instanceof OrderNotFoundError) {
    return new CapabilityError("not_found", "No paid order exists for that id.", {
      orderId: error.orderId
    });
  }

  if (error instanceof OrderAlreadyRefundedError) {
    return new CapabilityError("conflict", "Order has already been refunded.", {
      orderId: error.orderId
    });
  }

  if (error instanceof OrderNotRefundableError) {
    return new CapabilityError("conflict", "Order is not in a refundable state.", {
      orderId: error.orderId,
      status: error.status
    });
  }

  if (error instanceof RefundAmountExceedsBalanceError) {
    return new CapabilityError("conflict", "Refund amount exceeds the refundable balance.", {
      orderId: error.orderId,
      refundableCents: error.refundableCents
    });
  }

  if (error instanceof CapabilityError) {
    return error;
  }

  return new CapabilityError("internal", "Unexpected refund failure.");
}
