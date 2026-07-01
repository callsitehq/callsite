import {
  createFetchHandler,
  type FetchHandler,
  type FetchHandlerOptions
} from "@callsitehq/runtime";

import { createOrdersApp, type OrdersAppOptions } from "./app.js";

export interface OrdersFetchHandlerOptions extends FetchHandlerOptions {
  readonly app?: OrdersAppOptions | undefined;
}

export function createOrdersFetchHandler(options: OrdersFetchHandlerOptions = {}): FetchHandler {
  const { app, ...runtimeOptions } = options;

  return createFetchHandler(createOrdersApp(app).capabilities, runtimeOptions);
}
