# HLD: Delta / Incremental Debate Save

**Last updated:** 2026-07-17
**Author:** Technical Lead
**Status:** Approved — build now (owner decision, overrides the parked-pending-trigger stance on t/1470)
**Ticket:** t/1470

## Problem

Every debate auto-save transmits the **entire** `DebateSession` from the client to
the server: full `transcript`, full `argument_network` (`nodes` / `edges` /
`mutations`), and any embedded embeddings. For a 20+ turn debate this is tens of
megabytes uploaded on *every* auto-save, even though a single turn changes only a
handful of transcript entries and a few argument-network nodes/edges.

The acute production symptoms — the 4× concurrent-save cascade and the silent
180s hang — were already fixed by the coalesce/in-flight-guard/timeout work
(t/1468 `dca04c83`, t/1461 `9adcfaa8`, t/1469 `f204e3ae`). Those bound *failure
rate and blast radius*; they do **not** reduce payload size. Delta save is the
durable fix for the remaining cost: **client→server upload bandwidth and latency
per save**.

## Constraint That Shapes the Design

**Azure Blob Storage has no partial-write API.** The server cannot patch a blob in
place. On receiving a delta it must:

1. Read the current full `debate-{id}.json` blob,
2. Apply the delta in memory,
3. Write the full merged blob back.

Therefore the win is **upload size only** (client → server). Server write time and
storage cost are unchanged — the server still serializes and writes the full blob.
This is a real but *narrower* win than "delta save" first implies, and the design
must not pretend otherwise. It is still worth doing: the client uplink is the
constrained, user-visible leg (mobile/residential upstream), and it is the leg that
scales with debate size on every keystroke-triggered autosave.

## Design

### Payload: `DebateDelta`

A delta carries only what changed since the client's last successful save, plus the
version it was computed against:

```typescript
interface DebateDelta {
  debateId: string;
  baseVersion: number;          // _saveVersion the client last synced to
  newTranscriptEntries: TranscriptEntry[];   // append into transcript
  changedNodes: ArgumentNetworkNode[];       // upsert by id into argument_network.nodes
  changedEdges: ArgumentNetworkEdge[];       // upsert by id into argument_network.edges
  removedNodeIds?: string[];
  removedEdgeIds?: string[];
  newMutations: ANMutation[];                // append into argument_network.mutations
  meta?: Partial<DebateSessionMeta>;         // DebateSessionMeta = Pick<DebateSession,'title'|'updated_at'|'phase'>
}
```

> **Type names (corrected in t/1634 review):** the real types are
> `ArgumentNetworkNode` / `ArgumentNetworkEdge` (types.ts:971-1058), not
> `ArgumentNode` / `ArgumentEdge` (which do not exist); `DebateSessionMeta` is a
> `Pick<DebateSession, 'title' | 'updated_at' | 'phase'>` alias — there is **no
> `status` field**, `phase` is the progression enum. Merge targets the **nested**
> `argument_network` (types.ts:521-525), not root.

Append-mostly surfaces (`transcript`, `mutations`) send only the tail beyond
`baseVersion`. Mutable surfaces (`nodes`, `edges`) send changed-since-base by id
(upsert), with explicit removal lists for deletions.

> **OPEN — payload completeness (t/1634 review, being resolved with DebateTool):**
> A large set of `DebateSession` fields mutate **per turn** and are carried by
> *none* of the surfaces above — `convergence_tracker`, `qbaf_timeline`,
> `turn_embeddings`, `position_drift`, `per_claim_drift`, `extraction_summary`,
> `turn_validations`, `convergence_signals`, `process_rewards`, `commitments`,
> `moderator_state`, and others. If those change on the web autosave path, a delta
> that omits them either (a) silently staleness's them on the server (correctness
> bug, same class as the t/1637 snapshot-drop), or (b) forces a full-PUT fallback
> every save (feature never fires). Resolution options: force full-PUT whenever the
> diff touches anything outside {transcript-append, AN-upsert, scalar-meta}; or add
> a generic `changedFields?: Partial<DebateSession>` shallow-overlay so the payload
> stays extensible. Decision pending DebateTool's read of the per-turn write path;
> the `DebateDelta` shape above is **not frozen** until it lands.

### Optimistic Concurrency: `_saveVersion`

A monotonically increasing integer `_saveVersion` is stored **in the document**.

- Client tracks the version it last synced to.
- A delta declares `baseVersion`. The server accepts the delta **only if**
  `blob._saveVersion === delta.baseVersion`. On success it merges, increments
  `_saveVersion`, writes, and returns the new version.
- On mismatch (a concurrent write landed first) the server returns **409** with the
  current version. The client **falls back to a full PUT** of its whole session
  (which itself carries the freshly-read base), re-establishing a clean version.

This makes deltas safe against the same concurrent-write races the in-flight guard
already narrows, without silently clobbering.

### Merge Function (shared, pure)

`applyDebateDelta(fullSession, delta) → DebateSession` is a **pure function** in
`lib/debate` (DebateTool scope) so both the server merge step and any client-side
verification use one implementation. It:

- appends `newTranscriptEntries` / `newMutations`,
- upserts `changedNodes` / `changedEdges` by id,
- applies `removedNodeIds` / `removedEdgeIds`,
- shallow-merges `meta`,
- throws `ActionableError` on a base-version mismatch (caller maps to 409).

Shipping this as an Interface-First prerequisite ticket unblocks all three
consumers to build against the contract in parallel.

### Migration (lazy — no script)

No migration script. A blob with no `_saveVersion` is treated as version `0`. The
**first save of any session is always a full PUT**, which establishes
`_saveVersion`. Existing full-JSON debates therefore upgrade themselves on first
touch. Delta saves only ever fire on the second+ save of a session the client has
already synced.

### Electron stays full-save

The Electron local path (`atomicWriteSync` + `renameSyncWithRetry`, no network)
gets **no delta**. There is no upload leg to optimize, and the full-write is already
atomic. Delta is a **web-only** optimization. `saveDebateSession` (full) remains the
Electron bridge method; the new delta bridge method is web-only with a full-PUT
fallback baked in, so `@bridge` callers stay build-target-agnostic.

## Endpoint

New **`PATCH /api/debates/:id`** on ServerAPI, parallel to the existing
`PUT /api/debates`:

- Reuses the existing in-flight guard (`saveKey = "${userId}:${debateId}"`, 409 on
  concurrent in-flight save) — same guard the full PUT uses.
- Body is a `DebateDelta`. On `baseVersion` mismatch vs the stored blob → **409
  `version_conflict`** with `{ currentVersion }`; client falls back to full PUT.
- Reuses the slow-save diagnostic (`SLOW_DEBATE_SAVE_MS`) so we keep measuring.

## Component Impact & Ownership

| Layer | File(s) | Owner | Work |
|---|---|---|---|
| Shared types + merge | `lib/debate/types.ts`, new `lib/debate/applyDebateDelta.ts` | **DebateTool** | `DebateDelta`, `_saveVersion` on `DebateSession`, `ANMutation` reuse; pure `applyDebateDelta` + unit tests |
| Storage | `taxonomy-editor/src/server/storage/fileIO.ts` | **Server Storage** | version-aware read-merge-write: read blob, check `_saveVersion`, `applyDebateDelta`, bump version, write; 409 signal on mismatch |
| API | `taxonomy-editor/src/server/routes/debates.ts` | **ServerAPI** | `PATCH /api/debates/:id`: in-flight guard, delegate merge to storage, 409 on version conflict, slow-save diagnostic |
| Client | `sessionSlice.ts`, `bridge/{types,web-bridge,electron-bridge}.ts` | **Taxonomy Editor** | per-turn dirty tracking, version tracking, new delta bridge method (web), full-PUT fallback on 409, Electron unchanged |

## Ticket DAG

```
A (DebateTool: types + applyDebateDelta + tests)   [Interface-First prereq]
      │ blocks
      ├──────────────► B (Server Storage: version-aware read-merge-write)
      │                      │ blocks
      │                      ▼
      │                C (ServerAPI: PATCH /api/debates/:id)
      │                      │ blocks
      └───────────────┬──────┘
                      ▼
             D (Taxonomy Editor: dirty tracking + delta bridge + fallback)
```

- **A → B → C → D** is the critical path (client needs the endpoint C to call, and
  the shared types A).
- A also directly unblocks D's type work (the client codes against `DebateDelta`),
  so D can start its dirty-tracking/type scaffolding as soon as A lands, but its
  integration test needs C.

## Non-Goals

- Reducing server-side write time or Azure storage cost (blob has no partial write).
- Delta for the Electron local save path (no upload leg).
- Streaming / incremental *read* (this is save-only).
- Compaction of `argument_network` history (`mutations` growth is t/673's concern).

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Delta silently clobbers a concurrent write | `_saveVersion` optimistic concurrency → 409 → full-PUT fallback |
| Client and server merge logic diverge | Single shared pure `applyDebateDelta` in `lib/debate` |
| A delta computed against a stale base corrupts the doc | Server rejects any `baseVersion ≠ stored version`; never best-effort merges |
| Existing full-JSON debates lack a version | Lazy: absent `_saveVersion` = 0; first save always full PUT |
| Web/Electron behavioral drift | Delta is web-only; `@bridge` contract keeps callers agnostic; Electron keeps full save |
