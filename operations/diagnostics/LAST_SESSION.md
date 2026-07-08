**Date:** 2026-07-07
**Working on:** Triaged flight recorders, diagnosed Zod schema bug (t/1380), analyzed dual validation path architecture for TL (p/47#72).
**Status:** All diagnosed and ticketed. t/1380 fix (`.optional()` → `.nullish()`) is in Taxonomy Editor's working tree but not yet committed. Reported dual-path finding to TL: t/1321 tightened the Zod schema for CI (report-only), but the same schema is hard-enforced by the client save gate (`taxonomyDataSlice.ts:383`) — a shared-schema side effect.
**Key context:** Two consumers of `povTaxonomyFileSchema`: CI job (report-only, `continue-on-error`) and client save gate (hard-enforcing, blocks saves). Schema tightening in one path affects both. TL aware — may need a design decision on whether to split schemas.
**Next:** Monitor t/1380 commit. All Diagnostics tickets are Done — idle until new work arrives.
