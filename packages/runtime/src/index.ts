import {
  CapabilityError,
  type AnyCapability,
  type CapabilityContext,
  type JsonValue
} from "@callsitehq/core";

export interface FetchHandlerOptions {
  readonly basePath?: string;
}

export function createFetchHandler(
  capabilities: readonly AnyCapability[],
  options: FetchHandlerOptions = {}
): (request: Request) => Promise<Response> {
  const basePath = normalizeBasePath(options.basePath ?? "/capabilities");
  const byId = new Map(capabilities.map((capability) => [capability.id, capability]));

  return async function fetchHandler(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return json({ error: { code: "method_not_allowed", message: "Use POST." } }, 405);
    }

    const id = capabilityIdFromRequest(request, basePath);
    if (id === undefined) {
      return json({ error: { code: "not_found", message: "Capability route not found." } }, 404);
    }

    const capability = byId.get(id);
    if (capability === undefined) {
      return json({ error: { code: "not_found", message: `Capability "${id}" not found.` } }, 404);
    }

    try {
      const body = await request.json();
      const input = capability.input.parse(body);
      const context: CapabilityContext = { request };
      const result = await capability.run(input, context);
      const output = capability.output.parse(result);

      return json({ result: output }, 200);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

function capabilityIdFromRequest(request: Request, basePath: string): string | undefined {
  const { pathname } = new URL(request.url);

  if (!pathname.startsWith(`${basePath}/`)) {
    return undefined;
  }

  const id = pathname.slice(basePath.length + 1);
  return id.length === 0 ? undefined : decodeURIComponent(id);
}

function errorResponse(error: unknown): Response {
  if (error instanceof CapabilityError) {
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      },
      statusForCapabilityError(error)
    );
  }

  if (error instanceof SyntaxError || error instanceof TypeError) {
    return json({ error: { code: "bad_request", message: error.message } }, 400);
  }

  return json({ error: { code: "internal", message: "Internal capability error." } }, 500);
}

function statusForCapabilityError(error: CapabilityError): number {
  switch (error.code) {
    case "bad_request":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "rate_limited":
      return 429;
    case "internal":
      return 500;
  }
}

function normalizeBasePath(basePath: string): string {
  const withLeadingSlash = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

function json(body: JsonValue, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    },
    status
  });
}
