**Date:** 2026-07-10
**Working on:** t/1479 — NewDebateDialog: pass freeTier into Gemini onboarding check
**Status:** Code complete + committed; ticket NOT yet transitioned to Done (Orca MCP disconnected mid-session).
**Key context:** Fix `2d7685c7` (handleStart → `checkGeminiOnboarding({ freeTier })`, options-object form per t/1478's `checkAndShow(opts?: { freeTier?: boolean })`). Test `ec5aabac` (`NewDebateDialog.freeTier.test.tsx`, 2 cases, pass). Full `npm run verify` green (0 eslint errors, 0 depcruise violations, build ✓). Commits not pushed yet.
**Next:** When Orca MCP reconnects: comment both SHAs on t/1479 and transition it Done. Then next TL sync pushes `2d7685c7`+`ec5aabac`.
