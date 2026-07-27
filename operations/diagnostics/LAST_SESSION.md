**Date:** 2026-07-27
**Working on:** t/1780 — PreToolUse hook: warn on direct shared-tree main commits.
**Status:** Gate-verified (4/4 cases). Hook created DISABLED. Awaiting TL enable decision.
**Key context:**
- `check-direct-main-commit.cjs` — 5-step detection; committed by pathspec.
- Root cause of Case A failure: `git rev-parse --git-dir` returns absolute path; `--git-common-dir` returns relative. Fixed with `path.resolve()` on both before string compare.
- Case A (fires): exit 0, stdout warning. Cases B/C/D (suppress): exit 1.
- Case D (feature branch) verified by code review — step 5 exits 1 when branch ≠ main.
- Hook rule `direct-main-commit-warning`: created disabled. TL decides enable.
- Sage #80 Part 2 (exit-1-suppresses-silently) feedback: payload shown to user — awaiting go-ahead to submit.
**Next:** Watch t/1646 (batch gate). Confirm Sage #80 Part 2 feedback submission with user.
