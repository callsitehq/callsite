import { describe, expect, it } from "vitest";

import { capability, defineCallsite, type Schema } from "./index.js";

const stringSchema: Schema<string> = {
  jsonSchema: { type: "string" },
  parse(value) {
    if (typeof value !== "string") {
      throw new TypeError("Expected string");
    }

    return value;
  }
};

describe("capability", () => {
  it("creates a capability and renders it to IR", () => {
    const greet = capability({
      id: "demo.greet",
      intent: "Greet a person by name.",
      input: stringSchema,
      output: stringSchema,
      run(input) {
        return `Hello, ${input}`;
      }
    });

    expect(defineCallsite([greet])).toEqual({
      version: 1,
      capabilities: [
        {
          id: "demo.greet",
          intent: "Greet a person by name.",
          inputSchema: { type: "string" },
          outputSchema: { type: "string" },
          destructive: false,
          examples: []
        }
      ]
    });
  });

  it("rejects invalid ids", () => {
    expect(() =>
      capability({
        id: "Demo Greet",
        intent: "Greet a person by name.",
        input: stringSchema,
        output: stringSchema,
        run: (input) => input
      })
    ).toThrow(TypeError);
  });
});
