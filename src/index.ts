import { startServer } from "./server.js";

startServer().catch((error) => {
  console.error("[parley] MCP server failed to start.");
  console.error(error);
  process.exitCode = 1;
});
