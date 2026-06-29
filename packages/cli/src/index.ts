import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { emitMcpJson, emitOpenApi } from "@callsitehq/emit";

import type { IR } from "@callsitehq/core";

export interface BuildOptions {
  readonly configPath: string;
  readonly outDir: string;
}

export async function build(options: BuildOptions): Promise<void> {
  const configUrl = pathToFileURL(resolve(options.configPath));
  const configModule = (await import(configUrl.href)) as { default?: unknown; ir?: unknown };
  const ir = readIR(configModule.default ?? configModule.ir);
  const outDir = resolve(options.outDir);

  await writeArtifact(resolve(outDir, "mcp.json"), emitMcpJson(ir));
  await writeArtifact(resolve(outDir, "openapi.json"), emitOpenApi(ir));
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv;

  if (command !== "build") {
    printHelp();
    return command === undefined || command === "--help" || command === "-h" ? 0 : 1;
  }

  const configPath = readFlag(args, "--config") ?? "callsite.config.js";
  const outDir = readFlag(args, "--out") ?? "dist/callsite";

  await build({ configPath, outDir });
  return 0;
}

function readIR(value: unknown): IR {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("capabilities" in value) ||
    !Array.isArray(value.capabilities)
  ) {
    throw new TypeError(
      "Callsite config must export a root IR object: { version: 1, capabilities: [...] }."
    );
  }
  // TODO: Add deep IR validation before manual IR config files become a supported authoring path.
  return value as IR;
}

function readFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

async function writeArtifact(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function printHelp(): void {
  process.stdout.write(`callsite

Usage:
  callsite build [--config callsite.config.js] [--out dist/callsite]
`);
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  );
}
