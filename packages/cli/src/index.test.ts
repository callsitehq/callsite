import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { build } from "./index.js";

describe("build", () => {
  it("writes generated artifacts", async () => {
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
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          destructive: false,
          examples: []
        }]
      };`
    );

    await build({ configPath, outDir });

    await expect(readFile(join(outDir, "mcp.json"), "utf8")).resolves.toContain("demo.greet");
    await expect(readFile(join(outDir, "openapi.json"), "utf8")).resolves.toContain("3.1.0");
  });
});
