# Real CLI Smoke

## Purpose

Use this workflow to verify Parley against real participant binaries instead of the fixture-backed fake participants used in CI.

## Command

```bash
npm run build
npm run smoke:real
```

Optional Windows Gemini wrapper override:

```powershell
$env:PARLEY_GEMINI_COMMAND="powershell.exe"
$env:PARLEY_GEMINI_ARGS_JSON='["-NoProfile","-ExecutionPolicy","Bypass","-File","C:\\Users\\<user>\\AppData\\Roaming\\npm\\gemini.ps1"]'
```

Windows note:

- Parley now prefers `%APPDATA%\\npm\\gemini.cmd` automatically when that shim is present.
- Use the PowerShell override only when the npm `.cmd` shim is unavailable and `gemini.ps1` is the only working launcher.

Optional artifact retention:

```powershell
$env:PARLEY_SMOKE_KEEP_TEMP="1"
```

## Expected Result

- Success path: the script prints `ok: true`, `recordedAt`, environment metadata, participant launcher details, Gemini usefulness classification, the one-turn parley responses, and the finish-time `conclusion`.
- Failure path: the script prints `ok: false`, the temporary `smokeRoot`, and the diagnostics directory so operators can inspect the persisted artifacts.

The success payload is intended to be copied directly into the current release-evidence note based on `docs/release-evidence-template.md`.

## Guardrail Overrides

- `PARLEY_PARTICIPANT_TIMEOUT_MS`
- `PARLEY_PARTICIPANT_MAX_OUTPUT_BYTES`
- `PARLEY_PARTICIPANT_KILL_GRACE_MS`

Use these only when the release runbook explicitly calls for a different production value.

## Latest Observed Result

Observed on 2026-03-13 in a Windows local environment:

- `claude.exe` resolved directly from `PATH`
- PowerShell surfaced `gemini.ps1`, but Parley resolved Gemini through the npm-installed `gemini.cmd` shim under `%APPDATA%\\npm`
- `npm run smoke:real` completed successfully with `ok: true`, one committed turn, a finish-time `conclusion`, launcher metadata, and a `geminiUsefulness` field
- the latest default release-oriented smoke topic produced a materially useful Gemini response after prompt hardening, even though the response still fell back to the default next-step string and omitted argument/question arrays

Linux note:

- Current Linux evidence is automated CI on `ubuntu-latest`; this document does not claim a Linux real-CLI smoke until an actual Linux participant run is exercised.
