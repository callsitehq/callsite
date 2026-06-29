import { describe, expect, it } from "vitest";

import { capability, type StandardResult, type StandardSchemaV1 } from "@callsitehq/core";

import {
  createLambdaHandler,
  type AwsLambdaHandler,
  type AwsLambdaHttpApiV2Event,
  type AwsLambdaHttpApiV2Result
} from "./aws-lambda.js";
import { createFetchHandler } from "./index.js";

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

describe("createLambdaHandler", () => {
  it("adapts API Gateway v2 events through the fetch handler", async () => {
    const handler = createLambdaHandler(createFetchHandler([greet]));
    const response = await invoke(
      handler,
      event({
        body: JSON.stringify({ name: "Ada" }),
        method: "POST",
        rawPath: "/capabilities/demo.greet",
        rawQueryString: "source=lambda"
      })
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers?.["content-type"]).toBe("application/json");
    expect(response.isBase64Encoded).toBe(false);
    expect(JSON.parse(response.body ?? "")).toEqual({ greeting: "Hello, Ada" });
  });

  it("decodes base64 request bodies and joins Lambda cookies", async () => {
    const handler = createLambdaHandler(async (request) => {
      return Response.json({
        body: await request.text(),
        cookie: request.headers.get("cookie"),
        url: request.url
      });
    });
    const response = await invoke(
      handler,
      event({
        body: Buffer.from("hello").toString("base64"),
        cookies: ["session=abc", "theme=light"],
        isBase64Encoded: true,
        method: "POST",
        rawPath: "/capabilities/demo.echo",
        rawQueryString: "debug=true"
      })
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "")).toEqual({
      body: "hello",
      cookie: "session=abc; theme=light",
      url: "https://api.example.com/capabilities/demo.echo?debug=true"
    });
  });

  it("adapts Lambda Function URL-shaped events", async () => {
    const handler = createLambdaHandler(async (request) => {
      return Response.json({
        host: request.headers.get("host"),
        method: request.method,
        url: request.url
      });
    });
    const response = await invoke(
      handler,
      functionUrlEvent({
        method: "GET",
        rawPath: "/capabilities/demo.echo",
        rawQueryString: "via=function-url"
      })
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "")).toEqual({
      host: "abcde.lambda-url.us-east-1.on.aws",
      method: "GET",
      url: "https://abcde.lambda-url.us-east-1.on.aws/capabilities/demo.echo?via=function-url"
    });
  });

  it("returns binary responses as base64 and maps Set-Cookie to Lambda cookies", async () => {
    const handler = createLambdaHandler(() => {
      const headers = new Headers({
        "content-type": "application/octet-stream"
      });
      headers.append("set-cookie", "session=abc; HttpOnly");
      headers.append("set-cookie", "theme=light");

      return new Response(new Uint8Array([0, 1, 2]), { headers });
    });
    const response = await invoke(
      handler,
      event({
        method: "GET",
        rawPath: "/capabilities/demo.binary"
      })
    );

    expect(response).toEqual({
      statusCode: 200,
      headers: {
        "content-type": "application/octet-stream"
      },
      cookies: ["session=abc; HttpOnly", "theme=light"],
      body: "AAEC",
      isBase64Encoded: true
    });
  });

  it("returns compressed text responses as base64", async () => {
    const gzipBytes = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
    const handler = createLambdaHandler(() => {
      return new Response(gzipBytes, {
        headers: {
          "content-encoding": "gzip",
          "content-type": "text/plain"
        }
      });
    });
    const response = await invoke(
      handler,
      event({
        method: "GET",
        rawPath: "/capabilities/demo.compressed"
      })
    );

    expect(response).toEqual({
      statusCode: 200,
      headers: {
        "content-encoding": "gzip",
        "content-type": "text/plain"
      },
      body: gzipBytes.toString("base64"),
      isBase64Encoded: true
    });
  });

  it("returns a clear adapter error for unsupported Lambda event payloads", async () => {
    const handler = createLambdaHandler(createFetchHandler([greet]));
    const response = await invoke(handler, {
      httpMethod: "POST",
      path: "/capabilities/demo.greet",
      headers: {
        host: "api.example.com"
      },
      body: JSON.stringify({ name: "Ada" })
    } as unknown as AwsLambdaHttpApiV2Event);

    expect(response).toEqual({
      statusCode: 500,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        error: {
          code: "internal",
          message: "Unsupported Lambda event payload.",
          details: {
            reason: 'Expected payload format version "2.0".'
          }
        }
      }),
      isBase64Encoded: false
    });
  });

  const malformedV2Cases = [
    {
      name: "non-string header values",
      mutate(eventRecord: Record<string, unknown>) {
        eventRecord.headers = { host: 123 };
      },
      reason: "Expected headers to contain only string values."
    },
    {
      name: "invalid header names",
      mutate(eventRecord: Record<string, unknown>) {
        eventRecord.headers = { "bad header": "value" };
      },
      reason: "Expected headers to contain only valid HTTP header names."
    },
    {
      name: "invalid forwarded protocol",
      mutate(eventRecord: Record<string, unknown>) {
        eventRecord.headers = {
          host: "api.example.com",
          "x-forwarded-proto": "ftp"
        };
      },
      reason: 'Expected x-forwarded-proto to be "http" or "https".'
    },
    {
      name: "invalid host",
      mutate(eventRecord: Record<string, unknown>) {
        eventRecord.headers = {
          host: "bad host",
          "x-forwarded-proto": "https"
        };
      },
      reason: "Expected host or requestContext.domainName to be a valid URL host."
    },
    {
      name: "non-string cookies",
      mutate(eventRecord: Record<string, unknown>) {
        eventRecord.cookies = ["session=abc", 123];
      },
      reason: "Expected cookies to be an array of strings."
    },
    {
      name: "non-string rawQueryString",
      mutate(eventRecord: Record<string, unknown>) {
        eventRecord.rawQueryString = 123;
      },
      reason: "Expected rawQueryString to be a string."
    },
    {
      name: "non-string rawPath",
      mutate(eventRecord: Record<string, unknown>) {
        eventRecord.rawPath = 123;
      },
      reason: "Expected rawPath to be a non-empty string when provided."
    },
    {
      name: "non-string body",
      mutate(eventRecord: Record<string, unknown>) {
        eventRecord.body = { name: "Ada" };
      },
      reason: "Expected body to be a string when provided."
    },
    {
      name: "non-boolean isBase64Encoded",
      mutate(eventRecord: Record<string, unknown>) {
        eventRecord.isBase64Encoded = "false";
      },
      reason: "Expected isBase64Encoded to be a boolean."
    }
  ] as const;

  for (const testCase of malformedV2Cases) {
    it(`returns a clear adapter error for v2 events with ${testCase.name}`, async () => {
      const handler = createLambdaHandler(createFetchHandler([greet]));
      const malformedEvent = event({
        body: JSON.stringify({ name: "Ada" }),
        method: "POST",
        rawPath: "/capabilities/demo.greet"
      }) as unknown as Record<string, unknown>;

      testCase.mutate(malformedEvent);

      const response = await invoke(handler, malformedEvent as unknown as AwsLambdaHttpApiV2Event);

      expectUnsupportedEvent(response, testCase.reason);
    });
  }

  it("returns a stable internal error response for unexpected handler failures", async () => {
    const handler = createLambdaHandler(() => {
      throw new Error("boom");
    });
    const response = await invoke(
      handler,
      event({
        method: "GET",
        rawPath: "/capabilities/demo.fail"
      })
    );

    expect(response).toEqual({
      statusCode: 500,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        error: {
          code: "internal",
          message: "Internal server error."
        }
      }),
      isBase64Encoded: false
    });
  });
});

function schema<T>(
  validate: (value: unknown) => StandardResult<T> | Promise<StandardResult<T>>
): StandardSchemaV1<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "runtime-lambda-test",
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

interface EventOptions {
  readonly body?: string;
  readonly cookies?: string[];
  readonly isBase64Encoded?: boolean;
  readonly method: string;
  readonly rawPath: string;
  readonly rawQueryString?: string;
}

function event(options: EventOptions): AwsLambdaHttpApiV2Event {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: options.rawPath,
    rawQueryString: options.rawQueryString ?? "",
    ...(options.cookies === undefined ? {} : { cookies: options.cookies }),
    headers: {
      host: "api.example.com",
      "x-forwarded-proto": "https"
    },
    requestContext: {
      accountId: "123456789012",
      apiId: "api_123",
      domainName: "api.example.com",
      domainPrefix: "api",
      http: {
        method: options.method,
        path: options.rawPath,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest"
      },
      requestId: "request_123",
      routeKey: "$default",
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 1_767_225_600_000
    },
    ...(options.body === undefined ? {} : { body: options.body }),
    isBase64Encoded: options.isBase64Encoded ?? false
  } satisfies AwsLambdaHttpApiV2Event;
}

function functionUrlEvent(options: EventOptions): AwsLambdaHttpApiV2Event {
  const domainName = "abcde.lambda-url.us-east-1.on.aws";

  return {
    ...event(options),
    routeKey: "$default",
    headers: {
      host: domainName,
      "x-forwarded-proto": "https"
    },
    requestContext: {
      ...event(options).requestContext,
      apiId: "",
      domainName,
      domainPrefix: "abcde",
      routeKey: "$default",
      stage: "$default"
    }
  };
}

async function invoke(
  handler: AwsLambdaHandler,
  event: AwsLambdaHttpApiV2Event
): Promise<AwsLambdaHttpApiV2Result> {
  const result = await handler(event, lambdaContext, () => undefined);

  if (result === undefined) {
    throw new TypeError("Expected Lambda handler to return a result.");
  }

  return result;
}

function expectUnsupportedEvent(response: AwsLambdaHttpApiV2Result, reason: string): void {
  expect(response).toEqual({
    statusCode: 500,
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      error: {
        code: "internal",
        message: "Unsupported Lambda event payload.",
        details: {
          reason
        }
      }
    }),
    isBase64Encoded: false
  });
}

const lambdaContext = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: "callsite-test",
  functionVersion: "$LATEST",
  invokedFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:callsite-test",
  memoryLimitInMB: "128",
  awsRequestId: "aws_request_123",
  logGroupName: "/aws/lambda/callsite-test",
  logStreamName: "2026/01/01/[$LATEST]abcdef",
  getRemainingTimeInMillis() {
    return 30_000;
  },
  done() {
    return undefined;
  },
  fail() {
    return undefined;
  },
  succeed() {
    return undefined;
  }
};
