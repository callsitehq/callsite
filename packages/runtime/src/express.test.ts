import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { capability, type StandardResult, type StandardSchemaV1 } from "@callsitehq/core";

import { createFetchHandler } from "./index.js";
import {
  createExpressHandler,
  type ExpressHandler,
  type ExpressRequest,
  type ExpressResponse
} from "./express.js";

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

describe("createExpressHandler", () => {
  it("adapts parsed Express request bodies through the fetch handler", async () => {
    const handler = createExpressHandler(createFetchHandler([greet]));
    const response = await callExpressHandler(handler, {
      body: { name: "Ada" },
      headers: {
        host: "api.example.com"
      },
      method: "POST",
      originalUrl: "/capabilities/demo.greet?source=express",
      protocol: "https"
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(response.body)).toEqual({ greeting: "Hello, Ada" });
  });

  it("falls back to reading the request stream when no parsed body exists", async () => {
    const handler = createExpressHandler(createFetchHandler([greet]));
    const request = Readable.from([JSON.stringify({ name: "Grace" })]) as unknown as ExpressRequest;
    Object.assign(request, {
      headers: {
        "content-type": "application/json",
        host: "api.example.com"
      },
      method: "POST",
      originalUrl: "/capabilities/demo.greet",
      protocol: "https"
    });

    const response = await callExpressHandler(handler, request);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ greeting: "Hello, Grace" });
  });

  it("sets JSON content-type when serializing parsed Express objects", async () => {
    const handler = createExpressHandler(async (request) => {
      return Response.json({
        body: await request.text(),
        contentType: request.headers.get("content-type")
      });
    });
    const response = await callExpressHandler(handler, {
      body: { name: "Ada" },
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        host: "api.example.com"
      },
      method: "POST",
      originalUrl: "/capabilities/demo.greet"
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      body: '{"name":"Ada"}',
      contentType: "application/json"
    });
  });

  it("preserves multiple Set-Cookie response headers when available", async () => {
    const handler = createExpressHandler(() => {
      const headers = new Headers();
      headers.append("set-cookie", "session=abc; HttpOnly");
      headers.append("set-cookie", "theme=light");

      return new Response("ok", { headers });
    });
    const response = await callExpressHandler(handler, {
      headers: {
        host: "api.example.com"
      },
      method: "GET",
      originalUrl: "/capabilities/demo.greet"
    });

    expect(response.headers.get("set-cookie")).toEqual(["session=abc; HttpOnly", "theme=light"]);
  });

  it("passes fetch handler failures to Express next", async () => {
    const error = new Error("boom");
    const handler = createExpressHandler(() => {
      throw error;
    });
    const response = await callExpressHandler(handler, {
      body: { name: "Ada" },
      headers: {
        host: "api.example.com"
      },
      method: "POST",
      originalUrl: "/capabilities/demo.greet"
    });

    expect(response.error).toBe(error);
    expect(response.body).toBe("");
  });
});

function schema<T>(
  validate: (value: unknown) => StandardResult<T> | Promise<StandardResult<T>>
): StandardSchemaV1<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "runtime-express-test",
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

interface CapturedExpressResponse {
  readonly body: string;
  readonly error: unknown;
  readonly headers: ReadonlyMap<string, readonly string[] | string>;
  readonly status: number;
}

function callExpressHandler(
  handler: ExpressHandler,
  request: Partial<ExpressRequest> & Pick<ExpressRequest, "headers">
): Promise<CapturedExpressResponse> {
  const chunks: Buffer[] = [];
  const headers = new Map<string, readonly string[] | string>();
  let status = 0;
  let error: unknown;

  return new Promise((resolve) => {
    const response = {
      send(body?: unknown) {
        if (body !== undefined) {
          chunks.push(
            Buffer.from(
              typeof body === "string" || body instanceof Uint8Array ? body : String(body)
            )
          );
        }

        resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          error,
          headers,
          status
        });
        return this;
      },
      set(field: string, value: readonly string[] | string) {
        headers.set(field, value);
        return this;
      },
      status(code: number) {
        status = code;
        return this;
      }
    } as unknown as ExpressResponse;

    handler(request as ExpressRequest, response, (nextError?: unknown) => {
      error = nextError;
      resolve({
        body: Buffer.concat(chunks).toString("utf8"),
        error,
        headers,
        status
      });
    });
  });
}
