# Release Evidence Template

Use this note for each release candidate or production-readiness review so smoke, acceptance, and support-boundary facts stay in one place.

`npm run smoke:real` now emits `releaseEvidence` and `releaseEvidenceMarkdown`, and writes matching `.json` plus `.md` files when `PARLEY_SMOKE_EVIDENCE_DIR` is set. Use the generated payload as the default starting point for this note.
The generated launcher fields should stay concise and provenance-focused rather than embedding full participant prompts.

## Header

- Review date:
- Commit:
- Reviewer:
- Release candidate label:

## Support Boundary

- Supported transport:
- Windows real-environment evidence:
- Linux evidence:
- macOS evidence:
- Current caveats:

## Automated Checks

- `npm test`:
- `npm run lint`:
- `npm run typecheck`:
- `npm run build`:

## Real CLI Smoke

- Smoke command:
- OS:
- Node version:
- Smoke date:
- Claude launcher:
- Gemini launcher:
- Result:
- Gemini usefulness classification:
- Gemini usefulness reasons:
- Notes:

## Codex Desktop Acceptance

- Checklist run date:
- Result:
- Launcher caveats:
- Notes:

## Follow-Ups

- Open issues:
- Risk register updates needed:
- Test matrix updates needed:
- Release decision:
