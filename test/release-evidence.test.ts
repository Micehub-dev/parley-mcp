import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildReleaseEvidenceRecord,
  formatReleaseEvidenceMarkdown,
  summarizeLauncher,
  writeReleaseEvidenceArtifacts
} from "../src/smoke/release-evidence.js";

test("release evidence formatter maps smoke facts onto the review template", () => {
  const record = buildReleaseEvidenceRecord({
    reviewDate: "2026-03-13",
    commit: "abc123",
    reviewer: "release-bot",
    releaseCandidateLabel: "rc-11",
    currentCaveats: ["Windows uses gemini.cmd when available."],
    realCliSmoke: {
      os: "win32",
      nodeVersion: "v22.15.0",
      smokeDate: "2026-03-13",
      claudeLauncher: "claude.exe",
      geminiLauncher: "C:\\Users\\Micehub\\AppData\\Roaming\\npm\\gemini.cmd",
      result: "passed",
      geminiUsefulnessClassification: "material",
      geminiUsefulnessReasons: ["topic-specific next step", "supporting detail present"]
    }
  });

  const markdown = formatReleaseEvidenceMarkdown(record);

  assert.match(markdown, /## Header/);
  assert.match(markdown, /- Review date: 2026-03-13/);
  assert.match(markdown, /## Real CLI Smoke/);
  assert.match(markdown, /- Claude launcher: claude\.exe/);
  assert.match(markdown, /- Gemini usefulness classification: material/);
  assert.match(markdown, /topic-specific next step \| supporting detail present/);
});

test("launcher summarizer keeps provenance while omitting prompt and schema payloads", () => {
  const summary = summarizeLauncher({
    command: "cmd.exe",
    args: [
      "/d",
      "/s",
      "/c",
      "C:\\Users\\Micehub\\AppData\\Roaming\\npm\\gemini.cmd",
      "-p",
      "very long prompt that should not appear",
      "--output-format",
      "json",
      "--model",
      "auto"
    ]
  });

  assert.equal(
    summary,
    "cmd.exe -> C:\\Users\\Micehub\\AppData\\Roaming\\npm\\gemini.cmd [output=json, model=auto, prompt=inline]"
  );
  assert.doesNotMatch(summary, /very long prompt/);
});

test("release evidence writer emits json and markdown artifacts together", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "parley-release-evidence-"));

  try {
    const record = buildReleaseEvidenceRecord({
      reviewDate: "2026-03-13",
      realCliSmoke: {
        os: "win32",
        nodeVersion: "v22.15.0",
        smokeDate: "2026-03-13",
        claudeLauncher: "claude.exe",
        geminiLauncher: "gemini.cmd",
        result: "passed",
        geminiUsefulnessClassification: "material",
        geminiUsefulnessReasons: ["topic-specific next step"]
      }
    });

    const artifactPaths = await writeReleaseEvidenceArtifacts(
      tempDir,
      "release-evidence",
      record
    );

    const json = JSON.parse(await readFile(artifactPaths.jsonPath, "utf8")) as {
      realCliSmoke: {
        result: string;
      };
    };
    const markdown = await readFile(artifactPaths.markdownPath, "utf8");

    assert.equal(json.realCliSmoke.result, "passed");
    assert.match(markdown, /# Release Evidence/);
    assert.match(markdown, /- Result: passed/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
