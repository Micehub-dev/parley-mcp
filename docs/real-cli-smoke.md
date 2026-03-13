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
- `gemini.ps1` required an explicit PowerShell launcher override for `spawn`
- the real smoke still produced `participant_failure` for Gemini with exit code `1`, so the current support statement remains "Windows stdio support with documented local CLI caveats", not a blanket success claim across all operator setups
