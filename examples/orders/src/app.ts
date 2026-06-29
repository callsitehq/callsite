import { createOrderCapabilities } from "./capabilities.js";
import {
  FindOrdersUseCase,
  InMemoryOrderRepository,
  RefundOrderUseCase,
  type FeatureFlagChecker,
  type OrderEventPublisher
} from "./services.js";

export interface OrdersAppOptions {
  readonly events?: OrderEventPublisher | undefined;
  readonly featureFlags?: FeatureFlagChecker | undefined;
}

export function createOrdersApp(options: OrdersAppOptions = {}) {
  const orders = new InMemoryOrderRepository();
  const findOrders = new FindOrdersUseCase(orders);
  const refundOrder = new RefundOrderUseCase(orders, {
    events: options.events,
    featureFlags: options.featureFlags
  });

  return {
    capabilities: createOrderCapabilities({
      findOrders,
      refundOrder
    })
  };
}

export const capabilities = createOrdersApp().capabilities;
