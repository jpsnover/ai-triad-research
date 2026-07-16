**Date:** 2026-07-15
**Working on:** t/1587 (Phase 3 scheduler), t/1588 (PS formula alignment)
**Status:** t/1588 Done (Phase A `4008620a` + Phase B `c968fbc7`). t/1587 blocked on CL provenance register update before Done.
**Key context:** Phase B makes `nodes`/`cruxLinks` optional in `generateBatchConfig` when records carry pre-computed `testingPriority`. Added `loadTestingRecords(path)` for reading PS-emitted JSON. 30/30 tests green. CL pinged at p/3#100-101 with provenance register entries to move from §8→§1 (deficit ladder, importance weights) and new WELL_TESTED_EXCLUSION constants.
**Next:** Wait for CL provenance register update, then close t/1587 with commit SHA. Check for new pings/tickets.
