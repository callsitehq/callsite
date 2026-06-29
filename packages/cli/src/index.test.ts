import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { build } from "./index.js";

describe("build", () => {
  it("writes mcp.json and openapi.json for the current IR build", async () => {
    const directory = await mkdtemp(join(tmpdir(), "callsite-cli-"));
    const configPath = join(directory, "callsite.config.mjs");
    const outDir = join(directory, "out");

    await writeFile(
      configPath,
      `export default {
        version: 1,
        capabilities: [{
          id: "demo.greet",
          intent: "Greet a person by name.",
          input: { type: "object" },
          output: { type: "object" },
          destructive: false,
          errors: [{
            code: "not_found",
            intent: "No greeting target exists."
          }],
          examples: [],
          overrides: {},
          passthrough: {}
        }]
      };`
    );

    await build({ configPath, outDir });

    await expect(readdir(outDir)).resolves.toEqual(["mcp.json", "openapi.json"]);
    await expect(readFile(join(outDir, "mcp.json"), "utf8")).resolves.toContain("demo.greet");
    await expect(readFile(join(outDir, "openapi.json"), "utf8")).resolves.toContain("3.2.0");
    await expect(readFile(join(outDir, "openapi.json"), "utf8")).resolves.toContain(
      "/capabilities/demo.greet"
    );
    await expect(readFile(join(outDir, "openapi.json"), "utf8")).resolves.toContain(
      "No greeting target exists."
    );
  });

  it("rejects config files that do not export root IR", async () => {
    const directory = await mkdtemp(join(tmpdir(), "callsite-cli-"));
    const configPath = join(directory, "callsite.config.mjs");
    const outDir = join(directory, "out");

    await writeFile(
      configPath,
      `export default {
        capabilities: []
      };`
    );

    await expect(build({ configPath, outDir })).rejects.toThrow(
      "Callsite config must export a root IR object"
    );
  });
});
