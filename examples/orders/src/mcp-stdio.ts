import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createDefaultOrdersMcpServer } from "./mcp.js";

const server = createDefaultOrdersMcpServer({
  context(extra) {
    return {
      ...(extra.authInfo?.clientId === undefined ? {} : { subject: extra.authInfo.clientId }),
      log(event, data) {
        process.stderr.write(`${JSON.stringify({ event, data })}\n`);
      }
    };
  }
});

await server.connect(new StdioServerTransport());
