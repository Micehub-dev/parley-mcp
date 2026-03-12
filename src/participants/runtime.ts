import { spawn } from "node:child_process";

import type { ParticipantRawExecution } from "./types.js";

export interface CommandExecutionInput {
  command: string;
  args: string[];
  cwd: string;
}

export interface CommandExecutor {
  run(input: CommandExecutionInput): Promise<ParticipantRawExecution>;
}

export class SpawnCommandExecutor implements CommandExecutor {
  async run(input: CommandExecutionInput): Promise<ParticipantRawExecution> {
    return new Promise((resolve, reject) => {
      const child = spawn(input.command, input.args, {
        cwd: input.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (exitCode) => {
        resolve({
          command: input.command,
          args: input.args,
          stdout,
          stderr,
          exitCode
        });
      });
    });
  }
}
