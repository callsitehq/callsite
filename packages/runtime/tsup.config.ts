import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/node.ts"],
  external: ["@callsitehq/core"],
  format: ["esm"],
  sourcemap: true,
  target: "es2022"
});
