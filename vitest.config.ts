import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@callsitehq/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@callsitehq/emit": new URL("./packages/emit/src/index.ts", import.meta.url).pathname,
      "@callsitehq/runtime/aws-lambda": new URL(
        "./packages/runtime/src/aws-lambda.ts",
        import.meta.url
      ).pathname,
      "@callsitehq/runtime/express": new URL("./packages/runtime/src/express.ts", import.meta.url)
        .pathname,
      "@callsitehq/runtime/node": new URL("./packages/runtime/src/node.ts", import.meta.url)
        .pathname,
      "@callsitehq/runtime": new URL("./packages/runtime/src/index.ts", import.meta.url).pathname,
      "@callsitehq/zod": new URL("./packages/zod/src/index.ts", import.meta.url).pathname,
      "@callsitehq/cli": new URL("./packages/cli/src/index.ts", import.meta.url).pathname
    }
  },
  test: {
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage"
    },
    include: ["packages/**/*.test.ts", "examples/**/*.test.ts"]
  }
});
