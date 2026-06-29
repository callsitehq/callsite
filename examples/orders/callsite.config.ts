import { defineConfig } from "@callsitehq/zod";

import { capabilities } from "./src/capabilities.js";

export default defineConfig({
  capabilities,
  emit: {
    mcp: {
      name: "orders",
      version: "0.1.0"
    },
    openapi: {
      baseUrl: "https://api.example.com",
      name: "Orders API",
      version: "0.1.0"
    }
  }
});
