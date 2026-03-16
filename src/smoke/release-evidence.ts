import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ReleaseEvidenceRecord {
  header: {
    reviewDate: string;
    commit: string;
    reviewer: string;
    releaseCandidateLabel: string;
  };
  supportBoundary: {
    supportedTransport: string;
    windowsRealEnvironmentEvidence: string;
    linuxEvidence: string;
    macOsEvidence: string;
    currentCaveats: string;
  };
  automatedChecks: {
    test: string;
    lint: string;
    typecheck: string;
    build: string;
  };
  realCliSmoke: {
    smokeCommand: string;
    os: string;
    nodeVersion: string;
    smokeDate: string;
    claudeLauncher: string;
    geminiLauncher: string;
    result: string;
    geminiUsefulnessClassification: string;
    geminiUsefulnessReasons: string;
    notes: string;
  };
  codexDesktopAcceptance: {
    checklistRunDate: string;
    result: string;
    launcherCaveats: string;
    notes: string;
  };
  followUps: {
    openIssues: string;
    riskRegisterUpdatesNeeded: string;
    testMatrixUpdatesNeeded: string;
    releaseDecision: string;
  };
}

export interface LauncherSummaryInput {
  command: string;
  args: string[];
}

export interface BuildReleaseEvidenceInput {
  reviewDate: string;
  commit?: string;
  reviewer?: string;
  releaseCandidateLabel?: string;
  supportedTransport?: string;
  windowsRealEnvironmentEvidence?: string;
  linuxEvidence?: string;
  macOsEvidence?: string;
  currentCaveats?: string[];
  automatedChecks?: Partial<ReleaseEvidenceRecord["automatedChecks"]>;
  realCliSmoke: {
    smokeCommand?: string;
    os: string;
    nodeVersion: string;
    smokeDate: string;
    claudeLauncher: string;
    geminiLauncher: string;
    result: string;
    geminiUsefulnessClassification: string;
    geminiUsefulnessReasons: string[];
    notes?: string[];
  };
  codexDesktopAcceptance?: Partial<ReleaseEvidenceRecord["codexDesktopAcceptance"]>;
  followUps?: Partial<ReleaseEvidenceRecord["followUps"]>;
}

export function buildReleaseEvidenceRecord(
  input: BuildReleaseEvidenceInput
): ReleaseEvidenceRecord {
  return {
    header: {
      reviewDate: input.reviewDate,
      commit: input.commit ?? "not recorded",
      reviewer: input.reviewer ?? "not recorded",
      releaseCandidateLabel: input.releaseCandidateLabel ?? "not recorded"
    },
    supportBoundary: {
      supportedTransport: input.supportedTransport ?? "stdio MCP only",
      windowsRealEnvironmentEvidence:
        input.windowsRealEnvironmentEvidence ??
        "Windows real-environment evidence not recorded by this smoke artifact.",
      linuxEvidence:
        input.linuxEvidence ??
        "GitHub Actions ubuntu-latest automation evidence only; no Linux real-CLI smoke recorded here.",
      macOsEvidence:
        input.macOsEvidence ?? "Unverified; no macOS runtime exercise recorded in this artifact.",
      currentCaveats: joinEvidenceLines(
        input.currentCaveats ?? ["No additional caveats were recorded by the smoke artifact."]
      )
    },
    automatedChecks: {
      test: input.automatedChecks?.test ?? "not recorded by smoke artifact",
      lint: input.automatedChecks?.lint ?? "not recorded by smoke artifact",
      typecheck: input.automatedChecks?.typecheck ?? "not recorded by smoke artifact",
      build: input.automatedChecks?.build ?? "not recorded by smoke artifact"
    },
    realCliSmoke: {
      smokeCommand: input.realCliSmoke.smokeCommand ?? "npm run smoke:real",
      os: input.realCliSmoke.os,
      nodeVersion: input.realCliSmoke.nodeVersion,
      smokeDate: input.realCliSmoke.smokeDate,
      claudeLauncher: input.realCliSmoke.claudeLauncher,
      geminiLauncher: input.realCliSmoke.geminiLauncher,
      result: input.realCliSmoke.result,
      geminiUsefulnessClassification: input.realCliSmoke.geminiUsefulnessClassification,
      geminiUsefulnessReasons: joinEvidenceLines(
        input.realCliSmoke.geminiUsefulnessReasons,
        "none recorded"
      ),
      notes: joinEvidenceLines(
        input.realCliSmoke.notes ?? ["Smoke artifact generated automatically from the real smoke path."]
      )
    },
    codexDesktopAcceptance: {
      checklistRunDate:
        input.codexDesktopAcceptance?.checklistRunDate ?? "not run as part of smoke artifact",
      result: input.codexDesktopAcceptance?.result ?? "not recorded by smoke artifact",
      launcherCaveats:
        input.codexDesktopAcceptance?.launcherCaveats ?? "not recorded by smoke artifact",
      notes:
        input.codexDesktopAcceptance?.notes ??
        "Run the checklist separately when release claims include Codex Desktop support."
    },
    followUps: {
      openIssues: input.followUps?.openIssues ?? "none recorded",
      riskRegisterUpdatesNeeded: input.followUps?.riskRegisterUpdatesNeeded ?? "review after release",
      testMatrixUpdatesNeeded: input.followUps?.testMatrixUpdatesNeeded ?? "review after release",
      releaseDecision: input.followUps?.releaseDecision ?? "pending review"
    }
  };
}

export function formatReleaseEvidenceMarkdown(record: ReleaseEvidenceRecord): string {
  const lines = [
    "# Release Evidence",
    "",
    "## Header",
    "",
    `- Review date: ${record.header.reviewDate}`,
    `- Commit: ${record.header.commit}`,
    `- Reviewer: ${record.header.reviewer}`,
    `- Release candidate label: ${record.header.releaseCandidateLabel}`,
    "",
    "## Support Boundary",
    "",
    `- Supported transport: ${record.supportBoundary.supportedTransport}`,
    `- Windows real-environment evidence: ${record.supportBoundary.windowsRealEnvironmentEvidence}`,
    `- Linux evidence: ${record.supportBoundary.linuxEvidence}`,
    `- macOS evidence: ${record.supportBoundary.macOsEvidence}`,
    `- Current caveats: ${record.supportBoundary.currentCaveats}`,
    "",
    "## Automated Checks",
    "",
    `- \`npm test\`: ${record.automatedChecks.test}`,
    `- \`npm run lint\`: ${record.automatedChecks.lint}`,
    `- \`npm run typecheck\`: ${record.automatedChecks.typecheck}`,
    `- \`npm run build\`: ${record.automatedChecks.build}`,
    "",
    "## Real CLI Smoke",
    "",
    `- Smoke command: ${record.realCliSmoke.smokeCommand}`,
    `- OS: ${record.realCliSmoke.os}`,
    `- Node version: ${record.realCliSmoke.nodeVersion}`,
    `- Smoke date: ${record.realCliSmoke.smokeDate}`,
    `- Claude launcher: ${record.realCliSmoke.claudeLauncher}`,
    `- Gemini launcher: ${record.realCliSmoke.geminiLauncher}`,
    `- Result: ${record.realCliSmoke.result}`,
    `- Gemini usefulness classification: ${record.realCliSmoke.geminiUsefulnessClassification}`,
    `- Gemini usefulness reasons: ${record.realCliSmoke.geminiUsefulnessReasons}`,
    `- Notes: ${record.realCliSmoke.notes}`,
    "",
    "## Codex Desktop Acceptance",
    "",
    `- Checklist run date: ${record.codexDesktopAcceptance.checklistRunDate}`,
    `- Result: ${record.codexDesktopAcceptance.result}`,
    `- Launcher caveats: ${record.codexDesktopAcceptance.launcherCaveats}`,
    `- Notes: ${record.codexDesktopAcceptance.notes}`,
    "",
    "## Follow-Ups",
    "",
    `- Open issues: ${record.followUps.openIssues}`,
    `- Risk register updates needed: ${record.followUps.riskRegisterUpdatesNeeded}`,
    `- Test matrix updates needed: ${record.followUps.testMatrixUpdatesNeeded}`,
    `- Release decision: ${record.followUps.releaseDecision}`
  ];

  return `${lines.join("\n")}\n`;
}

export async function writeReleaseEvidenceArtifacts(
  outputDir: string,
  baseName: string,
  record: ReleaseEvidenceRecord
): Promise<{
  jsonPath: string;
  markdownPath: string;
}> {
  await mkdir(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, `${baseName}.json`);
  const markdownPath = path.join(outputDir, `${baseName}.md`);
  const markdown = formatReleaseEvidenceMarkdown(record);

  await writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown, "utf8");

  return {
    jsonPath,
    markdownPath
  };
}

function joinEvidenceLines(values: string[], fallback = "not recorded"): string {
  const cleaned = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return cleaned.length > 0 ? cleaned.join(" | ") : fallback;
}

export function summarizeLauncher(input: LauncherSummaryInput | null | undefined): string {
  if (!input) {
    return "not recorded";
  }

  const directLaunch = unwrapLauncher(input.command, input.args);
  const facts = buildLauncherFacts(directLaunch.args);
  const factSuffix = facts.length > 0 ? ` [${facts.join(", ")}]` : "";

  if (directLaunch.via) {
    return `${directLaunch.via} -> ${directLaunch.command}${factSuffix}`;
  }

  return `${directLaunch.command}${factSuffix}`;
}

function unwrapLauncher(command: string, args: string[]): {
  via?: string;
  command: string;
  args: string[];
} {
  const normalizedCommand = command.toLowerCase();

  if (normalizedCommand.endsWith("cmd.exe") && args.length >= 4 && args[2] === "/c") {
    return {
      via: command,
      command: args[3] ?? "not recorded",
      args: args.slice(4)
    };
  }

  const powerShellFileIndex = args.findIndex((value) => value.toLowerCase() === "-file");
  if (normalizedCommand.includes("powershell") && powerShellFileIndex >= 0) {
    return {
      via: command,
      command: args[powerShellFileIndex + 1] ?? "not recorded",
      args: args.slice(powerShellFileIndex + 2)
    };
  }

  return {
    command,
    args
  };
}

function buildLauncherFacts(args: string[]): string[] {
  const facts: string[] = [];
  const outputFormat = findFlagValue(args, "--output-format");
  const model = findFlagValue(args, "--model");
  const resumeRequested = args.includes("--resume");

  if (outputFormat) {
    facts.push(`output=${outputFormat}`);
  }

  if (model) {
    facts.push(`model=${model}`);
  }

  if (args.includes("--json-schema")) {
    facts.push("schema=inline");
  }

  if (resumeRequested) {
    facts.push("resume=true");
  }

  if (args.includes("-p")) {
    facts.push("prompt=inline");
  }

  return facts;
}

function findFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }

  const value = args[index + 1];
  return value && !value.startsWith("-") ? value : undefined;
}
