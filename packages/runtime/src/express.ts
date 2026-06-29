import type {
  NextFunction as ExpressNextFunctionType,
  Request as ExpressRequestType,
  RequestHandler,
  Response as ExpressResponseType
} from "express";

type FetchHandler = (request: Request) => Promise<Response> | Response;

export type ExpressRequest = ExpressRequestType;
export type ExpressResponse = ExpressResponseType;
export type ExpressNextFunction = ExpressNextFunctionType;
export type ExpressHandler = RequestHandler;

export function createExpressHandler(fetchHandler: FetchHandler): ExpressHandler {
  return (expressRequest, expressResponse, next) => {
    void handleExpressRequest(fetchHandler, expressRequest, expressResponse).catch(next);
  };
}

async function handleExpressRequest(
  fetchHandler: FetchHandler,
  expressRequest: ExpressRequest,
  expressResponse: ExpressResponse
): Promise<void> {
  const response = await fetchHandler(await requestFromExpress(expressRequest));
  await writeExpressResponse(expressResponse, response);
}

async function requestFromExpress(expressRequest: ExpressRequest): Promise<Request> {
  const headers = headersFromExpress(expressRequest.headers);
  const method = expressRequest.method ?? "GET";
  const init: RequestInit = {
    headers,
    method
  };

  if (method !== "GET" && method !== "HEAD") {
    const body = await bodyFromExpress(expressRequest);
    if (body !== undefined) {
      init.body = body.value;
      if (body.contentType !== undefined) {
        headers.set("content-type", body.contentType);
      }
    }
  }

  return new Request(urlFromExpress(expressRequest, headers), init);
}

function headersFromExpress(expressHeaders: ExpressRequest["headers"]): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(expressHeaders)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else {
      headers.set(name, value);
    }
  }

  return headers;
}

interface ExpressBody {
  readonly contentType?: string | undefined;
  readonly value: BodyInit;
}

async function bodyFromExpress(expressRequest: ExpressRequest): Promise<ExpressBody | undefined> {
  if ("body" in expressRequest && expressRequest.body !== undefined) {
    return bodyFromParsedExpressBody(expressRequest.body);
  }

  if (!isAsyncIterable(expressRequest)) {
    return undefined;
  }

  return {
    value: await bodyFromStream(expressRequest)
  };
}

function bodyFromParsedExpressBody(body: unknown): ExpressBody {
  if (typeof body === "string") {
    return { value: body };
  }

  if (body instanceof ArrayBuffer) {
    return { value: body };
  }

  if (body instanceof Uint8Array) {
    return { value: arrayBufferFromBytes(body) };
  }

  if (body instanceof URLSearchParams) {
    return {
      contentType: "application/x-www-form-urlencoded;charset=UTF-8",
      value: body
    };
  }

  return {
    contentType: "application/json",
    value: JSON.stringify(body)
  };
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function bodyFromStream(stream: AsyncIterable<unknown>): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}

function urlFromExpress(expressRequest: ExpressRequest, headers: Headers): string {
  const path = expressRequest.originalUrl ?? expressRequest.url ?? "/";
  const protocol = expressRequest.protocol ?? "http";
  const host = headers.get("host") ?? "localhost";

  return new URL(path, `${protocol}://${host}`).toString();
}

async function writeExpressResponse(
  expressResponse: ExpressResponse,
  response: Response
): Promise<void> {
  expressResponse.status(response.status);

  const setCookie = getSetCookie(response.headers);
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() === "set-cookie" && setCookie.length > 0) {
      return;
    }

    expressResponse.set(name, value);
  });

  if (setCookie.length > 0) {
    expressResponse.set("set-cookie", [...setCookie]);
  }

  if (response.body === null) {
    expressResponse.send();
    return;
  }

  expressResponse.send(Buffer.from(await response.arrayBuffer()));
}

function getSetCookie(headers: Headers): readonly string[] {
  const candidate = headers as Headers & {
    getSetCookie?: () => string[];
  };

  return candidate.getSetCookie?.() ?? [];
}
