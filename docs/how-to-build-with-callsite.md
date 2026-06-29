# How To Build With Callsite

Callsite has two jobs:

- turn your capability definitions into static agent-facing artifacts
- give your app a runtime dispatcher it can import and host itself

It does not own your application process. Your app still owns auth, services,
databases, queues, logging, deployment, and local development.

The intended shape is:

```txt
host request
  -> your server/framework
  -> auth/logging/request setup
  -> Callsite runtime
  -> capability.run(input, context)
  -> your use case/service
```

The full working example lives in `examples/orders`.

## 1. Write Normal Application Code First

Start with your own services and use cases. They should not import Callsite.

In the orders example, `src/services.ts` owns the in-memory repository,
feature-flag interface, event publisher interface, and use cases:

```ts
export class RefundOrderUseCase {
  public constructor(
    private readonly orders: InMemoryOrderRepository,
    options: RefundOrderUseCaseOptions = {}
  ) {}

  public async execute(input: RefundOrderRequest): Promise<RefundOrderResponse> {
    // Business rules, persistence, events, and domain errors live here.
  }
}
```

This keeps domain code reusable. A web route, queue worker, test, or Callsite
capability can all call the same use case.

## 2. Wrap Use Cases With Capabilities

A capability is the Callsite boundary around a use case. It owns:

- `id`: stable tool name
- `intent`: model-facing description of what the capability does and when to use it
- `input` and `output`: Standard Schema-compatible schemas
- `errors`: semantic failures the caller should understand
- `run`: the adapter from validated input and request context into your use case

Use a factory so long-lived dependencies are closed over when capabilities are
created:

```ts
export interface OrderCapabilityDeps {
  readonly refundOrder: {
    execute(input: RefundOrderRequest): Promise<RefundOrderResponse>;
  };
}

export function createOrderCapabilities(deps: OrderCapabilityDeps) {
  const refundOrder = capability({
    id: "orders.refund",
    intent:
      "Refund a customer's paid order, either fully or partially. Use when the customer has selected a specific paid order and wants money returned.",
    input: refundOrderInput,
    output: refundOrderOutput,
    destructive: true,
    errors: [
      {
        code: "unauthorized",
        intent: "A signed-in support subject is required to refund orders."
      },
      {
        code: "conflict",
        intent:
          "The order is not in a refundable state, is already refunded, or the requested refund exceeds the refundable amount."
      }
    ],
    async run(input, context) {
      context.log("orders.refund.start", { orderId: input.orderId });

      const actorId = subjectAsActorId(context.subject);
      if (actorId === undefined) {
        throw new CapabilityError("unauthorized", "A signed-in subject is required.");
      }

      try {
        return await deps.refundOrder.execute({ ...input, actorId });
      } catch (error) {
        throw mapRefundError(error);
      }
    }
  });

  return [refundOrder] as const;
}
```

The capability should be small. It should not know how to talk to a database,
publish an event, or evaluate a feature flag directly. It should translate
between Callsite and your application.

## 3. Keep Context Request-Scoped

Callsite context is for facts that vary per request. Today the core context is:

```ts
{
  subject?: unknown;
  log(event: string, data?: Record<string, unknown>): void;
}
```

Good context values:

- authenticated subject
- request-scoped logger
- correlation or trace data carried by the request-scoped logger

Poor context values:

- database clients
- repositories
- use case classes
- feature flag SDKs
- event buses

Those long-lived services belong in your application composition root and should
be closed over by capability factories.

## 4. Compose The App

Create the dependencies once in your application layer, then build capabilities
from them.

In `examples/orders/src/app.ts`:

```ts
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
```

This is the app-owned dependency graph. Callsite is just one consumer of it.

## 5. Add A Callsite Config

The CLI needs a config so it can load capabilities and emit static artifacts.
With Zod, use `@callsitehq/zod` so JSON Schema conversion stays below your app
code:

```ts
import { defineConfig } from "@callsitehq/zod";

import { capabilities } from "./src/app.js";

export default defineConfig({
  capabilities,
  emit: {
    mcp: {
      name: "orders",
      version: "0.1.0"
    },
    openapi: {
      baseUrl: "https://api.example.com",
      name: "Orders API",
      version: "0.1.0"
    }
  }
});
```

Then build:

```sh
pnpm exec callsite build --config callsite.config.ts --out generated
```

The CLI emits static files such as:

- `generated/mcp.json`
- `generated/openapi.json`

It does not generate or run your server.

## 6. Host The Runtime In Your Server

Your server imports the runtime and supplies request context. The Node example
uses the web-standard fetch handler plus the `node:http` adapter:

```ts
export function createOrdersFetchHandler(options: OrdersFetchHandlerOptions = {}) {
  const { app, ...runtimeOptions } = options;
  return createFetchHandler(createOrdersApp(app).capabilities, runtimeOptions);
}

export function serveOrders() {
  return createServer(
    createNodeHandler(
      createOrdersFetchHandler({
        app: {
          events: {
            publish(event) {
              console.log(JSON.stringify({ event: event.type, data: event }));
            }
          },
          featureFlags: {
            enabled(_flag, actorId) {
              return !actorId.startsWith("blocked_");
            }
          }
        },
        context(request) {
          const subject = request.headers.get("x-subject");

          return {
            ...(subject === null ? {} : { subject }),
            log(event, data) {
              console.log(JSON.stringify({ event, data }));
            }
          };
        }
      })
    )
  );
}
```

Runtime requests are JSON `POST`s to:

```txt
/capabilities/{capabilityId}
```

For example:

```sh
curl -s \
  -X POST http://127.0.0.1:3000/capabilities/orders.find \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","status":"paid"}'
```

## 7. Test The Contract

A useful test suite covers both halves:

- the same capabilities compile to IR and generated artifacts
- generated artifacts stay current
- runtime success responses work
- runtime validation and declared errors map correctly
- host-owned context reaches capabilities
- host-owned services affect behavior

The orders example tests all of those in `examples/orders/src/orders.test.ts`.

Run:

```sh
pnpm --filter @callsitehq/example-orders test
pnpm --filter @callsitehq/example-orders... build
```

## Rules Of Thumb

- Put business rules in use cases, not in `run`.
- Put app services in capability factories, not in context.
- Put per-request identity and logging in context.
- Throw domain errors from services; map them to `CapabilityError` at the capability boundary.
- Keep generated files declarative. The host app owns runtime composition.
- Treat `intent` as product copy for a model deciding whether to call the tool.
