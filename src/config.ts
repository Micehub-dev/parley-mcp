import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ParleyConfig } from "./types.js";

const configSchema = z.object({
  parley: z.object({
    defaults: z.object({
      claudeModel: z.string().min(1),
      geminiModel: z.string().min(1)
    }),
    allowedModels: z.object({
      claude: z.array(z.string().min(1)).min(1),
      gemini: z.array(z.string().min(1)).min(1)
    }),
    defaultMaxTurns: z.number().int().positive()
  })
});

export async function loadConfig(rootDir: string): Promise<ParleyConfig> {
  const configPath = path.join(rootDir, ".multi-llm", "config.json");
  const raw = await readFile(configPath, "utf8");
  return configSchema.parse(JSON.parse(raw));
}
