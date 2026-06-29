import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { build } from "./index.js";

describe("build", () => {
  it("writes mcp.json and openapi.json for raw IR configs", async () => {
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

  it("compiles TypeScript capability configs into IR before emitting artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "callsite-cli-"));
    const configPath = join(directory, "callsite.config.ts");
    const outDir = join(directory, "out");

    await writeFile(
      configPath,
      `const schema = {
        "~standard": {
          version: 1,
          vendor: "test",
          validate(value: unknown) {
            return { value };
          }
        }
      };

      export default {
        capabilities: [{
          id: "demo.greet",
          intent: "Greet a person by name.",
          input: schema,
          output: schema,
          destructive: false,
          errors: [],
          examples: [],
          overrides: {},
          passthrough: {},
          run() {
            return {};
          }
        }],
        toJsonSchema(_schema: unknown, options: { direction: "input" | "output" }) {
          return {
            type: "object",
            title: options.direction
          };
        },
        emit: {
          mcp: { name: "demo-tools", version: "1.2.3" },
          openapi: {
            name: "Demo API",
            version: "1.2.3",
            baseUrl: "https://api.example.com"
          }
        }
      };`
    );

    await build({ configPath, outDir });

    await expect(readFile(join(outDir, "mcp.json"), "utf8")).resolves.toContain("demo-tools");
    await expect(readFile(join(outDir, "mcp.json"), "utf8")).resolves.toContain('"title": "input"');
    await expect(readFile(join(outDir, "openapi.json"), "utf8")).resolves.toContain("Demo API");
    await expect(readFile(join(outDir, "openapi.json"), "utf8")).resolves.toContain(
      "https://api.example.com"
    );
    await expect(readFile(join(outDir, "openapi.json"), "utf8")).resolves.toContain(
      '"title": "output"'
    );
  });

  it("discovers callsite.config.ts by default", async () => {
    const directory = await mkdtemp(join(tmpdir(), "callsite-cli-"));
    const previousCwd = process.cwd();

    await writeFile(
      join(directory, "callsite.config.ts"),
      `export default {
        version: 1,
        capabilities: [{
          id: "demo.default_config",
          intent: "Use the default config file.",
          input: { type: "object" },
          output: { type: "object" },
          destructive: false,
          errors: [],
          examples: [],
          overrides: {},
          passthrough: {}
        }]
      };`
    );

    try {
      process.chdir(directory);
      await build({});
    } finally {
      process.chdir(previousCwd);
    }

    await expect(readFile(join(directory, "dist/callsite/mcp.json"), "utf8")).resolves.toContain(
      "demo.default_config"
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
      "Callsite config must export an IR object or { capabilities, toJsonSchema }"
    );
  });
});
