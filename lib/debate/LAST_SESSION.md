**Date:** 2026-07-01
**Working on:** t/1277 (hotfix), t/1279 (peer_referencing_rate), t/1278 (corpus coverage lever)
**Status:** All complete. t/1280 (diversity-injection round) blocked on CL design spec.
**Key context:** ESM mocking trap — taxonomy-editor vitest config doesn't alias 'node:fs' to 'fs'; always use `import fs from 'fs'` + factory `vi.mock('fs', ...)` pattern (not vi.spyOn). Commits: 5de7dc51, 9216c79c, 7eb7c398, ad03ed22, 543589de.
**Next:** Check ticket queue. t/1280 unblocked only when CL provides design spec (trigger, round count, measurement criteria).
