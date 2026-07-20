**Date:** 2026-07-20
**Working on:** t/1638 — enrich debate-save ActionableError with debate id / run_id / turn_count (ElectronMain link in t/1627's "name the exact lost state" chain).
**Status:** Complete. Committed `770766d3` on `main`; `npm run verify` VERIFY_EXIT=0 on committed code.
**Key context:** `saveDebateSession` in debateIO.ts wraps `atomicWriteSync` and enriches BOTH upstream contracts — the t/1627 total-loss `ActionableError` (lock path) AND the raw rethrown Error (EXDEV non-lock path). Test `__tests__/debateIO.saveEnrich.test.ts` drives the real function by mocking `fileIO.resolveDataPath`→temp dir and only `atomicWriteSync`. turn_count = transcript filter on 'statement'|'opening' (matches extractSummary).
**Next:** Await TL/DebateTool implementation review (routed per t/1627#3). Then pick up next unblocked ElectronMain ticket in a fresh session.
