# Repository Review — Checkpoint 2: Phase 2 Exit

**Date:** 2026-07-06 · **Author:** Technical Lead · **Companion to:** BACKLOG.md, CHECKPOINT-1.md
**Trigger:** t/1295 (B-209, the last Phase-2 structural item) closed 2026-07-06.

## Monolith measurements (review baseline → Phase-2 exit)

| File | Baseline (FINDINGS) | Now | Δ | Ceiling |
|---|---:|---:|---:|---:|
| `taxonomy-editor/src/server/server.ts` | 4,938 | **3,595** | −27% | 3,620 |
| `lib/debate/debateEngine.ts` | 6,046 | **4,003** | −34% | 4,028 |
| `taxonomy-editor/src/renderer/styles.css` | 18,605 | **17,754** | −5% (frozen + top-churn migrated) | 17,800 |
| `useDebateStore/helpers.ts` | 2,642 | **0 (deleted)** | −100% | — |
| `useDebateStore/slices/debateLoopSlice.ts` | 2,231 | **279** | −87% | — |

New cohesive modules created by the extractions (all with documented, disjoint responsibility surfaces): `topicPipeline.ts` (507), `claimExtractionPipeline.ts` (1,538), `synthesisPipeline.ts` (508); `routes/admin.ts` (803), `routes/sync.ts` (537), `routes/debates.ts` (142); 8 `useDebateStore/shared/` leaf modules + 2 new slices.

Note: `claimExtractionPipeline.ts` (1,538) exceeds the store-file 1,500 informal bar by 38 lines; it is a lib collaborator, not a store file, and sits under the large-file guard. Watch, don't act.

## Duplication (F-011/F-013 axis)

- POV labels/colors: **one definition** (`lib/electron-shared/povMeta.ts`) across 3 apps + lib (t/1293/1304/1305).
- cosineSimilarity: 12 definitions → 1 TS export (t/1294).
- lib↔TE vendored forks: 428 clone lines → ~236 removed via t/1301 (19 types unified, 3 functions deduped); embedding-resolver residue tracked as t/1331.
- SV forked main-process modules: extracted to `lib/electron-shared` (t/1296/1326); AI clients replaced by `lib/ai-client` (t/1327, pending GUI smoke via ElectronMain).
- Prompt text forks: deleted; fragment-sharing live (t/1297/1334). Known new cross-runtime pair: `qualityScore.ts` ↔ `Measure-DebateQuality` — parity guard tracked (t/1344).

## Repo weight

Tracked files: 2,203 · pack size: 107.2 MiB (post Phase-1 relocations; further history rewrite remains an explicitly deferred owner decision per EXECUTION-NOTES).

## Phase-2 item ledger (B-2xx: 13/13 resolved)

B-201 ✓ · B-202 ✓ · B-203 ✓ (Phase 3 → t/1331) · B-204 ✓ · B-205 ✓ · B-206 ✓ (Option B ADR'd) · B-207 ✓ (last crumb in t/1325) · B-208 ✓ · B-209 ✓ (<3,000 continues as t/1347, LOW) · B-210 ✓ · B-211 ✓ · B-212 ✓ · B-213 ✓ (ADR-006).

## Growth controls now standing

`quality-gates.json` ceilings ratcheted to landed+25 on all extracted monoliths (server.ts ratchet applied in this checkpoint commit — missed in t/1295 close-out); large-file guard; styles.css non-increase; routes-rule and store-slice rules in slice docs; flip/never-flip taxonomy in ci.yml header.

## Process assets forged during Phase 2 (not planned, earned)

Worktree Landing Procedure (AGENTS.md + `/land-from-worktree`), Deviation Flagging Rule (AGENTS.md + Done-hook), git-object-level committed-state standard, route-table invariant checker (permanent), per-cluster equivalence-test standard, deviation-ledger close-out format. Sage ledger #44–#54 records the failures that produced them.
