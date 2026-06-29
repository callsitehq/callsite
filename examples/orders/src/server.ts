import { realpathSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";

import {
  createFetchHandler,
  type FetchHandler,
  type FetchHandlerOptions
} from "@callsitehq/runtime";
import { createNodeHandler, type NodeHandler } from "@callsitehq/runtime/node";

import { createOrdersApp, type OrdersAppOptions } from "./app.js";

export interface OrdersFetchHandlerOptions extends FetchHandlerOptions {
  readonly app?: OrdersAppOptions | undefined;
}

export interface OrdersServerOptions {
  readonly host?: string;
  readonly port?: number;
}

export function createOrdersFetchHandler(options: OrdersFetchHandlerOptions = {}): FetchHandler {
  const { app, ...runtimeOptions } = options;
  return createFetchHandler(createOrdersApp(app).capabilities, runtimeOptions);
}

export function createOrdersNodeHandler(options: OrdersFetchHandlerOptions = {}): NodeHandler {
  return createNodeHandler(createOrdersFetchHandler(options));
}

export function serveOrders(options: OrdersServerOptions = {}): Server {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;
  const server = createServer(
    createOrdersNodeHandler({
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
  );

  server.listen(port, host, () => {
    const address = server.address();
    const boundPort = typeof address === "object" && address !== null ? address.port : port;

    console.log(`Orders example listening at http://${hostForUrl(host)}:${boundPort}`);
  });

  return server;
}

function hostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isDirectRun) {
  serveOrders();
}
