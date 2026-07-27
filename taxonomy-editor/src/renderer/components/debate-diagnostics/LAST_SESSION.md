**Date:** 2026-07-27
**Working on:** t/1736 — extract the 50-line directory tree from always-on AGENTS.md into role-local FILES.md (Phase 2 of role-instruction audit, parent t/1731).
**Status:** Complete. Marked Done. Two-repo commit split per t/1731#1 convention: FILES.md via git (SHA 23ef7b90), AGENTS.md pointer via ogit (SHA 0fb5532).
**Key context:** FILES.md is a normal project-repo file → `git` by pathspec; AGENTS.md is overlay-tracked → `ogit`. Two commits, two repos — never cross them. Pointer left in AGENTS.md: `**File inventory / directory map → [FILES.md](./FILES.md)**`. Behavioral norms (Conventions/Dependencies/Testing) untouched — reference-only move. Post-commit `ogit diff HEAD -- AGENTS.md` empty (no sync revert). /trivial-change self-cert, no TL review (docs-only).
**Next:** Re-check queue for next unblocked ticket (drain-until-budget, 3-ticket cap).
