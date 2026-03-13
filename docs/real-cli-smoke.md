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

- Success path: the script prints `ok: true`, the one-turn parley responses, and the finish-time `conclusion`.
- Failure path: the script prints `ok: false`, the temporary `smokeRoot`, and the diagnostics directory so operators can inspect the persisted artifacts.

## Guardrail Overrides

- `PARLEY_PARTICIPANT_TIMEOUT_MS`
- `PARLEY_PARTICIPANT_MAX_OUTPUT_BYTES`
- `PARLEY_PARTICIPANT_KILL_GRACE_MS`

Use these only when the release runbook explicitly calls for a different production value.

## Latest Observed Result

Observed on 2026-03-13 in a Windows local environment:

- `claude.exe` resolved directly from `PATH`
- PowerShell surfaced `gemini.ps1`, but Parley resolved Gemini through the npm-installed `gemini.cmd` shim under `%APPDATA%\\npm`
- `npm run smoke:real` completed successfully with `ok: true`, one committed turn, and a finish-time `conclusion`
- Gemini still may return weaker or less structured content than Claude, but the adapter now normalizes common fenced JSON, labeled plain-text, and partial JSON responses into the shared participant contract when safe

Linux note:

- Current Linux evidence is automated CI on `ubuntu-latest`; this document does not claim a Linux real-CLI smoke until an actual Linux participant run is exercised.
