**Date:** 2026-07-17
**Working on:** t/1617 — Claim Sketches showed raw `my_claims[].targets` AN ids with no validation; a dangling/forward target (e.g. → AN-7 when the network tops out at AN-6) looked valid.
**Status:** DONE + committed 5749ffb6. Verify green on committed code (458 scoped tests earlier + full `npm run verify`). Self-cert /trivial-change (display-only, single file, no new API/schema).
**Key context:** ClaimsTab already receives `an: ArgumentNetwork | undefined`; built `const anNodeIds = new Set((an?.nodes ?? []).map(n => n.id))` and rendered each target individually — unresolved ids get danger color + `⚠ (no such node)` + title tooltip; copyText annotates them too. Valid targets render unchanged. Inline styles only (styles.css frozen). Wrapped the Claim Sketches block in an IIFE so the id set is computed once.
**Next:** No queued ticket. Re-check ticket queue at next session start (`list_tickets(all:false, limit:500, sort:priority)`), pick highest-priority unblocked.
