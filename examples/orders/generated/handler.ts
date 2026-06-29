import { createFetchHandler } from "@callsitehq/runtime";

import config from "../callsite.config.js";

export const fetchHandler = createFetchHandler(config.capabilities);

export default {
  fetch: fetchHandler
};
