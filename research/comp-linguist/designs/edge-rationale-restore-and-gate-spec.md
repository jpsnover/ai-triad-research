# Edge-Rationale Restore + Regression-Gate Spec

**Last updated:** 2026-08-23
**Ticket:** t/2444 · **Author:** CL.Investigate1 · **Requested by:** Main (CL) (e/119)
**Status:** mechanism + drop site **empirically pinned** (thread e/120, converged across CL, PS,
TL). Restore tooling landed (PR #1428); this doc now carries the **final** root cause and the
**three-arm** gate coverage map. Restore is a data-repo write; the fix + guards land in
taxonomy-editor (ownerless — PI owner decision pending); gate GV is Main (TL).

## Why this supersedes the "prompt never asked" root cause

`designs/edge-rationale-remediation-plan.md` diagnosed the missing rationales as an *origin gap*
("created before the rationale-required prompt landed"). Git history in `../ai-triad-data`
(`taxonomy/Origin/edges.json`) refutes that: the rationales existed and were **destroyed by a
rationale-only field strip**, twice — captured by a `workflow-app` full-tree `git add`.

| date | commit | edges w/ rationale | event |
|------|--------|--------------------|-------|
| 2026-07-24 | `ba3128f5` | **33,448 / 33,454** (incl. 25,759 approved) | last good state |
| 2026-08-08 | `904feb92` | 165 | **WIPE #1** — rationale stripped from ~33k edges; +167 new appended |
| 2026-08-15 | `b5a76c8e` | 2,440 | t/2679 backfilled 2,275 approved rationales |
| 2026-08-20 | `9d019c9e` | 2 | **WIPE #2** — same strip destroys the backfill |

The 2026-08-11 remediation plan scanned the **post-wipe-#1** state (165) and mistook the symptom
for the origin.

**Mechanism (forensically locked, e/120#13/#14, converged):** the wipe is a **surgical
`rationale`-only field projection of preserved edges** — 100% of edge keys survive, every other
field (`confidence`/`status`/`discovered_at`/`model`/`weight`/`strength`) **byte-identical**, only
`rationale` removed; new edges appended. Byte-identical non-rationale fields **falsify** both a
re-propose-from-nodes (that would perturb timestamps/models) and a lossy reformat. It is an
**explicit property projection missing `rationale`, persisted by a whole-file save.**

**Drop site (named, e/120#20, code-verified by TL e/120#24) — taxonomy-editor, NOT the PS
pipeline.** The PS cmdlet `Invoke-EdgeDiscovery` is *append-preserve* in all four modes (seed adds
whole objects, L310-313; verified at wipe-era `3cfbbbc1`), and no PS/Python pipeline step strips
`rationale`. The projection is a **list-endpoint strip round-tripped through a whole-file save**,
on two surfaces:
- **Desktop (Electron IPC):** `taxonomy-editor/src/main/ipc/taxonomyHandlers.ts` — `load-edges`
  (L265) returns `edges.map(({ rationale, ...rest }) => rest)` (strips for payload size; the full
  rationale is lazy-loaded per-edge via `load-edge-detail`); `save-edges` (L379-414) persists the
  **entire caller-supplied array** via the **TS** `writeEdgesFile`, guarding only body *shape*.
  Load list (stripped) → append a new edge → save whole file ⇒ rationale wiped from all existing
  edges, `...rest` preserving every other field. Comment ties it to "the new-edge path
  (t/1816/t/1822)."
- **Server (web twin):** `taxonomy-editor/src/server/community/edgesApi.ts:18-22` — identical
  strip (its own doc comment states the invariant it violates: "on-disk file keep full data");
  served by `GET /api/edges`, whole-file save via `PUT /api/edges`.

The "`workflow-app` pipeline" attribution was the full-tree `git add` **capturing** an
editor/server whole-file save — not the pipeline edge-build. Both surfaces write through the **TS**
serializer (`lib/edges/serializeEdges.ts`), *not* the PS `Write-EdgesFile.ps1` — load-bearing for
the gate placement (Part B).

**Consequence:** the fix is not LLM backfill of 33k edges. It is (A) **git-restore** of the
original discovery-time text (PR #1428 tool); (B) a **site fix** — a shared re-merge helper so the
whole-file saves never persist a stripped payload; and (C) a **three-arm regression gate** (Part
B). Restore sequences **behind the site fix / TS write-guard**, not behind the PS arm.

## Part A — Restore procedure

### Edge identity: composite, not `id`
Edges carry **no `id` field**. Identity is the composite **`(source, target, type)`**. The
"id-keyed restore" requested in e/119 is therefore **composite-keyed**. (Empirically verified:
0/33,580 current and 0/33,454 old edges have an `id`.)

### Coverage (measured against the live file, 2026-08-20 state)

| bucket | count |
|--------|-------|
| current edges | 33,580 |
| already carry rationale (untouched) | 2 (both `debate-reflection`) |
| **restorable from `ba3128f5` by composite key** | **33,399** (approved 25,710; conf ≥0.75 → 27,608) |
| no source in `ba3128f5` — genuine generation gap | 179 |
| **result after restore** | **33,401 / 33,580 (99.5%)** carry rationale |

The 179 gap edges were created *after* the Jul-24 snapshot: 173 discovered 2026-08, 6 in 2026-03
(re-keyed since). By model: `gemini-3.5-flash-lite` 119, `gemini-2.5-flash` 50, `debate-reflection`
10. These — and *only* these — are the true "needs generation" cohort (LLM backfill or the
embedding-first templated rationale). The gap list is emitted as `gap_new_edges.json` by the
analysis run.

### Byte-safety (proven, not asserted)
The restore is a **minimal, reversible** edit:
- `rationale` is inserted **immediately after `confidence`**, matching its original placement.
- Every other key keeps its exact current position — the current file has **17 distinct per-edge
  key orderings** (weight / modulated_weight / strength / discovered_by vary); we never reorder.
- **Strip-back proof:** removing only the rationales we add and re-serializing reproduces the
  current file **byte-for-byte** (`STRIP-ADDED-ONLY == current blob: True`). The apply script
  runs this proof every invocation and **aborts, writing nothing,** if it fails.
- Output matches the compact hybrid contract of `serializeEdges.ts` (verified to round-trip the
  live file byte-for-byte: separators `,`/`:`, LF, single trailing newline).

### Tooling
`analyses/t2444-rationale-restore/apply_restore.py` — self-contained, self-verifying. Does **not**
commit; writes `<current>.restored` and prints the report above. Run:
```
git -C ../ai-triad-data show ba3128f5:taxonomy/Origin/edges.json > /tmp/edges_ba3128f5.json
python apply_restore.py --current ../ai-triad-data/taxonomy/Origin/edges.json --source /tmp/edges_ba3128f5.json
```

### Sequencing (load-bearing)
**Do not restore until the site fix (or the TS write-guard) lands.** Both prior wipes prove the
field is destroyed by the next whole-file editor/server save; t/2679's backfill died in 5 days.
Restore *after* the site fix (§Part B) removes the strip, with **Arm 2 (CI diff vs HEAD) as the
commit-time backstop**. **PS Arm 1 alone is not sufficient** — the site writes through the TS
serializer, not the PS `Write-EdgesFile`, so PS Arm 1 never fires on the actual add-edge-save
vector (see Part B coverage map).

## Part B — Regression / count-floor gate spec

**Requirement (e/119 ask #1):** the gate must fire when a write **drops `rationale` from edges
that previously had it** — a *regression*, not merely "a new edge lacks rationale." The
remediation plan's §2a gate ("new edge lacks rationale") would have caught **neither** wipe,
because the pipeline rewrites *all* edges and both wipes removed the field from pre-existing ones.

### Signal
Per-edge, keyed by composite `(source, target, type)`, comparing the **incoming** `edges.json`
against the **base** (committed) version:
```
regressed = { e : base[e].rationale is non-empty  AND  incoming[e].rationale is empty/absent }
```
Gate **fails** if `|regressed| > THRESHOLD`. Recommended `THRESHOLD = 0` (any rationale-bearing
edge losing its rationale is a defect). A count-floor variant — fail if
`count(rationale) < floor(base_count * (1 - tolerance))` — is a weaker backstop; prefer the
per-edge regression check as primary because it localizes *which* edges regressed for the failure
message.

### Site fix (the real root-cause fix — shared-utility, two consumers)
A pure composite-key re-merge helper in **`lib/edges`** (Shared Lib, existing owner):
`mergeEdgesPreservingRationale(incoming, onDisk)` — before any whole-file save, re-merge
`rationale` (and any other list-trimmed field) from the on-disk `edges.json` by
`(source, type, target)`, so a payload that originated from the stripped list endpoint never
persists the strip. **Call sites:** `save-edges` IPC + `PUT /api/edges` (taxonomy-editor,
ownerless). **Test both arms:** a save preserves on-disk `rationale` for existing edges (current
`edgesApi.test.ts` covers only read-strip *purity*, not save-preservation). Verify per t/2294:
add an edge in the UI / POST a new edge → confirm existing edges' `rationale` survives.

### Placement — three-arm coverage map (final, e/120#24; supersedes the e/120#4–#7 framing)
Two serializers exist by design (`serializeEdges.ts` for TS ↔ `Write-EdgesFile.ps1` for PS, kept
byte-identical so they "cannot drift"). The site writes through the **TS** path; the pipeline
re-emit would go through the **PS** path — so no single write-boundary arm covers everything.
All three use the same per-edge rule: *an edge rationaled in the HEAD/committed `edges.json` must
not be written rationale-less.*

1. **PS Arm 1 — `Write-EdgesFile.ps1`, baseline = HEAD.** Covers PS writers + any *pipeline
   re-emit* (`Invoke-EdgeDiscovery` append-preserves, so it re-surfaces an upstream-stripped set
   at its own write). **Not the site's guard** — it never runs on a direct editor/server save.
   PowerShell owns; **warn→throw** promotion (below).
2. **TS write-guard (Arm 1-TS) — `lib/edges` TS write path + server `PUT`, baseline = HEAD.** Same
   per-edge rule at the TS boundary. **This is the arm that actually gates the site** independent
   of the fix. Lands in taxonomy-editor (ownerless).
3. **Arm 2 — CI diff vs committed HEAD on `../ai-triad-data`.** Commit-time backstop; catches
   **any** writer including a direct editor/server save. **Co-primary / required, not deferrable**
   — it is the only arm that catches a save that bypasses both serializers. Home = DevOps if
   `ai-triad-data` has push CI (TL scoping).

**Restore-protection rule:** the restore is durable behind **the site fix OR Arm 1-TS**, with Arm 2
as the commit-time backstop — **not** behind PS Arm 1 alone.

### Gate Promotion — warn-first for any THROWING arm (t/2683)
A new blocking gate must not ship straight to throwing (t/2683: a gate promoted straight to
blocking failed on its own bug and downed both deploys). For each throwing arm:
- **Phase 1 — WARN:** emit a loud ActionableError-shaped warning ("would-block: N edges losing
  rationale vs HEAD"), do not throw. Ships now for observability.
- **Real-data clean-arm proof:** run the assertion with `ba3128f5`'s rationaled `edges.json` as
  both on-disk and HEAD, simulate an add-only delta → must pass with **zero** noise (real data,
  not a mock — proves no false-positive on a rationaled file).
- **Phase 2 — promote to THROW** only after that clean cycle.

### Two-arm GV (per arm, before promotion — Main (TL))
- **FIRE:** a write dropping `rationale` from an edge rationaled in HEAD → warns (Phase 1) / throws
  (Phase 2), naming the regressed edge(s).
- **CLEAN:** a normal add-only run → passes silently, zero pre-existing noise.
- **Reliability:** deterministic, no network, fast enough to block — a flaky blocking gate is the
  next incident. Config co-located at point of use.

### Ownership / routing
- **Site fix helper** (`mergeEdgesPreservingRationale`) → **Shared Lib** (`lib/edges`).
- **Call-site wiring + Arm 1-TS** (`save-edges` IPC, `PUT /api/edges`, TS write path) →
  **taxonomy-editor**, currently **ownerless** (`resolve_owner` = root/implicit) — PI owner
  decision pending (TL raising).
- **PS Arm 1** (`Write-EdgesFile.ps1`) → **PowerShell**.
- **Arm 2** (CI diff on `ai-triad-data`) → **DevOps** (if push CI exists).
- **Gate GV** (all arms) → **Main (TL)**. **Spec revision** → **CL** (this doc).

## Handoff checklist
- [ ] PI: resolve taxonomy-editor ownership (dedicated role vs assign vs TL-implements-once).
- [ ] Shared Lib: `mergeEdgesPreservingRationale(incoming, onDisk)` helper in `lib/edges` + tests.
- [ ] taxonomy-editor owner: wire the helper into `save-edges` IPC + `PUT /api/edges`; add the
      TS write-guard (Arm 1-TS); regression test that a save preserves on-disk `rationale`.
- [ ] PS: PS Arm 1 in `Write-EdgesFile.ps1` (warn→throw), HEAD baseline.
- [ ] DevOps: Arm 2 (CI diff vs HEAD) on `ai-triad-data`, if push CI exists.
- [ ] TL: two-arm GV per arm before any promotion to throw; `ba3128f5` clean-arm proof.
- [ ] Data owner: run `apply_restore.py`, land restored `edges.json` — **after** the site fix /
      Arm 1-TS lands (Arm 2 as backstop); **not** behind PS Arm 1 alone.
- [ ] CL (Main): correct `edge-rationale-remediation-plan.md`; decide LLM/templated backfill for
      the 179 gap edges (t/2946 Phase 2); reframe PR #1426 (harness screens *restored* rationales).
