import { createFetchHandler } from "@callsitehq/runtime";

import { capabilities } from "./capabilities.js";

export const fetchHandler = createFetchHandler(capabilities);

export default {
  fetch: fetchHandler
};
