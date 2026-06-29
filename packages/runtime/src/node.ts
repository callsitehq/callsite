import type { IncomingMessage, ServerResponse } from "node:http";

type FetchHandler = (request: Request) => Promise<Response> | Response;

export type NodeHandler = (request: IncomingMessage, response: ServerResponse) => void;

export function createNodeHandler(fetchHandler: FetchHandler): NodeHandler {
  return (nodeRequest, nodeResponse) => {
    void handleNodeRequest(fetchHandler, nodeRequest, nodeResponse).catch(() => {
      writeNodeError(nodeResponse);
    });
  };
}

async function handleNodeRequest(
  fetchHandler: FetchHandler,
  nodeRequest: IncomingMessage,
  nodeResponse: ServerResponse
): Promise<void> {
  const response = await fetchHandler(await requestFromNode(nodeRequest));
  await writeNodeResponse(nodeResponse, response);
}

async function requestFromNode(nodeRequest: IncomingMessage): Promise<Request> {
  const headers = headersFromNode(nodeRequest);
  const url = new URL(nodeRequest.url ?? "/", `http://${headers.get("host") ?? "localhost"}`);
  const init: RequestInit = {
    headers,
    method: nodeRequest.method ?? "GET"
  };

  if (init.method !== "GET" && init.method !== "HEAD") {
    init.body = await bodyFromNode(nodeRequest);
  }

  return new Request(url, init);
}

function headersFromNode(nodeRequest: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(nodeRequest.headers)) {
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

async function bodyFromNode(nodeRequest: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of nodeRequest) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function writeNodeResponse(nodeResponse: ServerResponse, response: Response): Promise<void> {
  nodeResponse.statusCode = response.status;

  if (response.statusText.length > 0) {
    nodeResponse.statusMessage = response.statusText;
  }

  response.headers.forEach((value, name) => {
    nodeResponse.setHeader(name, value);
  });

  if (response.body === null) {
    nodeResponse.end();
    return;
  }

  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
}

function writeNodeError(nodeResponse: ServerResponse): void {
  if (nodeResponse.headersSent) {
    nodeResponse.destroy();
    return;
  }

  nodeResponse.statusCode = 500;
  nodeResponse.setHeader("content-type", "application/json");
  nodeResponse.end(
    JSON.stringify({
      error: {
        code: "internal",
        message: "Internal server error."
      }
    })
  );
}
