**Date:** 2026-07-29
**Working on:** t/1921 — Reduce eslint complexity warnings in server/storage/ (ADR-007 helper extractions)
**Status:** Batch A DONE (PR #135, `4f68d4ae`). Batch B DONE (PR #140, `68a229e5`). Batch C PR open (#147, `9a1e7e28`).

**Batch A landed:**
- fileIO.ts: `findGraphAttributeMismatches` 17→7, `buildNodeSourceIndex` 26→2, `buildPolicySourceIndex` 27→4
- debateStore.ts: `applyDebateDeltaToStorage` 22→7

**Batch B landed:**
- editMeta.ts: `stampNodeAuthorship` map callback 29→6 (`restoreUnchangedStamps`+`buildEditMeta`+`buildHistoryEntry`)

**Batch C (PR #147, awaiting CI):**
- githubRestClient.ts: `request` 45→13 (7 helpers: `recordAttempt`, `buildRequestHeaders`, `handleNotModified`, `parseAndLogResponse`, `extractApiMessage`, `handleNonOkStatus`, `handleNetworkError`)
- `NonOkOutcome` union type at module scope carries retry/return signal

**Remaining:**
- Batch D: githubAPIBackend.ts `listDirectory@16` (coordinate LOC impact with t/1688 exception)

**Landing procedure (e/49/e/50):** PR-flow is CONVENTION not platform hard-block. Always land via feature branch → `gh pr create` → 6 checks → `gh pr merge --rebase --delete-branch`. From detached HEAD: push as `HEAD:refs/heads/<branch>` (fully-qualified).

**Prior sessions:** t/1941 edges serializer (`dcd54936`); t/1895 mention read path (`84cb675b`); t/1807 entity read path (`1d2d9111`); t/1688 fileIO+githubAPIBackend split (`c2ea5c7e`).
