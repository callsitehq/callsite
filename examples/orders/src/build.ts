import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { emitMcpJson, emitOpenApi } from "@callsitehq/emit";

import { ir } from "./capabilities.js";

export async function buildOrdersArtifacts(
  outDir: URL = new URL("../generated/", import.meta.url)
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(new URL("mcp.json", outDir), emitMcpJson(ir, { name: "orders", version: "0.1.0" })),
    writeFile(
      new URL("openapi.json", outDir),
      emitOpenApi(ir, {
        baseUrl: "https://api.example.com",
        name: "Orders API",
        version: "0.1.0"
      })
    )
  ]);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildOrdersArtifacts();
}
