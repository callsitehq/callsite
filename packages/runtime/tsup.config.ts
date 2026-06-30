import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/node.ts", "src/express.ts", "src/aws-lambda.ts", "src/mcp.ts"],
  external: ["@callsitehq/core", "@callsitehq/emit", "@modelcontextprotocol/sdk"],
  format: ["esm"],
  sourcemap: true,
  target: "es2022"
});
