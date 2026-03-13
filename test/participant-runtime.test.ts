import assert from "node:assert/strict";
import test from "node:test";

import { SpawnCommandExecutor } from "../src/participants/runtime.js";

test("spawn executor terminates participant processes that exceed the timeout guardrail", async () => {
  const executor = new SpawnCommandExecutor();
  const originalTimeout = process.env.PARLEY_PARTICIPANT_TIMEOUT_MS;
  const originalGrace = process.env.PARLEY_PARTICIPANT_KILL_GRACE_MS;

  process.env.PARLEY_PARTICIPANT_TIMEOUT_MS = "100";
  process.env.PARLEY_PARTICIPANT_KILL_GRACE_MS = "100";

  try {
    const result = await executor.run({
      command: process.execPath,
      args: ["-e", "setTimeout(() => { process.stdout.write('too late'); }, 5000);"],
      cwd: process.cwd()
    });

    assert.equal(result.guardrail, "timeout");
    assert.equal(result.timedOut, true);
    assert.ok((result.durationMs ?? 0) < 2_000);
    assert.equal(result.stdout, "");
  } finally {
    restoreEnv("PARLEY_PARTICIPANT_TIMEOUT_MS", originalTimeout);
    restoreEnv("PARLEY_PARTICIPANT_KILL_GRACE_MS", originalGrace);
  }
});

test("spawn executor terminates participant processes that exceed the output guardrail", async () => {
  const executor = new SpawnCommandExecutor();
  const originalLimit = process.env.PARLEY_PARTICIPANT_MAX_OUTPUT_BYTES;
  const originalTimeout = process.env.PARLEY_PARTICIPANT_TIMEOUT_MS;

  process.env.PARLEY_PARTICIPANT_MAX_OUTPUT_BYTES = "64";
  process.env.PARLEY_PARTICIPANT_TIMEOUT_MS = "5000";

  try {
    const result = await executor.run({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(4096)); setTimeout(() => {}, 5000);"],
      cwd: process.cwd()
    });

    assert.equal(result.guardrail, "output_limit");
    assert.equal(result.outputLimitExceeded, true);
    assert.ok(result.stdout.length <= 64);
    assert.ok((result.durationMs ?? 0) < 2_000);
  } finally {
    restoreEnv("PARLEY_PARTICIPANT_MAX_OUTPUT_BYTES", originalLimit);
    restoreEnv("PARLEY_PARTICIPANT_TIMEOUT_MS", originalTimeout);
  }
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
