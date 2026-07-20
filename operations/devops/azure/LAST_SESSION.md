**Date:** 2026-07-16
**Working on:** t/1595 — trim operations/devops/azure/AGENTS.md context bloat (part of t/1592 fleet cleanup)
**Status:** Complete. AGENTS.md 165→59 lines; anti-patterns + readiness checklist extracted to docs/aca-checklists.md. Doc SHA 411be79e (main git), AGENTS.md SHA 49a3954 (overlay/ogit).
**Key context:** Load-bearing rules kept inline per TL guardrail: `az containerapp update` env-var drift rule, BYOK-no-secrets, Bicep-not-portal. No mandatory rule deleted — only relocated/pointed. Overlay commits use `pwsh ./scripts/ogit.ps1` (ogit alias unavailable in Bash tool).
**Next:** Push both repos (main + overlay) at next reviewed-batch boundary. Still awaiting owner's live authenticated test to close t/1361; base-image retention/pin LOW ticket still unfiled.
