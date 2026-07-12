# Corroboration: Per-Node Epistemic Testing Record

**Author:** Computational Linguist
**Date:** 2026-07-12
**Ticket:** t/1523
**Status:** Design proposal (pending owner + TL approval)

---

## Problem

The POV taxonomy is lumpy with respect to epistemic testing. Some BDI nodes have been
tested via debate and held up. Some were strengthened by modification rooted in
post-debate reflection. Most have never been tested at all. Today nothing in the data
model or the UI distinguishes these states. A node that survived three adversarial
debates renders identically to one no debate has ever touched, and there is no way to
sort or filter the taxonomy by testing history.

The existing `confidence` field does not capture this. Confidence
(`beliefConfidence.ts`, `Invoke-BDIWeightAssignment.ps1`) is a formula over epistemic
type, falsifiability, and evidence/edge boosts, which makes it a *plausibility*
estimate. The missing instrument answers a different question. How much adversarial
pressure has this node survived, in its current formulation?

Four requirements, from the owner's 2026-07-12 request:

1. Name the concept correctly.
2. Measure it.
3. Convey it in the user experience, including **sorting POV BDIs by it**.
4. Build a program that raises it for the most important BDIs.

## Concept: Corroboration

The concept is Popper's **corroboration**. A claim earns epistemic standing not by
being plausible but by surviving severe tests. We adopt the term because it avoids
two traps:

- **"Certainty"** describes a believer's psychological state, not a property of the
  claim's testing history.
- **"Confidence"** is already taken in this codebase and measures something else
  (see above). Overloading it would corrupt both instruments.

Corroboration has two dimensions, **exposure** (how much severe testing) and
**outcome** (held, refined, weakened), collapsed for display into a discrete tier
plus a revision annotation.

Design commitment from Lakatos: **refinement is a strength signal, not a reset.** A
node revised in response to a debate, whose revised form subsequently held, is in the
strongest epistemic state the system can certify. A naive design in which any edit
zeroes the record would punish exactly the behavior the project exists to produce.

### Relation to existing instruments

| Instrument | What it measures | Relation |
|---|---|---|
| `confidence` (Beliefs) | Plausibility formula | Orthogonal. Corroboration MAY feed a bounded confidence boost later; not in scope here. |
| QBAF `computed_strength` (AN claims) | *Structural* dialectical strength within one debate's argument network | Input. Corroboration is the *historical* rollup of these per-debate outcomes onto taxonomy nodes. |
| `debate_refs[]` | Which debates touched a node | Input. Today a bare ID list; corroboration attaches outcomes to it. |
| `situation_crux_alignment` (calibration) | Whether injected situations shape substance vs. decorate | The Cited/Contested boundary below reuses this reference-vs-engagement distinction at node granularity. |

Ontologically, corroboration is a provenance attribute of the node
(vocabulary-level, per the project's vocabulary-over-formalism rule). It does not add
edge types, alter the AIF vocabulary, or change BDI category semantics.

## Data Model

New enrichment object under `node.graph_attributes` (following the convention that
enriched fields live there, not at node root), for POV BDI nodes. Situation nodes are
a future extension (§Open Questions).

```json
"corroboration": {
  "tier": "contested",              // untested | cited | contested | corroborated
  "sort_key": 2.31,                  // persisted total ordering — see Sort Key
  "engagements": 4,                  // debates with substantive engagement
  "challenges": 2,                   // severe attacks faced (cumulative)
  "held": 1,
  "weakened": 0,
  "revisions": [
    { "date": "2026-05-12", "debate_id": "debate-...", "held_since": true }
  ],
  "last_tested": "2026-07-02",
  "description_hash": "sha256:...",  // formulation the record certifies
  "record": [
    {
      "debate_id": "debate-...",
      "date": "2026-07-02",
      "verdict": "held",             // held | weakened | refined | open | cited
      "strongest_attack_encountered": { "claim_id": "...", "strength": 0.82, "scheme": "rebut" },
      "claim_outcomes": { "thrived": 2, "survived": 1, "died": 0 },
      "concession": null             // or { type: "full"|"conditional"|"tactical", turn: "..." }
    }
  ]
}
```

`strongest_attack_encountered` is recorded for **every** entry in `record[]`, including `cited`
verdicts, and is `null` only when the node was engaged but never attacked at all. This is
deliberate: it is the raw evidence a threshold reevaluation needs (see §Reevaluation Without
Re-Harvesting). The field was `strongest_attack` in an earlier draft of this design; renamed
to make explicit that it captures every attack encountered, not only ones that cleared
`SEVERE_ATTACK_THRESHOLD`.

**Single-writer rule** (Shared Utility Rule): the record and `sort_key` are computed
in one place, a new `lib/debate/corroboration.ts` module invoked at harvest time and
by the one-off backfill. PowerShell and the renderer are read-only consumers. No
consumer recomputes tiers or sort keys locally.

The record certifies a specific formulation of the node, captured as
`description_hash`. At read time, consumers compare the hash against the node's
current description. On mismatch (a material edit with no debate linkage), the node
displays as **stale** and is demoted from Corroborated to Contested for sorting until
retested. Cosmetic edits can be exempted later via normalization; v1 treats any
description change as material.

**Write-time requirement, not just a read-time definition:** when the single writer
appends a `refined` entry (a debate-linked edit, §Verdict attribution rules), it
recomputes and updates `description_hash` to the *new* formulation in the same write.
This is what keeps "refined" and "stale" mutually exclusive in practice: a
reflection-driven edit is debate-linked by construction, so by the time it is visible
to readers, the hash already matches the new text and the mismatch check never fires.
An edit only shows as stale when it bypassed the refinement path entirely — i.e., it
carries no `record[]` entry and no `revisions[]` entry at all. Missing this write-time
step would let a legitimate reflection edit render as `refined` *and* `stale`
simultaneously, contradicting the non-punitive design intent above.

### Schema updates

- Add the `corroboration` object to `taxonomy/schemas/pov-taxonomy.schema.json`
  (documentation-only today per repo-review F-025, but still the schema of record).
- Add the TS interface to `lib/debate/taxonomyTypes.ts`.
- The renderer zod subset (`utils/validation.ts`) treats the field as optional
  passthrough in v1.

## Tier Ladder

| Tier | Rank | Definition |
|---|:---:|---|
| **Untested** | 0 | No substantive engagement in any harvested debate. |
| **Cited** | 1 | Engaged (≥1 debate) but never severely challenged — referenced, not tested. |
| **Contested** | 2 | Severely challenged ≥1 time; outcomes mixed, open, or insufficient for Corroborated. |
| **Corroborated** | 3 | ≥2 severe challenges across ≥2 distinct debates; most recent verdicts are `held` (or `refined` with `held_since: true`); no `weakened` verdict more recent than the latest `held`; record not stale. |

**Refined** is an annotation, not a tier (`revisions[]` is non-empty). A Corroborated
node with a held revision renders with a distinct mark (§UX), because
revision-then-survival is the system's strongest certificate.

The headline measure is deliberately a **discrete tier, not a 0–1 score**. A
continuous corroboration number would imply instrument precision we do not have
(compare the register's false-precision rationale) and invite cross-node comparisons
the evidence cannot support. The continuous `sort_key` exists solely to order lists
and is never displayed as a value.

### Verdict attribution rules (per node n, per harvested debate D)

Definitions build only on artifacts the pipeline already persists:

- **Engaged(n, D)**: n appears in D's `injection_manifest.povNodeIds`
  (`calibrationLogger.ts`) AND at least one argument-network claim in D carries a
  `taxonomy_refs` entry pointing at n. Injection alone is not engagement.
- **Challenged(n, D)**: an attack (rebut/undercut/undermine, or a
  CONTRADICTS/WEAKENS-typed AN edge) targets a claim attributed to n, and the
  attacker's final-round QBAF `computed_strength` is at least
  `SEVERE_ATTACK_THRESHOLD`. The raw strength of the strongest attack is recorded
  regardless of whether it clears this bar (see `strongest_attack_encountered`
  below) — the threshold gates the *verdict label*, not what gets persisted.
- **Verdict:**
  - `held`: Challenged, all attributed claims finished `thrived`/`survived`
    (`claimOutcomes.ts` classification), and no full concession by the owning POV's
    speaker on a linked crux (`cruxResolution.ts` concession tracking).
  - `weakened`: Challenged, and at least one attributed claim `died`, or a full
    concession was recorded with `bdi_impact` matching the node's category.
  - `refined`: the node received a revision citing D, either a `WeightHistoryEntry`
    from the crux-feedback path (`cruxTaxonomyFeedback.ts`) or an accepted
    harvest-queue edit. `held_since` starts `null` and flips `true` when a later
    debate tests the revised formulation and it holds.
  - `open`: Challenged, but the debate ended without a decisive claim outcome or
    concession (mixed evidence). Counts toward Contested, never toward Corroborated.
  - `cited`: Engaged, never Challenged.

## Sort Key (requirement: sort POV BDIs by corroboration)

A persisted float giving a deterministic total ordering, computed by the single
writer:

```
tier_rank      = untested 0 | cited 1 | contested 2 | corroborated 3
verdict_weight = held 1.0 | refined(held_since) 1.0 | refined(pending) 0.6
               | open 0.25 | weakened −0.5 | cited 0.0
evidence       = Σ over record: strongest_attack_encountered.strength × verdict_weight
sort_key       = tier_rank + clamp(evidence / EVIDENCE_SATURATION, 0, 0.99)
```

`sort_key ∈ [0, 4)`. Within a tier, nodes with stronger survived attacks sort higher.
Tie-break for consumers: `last_tested` descending, then node id ascending
(deterministic across PS and TS). Stale records sort at `min(sort_key, 2.99)`, the
Contested ceiling, without rewriting the stored value; staleness is a read-time
condition.

### Sorting surfaces

**PowerShell.** A new cmdlet, following `/add-ps-cmdlet`:

```powershell
Get-NodeCorroboration [-Pov acc|saf|skp] [-Category belief|desire|intention]
                      [-Tier <tier>] [-SortBy Corroboration|Deficit] [-Top N] [-Stale]
```

Emits objects (`NodeId`, `Label`, `Tier`, `SortKey`, `Engagements`, `Challenges`,
`LastTested`, `Refined`, `Stale`) so the pipeline composes:
`Get-NodeCorroboration -Pov saf -Category belief -SortBy Deficit -Top 20`.
`-SortBy Deficit` orders by `testing_priority` (§Program), which is the scheduler's
work queue and the answer to "which important BDIs are least tested."

**Taxonomy editor.** The node list gains a **"Corroboration"** sort option
(ascending/descending on `sort_key`) alongside the existing sorts, plus tier filter
chips. The field rides `graph_attributes` on nodes already delivered through the
existing taxonomy load path, so **no new bridge method is required**; this is a
renderer-only change.

## Reevaluation Without Re-Harvesting

Owner requirement (2026-07-13): `CORROBORATED_MIN_CHALLENGES` starts at 2, and will
likely be raised once there is a larger corpus of tested nodes. Every stipulated
threshold in this design should be reevaluable the same way — as a cheap recompute
over already-persisted evidence, not a re-run of debates or a re-parse of raw session
files. This section makes that guarantee explicit and names the one gap it required
closing.

**`tier` and `sort_key` are pure functions of `{record[], current constants}`.**
Nothing about them requires touching a debate session once `record[]` exists.
Concretely:

- Raising `CORROBORATED_MIN_CHALLENGES` (2 → N) is a recount over the already-stored
  `verdict` labels in `record[]` per node — no dependency on raw debate data at all.
- Changing verdict *weights* (§Sort Key) only touches `sort_key`, likewise computed
  from `record[]`.
- Changing `SEVERE_ATTACK_THRESHOLD` reclassifies which entries count as Challenged
  vs. `cited`, which is why `strongest_attack_encountered` (§Data Model) is captured
  for every entry, not only ones that cleared the old threshold. Without that field,
  lowering or raising this threshold would require re-deriving `Challenged(n, D)`
  from the original QBAF attack graph per debate — the one dependency this design
  does not want to reintroduce.
- Changing `EVIDENCE_SATURATION` or the deficit ladder (§Program) is likewise a pure
  recompute over stored fields.

**Required deliverable (added to Phase 0, §Ownership & Phasing):** `corroboration.ts`
exposes the tier/sort-key computation as a separate pure function
(`computeTierAndSortKey(record, constants)`), distinct from the harvest-time writer
that appends new `record[]` entries. A **recompute-only** batch operation calls this
pure function against every node's *existing* `record[]` under the current constant
values and rewrites only `tier` and `sort_key` — `record[]`, `engagements`,
`challenges`, `held`, `weakened`, and `revisions` are historical fact and are never
rewritten by a recompute pass. Exposed to PowerShell as
`Update-NodeCorroboration -RecomputeOnly` (Phase 2, alongside `Get-NodeCorroboration`)
so a threshold change is one command: edit the constant, run the recompute, done.
No re-harvest, no re-running debates, no data loss risk from repeated runs (the
operation is idempotent).

**What this does NOT cover.** If a future change alters the *verdict rules themselves*
(§Verdict attribution rules — e.g. redefining what counts as a decisive claim outcome,
or changing which edge types count as attacks), that changes what should have been
written to `record[].verdict`, and reevaluating it correctly needs the AN/claim data,
not just the corroboration record. `strongest_attack_encountered` future-proofs
threshold changes on top of the existing rules; it does not future-proof changes to
the rules themselves. If that need arises, the harvest pipeline provides the same
inputs (`injection_manifest`, `taxonomy_refs`, `claimOutcomes.ts`, QBAF strengths) for
a targeted re-harvest of affected debates.

## Measurement Pipeline

A 2026-07-12 code survey confirmed most inputs already exist; the gap is
**attribution and rollup**, not new instrumentation:

| Input | Where it lives today | Status |
|---|---|---|
| Which nodes a debate injected | `injection_manifest` (povNodeIds/povPrimaryIds), `calibrationLogger.ts` | exists |
| Which nodes claims referenced | AN `taxonomy_refs` per claim; `node.debate_refs[]` | exists |
| Claim outcomes (thrived/survived/died) | `claimOutcomes.ts` → session AN nodes + calibration summary | exists — **for AN claims only, never attributed back to taxonomy nodes** |
| Attack strengths | QBAF `computed_strength` + `qbaf_strength_timeline` | exists — same attribution gap |
| Concessions | `cruxResolution.ts` crux states; `concession_history` in `taxonomyTypes.ts` schema | exists (schema); wiring unclear |
| Debate-linked revisions | `WeightHistoryEntry` with `attack_claim`/`robustness` via `cruxTaxonomyFeedback.ts`; harvest queue | exists |

**Phase 0 (the prerequisite everything blocks on):** at harvest, compute the reverse
map from AN-claim outcomes to taxonomy nodes over the `taxonomy_refs` join, apply the
verdict rules, and write `corroboration` + `sort_key` to the node. The logic lives in
a new module, `lib/debate/corroboration.ts`; per the maintenance rule it enters the
CL owned-files table in the same PR.

**Backfill:** a one-off job over historical `<data>/debates/debate-*.json` sessions
and calibration JSONLs seeds records for the existing corpus, so tiers are populated
on day one rather than starting all-Untested. Older sessions missing
`injection_manifest` degrade gracefully. `debate_refs` membership alone floors a node
at Cited with `record[].verdict: "cited"`.

## UX

1. **Tier chips on node cards.** Untested renders *neutral* (grey outline). It is
   the default state of most of the graph and must not read as an error. Chip
   colors run grey outline (Untested), grey filled (Cited), amber (Contested),
   green (Corroborated). The Refined annotation adds a small "forged" glyph; a
   stale record adds a dashed border and a tooltip ("revised since last tested").
2. **Sort and filter** in the node list, as specified above.
3. **Drill-down provenance panel.** Clicking the chip shows the record ("Survived 3
   debates. Refined 2026-05-12 in response to [debate]. View the exchange.").
   Entries link to the debate session (`debates/debate-<id>.json`) and the specific
   turns, mirroring the intellectual-lineage panel pattern.
4. **Graph heatmap overlay (phase 1b, optional).** A corroboration color mode in the
   graph view making the lumpiness directly visible as corroborated ridges and
   untested plains.

Only tiers, counts, and dates are ever rendered; `sort_key` is not displayed.

## Program: Severe-Test Scheduling

Spend debate budget where it buys the most epistemic value.

```
importance       = 0.35·degree_centrality + 0.25·policy_linkage
                 + 0.20·doctrinal_anchor + 0.20·usage_frequency      (each normalized 0–1)
deficit          = untested 1.0 | cited 0.7 | stale 0.6 | contested 0.4 | corroborated 0.1
testing_priority = importance × deficit
```

Cycle:

1. **Rank.** `Get-NodeCorroboration -SortBy Deficit -Top K`.
2. **Target topics.** For each top node, generate a debate topic engineered to put
   its claim under attack. The node's `steelman_vulnerability` field (already
   populated) seeds the challenge framing; the topic-critique rubric gates quality
   as usual.
3. **Run.** `Invoke-DebateBatch` with target nodes force-injected as primary
   (`povPrimaryIds`).
4. **Harvest.** Phase 0 attribution updates records. Refinement candidates route
   through the existing crux-feedback / harvest-review workflow; the scheduler never
   auto-edits nodes.
5. **Re-rank.**

Two guardrails apply. The retread downweight in `corpusCoverage.ts` (0.6 multiplier)
already discourages over-testing, and tests per node per cycle are capped at
`MAX_TESTS_PER_NODE_PER_CYCLE`. Each cycle emits a before/after tier distribution so
progress is inspectable ("this month: 14 nodes Untested→Contested, 5
Contested→Corroborated").

## Provenance Declarations

Per the register's no-grade-inflation rule, every judgment-bearing parameter here is
**stipulated** at design time. Register entries (added to
`metric-provenance-register.md` alongside this doc, marked design-stage):

| Parameter | Value | Class |
|---|---|---|
| `SEVERE_ATTACK_THRESHOLD` | 0.5 | stipulated |
| `CORROBORATED_MIN_CHALLENGES` | 2 across ≥2 debates | stipulated |
| Verdict weights | held 1.0 / refined-held 1.0 / refined-pending 0.6 / open 0.25 / weakened −0.5 | stipulated |
| `EVIDENCE_SATURATION` | 5 | stipulated |
| Deficit ladder | 1.0 / 0.7 / 0.6 / 0.4 / 0.1 | stipulated |
| Importance weights | 0.35 / 0.25 / 0.20 / 0.20 | stipulated |
| Tier rules (the ladder itself) | — | stipulated instrument |

### Validation plan (path off "stipulated")

After ≥50 harvested debates carry corroboration records, run a stratified sample of
30 nodes across tiers with blind human judgment on two questions per node ("was this
node severely tested?", "did it hold in its current form?"), and compare against the
assigned tiers. Target Cohen's κ ≥ 0.7 to reclassify the tier instrument as
human-validated; below that, revise thresholds and re-run. The CL owns this study
and the register update.

## Ownership & Phasing

The work is cross-scope (data-model change, new harvest module, renderer UX, new
cmdlet), so **Main (Technical Lead)** design review precedes implementation tickets.

| Phase | Work | Owner | Blocked by |
|---|---|---|---|
| 0 | `lib/debate/corroboration.ts`: reverse attribution, verdict rules, record + `sort_key` writer at harvest; pure `computeTierAndSortKey(record, constants)` function (§Reevaluation) usable standalone from the harvest writer; `taxonomyTypes.ts` + JSON schema updates | Shared Lib | TL approval |
| 0b | Backfill job over historical sessions + calibration JSONLs | Shared Lib | 0 |
| 1 | Taxonomy editor: sort option, tier chips, filters, drill-down panel | Taxonomy Editor | 0 |
| 1b | Graph heatmap overlay (optional) | Taxonomy Editor | 1 |
| 2 | `Get-NodeCorroboration` cmdlet; `Update-NodeCorroboration -RecomputeOnly` cmdlet wrapping the Phase 0 pure function for threshold reevaluation (§Reevaluation) (`/add-ps-cmdlet`) | PowerShell | 0 |
| 3 | Severe-test scheduler: deficit ranking, targeted topic generation, batch config | Shared Lib + CL | 0, 2 |
| 4 | Golden-set validation study; provenance upgrades | CL | ≥50 debates after 0 |

Verify gates per phase run `npm run verify` (0/0b/1/3) and `Invoke-Pester ./tests/`
(2). Phase 0 needs fault tests for the harvest writer (missing `taxonomy_refs`,
absent `injection_manifest`, malformed sessions) per `/add-fault-test`.

## Open Questions

1. **Situation nodes.** `situationRefs.ts` already gives reference extraction for
   `sit-*`/`cc-*`. Extending verdicts to situations needs a notion of "a situation
   held" that differs from POV claims, since situations are shared rather than
   defended by one camp. Deferred; design when POV-node records prove useful.
2. **Confidence coupling.** Should high corroboration feed a bounded boost into
   `beliefConfidence.ts`? It already has a debate-refs boost (+0.03 per ref, capped
   at +0.10). Deferred until the validation study establishes that the tier
   instrument measures what it claims; the instruments stay separate meanwhile.
3. **Concession wiring.** `concession_history` exists in the type schema but
   population is unverified. Phase 0 must confirm during implementation and fall
   back to crux-tracker concessions if the node-level field is unpopulated.
4. **Cosmetic-edit exemption** for `description_hash` (normalize whitespace and
   typos before hashing). V1 treats all edits as material; revisit if staleness
   churn is noisy.
