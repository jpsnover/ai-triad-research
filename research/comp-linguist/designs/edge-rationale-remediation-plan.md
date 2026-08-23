# Edge Rationale Coverage: Exploration and Remediation Plan

**Last updated:** 2026-08-23
**Ticket:** t/2444 (PI-requested) · **Status:** ⚠️ **root cause CORRECTED 2026-08-23 — see banner below; the backfill plan is superseded by a git-restore.**

> ## ⚠️ CORRECTION (2026-08-23): root cause was misdiagnosed — this is recoverable data loss, not an origin gap
>
> The Summary and Deliverable 1 below (written 2026-08-11) concluded the ~33k edges "never had"
> a rationale — "created before the rationale-required prompt landed." **The git history of
> `../ai-triad-data` refutes this** (traced by CL.Investigate1, e/119; empirically reproduced by Main):
>
> | commit | date | edges w/ non-empty rationale |
> |---|---|---|
> | `ba3128f5` | 2026-07-24 | **33,448 / 33,454** (incl. **25,759 / 25,765 approved**) |
> | `904feb92` | 2026-08-08 | 165 ← **WIPE #1** (workflow-app v1.0.0 "automated data pipeline update", full-tree rebuild drops the field) |
> | `b5a76c8e` | 2026-08-15 | 2,440 ← t/2679 LLM backfill adds ~2,275 approved |
> | `9d019c9e` | 2026-08-20 | **2** ← **WIPE #2** (same pipeline destroys the backfill) |
>
> Every one of the ~33k edges **carried a discovery-time rationale from May through 07-24**; two
> destructive writes by the workflow-app data pipeline wiped them. The 08-11 scan below read the
> post-wipe-#1 state (165) and mistook a symptom for an origin gap. **t/2679's backfill is void**
> (wiped 5 days later).
>
> **Verified mechanism (git forensics, ../ai-triad-data):** the wipe is a **field-strip of preserved
> edges, not a set-regenerate.** At wipe #1 (`904feb92`, one commit after `ba3128f5`): **100% of the
> 33,451 pre-wipe edge keys survive** (removed 0, added 167), and **all 33,445 rationaled edges kept
> their composite key but lost the `rationale` field** — and edge-by-edge, **every non-`rationale`
> field is byte-identical pre→post** (confidence, status, discovered_at, model, weight, strength). That
> fingerprint (drop exactly one field, carry the rest byte-for-byte) is a `({ rationale, ...rest })`
> object spread, not a rewrite.
>
> **CONFIRMED site (CL.Investigate1 #20; PS #21 cleared the alternatives) — it is NOT the pipeline.**
> The `Invoke-EdgeDiscovery` cmdlet is append-preserve in all four modes, `embed_taxonomy.py` skips
> edges.json, and no PS pipeline step projects the field. The strip is the **taxonomy-editor
> load-list/save-whole-file round-trip**:
> - **Desktop** — `taxonomy-editor/src/main/ipc/taxonomyHandlers.ts`: `load-edges` returns
>   `edges.map(({ rationale, ...rest }) => rest)` (strips rationale for the list payload — an intentional
>   lazy-load optimization, see §1c below), and `save-edges` writes the **entire** caller-supplied array
>   via `writeEdgesFile`, guarding body shape only, not field completeness. Load list → append one edge →
>   save whole file = rationale wiped from every existing edge, other fields intact, +new edges appended.
>   Exactly the observed shape (+167 new, 33k stripped).
> - **Server twin** — `src/server/community/edgesApi.ts` (same strip) + `PUT /api/edges` (whole-file save).
> The `Tool: workflow-app v1.0.0` attribution was a full-tree `git add` **capturing** an editor/server
> save, not the pipeline writing it.
>
> **Revised fix (supersedes Deliverable 2):**
> 1. **Restore, don't backfill.** git-restore the original discovery-time rationales from
>    `ba3128f5:taxonomy/Origin/edges.json` by **composite key `(source,target,type)`** (edges carry no
>    id) — original quality, near-zero cost. 33,399/33,580 restorable (99.5%); byte-safety proven by
>    `analyses/t2444-rationale-restore/apply_restore.py`. Beats an LLM reconstruction on both axes. (t/2946)
> 2. **Fix the destroyer.** The whole-file save paths (`save-edges` IPC + `PUT /api/edges`) must
>    **re-merge `rationale` (and any list-trimmed field) from the on-disk edges.json by composite key
>    before writing** — never persist a payload that came from the rationale-stripped list endpoint.
>    Keep the read-side strip (it's an intentional payload-size optimization; §1c). Add a save-preserves-
>    on-disk-rationale test (both arms). Site = `taxonomy-editor` (desktop + server), which resolves to
>    **root/ownerless** — TL dispatches, PI assigns an owner (t/2945).
> 3. **Regression gate — two serializers, so coverage must span both** (per-edge rule everywhere: fail a
>    write that drops `rationale` from an edge rationaled in HEAD; baseline = **committed HEAD**, not
>    on-disk). Coverage map (CL.Investigate1's spec owns the detail; TL GVs under t/2945):
>    - **PS writers** (`Write-EdgesFile.ps1`: Invoke-EdgeDiscovery + other PS edge cmdlets) → **Arm 1**
>      (warn-first, then throw — Gate Promotion, t/2683). Catches a *pipeline re-emit*, **not** the editor
>      save — the editor/server write through the **TS** serializer (`lib/edges/serializeEdges.ts`), which
>      never routes through PS `Write-EdgesFile`.
>    - **Editor + server saves** (the actual site) → the **site fix** itself (re-merge), and/or a
>      **TS-side write-boundary guard** mirroring Arm 1, and/or **Arm 2** (CI diff vs committed HEAD on
>      ai-triad-data). Arm 2 is genuinely co-primary — the only currently-planned arm that catches a direct
>      editor/server save.
> 4. **Sequencing (durability — the t/2679 lesson).** The restore (t/2946) must sequence **behind the
>    site fix (or a TS-side write guard), with Arm 2 as the commit-time backstop** — **not** behind PS
>    Arm 1 alone, which does not execute on an editor add-edge save (the exact original trigger). Marker
>    (t/2943/t/2944) follows. Nothing restored until an editor save can no longer silently re-wipe it.
>
> Everything below 2026-08-11 is retained as the (superseded) exploration record.

## Summary

Taxonomy edges should record *why* they exist. Almost none do. A full scan of
`ai-triad-data/taxonomy/Origin/edges.json` confirms the PI pre-scan: **165 of 33,621 edges
(0.49%) carry a non-empty `rationale`.** The root cause is not a write-time bug. Every current
writer emits and persists rationale; the ~33.4k edges without one were created *before* the
rationale-required prompt landed (2026-08). One writer path (embedding-first) has no LLM step
and so emits no rationale even now. This document inventories the writers, profiles the gap
against real data, and lays out prospective (stop the bleeding) and retrospective (backfill)
options with cost.

## Deliverable 1: Root-cause exploration

### 1a. Writer inventory

Every path that writes `edges.json`, and whether it generates and persists `rationale`. All
edge writes funnel through one serializer per language (`serializeEdgesJson`,
`lib/edges/serializeEdges.ts`; `Write-EdgesFile`, `scripts/AITriad/Private/Write-EdgesFile.ps1`),
guarded by `lib/edges/edgesWriterGuard.test.ts` (t/1960).

| Writer | Path | Generates rationale? | Persists? |
|--------|------|----------------------|-----------|
| Discovery, per-node | `Invoke-EdgeDiscovery.ps1` L1249-1265 | Yes (LLM, required in schema L433) | Yes (L1255) |
| Discovery, batch | `Invoke-EdgeDiscovery.ps1` L920-936 | Yes (LLM, required L773) | Yes (L926) |
| Discovery, embedding-first | `Invoke-EdgeDiscovery.ps1` L679-692 | **No** (similarity-only, no LLM classification) | Field written but empty (L686) |
| Debate reflection | `debateReflectionSlice.ts` L884-898 | Yes (from reflection proposal) | Yes (L893) |
| Field mutator | `Set-Edge.ps1` | No (does not touch rationale) | Preserves existing on round-trip |
| Lifecycle | `Approve-Edge.ps1` | No (status only; displays rationale L110) | Preserves existing |
| Server routes | `server/routes/edges.ts` → `storage/fileIO.ts` | No (status/whole-file) | Preserves existing |

**Root-cause classification (per the TL "prompt never asked" vs "generated but dropped"
distinction):** the missing-rationale cohorts are **"prompt never asked."** The LLM discovery
schemas *require* rationale today, and it is persisted at the write site. No writer generates a
rationale and then drops it. The one true gap in current code is **embedding-first discovery**,
which has no LLM classification step to produce a rationale at all.

### 1b. Cohort profile (real data, full scan of 33,621 edges)

The clean discriminator is **`discovered_at` era, not `model`.** The name `gemini-2.5-flash`
appears in both the pre-rationale bulk (23k, 2026-03/05) and the recent rationale-bearing set
(44, 2026-08), so model alone does not separate cohorts.

**By era:** every rationale-bearing edge was discovered in 2026-08.

| `discovered_at` month | edges | with rationale |
|-----------------------|-------|----------------|
| 2026-05 | 14,769 | 0 |
| 2026-03 | 11,526 | 0 |
| 2026-06 | 3,566 | 0 |
| 2026-04 | 1,886 | 0 |
| 2026-07 | 1,707 | 0 |
| 2026-08 | 167 | 165 |

**By status:** all 165 rationale-bearing edges are `proposed`. **Zero of the 25,765 approved
edges have a rationale.** The reviewed, load-bearing edges are the ones missing it.

| status | edges | with rationale |
|--------|-------|----------------|
| approved | 25,765 | 0 |
| proposed | 7,856 | 165 |

**By writer/model:** the 165 break down as gemini-3.5-flash-lite 119, gemini-2.5-flash 44,
debate-reflection 2 (all 2026-08). The rationale-less bulk is gemini-2.5-flash 23,225,
embedding-first 3,761, gemini-3.1-flash-lite 3,683, claude-sonnet-4-5 1,938, t1142-recovery 528.

Related field coverage is also uneven (context for the broader consistency story, t/2425 drift
class): `weight` present on 18,241 (54%), `modulated_weight` 9,852 (29%), `strength` 19,724
(59%), `notes` 10, `model` missing on 3,782 (the embedding-first plus 21 unattributed).

### 1c. Consumer check (what would use rationale)

- **Edge Detail panel** (`EdgeDetailPanel.tsx`, `useEdgeRationale` L34-115) displays the
  rationale, lazy-loaded because the list API strips it for payload size. This is the primary
  consumer and the reason the field is user-visible at all.
- **Review workflow** (`Approve-Edge.ps1` L110) prints the rationale to the human approving an
  edge. A rationale would most improve *review throughput and quality*, which points at the
  approved and to-be-approved cohorts as the highest-value backfill target.
- No runtime debate-grounding path reads `rationale` today (edges feed the snapshot, but the
  live QBAF is built from debate claims, not edge rationale text). So the value case is
  human-facing (browse and review), not model-facing, which bounds how much backfill is worth.

## Deliverable 2: Remediation plan

### 2a. Prospective: make every new edge carry a rationale

The discovery LLM schemas already require rationale, so the prospective gap is narrow but real:
(1) embedding-first has no rationale source, and (2) nothing *enforces* the invariant at the
write boundary, so a future writer can regress silently (the t/2425 multiple-generators drift
class). Plan a **validation gate, not a memo:**

1. **Serializer-level assertion.** Add an optional strict check in the shared writers
   (`serializeEdgesJson` / `Write-EdgesFile`) that flags a *newly added* edge lacking a
   non-empty rationale. Scoped to new edges so it never trips on the legacy backlog.
2. **CI gate.** A schema check on changed `edges.json` proposed edges, wired the way the other
   registry-completeness gates are (`npm run verify:config` pattern), proven with both arms (a
   deliberately rationale-less new edge fails; the clean case passes silently). Routes to Main
   (TL) for Gate Verification per the prevention-per-incident rule.
3. **Embedding-first fix.** Give the similarity path a rationale source: either a lightweight
   templated rationale ("proposed by embedding similarity: cosine 0.NN between <source> and
   <target>") or a cheap LLM classification pass on just the embedding-first candidates. This
   is an implementation ticket, out of scope here; flagged for sequencing.

### 2b. Retrospective: backfill the ~33.4k rationale-less edges

Batch-generate a rationale for each rationale-less edge from its source-node content,
target-node content, and edge type (plus confidence/weight as hints). Scope options, cheapest to
most complete:

| Option | Scope | Edge count | Rationale |
|--------|-------|-----------|-----------|
| A | Accept-and-document | 0 | The field is honestly documented as "recent edges only" (already done in `docs/pov-edges.md`). Zero cost, zero coverage. |
| B | Approved-only | ~25,765 | The highest-value cohort (drives review + display); skips proposed edges that may be rejected anyway. |
| C | Approved + high-confidence proposed | ~28-30k | Adds proposed edges above the review threshold (e.g. confidence ≥ 0.75). |
| D | Full backfill | ~33,456 | Complete coverage, including low-confidence proposed edges that may never be approved. |

**Cost estimate** (order-of-magnitude; assumes ~700 input + ~100 output tokens per edge, source
+ target description + type + instruction). Batch by edge type to maximize prompt-cache hits.

| Model | Full (~33.4k) | Approved-only (~25.8k) |
|-------|---------------|------------------------|
| gemini-flash-lite, free tier | ~$0 (rate-limited; wall-clock is the cost, est. several hours) | ~$0, fewer hours |
| gemini-flash-lite, paid | ~$3-6 | ~$2-5 |
| claude-sonnet | ~$90-130 | ~$70-100 |

The free-tier flash-lite path makes even a full backfill effectively free in dollars, trading
money for wall-clock under rate limits. Quality note: a backfilled rationale is a *post-hoc
reconstruction* from node content, not the original discovery reasoning, so it should be marked
as such (e.g. `rationale_source: "backfill"`) so it is never mistaken for a contemporaneous
justification. This is itself a small schema addition worth deciding on before any backfill run.

### 2c. Recommendation

- **Prospective:** proceed with 2a (serializer assertion + CI gate + embedding-first rationale
  source) as the durable fix. This is the part that stops the gap from growing and matches the
  t/2425 "gate not memo" rule. Route the gate to Main (TL) for two-arm verification.
- **Retrospective:** recommend **Option B (approved-only)** on **free-tier flash-lite**, with a
  `rationale_source: "backfill"` marker, as the best value: it covers the cohort that actually
  drives review and display, at near-zero dollar cost. Full backfill (D) buys little extra since
  low-confidence proposed edges may never be approved.

## Open decisions for PI / TL

1. Backfill scope: B (approved-only, recommended), C, D, or A (accept-and-document)?
2. Approve the `rationale_source` marker schema addition so backfilled rationales are
   distinguishable from discovery-time ones?
3. Sequence the embedding-first rationale source (templated vs cheap LLM pass) as its own
   implementation ticket?

No implementation has been done under this ticket. On direction, I will file the prospective
gate and (if approved) the backfill as separate implementation tickets.
