import { realpathSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

import { toIR, type AnyCapability, type IR, type ToJsonSchema } from "@callsitehq/core";
import {
  emitMcpJson,
  emitOpenApi,
  type EmitMcpJsonOptions,
  type EmitOpenApiOptions
} from "@callsitehq/emit";
import { createFetchHandler } from "@callsitehq/runtime";
import { createNodeHandler } from "@callsitehq/runtime/node";

export interface BuildOptions {
  readonly configPath?: string | undefined;
  readonly outDir?: string | undefined;
}

export interface DevOptions {
  readonly configPath?: string | undefined;
  readonly host?: string | undefined;
  readonly port?: number | undefined;
}

export interface DevServer {
  readonly server: Server;
  readonly url: string;
  readonly capabilityIds: readonly string[];
  readonly close: () => Promise<void>;
}

export interface CallsiteConfig {
  readonly capabilities: readonly AnyCapability[];
  readonly toJsonSchema: ToJsonSchema;
  readonly emit?: CallsiteEmitConfig;
}

export interface CallsiteEmitConfig {
  readonly mcp?: EmitMcpJsonOptions;
  readonly openapi?: EmitOpenApiOptions;
}

export async function build(options: BuildOptions): Promise<void> {
  const configPath = await resolveConfigPath(options.configPath);
  const config = readConfig(await loadConfig(configPath));
  const ir = configToIR(config);
  const emit = isCallsiteConfig(config) ? config.emit : undefined;
  const outDir = resolve(options.outDir ?? "dist/callsite");

  await writeArtifact(resolve(outDir, "mcp.json"), emitMcpJson(ir, emit?.mcp));
  await writeArtifact(resolve(outDir, "openapi.json"), emitOpenApi(ir, emit?.openapi));
  if (isCallsiteConfig(config)) {
    await writeArtifact(resolve(outDir, "handler.ts"), runtimeHandler(configPath, outDir));
  }
}

export async function dev(options: DevOptions = {}): Promise<DevServer> {
  const configPath = await resolveConfigPath(options.configPath);
  const config = readConfig(await loadConfig(configPath));

  if (!isCallsiteConfig(config)) {
    throw new TypeError("callsite dev requires a capability config; raw IR configs cannot run.");
  }

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;
  const server = createServer(createNodeHandler(createFetchHandler(config.capabilities)));
  const address = await listen(server, host, port);
  const url = `http://${hostForUrl(host)}:${address.port}`;

  return {
    server,
    url,
    capabilityIds: config.capabilities.map((capability) => capability.id),
    close: () => closeServer(server)
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  if (command === "build") {
    const configPath = readFlag(args, "--config");
    const outDir = readFlag(args, "--out");

    await build({ configPath, outDir });
    return 0;
  }

  if (command === "dev") {
    const configPath = readFlag(args, "--config");
    const host = readFlag(args, "--host");
    const port = readPortFlag(args, "--port");
    const server = await dev({ configPath, host, port });

    printDevServer(server);
    return 0;
  }

  printHelp();
  return 1;
}

const DEFAULT_CONFIG_FILES = [
  "callsite.config.ts",
  "callsite.config.mts",
  "callsite.config.js",
  "callsite.config.mjs",
  "callsite.config.cjs"
];

async function resolveConfigPath(configPath: string | undefined): Promise<string> {
  if (configPath !== undefined) {
    return resolve(configPath);
  }

  for (const candidate of DEFAULT_CONFIG_FILES) {
    const path = resolve(candidate);

    try {
      await access(path);
      return path;
    } catch {
      // Keep looking through the default config names.
    }
  }

  throw new TypeError(
    `No Callsite config found. Create ${DEFAULT_CONFIG_FILES[0]} or pass --config.`
  );
}

async function loadConfig(configPath: string): Promise<unknown> {
  const jiti = createJiti(import.meta.url, { fsCache: false });
  const configModule = (await jiti.import(configPath)) as {
    readonly default?: unknown;
    readonly config?: unknown;
    readonly ir?: unknown;
  };

  return configModule.default ?? configModule.config ?? configModule.ir;
}

function readConfig(value: unknown): IR | CallsiteConfig {
  if (isIR(value) || isCallsiteConfig(value)) {
    return value;
  }

  throw new TypeError(
    "Callsite config must export an IR object or { capabilities, toJsonSchema }."
  );
}

function configToIR(config: IR | CallsiteConfig): IR {
  return isIR(config) ? config : toIR(config.capabilities, config.toJsonSchema);
}

function isCallsiteConfig(value: unknown): value is CallsiteConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "capabilities" in value &&
    Array.isArray(value.capabilities) &&
    "toJsonSchema" in value &&
    typeof value.toJsonSchema === "function"
  );
}

function isIR(value: unknown): value is IR {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "capabilities" in value &&
    Array.isArray(value.capabilities)
  );
}

function readFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function readPortFlag(args: readonly string[], name: string): number | undefined {
  const value = readFlag(args, name);

  if (value === undefined) {
    return undefined;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError(`${name} must be an integer between 0 and 65535.`);
  }

  return port;
}

function runtimeHandler(configPath: string, outDir: string): string {
  const configImport = importSpecifier(resolve(outDir, "handler.ts"), configPath);

  return `import { createFetchHandler } from "@callsitehq/runtime";

import config from "${configImport}";

export const fetchHandler = createFetchHandler(config.capabilities);

export default {
  fetch: fetchHandler
};
`;
}

function importSpecifier(fromPath: string, toPath: string): string {
  const specifier = relative(dirname(fromPath), toPath).replaceAll("\\", "/");
  const relativeSpecifier = specifier.startsWith(".") ? specifier : `./${specifier}`;

  return replaceTypeScriptExtension(relativeSpecifier);
}

function replaceTypeScriptExtension(path: string): string {
  switch (extname(path)) {
    case ".ts":
      return `${path.slice(0, -3)}.js`;
    case ".mts":
      return `${path.slice(0, -4)}.mjs`;
    case ".cts":
      return `${path.slice(0, -4)}.cjs`;
    default:
      return path;
  }
}

async function writeArtifact(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function listen(server: Server, host: string, port: number): Promise<AddressInfo> {
  return new Promise((resolveListen, rejectListen) => {
    function onError(error: Error): void {
      rejectListen(error);
    }

    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      const address = server.address();

      if (typeof address === "object" && address !== null) {
        resolveListen(address);
        return;
      }

      rejectListen(new TypeError("Dev server did not bind to a TCP address."));
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error !== undefined) {
        rejectClose(error);
        return;
      }

      resolveClose();
    });
  });
}

function hostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function printDevServer(server: DevServer): void {
  const routes = server.capabilityIds
    .map((id) => `  POST ${server.url}/capabilities/${encodeURIComponent(id)}`)
    .join("\n");

  process.stdout.write(`Callsite dev server listening at ${server.url}

Capabilities:
${routes.length > 0 ? routes : "  (none)"}
`);
}

function printHelp(): void {
  process.stdout.write(`callsite

Usage:
  callsite build [--config callsite.config.ts] [--out dist/callsite]
  callsite dev [--config callsite.config.ts] [--host 127.0.0.1] [--port 3000]
`);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

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
