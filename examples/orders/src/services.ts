export type OrderStatus = "paid" | "shipped" | "refunded";

export interface OrderSummary {
  readonly orderId: string;
  readonly status: OrderStatus;
  readonly totalCents: number;
  readonly refundedCents: number;
}

export interface FindOrdersRequest {
  readonly email: string;
  readonly status?: OrderStatus | undefined;
  readonly limit: number;
}

export interface FindOrdersResponse {
  readonly orders: OrderSummary[];
}

export interface RefundOrderRequest {
  readonly actorId: string;
  readonly orderId: string;
  readonly amountCents?: number | undefined;
  readonly reason?: string | undefined;
}

export interface RefundOrderResponse {
  readonly refundId: string;
  readonly status: "refunded" | "pending";
  readonly refundedCents: number;
}

export interface OrderEvent {
  readonly type: "order.refunded";
  readonly actorId: string;
  readonly orderId: string;
  readonly refundedCents: number;
  readonly reason?: string | undefined;
}

export interface OrderEventPublisher {
  publish(event: OrderEvent): void | Promise<void>;
}

export interface FeatureFlagChecker {
  enabled(flag: string, actorId: string): boolean | Promise<boolean>;
}

export interface OrderRecord {
  orderId: string;
  email: string;
  status: OrderStatus;
  totalCents: number;
  refundedCents: number;
}

export class InMemoryOrderRepository {
  readonly #orders: OrderRecord[];

  public constructor(orders: readonly OrderRecord[] = seedOrders()) {
    this.#orders = orders.map((order) => ({ ...order }));
  }

  public find(input: FindOrdersRequest): OrderSummary[] {
    return this.#orders
      .filter((order) => order.email === input.email)
      .filter((order) => input.status === undefined || order.status === input.status)
      .slice(0, input.limit)
      .map(toSummary);
  }

  public findById(orderId: string): OrderRecord | undefined {
    return this.#orders.find((order) => order.orderId === orderId);
  }

  public applyRefund(orderId: string, refundedCents: number): void {
    const order = this.findById(orderId);
    if (order === undefined) {
      return;
    }

    order.refundedCents += refundedCents;
    if (order.refundedCents === order.totalCents) {
      order.status = "refunded";
    }
  }
}

export class FindOrdersUseCase {
  public constructor(private readonly orders: InMemoryOrderRepository) {}

  public execute(input: FindOrdersRequest): FindOrdersResponse {
    return {
      orders: this.orders.find(input)
    };
  }
}

export interface RefundOrderUseCaseOptions {
  readonly events?: OrderEventPublisher | undefined;
  readonly featureFlags?: FeatureFlagChecker | undefined;
}

export class RefundOrderUseCase {
  readonly #events: OrderEventPublisher;
  readonly #featureFlags: FeatureFlagChecker;

  public constructor(
    private readonly orders: InMemoryOrderRepository,
    options: RefundOrderUseCaseOptions = {}
  ) {
    this.#events = options.events ?? noopEvents;
    this.#featureFlags = options.featureFlags ?? allowAllFeatureFlags;
  }

  public async execute(input: RefundOrderRequest): Promise<RefundOrderResponse> {
    if (!(await this.#featureFlags.enabled("orders.refund", input.actorId))) {
      throw new RefundsDisabledError(input.actorId);
    }

    const order = this.orders.findById(input.orderId);
    if (order === undefined) {
      throw new OrderNotFoundError(input.orderId);
    }
    if (order.status === "refunded") {
      throw new OrderAlreadyRefundedError(input.orderId);
    }
    if (order.status !== "paid") {
      throw new OrderNotRefundableError(input.orderId, order.status);
    }

    const refundableCents = order.totalCents - order.refundedCents;
    const refundedCents = input.amountCents ?? refundableCents;
    if (refundedCents > refundableCents) {
      throw new RefundAmountExceedsBalanceError(input.orderId, refundableCents);
    }

    this.orders.applyRefund(order.orderId, refundedCents);

    await this.#events.publish({
      type: "order.refunded",
      actorId: input.actorId,
      orderId: order.orderId,
      refundedCents,
      ...(input.reason === undefined ? {} : { reason: input.reason })
    });

    return {
      refundId: `re_${order.orderId}`,
      status: refundedCents === refundableCents ? "refunded" : "pending",
      refundedCents
    };
  }
}

export class RefundsDisabledError extends Error {
  public constructor(public readonly actorId: string) {
    super("Refunds are disabled for this subject.");
    this.name = "RefundsDisabledError";
  }
}

export class OrderNotFoundError extends Error {
  public constructor(public readonly orderId: string) {
    super("Order not found.");
    this.name = "OrderNotFoundError";
  }
}

export class OrderAlreadyRefundedError extends Error {
  public constructor(public readonly orderId: string) {
    super("Order already refunded.");
    this.name = "OrderAlreadyRefundedError";
  }
}

export class OrderNotRefundableError extends Error {
  public constructor(
    public readonly orderId: string,
    public readonly status: OrderStatus
  ) {
    super("Order is not refundable.");
    this.name = "OrderNotRefundableError";
  }
}

export class RefundAmountExceedsBalanceError extends Error {
  public constructor(
    public readonly orderId: string,
    public readonly refundableCents: number
  ) {
    super("Refund amount exceeds refundable balance.");
    this.name = "RefundAmountExceedsBalanceError";
  }
}

export function seedOrders(): OrderRecord[] {
  return [
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
  ];
}

function toSummary(order: OrderRecord): OrderSummary {
  return {
    orderId: order.orderId,
    status: order.status,
    totalCents: order.totalCents,
    refundedCents: order.refundedCents
  };
}

const noopEvents: OrderEventPublisher = {
  publish() {
    return undefined;
  }
};

const allowAllFeatureFlags: FeatureFlagChecker = {
  enabled() {
    return true;
  }
};
