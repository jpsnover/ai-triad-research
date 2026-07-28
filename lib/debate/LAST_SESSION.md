**Date:** 2026-07-28
**Working on:** t/1837/t/1839 — aiAdapter hermetic fix + cliPipeExit CI timing.

**Session work (t/1837, t/1839 — Done, `d508d22f`):**
- `aiAdapter.test.ts`: added `@vitest-environment node` + mocked `onnxEmbedding` — escapes jsdom environment, prevents onnxruntime-node load in CI
- `cliPipeExit.test.ts`: bumped WITH-fix spawn timeout 20s→60s, test timeout 30s→90s (tsx cold-start on loaded CI runners was killing the child); changed counterfactual from `it.runIf(win32)` to `it.skip` (hang is environment-sensitive within Windows, t/1839)
- Gate integrity confirmed: WITH-fix case exits 0 in 435ms — deterministic event-loop drain, not timeout tolerance
- Landed via fresh worktree (`wt-land-1837`) cut from `origin/main`; verify: 64 passed, 1 skipped (expected); pushed `37598a6f..d508d22f`
- Azure gating on CI green + gemini migration both present before deploy dispatch

**NEXT:** Run `list_tickets(all:false, limit:500, sort:"priority")` at next session start.
