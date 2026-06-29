import {
  CapabilityError,
  type AnyCapability,
  type AnyStandardSchema,
  type CapabilityContext,
  type CapabilityErrorCode,
  type JsonObject,
  type StandardIssue
} from "@callsitehq/core";

export interface RuntimeManifest {
  readonly capabilities: Readonly<Record<string, AnyCapability>>;
}

export interface RuntimeRequest {
  readonly capabilityId: string;
  readonly input: unknown;
}

export type RuntimeResult = RuntimeSuccess | RuntimeFailure;

export interface RuntimeSuccess {
  readonly ok: true;
  readonly value: unknown;
}

export interface RuntimeFailure {
  readonly ok: false;
  readonly error: RuntimeError;
}

export interface RuntimeError {
  readonly code: CapabilityErrorCode;
  readonly message: string;
  readonly details?: JsonObject;
}

export type RuntimeContext = Omit<CapabilityContext, "log"> &
  Partial<Pick<CapabilityContext, "log">>;

export type FetchContextProvider =
  RuntimeContext | ((request: Request) => RuntimeContext | Promise<RuntimeContext>);

export interface FetchHandlerOptions {
  readonly basePath?: string;
  readonly context?: FetchContextProvider;
}

export function createRuntimeManifest(capabilities: readonly AnyCapability[]): RuntimeManifest {
  return {
    capabilities: Object.assign(
      Object.create(null) as Record<string, AnyCapability>,
      Object.fromEntries(capabilities.map((capability) => [capability.id, capability]))
    )
  };
}

export async function execute(
  manifest: RuntimeManifest,
  request: RuntimeRequest,
  context: RuntimeContext = {}
): Promise<RuntimeResult> {
  const capability = capabilityFromManifest(manifest, request.capabilityId);

  if (capability === undefined) {
    return failure("not_found", `Capability "${request.capabilityId}" not found.`);
  }

  const inputResult = await validate(capability.input, request.input);
  if (!inputResult.ok) {
    return failure("invalid_input", "Invalid input.", validationDetails(inputResult.issues));
  }

  try {
    const runResult = await capability.run(inputResult.value, capabilityContext(context));
    const outputResult = await validate(capability.output, runResult);

    if (!outputResult.ok) {
      return failure(
        "internal",
        "Capability returned invalid output.",
        validationDetails(outputResult.issues)
      );
    }

    return {
      ok: true,
      value: outputResult.value
    };
  } catch (error) {
    return failureFromThrown(error);
  }
}

function capabilityFromManifest(
  manifest: RuntimeManifest,
  capabilityId: string
): AnyCapability | undefined {
  if (!Object.hasOwn(manifest.capabilities, capabilityId)) {
    return undefined;
  }

  return manifest.capabilities[capabilityId];
}

export function createFetchHandler(
  manifestOrCapabilities: RuntimeManifest | readonly AnyCapability[],
  options: FetchHandlerOptions = {}
): (request: Request) => Promise<Response> {
  const basePath = normalizeBasePath(options.basePath ?? "/capabilities");
  const manifest = isRuntimeManifest(manifestOrCapabilities)
    ? manifestOrCapabilities
    : createRuntimeManifest(manifestOrCapabilities);

  return async function fetchHandler(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return json({ error: runtimeError("invalid_input", "Use POST.") }, 405);
    }

    const capabilityId = capabilityIdFromRequest(request, basePath);
    if (capabilityId === undefined) {
      return json({ error: runtimeError("not_found", "Capability route not found.") }, 404);
    }

    const input = await requestJson(request);
    if (!input.ok) {
      return json({ error: input.error }, statusForErrorCode(input.error.code));
    }

    const result = await execute(
      manifest,
      { capabilityId, input: input.value },
      await contextFor(request, options.context)
    );

    if (!result.ok) {
      return json({ error: result.error }, statusForErrorCode(result.error.code));
    }

    return json(result.value, 200);
  };
}

function isRuntimeManifest(
  value: RuntimeManifest | readonly AnyCapability[]
): value is RuntimeManifest {
  return !Array.isArray(value) && "capabilities" in value;
}

type ValidationResult =
  | {
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly ok: false;
      readonly issues: readonly StandardIssue[];
    };

async function validate(schema: AnyStandardSchema, value: unknown): Promise<ValidationResult> {
  const result = await schema["~standard"].validate(value);

  if (result.issues !== undefined) {
    return {
      ok: false,
      issues: result.issues
    };
  }

  return {
    ok: true,
    value: result.value
  };
}

function capabilityContext(context: RuntimeContext): CapabilityContext {
  return {
    ...(context.subject === undefined ? {} : { subject: context.subject }),
    log: context.log ?? noopLog
  };
}

function failure(code: CapabilityErrorCode, message: string, details?: JsonObject): RuntimeFailure {
  return {
    ok: false,
    error: runtimeError(code, message, details)
  };
}

function failureFromThrown(error: unknown): RuntimeFailure {
  if (error instanceof CapabilityError) {
    return failure(error.code, error.message, error.details);
  }

  return failure("internal", "Internal capability error.");
}

function runtimeError(
  code: CapabilityErrorCode,
  message: string,
  details?: JsonObject
): RuntimeError {
  return {
    code,
    message,
    ...(details === undefined ? {} : { details })
  };
}

function validationDetails(issues: readonly StandardIssue[]): JsonObject {
  return {
    issues: issues.map((issue) => ({
      message: issue.message,
      ...(issue.path === undefined ? {} : { path: issue.path.map(pathSegmentToJson) })
    }))
  };
}

function pathSegmentToJson(segment: NonNullable<StandardIssue["path"]>[number]): string | number {
  const key =
    typeof segment === "object" && segment !== null && "key" in segment ? segment.key : segment;

  return typeof key === "number" ? key : String(key);
}

function capabilityIdFromRequest(request: Request, basePath: string): string | undefined {
  const { pathname } = new URL(request.url);

  if (!pathname.startsWith(`${basePath}/`)) {
    return undefined;
  }

  const id = pathname.slice(basePath.length + 1);
  if (id.length === 0) {
    return undefined;
  }

  try {
    return decodeURIComponent(id);
  } catch {
    return undefined;
  }
}

async function requestJson(request: Request): Promise<RuntimeResult> {
  try {
    return {
      ok: true,
      value: await request.json()
    };
  } catch {
    return failure("invalid_input", "Request body must be valid JSON.");
  }
}

async function contextFor(
  request: Request,
  provider: FetchContextProvider | undefined
): Promise<RuntimeContext> {
  if (provider === undefined) {
    return {};
  }

  return typeof provider === "function" ? provider(request) : provider;
}

function statusForErrorCode(code: CapabilityErrorCode): number {
  switch (code) {
    case "invalid_input":
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
    case "unavailable":
      return 503;
    case "internal":
      return 500;
  }
}

function normalizeBasePath(basePath: string): string {
  const withLeadingSlash = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    },
    status
  });
}

function noopLog(): void {}
