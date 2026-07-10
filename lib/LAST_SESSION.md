**Date:** 2026-07-09
**Working on:** t/1436 (z.ai / GLM-5.2 backend addition)
**Status:** Done. Committed as aa5baa4a. AC#3 smoke test blocked on missing ZAI_API_KEY — deferred to owner.
**Key context:** New provider at lib/ai-client/providers/zai.ts mirrors groq.ts. BackendId union now includes 'zai'. Cross-scope fix: taxonomy-editor/src/server/config.ts ENV_KEY_NAMES.
**Next:** Check ticket queue for new assignments.
