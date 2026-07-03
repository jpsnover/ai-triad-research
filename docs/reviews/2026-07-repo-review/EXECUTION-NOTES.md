# Execution Notes — Sequencing the Repo-Review Backlog

**Date:** 2026-07-02 · **Companion to:** BACKLOG.md

## Recommended order

### Phase 1 (target: one focused week of agent time)

Run in this order — each item makes the next cheaper:

1. **B-106** (purge on-disk weight) — first, because every subsequent agent search across the repo gets faster immediately, including the searches the other Phase-1 items need. 30 minutes.
2. **B-101** (REPO_MAP fix) — second, because B-105's orphan re-checks and all later discovery use the map.
3. **B-102 + B-103 + B-108-doc-half** — batch into **one documentation session** (same evidence base, same verification style; B-103 and the tech-lead AGENTS.md fix are both ogit commits — do them together to amortize the overlay procedure).
4. **B-105** (archive sweep) — after docs are true, so nothing archived is still referenced by a just-corrected doc.
5. **B-104** (research/management data move) — the heaviest item; schedule when the Computational Linguist role is idle (their scripts get path updates). **Do NOT bundle a history rewrite into this** — see human-review section.
6. **B-107** (AGENTS.md orientation upgrade) — last in phase, so it can link the now-accurate artifacts.

### Phase 1 → 2 checkpoint (required)

Before starting Phase 2, re-measure the velocity indicators and record them in this directory as `CHECKPOINT-1.md`:

| Indicator | Baseline (2026-07-02) | Target |
|---|---|---|
| Orientation trace (same benchmark task: "add a field to POV summary schema and propagate") | 12 steps / 4 doc-led / ~1,300 lines read | ≤6 steps / 0 dead-ends / ≤500 lines |
| Git pack size | 200 MB | ≤90 MB (without history rewrite: tracked-size delta only shows on fresh objects — measure `git ls-files` total instead: 275 MB → <15 MB) |
| Tracked file count | 2,203 | ~1,950 |
| REPO_MAP coverage | 144 files / truncated | full, no marker |
| On-disk repo weight (excl. node_modules, .git) | ~800 MB | ≤250 MB |

If the orientation trace doesn't improve materially, revisit VELOCITY-DIAGNOSIS mechanism ranking (monoliths may dominate more than assessed) and pull B-209/B-210 forward.

### Phase 2 (2–3 weeks, parallelizable across agents)

- **Decision first:** B-206 (app-consolidation HLD) and B-213 (prompt-system ADR) are *decision* items — start both immediately; their outcomes gate B-204/B-205/B-402 (moot-if-consolidated) and the prompt migration scope. Do not start B-204/B-205 until B-206 is decided, or you risk deduplicating apps that are about to be absorbed.
- **Parallel track A (shared metadata/utils):** B-201 → B-202 → B-203 → B-212. Single-owner track (Shared Lib agent) — these all touch lib/ and its consumers; serializing them avoids rebase churn.
- **Parallel track B (server):** B-408 (gates, do it now — it's Phase 4 numbered but should land before any monolith surgery) → B-209 (route extraction). ServerAPI agent.
- **Parallel track C (config):** B-207 → B-208. Any senior agent.
- **B-210 (debateEngine) and B-211 (styles.css) last** — they benefit from B-408's ratchets being in place and from tracks A/B settling the shared surfaces first.

### Phase 3 (1–2 weeks)

- **B-301 Stage 1 (neutralize `normalizeNodeId`) should actually be executed during Phase 1** — it's a 30-minute defusal of a data-corruption hazard; don't wait for its phase.
- Then B-302 → B-303 → B-304 (strict dependency chain: conflict schema → edges schema → enforcement wiring). B-305 rides with B-302's schema file. B-306/B-307 are independent fillers for any idle slot.
- B-304's report-only period should span at least one week of normal work before B-404 flips it to enforcing.

### Phase 4 (ongoing)

- B-408 already landed (pulled into Phase 2). B-403 (doc-accuracy CI) lands immediately after Phase 1's checkpoint so the recovered accuracy is locked before it can rot. B-401's triage can run as a background task any time; the burn-down batches well as sonnet sessions of ~50 catches each. B-405/B-407 are ideal "small idle-agent" tickets. B-406 whenever the PowerShell agent has a free session. B-402 waits on B-206.

## Batching guidance (single-session bundles)

| Bundle | Items | Rationale |
|---|---|---|
| Docs-truth session | B-102, B-103, B-108(doc), B-405(registry half) | Same verification style, two ogit commits amortized |
| Junk-purge session | B-106, B-105(steps 4–5), B-301 Stage 1 | All deletion/move + one code defusal, single verify run |
| Schema session | B-302 + B-305 | Same file (`conflict.schema.json`), one review |
| PS hygiene session | B-407 + B-406(first alias batch) + B-307(item 4) | One module import/test cycle |
| Small-fix session | B-207, B-307(items 1–3) | Trivial closed-list edits, one verify |

## Items requiring human review before merge (regardless of executor)

1. **B-104** — and separately, the optional **history rewrite** to reclaim the 200 MB pack: this breaks every clone and all agents' local repos; if desired, schedule as a coordinated event (all agents idle, reclone after). Recommendation: skip the rewrite for now; the `git ls-files` weight is what taxes day-to-day work, and that's fixed without rewriting.
2. **B-206** — one-way-door on app architecture; needs an ADR and owner sign-off.
3. **B-210** — debateEngine surgery; behavioral-equivalence evidence (`Compare-DebateRuns`, evals) must be human-inspected, not just green-checked.
4. **B-301 Stage 2** — schema-pattern decision legitimizing `cc-*`; owner should confirm the two-prefix provenance story before it's enshrined.
5. **B-201(a)** — canonical POV colors: a human should eyeball which palette is intended; this is a product decision wearing a refactor costume.
6. **Anything touching `ADMIN_USERS`, auth, or deploy workflows** if encountered incidentally — standing rule, not expected in this backlog.

## Executor notes

- The sonnet-safe items (B-101, B-102, B-103, B-105, B-106, B-202, B-207, B-307, B-404, B-405, B-407, B-408, plus the migration halves of B-201/B-211/B-401) have closed file lists and mechanical verification as specified in BACKLOG.md — they can run as low-cost parallel sessions. If any sonnet session hits an ambiguity not covered by its Change field, the standing instruction is **stop and route back**, not improvise.
- fable-required items concentrate in Phase 2/3; budget roughly: B-206 HLD one session, B-209 two sessions, B-210 three sessions, B-304 two sessions.
- Multi-agent ownership per the Orca scope map: lib items → Shared Lib/DebateTool; server items → ServerAPI; PS items → PowerShell; schema/data items → coordinate TL + PowerShell + Taxonomy Editor; doc items → TL (this role) with ogit for overlay files.

## Standing risks during execution

- **Merge contention on the monoliths is itself the top finding** — while B-209/B-210 are in flight, freeze feature work on server.ts/debateEngine.ts or sequence it behind the extraction PRs. The multi-agent amend/pathspec rules (ADR-005) apply doubly here.
- The data repo (`ai-triad-data`) gains new directories (`research-artifacts/`, more `debates/`) — tell the data-repo consumers (CI summarization workflow, `.aitriad.json` readers) via the PM before B-104/B-106 land.
- After B-105, watch one week for "file not found" reports from any agent whose undocumented workflow referenced an archived script — the archive move (not delete) makes recovery a `git mv` back.
