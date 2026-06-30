**Date:** 2026-06-29
**Working on:** Four tickets: t/1062 (anon embeddings 403), t/1085 (rate limiter fault tests), t/1111 (local user FR access test), t/1110 (debate anon allowlist completeness test)
**Status:** All four complete, verify gate passing
**Key context:** freeTierRoute in server.ts:4127 now covers both /api/ai/generate and /api/embeddings/compute; debateAnonAllowlist.test.ts is the regression anchor for future debate endpoint additions
**Next:** Check ticket queue for new work
