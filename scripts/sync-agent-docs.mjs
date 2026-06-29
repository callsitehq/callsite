import { readFile, writeFile } from "node:fs/promises";

const agents = await readFile("AGENTS.md", "utf8");

await writeFile(
  "CLAUDE.md",
  `<!-- Generated from AGENTS.md. Do not edit directly. Run pnpm sync:agent-docs. -->\n\n${agents}`
);
