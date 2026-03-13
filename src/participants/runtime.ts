import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

import type { ParticipantRawExecution } from "./types.js";
import type { ParticipantProcessGuardrail } from "../types.js";

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
      const startedAt = Date.now();
      const child = spawn(input.command, input.args, {
        cwd: input.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let timedOut = false;
      let outputLimitExceeded = false;
      let guardrail: ParticipantProcessGuardrail | undefined;

      const timeoutMs = readPositiveIntEnv("PARLEY_PARTICIPANT_TIMEOUT_MS") ?? 120_000;
      const maxOutputBytes = readPositiveIntEnv("PARLEY_PARTICIPANT_MAX_OUTPUT_BYTES") ?? 1_000_000;
      const killGraceMs = readPositiveIntEnv("PARLEY_PARTICIPANT_KILL_GRACE_MS") ?? 1_000;

      const forceKillTimer = setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, timeoutMs + killGraceMs);
      forceKillTimer.unref();

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        guardrail = "timeout";
        child.kill("SIGTERM");
      }, timeoutMs);
      timeoutTimer.unref();

      const finish = (result: ParticipantRawExecution) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutTimer);
        clearTimeout(forceKillTimer);
        resolve(result);
      };

      const appendChunk = (current: string, chunk: Buffer | string, remainingBytes: number) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (remainingBytes <= 0) {
          return current;
        }

        if (buffer.length <= remainingBytes) {
          return current + buffer.toString();
        }

        return current + buffer.subarray(0, remainingBytes).toString();
      };

      const handleOutputLimit = () => {
        if (outputLimitExceeded) {
          return;
        }

        outputLimitExceeded = true;
        guardrail = "output_limit";
        child.kill("SIGTERM");
      };

      child.stdout.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remainingBytes = maxOutputBytes - stdoutBytes;
        stdout += appendChunk("", buffer, remainingBytes);
        stdoutBytes += buffer.length;
        if (stdoutBytes > maxOutputBytes) {
          handleOutputLimit();
        }
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remainingBytes = maxOutputBytes - stderrBytes;
        stderr += appendChunk("", buffer, remainingBytes);
        stderrBytes += buffer.length;
        if (stderrBytes > maxOutputBytes) {
          handleOutputLimit();
        }
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        clearTimeout(timeoutTimer);
        clearTimeout(forceKillTimer);
        reject(error);
      });

      child.on("close", (exitCode, signal) => {
        finish({
          command: input.command,
          args: input.args,
          stdout,
          stderr,
          exitCode,
          durationMs: Date.now() - startedAt,
          ...(signal ? { signal } : {}),
          ...(timedOut ? { timedOut: true } : {}),
          ...(outputLimitExceeded ? { outputLimitExceeded: true } : {}),
          ...(guardrail ? { guardrail } : {})
        });
      });
    });
  }
}

function readPositiveIntEnv(name: string): number | null {
  const rawValue = process.env[name];
  if (!rawValue) {
    return null;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}
