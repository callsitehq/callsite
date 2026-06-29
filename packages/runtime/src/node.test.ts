import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { capability, type StandardResult, type StandardSchemaV1 } from "@callsitehq/core";

import { createFetchHandler } from "./index.js";
import { createNodeHandler } from "./node.js";

interface GreetInput {
  readonly name: string;
}

interface GreetOutput {
  readonly greeting: string;
}

const greetInput = schema<GreetInput>((value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("name" in value) ||
    typeof value.name !== "string"
  ) {
    return issue("Expected { name: string }", ["name"]);
  }

  return { value: { name: value.name } };
});

const greetOutput = schema<GreetOutput>((value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("greeting" in value) ||
    typeof value.greeting !== "string"
  ) {
    return issue("Expected { greeting: string }", ["greeting"]);
  }

  return { value: { greeting: value.greeting } };
});

const greet = capability({
  id: "demo.greet",
  intent: "Greet a person by name.",
  input: greetInput,
  output: greetOutput,
  run(input) {
    return { greeting: `Hello, ${input.name}` };
  }
});

describe("createNodeHandler", () => {
  it("adapts Node HTTP requests through the fetch handler", async () => {
    const handler = createNodeHandler(createFetchHandler([greet]));
    const response = await callNodeHandler(handler, {
      body: JSON.stringify({ name: "Ada" }),
      method: "POST",
      url: "/capabilities/demo.greet"
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ greeting: "Hello, Ada" });
  });
});

function schema<T>(
  validate: (value: unknown) => StandardResult<T> | Promise<StandardResult<T>>
): StandardSchemaV1<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "runtime-node-test",
      validate
    }
  };
}

function issue(message: string, path: readonly string[]): StandardResult<never> {
  return {
    issues: [
      {
        message,
        path
      }
    ]
  };
}

interface NodeRequestOptions {
  readonly body?: string;
  readonly method: string;
  readonly url: string;
}

interface CapturedNodeResponse {
  readonly body: string;
  readonly headers: ReadonlyMap<string, number | readonly string[] | string>;
  readonly status: number;
}

async function callNodeHandler(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  options: NodeRequestOptions
): Promise<CapturedNodeResponse> {
  const request = Readable.from(
    options.body === undefined ? [] : [options.body]
  ) as IncomingMessage;
  request.headers = {
    host: "localhost"
  };
  request.method = options.method;
  request.url = options.url;

  const chunks: Buffer[] = [];
  const headers = new Map<string, number | readonly string[] | string>();
  let status = 0;

  const done = new Promise<void>((resolveDone) => {
    const response = {
      headersSent: false,
      statusCode: 0,
      statusMessage: "",
      destroy() {
        resolveDone();
        return response;
      },
      end(chunk?: unknown) {
        status = response.statusCode;
        if (chunk !== undefined) {
          chunks.push(
            Buffer.from(
              typeof chunk === "string" || chunk instanceof Uint8Array ? chunk : String(chunk)
            )
          );
        }
        resolveDone();
        return response;
      },
      setHeader(name: string, value: number | readonly string[] | string) {
        headers.set(name, value);
        return response;
      }
    } as unknown as ServerResponse;

    handler(request, response);
  });

  await done;

  return {
    body: Buffer.concat(chunks).toString("utf8"),
    headers,
    status
  };
}
