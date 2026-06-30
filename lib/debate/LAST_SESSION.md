**Date:** 2026-06-30
**Working on:** t/1228 — barrel Node-import crash (two chains breaking Vite dev server)
**Status:** Complete. Chain 1 (`7a5b5131`): extracted `agentUtility.ts` from `calibrationLogger.ts`. Chain 2 (`6887bb02`): extracted `explorationPresetConfig.ts` from `explorationPreset.ts`. Full verify passes.
**Key context:** Pattern for browser-safe barrel exports: extract pure-math/config into a separate module with type-only imports, re-export from original for backward compat, update renderer imports to point at the new module.
**Next:** Ticket queue empty. Check for new assignments on next session start.
