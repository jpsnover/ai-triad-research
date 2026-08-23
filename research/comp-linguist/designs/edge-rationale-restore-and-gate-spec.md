# Edge-Rationale Restore + Regression-Gate Spec

**Last updated:** 2026-08-23
**Ticket:** t/2444 · **Author:** CL.Investigate1 · **Requested by:** Main (CL) (e/119)
**Status:** artifacts ready + verified; restore is a data-repo write (out of CL scope) and gate
is a CI/pipeline gate (routes to Main (TL)) — both handed off, neither self-applied.

## Why this supersedes the "prompt never asked" root cause

`designs/edge-rationale-remediation-plan.md` diagnosed the missing rationales as an *origin gap*
("created before the rationale-required prompt landed"). Git history in `../ai-triad-data`
(`taxonomy/Origin/edges.json`) refutes that: the rationales existed and were **destroyed by the
`workflow-app` data pipeline**, twice.

| date | commit | edges w/ rationale | event |
|------|--------|--------------------|-------|
| 2026-07-24 | `ba3128f5` | **33,448 / 33,454** (incl. 25,759 approved) | last good state |
| 2026-08-08 | `904feb92` | 165 | **WIPE #1** — pipeline full-tree add drops the field |
| 2026-08-15 | `b5a76c8e` | 2,440 | t/2679 backfilled 2,275 approved rationales |
| 2026-08-20 | `9d019c9e` | 2 | **WIPE #2** — same pipeline destroys the backfill |

The 2026-08-11 remediation plan scanned the **post-wipe-#1** state (165) and mistook the symptom
for the origin. The serializer (`lib/edges/serializeEdges.ts` / `Write-EdgesFile.ps1`) is not at
fault — it preserves every field per edge. The drop is upstream, in the edge *rebuild*.

**Bug site (traced by TL, e/120#5):** the `workflow-app` "edges" step is a thin shell-out —
`pipeline.ts:289` → **`scripts/AITriad/Public/Invoke-EdgeDiscovery.ps1`** (PowerShell-owned,
in-repo; the app is just the trigger). On a full-tree run it re-proposes edges and writes them
**without carrying forward the existing `rationale`** for edges that already had one, then
persists via `Write-EdgesFile` (L723/746). So the destroyer *does* route through the shared
serializer — which is what makes the write-boundary regression assertion the primary catch (Part
B). This writer was never in the remediation plan's inventory (§1a).

**Consequence:** the fix is not LLM backfill of 33k edges. It is (A) **git-restore** of the
original discovery-time text + (B) a **regression gate** that catches the drop + a pipeline fix
(pipeline is DevOps-owned; see §Handoff).

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
**Do not restore until the pipeline destroyer is fixed.** Both prior wipes prove the field is
destroyed on the next full-tree pipeline run; t/2679's backfill died in 5 days. Restore *after*
the upstream edge-build fix lands, then let the regression gate (Part B) hold the line.

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

### Placement (two non-redundant arms — coverage confirmed by TL's trace, e/120#5)
Both arms are wanted; they cover different writer populations. The bug-site trace (above) settles
which arm catches *this* incident vs. the *class*:

1. **Write-EdgesFile serializer assertion — PRIMARY (catches this incident).** A per-edge
   regression check at the shared sink (`Write-EdgesFile.ps1` / `serializeEdgesJson`): throw if a
   write drops `rationale` from an edge that had it on disk (composite-keyed vs the current
   `edges.json`). Because `Invoke-EdgeDiscovery` — the actual destroyer — writes **through**
   `Write-EdgesFile` (L723/746), this arm catches the exact wipe, and every other in-repo edge
   writer at the sink (same centralize-at-the-sink pattern as the t/2902 dirty-tree guard).
   **PowerShell owns**; wire with TL two-arm GV. (§2a's serializer assertion, but *regression*-
   scoped, not *new-edge*-scoped.)
2. **CI diff-gate — DEFENSE-IN-DEPTH (catches the future class, not this incident).** Committed
   `edges.json` base→HEAD (wired like `npm run verify:config`): fail on any per-edge rationale
   regression. Covers any path that ever **bypasses** `Write-EdgesFile` — a future direct writer,
   a manual edit, a raw file replacement. TL designs/routes this arm.

**Coverage story (corrected — inverts the e/120#4 framing):** serializer arm = *this* incident
(primary), CI-gate = *future bypass* (defense-in-depth). Stated explicitly so the serializer arm
is not undersold: it is the load-bearing catch here precisely because the pipeline is **not**
external to the serializer.

### Two-arm verification (required before it can block prod)
Per the prevention-per-incident / gate-signal-integrity rules, prove **both arms**:
- **Failing arm:** a deliberately-regressed edge (strip rationale from one previously-bearing
  edge) makes the gate exit non-zero, naming the regressed edge(s).
- **Clean arm:** the current→restored diff (which only *adds* rationale) passes with zero noise;
  an unrelated edge edit that touches no rationale passes silently.
- **Reliability:** deterministic, no network, fast enough to block — a flaky blocking gate is the
  next incident.
- Config co-located at point of use.

### Ownership / routing
- The **gate** touches CI/pipeline routes → **Main (TL)** for Gate Verification.
- The **serializer assertion** in `lib/edges/` / `scripts/AITriad/` is Shared-Lib / PowerShell
  scope — CL specifies, they implement.
- The **`workflow-app` pipeline edge-build fix** (the actual destroyer) is **outside CL scope** —
  DevOps / pipeline owner (resolve via `resolve_owner`). CL provides the evidence; restoring data
  without this fix resets the clock.

## Handoff checklist
- [ ] Pipeline owner: audit + fix `workflow-app` edge-build so it preserves `rationale`.
- [ ] TL: Gate Verification (two-arm) for the CI regression gate.
- [ ] Shared-Lib / PS: regression assertion in the shared serializers.
- [ ] Data owner: run `apply_restore.py`, land the restored `edges.json` (**after** the pipeline fix).
- [ ] CL (Main): correct `edge-rationale-remediation-plan.md`; decide LLM/templated backfill for
      the 179 gap edges; reframe PR #1426 (harness now screens *restored* rationales).
