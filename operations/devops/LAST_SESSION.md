**Date:** 2026-07-16
**Working on:** t/1597 — trim operations/devops/AGENTS.md context bloat (part of t/1592 fleet cleanup)
**Status:** Complete. AGENTS.md 149 → 118 lines. No behavioral rule deleted — only relocated/pointed.

**What changed (both actions done):**
- Action 1 (Key Commands): extracted the Key Commands block → new `deploy/azure/runbooks/operational-commands.md` (DevOps-owned quick-reference, distinct from the deploy-procedure `production-release.md`). AGENTS.md block replaced with a pointer.
  - main git `d2954cd7` (new runbook), overlay `8eec8ae` (AGENTS.md pointer)
- Action 2 (Error Diagnosis Format): t/1593 landed (shared `docs/error-diagnosis-format.md` now exists in main git), so replaced the triplicated inline block with a one-line pointer.
  - overlay `d4bb282`

**Key context:** AGENTS.md is overlay-tracked (.orca-git) — committed via `git --git-dir=.orca-git --work-tree=. ...`, NOT main git. The new `deploy/azure/` doc is main-git. Markdown-only changes → no tsc/Pester verify gate applies.

**Next:** Check ticket queue. Queued-but-unstarted: ai-rosetta-stone Container App rename (plan `quizzical-sleeping-garden.md`) — do NOT start without explicit owner confirmation.
