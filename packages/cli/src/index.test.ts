import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { build, dev } from "./index.js";

const fakeHttp = vi.hoisted(() => {
  type Handler = (request: unknown, response: unknown) => void;

  class FakeServer {
    readonly handler: Handler;
    private host = "127.0.0.1";
    private port = 3000;

    constructor(handler: Handler) {
      this.handler = handler;
    }

    address(): { address: string; family: string; port: number } {
      return {
        address: this.host,
        family: "IPv4",
        port: this.port
      };
    }

    close(callback: (error?: Error) => void): this {
      callback();
      return this;
    }

    listen(port: number, host: string, callback: () => void): this {
      this.host = host;
      this.port = port === 0 ? 45123 : port;
      callback();
      return this;
    }

    off(): this {
      return this;
    }

    once(): this {
      return this;
    }
  }

  const servers: FakeServer[] = [];

  return {
    createServer: vi.fn((handler: Handler) => {
      const server = new FakeServer(handler);
      servers.push(server);
      return server;
    }),
    servers
  };
});

vi.mock("node:http", () => ({
  createServer: fakeHttp.createServer
}));

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

    await expect(readdir(outDir).then((files) => files.sort())).resolves.toEqual([
      "mcp.json",
      "openapi.json"
    ]);
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

    await expect(readdir(outDir).then((files) => files.sort())).resolves.toEqual([
      "handler.ts",
      "mcp.json",
      "openapi.json"
    ]);
    await expect(readFile(join(outDir, "mcp.json"), "utf8")).resolves.toContain("demo-tools");
    await expect(readFile(join(outDir, "mcp.json"), "utf8")).resolves.toContain('"title": "input"');
    await expect(readFile(join(outDir, "openapi.json"), "utf8")).resolves.toContain("Demo API");
    await expect(readFile(join(outDir, "openapi.json"), "utf8")).resolves.toContain(
      "https://api.example.com"
    );
    await expect(readFile(join(outDir, "openapi.json"), "utf8")).resolves.toContain(
      '"title": "output"'
    );
    await expect(readFile(join(outDir, "handler.ts"), "utf8")).resolves.toBe(
      `import { createFetchHandler } from "@callsitehq/runtime";

import config from "../callsite.config.js";

export const fetchHandler = createFetchHandler(config.capabilities);

export default {
  fetch: fetchHandler
};
`
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

describe("dev", () => {
  it("starts a local server from TypeScript capability configs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "callsite-cli-"));
    const configPath = join(directory, "callsite.config.ts");

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
          run(input: { name: string }) {
            return { greeting: \`Hello, \${input.name}\` };
          }
        }],
        toJsonSchema() {
          return { type: "object" };
        }
      };`
    );

    const server = await dev({ configPath, port: 0 });

    try {
      expect(server.capabilityIds).toEqual(["demo.greet"]);
      expect(server.url).toBe("http://127.0.0.1:45123");

      const lastServer = fakeHttp.servers.at(-1);
      expect(lastServer).toBeDefined();

      const response = await callNodeHandler(lastServer!.handler, {
        body: JSON.stringify({ name: "Ada" }),
        method: "POST",
        url: "/capabilities/demo.greet"
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ greeting: "Hello, Ada" });
    } finally {
      await server.close();
    }
  });

  it("rejects raw IR configs because they do not contain handlers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "callsite-cli-"));
    const configPath = join(directory, "callsite.config.mjs");

    await writeFile(
      configPath,
      `export default {
        version: 1,
        capabilities: []
      };`
    );

    await expect(dev({ configPath, port: 0 })).rejects.toThrow(
      "callsite dev requires a capability config"
    );
  });
});

interface NodeRequestOptions {
  readonly body?: string;
  readonly method: string;
  readonly url: string;
}

interface CapturedNodeResponse {
  readonly body: string;
  readonly headers: ReadonlyMap<string, number | readonly string[] | string>;
  readonly status: number;
}

async function callNodeHandler(
  handler: (request: unknown, response: unknown) => void,
  options: NodeRequestOptions
): Promise<CapturedNodeResponse> {
  const request = Readable.from(
    options.body === undefined ? [] : [options.body]
  ) as IncomingMessage;
  request.headers = {
    host: "localhost"
  };
  request.method = options.method;
  request.url = options.url;

  const chunks: Buffer[] = [];
  const headers = new Map<string, number | readonly string[] | string>();
  let status = 0;

  const done = new Promise<void>((resolveDone) => {
    const response = {
      headersSent: false,
      statusCode: 0,
      statusMessage: "",
      destroy() {
        resolveDone();
        return response;
      },
      end(chunk?: unknown) {
        status = response.statusCode;
        if (chunk !== undefined) {
          chunks.push(
            Buffer.from(
              typeof chunk === "string" || chunk instanceof Uint8Array ? chunk : String(chunk)
            )
          );
        }
        resolveDone();
        return response;
      },
      setHeader(name: string, value: number | readonly string[] | string) {
        headers.set(name, value);
        return response;
      }
    } as unknown as ServerResponse;

    handler(request, response);
  });

  await done;

  return {
    body: Buffer.concat(chunks).toString("utf8"),
    headers,
    status
  };
}
