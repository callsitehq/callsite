import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Handler
} from "aws-lambda";

type FetchHandler = (request: Request) => Promise<Response> | Response;

export type AwsLambdaHttpApiV2Event = APIGatewayProxyEventV2;
export type AwsLambdaHttpApiV2Result = APIGatewayProxyStructuredResultV2;
export type AwsLambdaHandler = Handler<AwsLambdaHttpApiV2Event, AwsLambdaHttpApiV2Result>;

export function createLambdaHandler(fetchHandler: FetchHandler): AwsLambdaHandler {
  return async (event) => {
    try {
      const unsupportedReason = unsupportedEventReason(event);
      if (unsupportedReason !== undefined) {
        return unsupportedEvent(unsupportedReason);
      }

      const response = await fetchHandler(requestFromLambdaEvent(event));
      return resultFromResponse(response);
    } catch {
      return internalError();
    }
  };
}

function requestFromLambdaEvent(event: AwsLambdaHttpApiV2Event): Request {
  const headers = headersFromLambdaEvent(event);
  const method = event.requestContext?.http?.method ?? "GET";
  const init: RequestInit = {
    headers,
    method
  };

  if (method !== "GET" && method !== "HEAD" && event.body !== undefined) {
    init.body =
      event.isBase64Encoded === true
        ? arrayBufferFromBytes(Buffer.from(event.body, "base64"))
        : event.body;
  }

  return new Request(urlFromLambdaEvent(event, headers), init);
}

function headersFromLambdaEvent(event: AwsLambdaHttpApiV2Event): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) {
      headers.set(name, value);
    }
  }

  if (event.cookies !== undefined && event.cookies.length > 0) {
    const existingCookie = headers.get("cookie");
    const eventCookie = event.cookies.join("; ");
    headers.set(
      "cookie",
      existingCookie === null ? eventCookie : `${existingCookie}; ${eventCookie}`
    );
  }

  return headers;
}

function urlFromLambdaEvent(event: AwsLambdaHttpApiV2Event, headers: Headers): string {
  const protocol = headers.get("x-forwarded-proto") ?? "https";
  const host = headers.get("host") ?? event.requestContext?.domainName ?? "localhost";
  const path = pathWithLeadingSlash(event.rawPath ?? event.requestContext?.http?.path ?? "/");
  const query =
    event.rawQueryString === undefined || event.rawQueryString.length === 0
      ? ""
      : `?${event.rawQueryString}`;

  return new URL(`${path}${query}`, `${protocol}://${host}`).toString();
}

function pathWithLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

async function resultFromResponse(response: Response): Promise<AwsLambdaHttpApiV2Result> {
  const headers = headersFromResponse(response.headers);
  const cookies = getSetCookie(response.headers);
  const body = await bodyFromResponse(response);

  return {
    statusCode: response.status,
    ...(headers === undefined ? {} : { headers }),
    ...(cookies.length === 0 ? {} : { cookies: [...cookies] }),
    ...(body === undefined ? {} : body)
  };
}

function headersFromResponse(headers: Headers): Readonly<Record<string, string>> | undefined {
  const result: Record<string, string> = {};
  const setCookie = getSetCookie(headers);

  headers.forEach((value, name) => {
    if (name.toLowerCase() === "set-cookie" && setCookie.length > 0) {
      return;
    }

    result[name] = value;
  });

  return Object.keys(result).length === 0 ? undefined : result;
}

async function bodyFromResponse(
  response: Response
): Promise<Pick<AwsLambdaHttpApiV2Result, "body" | "isBase64Encoded"> | undefined> {
  if (response.body === null) {
    return undefined;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (isTextResponse(response.headers)) {
    return {
      body: bytes.toString("utf8"),
      isBase64Encoded: false
    };
  }

  return {
    body: bytes.toString("base64"),
    isBase64Encoded: true
  };
}

function isTextResponse(headers: Headers): boolean {
  if (headers.has("content-encoding")) {
    return false;
  }

  const contentType = headers.get("content-type")?.toLowerCase();
  if (contentType === undefined) {
    return false;
  }

  return (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("javascript") ||
    contentType.includes("x-www-form-urlencoded")
  );
}

function getSetCookie(headers: Headers): readonly string[] {
  const candidate = headers as Headers & {
    getSetCookie?: () => string[];
  };

  return candidate.getSetCookie?.() ?? [];
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function unsupportedEventReason(event: unknown): string | undefined {
  if (!isRecord(event)) {
    return "Expected an event object.";
  }

  if (event.version !== "2.0") {
    return 'Expected payload format version "2.0".';
  }

  if (!isRecord(event.headers)) {
    return "Expected headers object.";
  }

  if (!recordValuesAreStrings(event.headers)) {
    return "Expected headers to contain only string values.";
  }

  if (!recordKeysAreHeaderNames(event.headers)) {
    return "Expected headers to contain only valid HTTP header names.";
  }

  const forwardedProto = headerValue(event.headers, "x-forwarded-proto");
  if (forwardedProto !== undefined && forwardedProto !== "http" && forwardedProto !== "https") {
    return 'Expected x-forwarded-proto to be "http" or "https".';
  }

  if (event.cookies !== undefined && !isStringArray(event.cookies)) {
    return "Expected cookies to be an array of strings.";
  }

  if (event.rawQueryString !== undefined && typeof event.rawQueryString !== "string") {
    return "Expected rawQueryString to be a string.";
  }

  if (event.rawPath !== undefined && !isNonEmptyString(event.rawPath)) {
    return "Expected rawPath to be a non-empty string when provided.";
  }

  if (event.body !== undefined && typeof event.body !== "string") {
    return "Expected body to be a string when provided.";
  }

  if (event.isBase64Encoded !== undefined && typeof event.isBase64Encoded !== "boolean") {
    return "Expected isBase64Encoded to be a boolean.";
  }

  if (!isRecord(event.requestContext) || !isRecord(event.requestContext.http)) {
    return "Expected requestContext.http.";
  }

  if (
    event.requestContext.domainName !== undefined &&
    typeof event.requestContext.domainName !== "string"
  ) {
    return "Expected requestContext.domainName to be a string when provided.";
  }

  const host = headerValue(event.headers, "host") ?? event.requestContext.domainName;
  if (host !== undefined && !isValidUrlHost(host)) {
    return "Expected host or requestContext.domainName to be a valid URL host.";
  }

  if (!isNonEmptyString(event.requestContext.http.method)) {
    return "Expected requestContext.http.method.";
  }

  if (
    event.requestContext.http.path !== undefined &&
    typeof event.requestContext.http.path !== "string"
  ) {
    return "Expected requestContext.http.path to be a string when provided.";
  }

  if (event.rawPath === undefined && !isNonEmptyString(event.requestContext.http.path)) {
    return "Expected rawPath or requestContext.http.path.";
  }

  return undefined;
}

function unsupportedEvent(reason: string): AwsLambdaHttpApiV2Result {
  return {
    statusCode: 500,
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      error: {
        code: "internal",
        message: "Unsupported Lambda event payload.",
        details: {
          reason
        }
      }
    }),
    isBase64Encoded: false
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordValuesAreStrings(value: Record<string, unknown>): boolean {
  return Object.values(value).every((item) => typeof item === "string");
}

function recordKeysAreHeaderNames(value: Record<string, unknown>): boolean {
  return Object.keys(value).every(isHeaderName);
}

function isHeaderName(value: string): boolean {
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value);
}

function headerValue(headers: Record<string, unknown>, name: string): string | undefined {
  const match = Object.entries(headers).find(([candidate]) => candidate.toLowerCase() === name);

  return match === undefined ? undefined : (match[1] as string);
}

function isValidUrlHost(host: string): boolean {
  try {
    return new URL(`https://${host}`).host === host.toLowerCase();
  } catch {
    return false;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function internalError(): AwsLambdaHttpApiV2Result {
  return {
    statusCode: 500,
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      error: {
        code: "internal",
        message: "Internal server error."
      }
    }),
    isBase64Encoded: false
  };
}
