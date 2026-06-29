import { describe, expect, it } from "vitest";

import { capability, CapabilityError, type Schema } from "@callsitehq/core";

import { createFetchHandler } from "./index.js";

interface GreetInput {
  readonly name: string;
}

interface GreetOutput {
  readonly greeting: string;
}

const greetInput: Schema<GreetInput> = {
  parse(value) {
    if (
      typeof value !== "object" ||
      value === null ||
      !("name" in value) ||
      typeof value.name !== "string"
    ) {
      throw new TypeError("Expected { name: string }");
    }

    return { name: value.name };
  }
};

const greetOutput: Schema<GreetOutput> = {
  parse(value) {
    if (
      typeof value !== "object" ||
      value === null ||
      !("greeting" in value) ||
      typeof value.greeting !== "string"
    ) {
      throw new TypeError("Expected { greeting: string }");
    }

    return { greeting: value.greeting };
  }
};

describe("createFetchHandler", () => {
  it("dispatches a capability by id", async () => {
    const handler = createFetchHandler([
      capability({
        id: "demo.greet",
        intent: "Greet a person by name.",
        input: greetInput,
        output: greetOutput,
        run(input) {
          return { greeting: `Hello, ${input.name}` };
        }
      })
    ]);

    const response = await handler(
      new Request("https://example.com/capabilities/demo.greet", {
        body: JSON.stringify({ name: "Ada" }),
        method: "POST"
      })
    );

    await expect(response.json()).resolves.toEqual({ result: { greeting: "Hello, Ada" } });
  });

  it("maps capability errors to HTTP responses", async () => {
    const handler = createFetchHandler([
      capability({
        id: "demo.fail",
        intent: "Fail intentionally.",
        input: greetInput,
        output: greetOutput,
        run() {
          throw new CapabilityError("not_found", "No greeting found.");
        }
      })
    ]);

    const response = await handler(
      new Request("https://example.com/capabilities/demo.fail", {
        body: JSON.stringify({ name: "Ada" }),
        method: "POST"
      })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "No greeting found." }
    });
  });
});
