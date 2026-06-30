**Date:** 2026-06-30
**Working on:** t/1200 (ONNX embedding cold-start elimination) and t/1162 (real-debate fixture generator)
**Status:** Complete. Both shipped — `34840c06` and `efc03ac7`. All 4643 tests pass, 10 slow tests properly skipped.
**Key context:** Vitest 4 requires options as 2nd arg (`it('name', { timeout }, fn)` not `it('name', fn, timeout)`). Real fixtures written to timestamped dirs under `fixtures/real/` (gitignored). `describe.runIf(process.env.RUN_SLOW)` gates slow tests.
**Next:** Ticket queue empty. Check for new assignments on next session start.
