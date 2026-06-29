import { describe, expect, it } from "vitest";

import {
  capability,
  CapabilityError,
  type StandardResult,
  type StandardSchemaV1
} from "@callsitehq/core";

import { createFetchHandler, createRuntimeManifest, execute } from "./index.js";

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
  run(input, context) {
    context.log("greet", { name: input.name });
    return { greeting: `Hello, ${input.name}` };
  }
});

describe("execute", () => {
  it("validates input, dispatches by id, validates output, and returns the parsed value", async () => {
    const events: [string, Record<string, unknown> | undefined][] = [];
    const result = await execute(
      createRuntimeManifest([greet]),
      {
        capabilityId: "demo.greet",
        input: { name: "Ada" }
      },
      {
        log(event, data) {
          events.push([event, data]);
        }
      }
    );

    expect(result).toEqual({
      ok: true,
      value: { greeting: "Hello, Ada" }
    });
    expect(events).toEqual([["greet", { name: "Ada" }]]);
  });

  it("returns not_found when no capability exists for the requested id", async () => {
    await expect(
      execute(createRuntimeManifest([]), {
        capabilityId: "demo.missing",
        input: {}
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "not_found",
        message: 'Capability "demo.missing" not found.'
      }
    });
  });

  it("does not resolve inherited object properties as capability ids", async () => {
    await expect(
      execute(createRuntimeManifest([]), {
        capabilityId: "constructor",
        input: {}
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "not_found",
        message: 'Capability "constructor" not found.'
      }
    });
  });

  it("returns invalid_input with validation details before run executes", async () => {
    let ran = false;
    const result = await execute(
      createRuntimeManifest([
        capability({
          id: "demo.validate",
          intent: "Validate input.",
          input: greetInput,
          output: greetOutput,
          run() {
            ran = true;
            return { greeting: "unreachable" };
          }
        })
      ]),
      {
        capabilityId: "demo.validate",
        input: { name: 123 }
      }
    );

    expect(ran).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Invalid input.",
        details: {
          issues: [
            {
              message: "Expected { name: string }",
              path: ["name"]
            }
          ]
        }
      }
    });
  });

  it("passes through semantic capability errors", async () => {
    const result = await execute(
      createRuntimeManifest([
        capability({
          id: "demo.fail",
          intent: "Fail intentionally.",
          input: greetInput,
          output: greetOutput,
          run() {
            throw new CapabilityError("unavailable", "Greeting service unavailable.", {
              retryAfterSeconds: 30
            });
          }
        })
      ]),
      {
        capabilityId: "demo.fail",
        input: { name: "Ada" }
      }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        message: "Greeting service unavailable.",
        details: {
          retryAfterSeconds: 30
        }
      }
    });
  });

  it("returns internal when output validation fails", async () => {
    const result = await execute(
      createRuntimeManifest([
        capability({
          id: "demo.bad_output",
          intent: "Return invalid output.",
          input: greetInput,
          output: greetOutput,
          run() {
            return { greeting: 123 } as never;
          }
        })
      ]),
      {
        capabilityId: "demo.bad_output",
        input: { name: "Ada" }
      }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "internal",
        message: "Capability returned invalid output.",
        details: {
          issues: [
            {
              message: "Expected { greeting: string }",
              path: ["greeting"]
            }
          ]
        }
      }
    });
  });

  it("returns internal for unknown thrown errors", async () => {
    const result = await execute(
      createRuntimeManifest([
        capability({
          id: "demo.throw",
          intent: "Throw unexpectedly.",
          input: greetInput,
          output: greetOutput,
          run() {
            throw new Error("database exploded");
          }
        })
      ]),
      {
        capabilityId: "demo.throw",
        input: { name: "Ada" }
      }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "internal",
        message: "Internal capability error."
      }
    });
  });
});

describe("createFetchHandler", () => {
  it("adapts HTTP requests to execute and returns the capability output directly", async () => {
    const handler = createFetchHandler([greet]);
    const response = await handler(
      new Request("https://example.com/capabilities/demo.greet", {
        body: JSON.stringify({ name: "Ada" }),
        method: "POST"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ greeting: "Hello, Ada" });
  });

  it("uses the standard error envelope and HTTP status mapping", async () => {
    const handler = createFetchHandler([
      capability({
        id: "demo.fail",
        intent: "Fail intentionally.",
        input: greetInput,
        output: greetOutput,
        run() {
          throw new CapabilityError("conflict", "Greeting already exists.");
        }
      })
    ]);
    const response = await handler(
      new Request("https://example.com/capabilities/demo.fail", {
        body: JSON.stringify({ name: "Ada" }),
        method: "POST"
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "conflict",
        message: "Greeting already exists."
      }
    });
  });

  it("passes request-derived context to capabilities", async () => {
    const handler = createFetchHandler(
      [
        capability({
          id: "demo.subject",
          intent: "Return the subject.",
          input: greetInput,
          output: greetOutput,
          run(_input, context) {
            return { greeting: String(context.subject) };
          }
        })
      ],
      {
        context(request) {
          return {
            subject: request.headers.get("x-subject"),
            log() {}
          };
        }
      }
    );
    const response = await handler(
      new Request("https://example.com/capabilities/demo.subject", {
        body: JSON.stringify({ name: "Ada" }),
        headers: {
          "x-subject": "user_123"
        },
        method: "POST"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ greeting: "user_123" });
  });

  it("returns invalid_input for malformed JSON", async () => {
    const handler = createFetchHandler([greet]);
    const response = await handler(
      new Request("https://example.com/capabilities/demo.greet", {
        body: "{",
        method: "POST"
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_input",
        message: "Request body must be valid JSON."
      }
    });
  });
});

function schema<T>(
  validate: (value: unknown) => StandardResult<T> | Promise<StandardResult<T>>
): StandardSchemaV1<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "runtime-test",
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
