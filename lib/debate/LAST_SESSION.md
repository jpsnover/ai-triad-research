**Date:** 2026-06-29
**Working on:** t/1135 CL review round 2 fix (markdown-mode crash hole), t/1139 crux framing fix (completed)
**Status:** t/1135 round 2 fix applied and verified (2291/2291 tests pass), posted t/1135#7, pinged CL at p/49#145. Awaiting CL re-review. t/1139 done.
**Key context:** cli.ts now writes structured JSON first via safeSerialize+atomicWriteSync regardless of format, deletes partial after, then writes markdown as secondary artifact. atomicWriteSync cleans up orphaned .tmp on rename failure. Cross-scope GUI changes (debateIO.ts/fileIO.ts) still need routing.
**Next:** Wait for CL review on t/1135#7. Route cross-scope GUI safe-serialize changes to Taxonomy Editor/Server owners when CL approves.
