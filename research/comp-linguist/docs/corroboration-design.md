# Debate-Tested: Per-Node Epistemic Testing Record

**Author:** Computational Linguist
**Date:** 2026-07-12
**Ticket:** t/1523
**Status:** Approved by Technical Lead 2026-07-13 (t/1523#7), Beliefs-only v1 scope
confirmed. TL condition: t/1533 (this rename) must land before any Phase 0
implementation ticket is cut, since Phase 0 writes the literal field, module, and
cmdlet names this rename changes — sequencing avoids a live-data migration. Externally
reviewed 2026-07-13 (three independent reviews via
`corroboration-proposal-external-review.md`); amendments are integrated inline and
marked "external review, 2026-07-13." The third review identified a direct logical
contradiction between the original "Corroboration" naming and Popper's own account of
corroboration (§Excluding Well-Tested Nodes): this document is renamed throughout as
of t/1533 to remove that contradiction. v1 scope is restricted to Beliefs (§Data
Model); Desires, Intentions, and situation nodes are deferred to their own design
passes. A crux-discovery-density complementary signal remains open, tracked
separately (t/1534). An external-evidence pointer feature was also spun out
separately (t/1535).

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

## Concept: Debate-Tested

The concept draws on Popper's **corroboration**. A claim earns epistemic standing not by
being plausible but by surviving severe tests. We adopt the term because it avoids
two traps:

- **"Certainty"** describes a believer's psychological state, not a property of the
  claim's testing history.
- **"Confidence"** is already taken in this codebase and measures something else
  (see above). Overloading it would corrupt both instruments.

Debate-Tested has two dimensions, **exposure** (how much severe testing) and
**outcome** (held, refined, weakened), collapsed for display into a discrete tier
plus a revision annotation.

Design commitment from Lakatos: **refinement is a strength signal, not a reset.** A
node revised in response to a debate, whose revised form subsequently held, is in the
strongest epistemic state the system can certify. A naive design in which any edit
zeroes the record would punish exactly the behavior the project exists to produce.

**Named risk (external review, 2026-07-13): self-confirmation.** The same family of
AI models generates the challenge, the defense, the reflection, and the proposed
revision. Nothing prevents a revision from being a narrow rewrite that dodges the
specific wording of one attack rather than a substantive strengthening, and a
sequence of such rewrites, each surviving its own narrow retest, would satisfy this
tier's mechanics without the node having become more sound. There is no gradient-based
training loop here, no weights updating across debates, so this is not overfitting in
the machine-learning sense; the risk is real regardless of that distinction. The
mitigation is the human review gate (§Wisdom Harvesting, human-gated review queue,
framing paper), and
it is only as strong as reviewer vigilance, which this design does not currently
instruct. The review-queue step for any `refined` proposal must explicitly ask the
Lakatosian question **as a check, not as unexamined justification**: does this
revision address the substance of the challenge, or does it narrowly evade the
specific attack that was made? A revision that survives by generalizing away from the
one attack that succeeded, without engaging what the attack actually established, is
a degenerating patch and should be rejected regardless of whether a subsequent debate
would let it hold. This criterion belongs in the harvest-review UI copy (Phase 1) as
an explicit prompt to the reviewer, not left implicit. Reviewer fatigue and deference
to the system's own outputs over time is a further risk this design does not solve;
it is named here as a known residual limitation rather than assumed away.

### Relation to existing instruments

| Instrument | What it measures | Relation |
|---|---|---|
| `confidence` (Beliefs) | Plausibility formula | Orthogonal. Debate-Tested MAY feed a bounded confidence boost later; not in scope here. |
| QBAF `computed_strength` (AN claims) | *Structural* dialectical strength within one debate's argument network | Input. Debate-Tested is the *historical* rollup of these per-debate outcomes onto taxonomy nodes. |
| `debate_refs[]` | Which debates touched a node | Input. Today a bare ID list; this instrument attaches outcomes to it. |
| `situation_crux_alignment` (calibration) | Whether injected situations shape substance vs. decorate | The Cited/Contested boundary below reuses this reference-vs-engagement distinction at node granularity. |

Ontologically, this instrument is a provenance attribute of the node
(vocabulary-level, per the project's vocabulary-over-formalism rule). It does not add
edge types, alter the AIF vocabulary, or change BDI category semantics.

## Data Model

New enrichment object under `node.graph_attributes` (following the convention that
enriched fields live there, not at node root). **Scope restricted to Beliefs in v1**
(external review, 2026-07-13, superseding the original "camp-specific claims"
scope): §1.2 of this project's own framing already states that Beliefs, Desires, and
Intentions are contestable in different ways — evidence refutes a Belief, feasibility
challenges an Intention, neither touches a Desire — yet the severity threshold,
outcome vocabulary, and content-increase gate above were drafted with only Beliefs in
mind (QBAF attack strength as evidential pressure; falsifiability as the
content-increase criterion). Applying them uniformly to Desires and Intentions would
mean "severely challenged and held" measures a categorically different thing per kind
while rendering as the same tier, which is not a labeling problem but a validity
problem: whatever a Desire "surviving a severe challenge" measures, it is not
demonstrated to be the same construct as a Belief surviving evidential attack.
Desires and Intentions are deferred to their own design pass, alongside situation
nodes (§Open Questions), rather than forcing three parallel severity/outcome
semantics into this pass under review pressure. Both extensions may reuse this
document's data model and tier mechanics once each has its own construct definition.

```json
"debate_tested": {
  "tier": "contested",              // untested | cited | contested | well_tested
  "sort_key": 2.31,                  // persisted total ordering — see Sort Key
  "engagements": 4,                  // debates with substantive engagement
  "challenges": 2,                   // severe attacks faced (cumulative)
  "held": 1,
  "weakened": 0,
  "revisions": [
    { "date": "2026-05-12", "debate_id": "debate-...", "held_since": true }
    // held_since: boolean | null
    //   null  = not yet retested since this revision
    //   true  = retested in a later debate and the revised formulation held
    //   false = retested in a later debate and the revised formulation did NOT hold
  ],
  "last_tested": "2026-07-02",
  "description_hash": "sha256:...",  // formulation the record certifies
  "record": [
    {
      "debate_id": "debate-...",
      "date": "2026-07-02",
      "pipeline_version": "2026-07-e50b10cf",  // debate-engine commit/model generation active at harvest time
      "verdict": "held",             // held | weakened | refined | open | cited
      "strongest_attack_encountered": { "claim_id": "...", "strength": 0.82, "scheme": "rebut", "challenger_camp": "accelerationist" },
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
in one place, a new `lib/debate/debateTested.ts` module invoked at harvest time and
by the one-off backfill. PowerShell and the renderer are read-only consumers. No
consumer recomputes tiers or sort keys locally.

The record certifies a specific formulation of the node, captured as
`description_hash`. At read time, consumers compare the hash against the node's
current description. On mismatch (a material edit with no debate linkage), the node
displays as **stale** and is demoted from Well-Tested to Contested for sorting until
retested. **Cosmetic-edit exemption, adopted for v1 rather than deferred (external
review, 2026-07-13):** the variable that matters is semantic materiality, not literal
text equality, and the project already has the tool this needs — the same
all-MiniLM-L6-v2 embeddings used elsewhere for relevance scoring. Before flagging a
mismatch, compare the embedding cosine similarity of the old and new description
text against `COSMETIC_EDIT_SIMILARITY_THRESHOLD` (proposed 0.98, stipulated); above
it, update `description_hash` silently with no staleness flag and no record entry.
Deferring this was going to produce a predictable, backwards incentive: a trivial
typo fix on a Well-Tested node gets the maximal penalty (full demotion to
Contested), while a genuinely substantive rewrite gets full credit as long as it is
routed through the debate-linked `refined` path — exactly backwards from what the
mechanism should reward, and cheap enough to fix now rather than carry as a known
defect.

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

**Calling-convention requirement for `prior_falsifiability` (CL review, t/1545#3):**
The write-time requirement above means `harvestDebateTested` is called *after* the
reflect loop has updated the node's description. If the reflect loop also updates
`graph_attributes.falsifiability` before calling harvest, the `prior_falsifiability`
field written into the revision entry captures the post-reflection falsifiability
rather than the pre-reflection value. In a subsequent debate the content-increase gate
then compares post-reflection against itself and always passes. The gate is
ineffective for the exact edit that triggered the refinement.

**Required calling pattern for orchestration code (Phase 3 / any caller that calls
`harvestDebateTested` for a session that includes refined nodes):** read each
`refined` node's `graph_attributes.falsifiability` *before* the reflect loop runs on
that node, and pass the captured value explicitly to the harvest writer. The harvest
function signature should expose a `priorFalsifiability` parameter per-node (or as
part of a `HarvestRefinementContext`) rather than re-reading from the already-mutated
`PovNode`. This makes the writer stateless with respect to calling order, and the
content-increase gate unambiguous.

**Backfill fallback (Phase 0b):** historical sessions do not have a reliable
pre-reflection snapshot. For backfill-created revision entries, set
`prior_falsifiability: null` and add `"backfill": true` to the revision object. The gate cannot fire on a value we do not have, and
`null` is visibly distinct from a measured value. Do not substitute the current
falsifiability as a proxy. Substituting it creates phantom "prior" values that are
actually post-reflection, which is the failure mode this constraint exists to prevent.

### Schema updates

- Add the `debate_tested` object to `taxonomy/schemas/pov-taxonomy.schema.json`
  (documentation-only today per repo-review F-025, but still the schema of record).
- Add the TS interface to `lib/debate/taxonomyTypes.ts`.
- The renderer zod subset (`utils/validation.ts`) treats the field as optional
  passthrough in v1.

## Tier Ladder

| Tier | Rank | Definition |
|---|:---:|---|
| **Untested** | 0 | No substantive engagement in any harvested debate. |
| **Cited** | 1 | Engaged (≥1 debate) but never severely challenged — referenced, not tested. |
| **Contested** | 2 | Severely challenged ≥1 time; outcomes mixed, open, or insufficient for Well-Tested. |
| **Well-Tested** | 3 | ≥2 severe challenges across ≥2 distinct debates; most recent verdicts are `held` (or `refined` with `held_since: true`); no `weakened` verdict more recent than the latest `held`; record not stale. |

**Refined** is an annotation, not a tier (`revisions[]` is non-empty). A Well-Tested
node with a held revision renders with a distinct mark (§UX), because
revision-then-survival is the system's strongest certificate.

The headline measure is deliberately a **discrete tier, not a 0–1 score**. A
continuous testing-history number would imply instrument precision we do not have
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
  - `weakened`: Challenged, and (a full concession was recorded with `bdi_impact`
    matching the node's category) OR (at least half of attributed claims `died`, with
    a floor of one claim when only one is attributed). **Aggregation rule stated
    explicitly (external review, 2026-07-13):** the prior draft triggered `weakened`
    on any single died claim regardless of how many others held, so a node
    represented by five claims where four thrived and one died would render
    identically to a node whose sole claim died outright. Proportional aggregation
    fixes this; a node attributed to many claims is not punished for one weak
    corollary.
  - `refined`: the node received a revision citing D, either a `WeightHistoryEntry`
    from the crux-feedback path (`cruxTaxonomyFeedback.ts`) or an accepted
    harvest-queue edit. `held_since` starts `null` and flips `true` when a later
    debate tests the revised formulation (hash still matches) and it holds. It
    flips `false` when a later debate tests the same formulation and that debate's
    own verdict comes out `weakened` — the failure is recorded on the *new* debate's
    entry as `weakened` per the rule above; `held_since: false` only marks the
    superseded refinement attempt so it stops banking pending credit (§Sort Key).
    **Content-increase gate, required before `held_since` can flip `true` (external
    review, 2026-07-13):** Lakatos's non-punitive treatment of revision applies
    specifically to *content-increasing* (progressive) revisions, not
    content-decreasing (degenerating) ones — a claim revised into vaguer, more
    hedged, less falsifiable wording clears a lower QBAF attack-strength bar for the
    wrong reason, and auto-crediting that as the system's strongest certificate is
    the exact failure the distinction exists to prevent. The revised wording's
    falsifiability score (`beliefConfidence.ts`, already an input to `confidence`,
    no new instrument needed) must be at least as high as the prior wording's before
    `held_since` is eligible to flip `true`. A revision that scores strictly lower
    on falsifiability is flagged for explicit human attention in the review queue
    rather than auto-credited on a later hold, regardless of whether it survives a
    retest — surviving by getting vaguer is not the strength this tier claims to
    certify.
  - `open`: Challenged, but the debate ended without a decisive claim outcome or
    concession (mixed evidence). Counts toward Contested, never toward Well-Tested.
  - `cited`: Engaged, never Challenged.

## Sort Key (requirement: sort POV BDIs by how well-tested they are)

A persisted float giving a deterministic total ordering, computed by the single
writer:

```
tier_rank      = untested 0 | cited 1 | contested 2 | well_tested 3
verdict_weight = held 1.0 | refined(held_since:true) 1.0 | refined(pending) 0.6
               | refined(held_since:false) 0.0 | open 0.25 | weakened −0.5 | cited 0.0
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
Get-NodeTestingRecord [-Pov acc|saf|skp] [-Category belief|desire|intention]
                      [-Tier <tier>] [-SortBy Debate-Tested|Deficit] [-Top N] [-Stale]
```

Emits objects (`NodeId`, `Label`, `Tier`, `SortKey`, `Engagements`, `Challenges`,
`LastTested`, `Refined`, `Stale`) so the pipeline composes:
`Get-NodeTestingRecord -Pov saf -Category belief -SortBy Deficit -Top 20`.
`-SortBy Deficit` orders by `testing_priority` (§Program), which is the scheduler's
work queue and the answer to "which important BDIs are least tested."

**Taxonomy editor.** The node list gains a **"Debate-Tested"** sort option
(ascending/descending on `sort_key`) alongside the existing sorts, plus tier filter
chips. The field rides `graph_attributes` on nodes already delivered through the
existing taxonomy load path, so **no new bridge method is required**; this is a
renderer-only change.

## Reevaluation Without Re-Harvesting

Owner requirement (2026-07-13): `WELL_TESTED_MIN_CHALLENGES` starts at 2, and will
likely be raised once there is a larger corpus of tested nodes. Every stipulated
threshold in this design should be reevaluable the same way — as a cheap recompute
over already-persisted evidence, not a re-run of debates or a re-parse of raw session
files. This section makes that guarantee explicit and names the one gap it required
closing.

**`tier` and `sort_key` are pure functions of `{record[], current constants}`.**
Nothing about them requires touching a debate session once `record[]` exists.
Concretely:

- Raising `WELL_TESTED_MIN_CHALLENGES` (2 → N) is a recount over the already-stored
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

**Required deliverable (added to Phase 0, §Ownership & Phasing):** `debateTested.ts`
exposes the tier/sort-key computation as a separate pure function
(`computeTierAndSortKey(record, constants)`), distinct from the harvest-time writer
that appends new `record[]` entries. A **recompute-only** batch operation calls this
pure function against every node's *existing* `record[]` under the current constant
values and rewrites only `tier` and `sort_key` — `record[]`, `engagements`,
`challenges`, `held`, `weakened`, and `revisions` are historical fact and are never
rewritten by a recompute pass. Exposed to PowerShell as
`Update-NodeTestingRecord -RecomputeOnly` (Phase 2, alongside `Get-NodeTestingRecord`)
so a threshold change is one command: edit the constant, run the recompute, done.
No re-harvest, no re-running debates, no data loss risk from repeated runs (the
operation is idempotent).

**What this does NOT cover.** If a future change alters the *verdict rules themselves*
(§Verdict attribution rules — e.g. redefining what counts as a decisive claim outcome,
or changing which edge types count as attacks), that changes what should have been
written to `record[].verdict`, and reevaluating it correctly needs the AN/claim data,
not just the testing record. `strongest_attack_encountered` future-proofs
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
verdict rules, and write `debate_tested` + `sort_key` to the node. The logic lives in
a new module, `lib/debate/debateTested.ts`; per the maintenance rule it enters the
CL owned-files table in the same PR.

**Backfill:** a one-off job over historical `<data>/debates/debate-*.json` sessions
and calibration JSONLs seeds records for the existing corpus, so tiers are populated
on day one rather than starting all-Untested. Older sessions missing
`injection_manifest` degrade gracefully. `debate_refs` membership alone floors a node
at Cited with `record[].verdict: "cited"`.

## UX

1. **Tier chips on node cards.** Untested renders *neutral* (grey outline) **at the
   individual-node level** — a single Untested claim has not failed anything, and
   the badge must not read as an error on that claim. This does not contradict
   §Program's "testing deficit" framing, which operates at the aggregate level: most
   of the taxonomy sitting at Untested is a real coverage gap worth the scheduler's
   attention, even though no single Untested node is thereby deficient. Both readings
   hold at once (external review, 2026-07-13, resolving an apparent tension between
   this line and §Program rather than retracting either). Chip
   colors run grey outline (Untested), grey filled (Cited), amber (Contested),
   green (Well-Tested). **The chip carries its challenge count inline** (e.g.
   "Well-Tested · 2" vs. "Well-Tested · 47"), added per external review: the tier
   alone collapses a node that barely cleared the bar and one that has been tested
   dozens of times into the same badge, discarding real information the record
   already holds. The Refined annotation adds a small "forged" glyph; a stale
   record adds a dashed border and a tooltip ("revised since last tested").
2. **Sort and filter** in the node list, as specified above.
3. **Drill-down provenance panel.** Clicking the chip shows the record ("Survived 3
   debates, challenged by 2 distinct camps. Refined 2026-05-12 in response to
   [debate]. View the exchange."). Entries link to the debate session
   (`debates/debate-<id>.json`) and the specific turns, mirroring the
   intellectual-lineage panel pattern. **The panel restates the epistemic boundary
   inline** ("this reflects testing history inside the platform's own debates, not
   an external truth judgment") rather than relying on a reader to have internalized
   that from a separate document — added per external review, since the boundary is
   only as effective as its most-encountered restatement, not its most careful one.
4. **Side-by-side maturity view.** Debate-Tested tier and the separate `confidence`
   plausibility score (§Relation to existing instruments) are shown together,
   explicitly labeled with their different meanings, wherever a node's full detail
   is displayed. The two instruments answer different questions and were kept
   deliberately uncoupled (§Open Questions); showing them side by side lets a reader
   see that difference rather than mentally merging two badges into one impression
   of "how good is this claim." Added per external review.
5. **Graph heatmap overlay (phase 1b, optional).** A testing-tier color mode in the
   graph view making the lumpiness directly visible as well-tested ridges and
   untested plains.

Only tiers, counts, dates, and challenger-camp diversity are ever rendered;
`sort_key` is not displayed.

## Program: Severe-Test Scheduling

Spend debate budget where it buys the most epistemic value.

```
importance       = 0.35·degree_centrality + 0.25·policy_linkage
                 + 0.20·doctrinal_anchor + 0.20·usage_frequency      (each normalized 0–1)
deficit          = untested 1.0 | cited 0.7 | stale 0.6 | contested 0.4 | well_tested 0.1
testing_priority = importance × deficit
```

Cycle:

1. **Rank.** `Get-NodeTestingRecord -SortBy Deficit -Top K`.
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
`MAX_TESTS_PER_NODE_PER_CYCLE` (proposed: 1 — a node is targeted at most once per
scheduler cycle, consistent with the re-eligibility posture above rather than
concentrating repeated tests on the same deficit leader; value was previously
referenced without being assigned, corrected on final review). Each cycle emits a
before/after tier distribution so
progress is inspectable ("this month: 14 nodes Untested→Contested, 5
Contested→Well-Tested").

### Excluding Well-Tested Nodes to Protect Testing Attention

**Named contradiction (external review, 2026-07-13), sharper than a naming-risk
concern: this section, as originally drafted, cited Popper for its name while doing
the one thing Popper's account of corroboration explicitly forbids.** Popper was
emphatic that corroboration is not inductive support: a well-corroborated claim is
not thereby more likely to survive its next test, and corroboration confers no
license to test it less. Using the top tier to reduce future testing is
precisely that inference. The mechanism below is defensible on ordinary
resource-allocation grounds — debate budget is finite, and spending it where it
teaches the most is a reasonable policy — but it is not defensible *under the name
this document originally used for it*, and the two could not be argued
simultaneously. This was the decisive reason (not merely a readability concern) that
t/1533 tracked a rename away from "Corroboration" as required, not optional, before
this design shipped. That rename is now complete throughout this document —
"Debate-Tested" and "Well-Tested" below name the mechanism honestly, on its
resource-allocation merits, with no residual claim to Popper's authority.

Owner direction (2026-07-13), superseding Open Question 2 below: the useful coupling
between this instrument and the rest of the system is not feeding it into confidence
(that stays deferred). It is the opposite move — using a node's already-earned
testing status as a reason to **get out of the way**, so debate attention concentrates
on the material that still needs testing. A node that has already survived two severe
challenges across two debates has, at the margin, less to prove than a node nobody
has touched.

This is the same lever family as `corpusCoverage.ts`'s retread downweight (t/1438),
generalized to a different signal (testing tier rather than citation frequency
plus crux-linkage), applied at the same integration point
(`taxonomyRelevance.ts` node selection). Two modes, matched to the two ways debates
happen in this system:

- **Ordinary debates (soft downweight).** At setup-time relevance scoring, a node at
  `debate_tested.tier === 'well_tested'` gets its relevance score multiplied by
  `WELL_TESTED_INJECTION_MULTIPLIER` (proposed 0.5 — stipulated, distinct parameter
  from the retread multiplier even though numerically close by coincidence). Soft,
  not a ban, composing multiplicatively with the existing retread multiplier and any
  coverage boost — same posture as t/1438, for the same reason: a Well-Tested node
  can still be the single most on-topic claim for a given debate, and a hard ban
  would force worse substitute claims into otherwise normal debates.
- **Severe-test scheduler batches (hard exclusion).** Inside a `Invoke-DebateBatch`
  run driven by §Program's cycle, every OTHER Well-Tested node (not the deficit
  leader being force-injected as primary) is excluded outright from injection, not
  merely downweighted. The batch's entire purpose is putting the targeted node under
  pressure; a well-tested node competing for the same context slots works directly
  against that purpose. This sharpens Phase 3's existing "force-injected as primary"
  step (§Program cycle, step 3) into an explicit two-sided rule: force IN the target,
  force OUT the already-Well-Tested.

**Guardrail (same shape as t/1438's, reused rather than reinvented):** an A/B on
ordinary debates — soft-downweight on vs. off — must show testing-diversity gains
(more distinct nodes crossing Untested→Cited or Cited→Contested per N debates)
**without** degrading `crux_addressed_ratio` or `avg_grounding_confidence` on those
same debates. Coverage of the untested tail gained at the cost of debate quality is a
fail, exactly as it would be for the retread lever.

Both new parameters are stipulated at design time (§Provenance Declarations below);
neither is tuned against a debate-quality score that would also serve as the
guardrail's own pass/fail metric, per the framing paper's autotuning boundary.
Implementation is Phase 3 scope (§Ownership & Phasing) — no separate ticket exists
yet because it is blocked on Phase 0 (`debate_tested.tier` must exist on nodes before
anything can select against it).

**Named risk (external review, 2026-07-13): permanent insulation.** Two survived
challenges is a thin evidence base for reducing a node's testing priority, even
softly, and the coverage/quality guardrail above only checks aggregate debate
outcomes; it does not catch a specific node quietly escaping further scrutiny for
good. The exclusion mechanism is revised to guarantee no node is excluded
indefinitely:

- **Forced re-eligibility.** A Well-Tested node returns to the normal (non-excluded,
  non-downweighted) candidate pool after `REEXAMINATION_INTERVAL` (proposed: 90 days
  or 20 new debates touching its topic domain, whichever comes first — both
  stipulated). This is not optional revalidation the scheduler might get around to; it
  is an automatic reset of exclusion status. A node can re-earn exclusion by surviving
  fresh challenges after the reset, but it cannot coast on a two-challenge record
  indefinitely.
- **The hard exclusion in scheduler batches (§ordinary vs. batch modes above) is
  capped at `MAX_CONSECUTIVE_EXCLUDED_CYCLES`** (proposed: 3), after which a
  Well-Tested node becomes eligible again for that specific scheduler cycle even if
  it is not the deficit leader, so a batch occasionally re-probes claims it has been
  routing around.
- **Challenger diversity is tracked**, not just challenge count. Each `record[]` entry
  gains a `challenger_camp` field (the attacking claim's speaker camp, already present
  on the argument-network node and joinable at harvest time — no new data collection).
  A node challenged twice by the *same* camp is weaker evidence than one challenged by
  two different camps, and `Get-NodeTestingRecord` surfaces this so a reviewer can spot
  a node that has only ever been tested from one direction. This does not manufacture
  independence that is not there: two debates challenged by the same authored personas
  and the same underlying model family share whatever blind spots that combination
  has, and camp-diversity tracking makes the shape of that limit visible rather than
  pretending "two distinct debates" means two independent trials.
- **Every record entry carries `pipeline_version`** (§Data Model), the debate-engine
  commit and model generation active at harvest time. Severity is gated on QBAF
  attack strength, which is itself a function of debater competence and model
  version, neither stationary across this project's own development timeline — a
  model upgrade silently redefines what "severe" means, and without an era marker,
  records from different pipeline generations would be silently pooled as if
  commensurable. This does not solve cross-era comparability; it makes the
  discontinuity discoverable rather than invisible, the same posture taken for the
  t/1402 QBAF semantics correction.
- **The re-eligibility timer above is this design's answer to non-stationarity as
  well as to thin-evidence insulation.** A claim tested against one era's
  arguments and then permanently excluded would never meet the next era's arguments;
  forced periodic re-eligibility means every Well-Tested node eventually re-enters
  the pool under whatever the pipeline currently is, not just the pipeline that
  produced its original record.

These two parameters (`REEXAMINATION_INTERVAL`, `MAX_CONSECUTIVE_EXCLUDED_CYCLES`)
are stipulated at design time and added to §Provenance Declarations.
`challenger_camp` and `pipeline_version` are observed data fields, not stipulated
judgment thresholds, and are not register entries for the same reason
`debate_id`/`date` are not.

## Provenance Declarations

Per the register's no-grade-inflation rule, every judgment-bearing parameter here is
**stipulated** at design time. Register entries (added to
`metric-provenance-register.md` alongside this doc, marked design-stage):

| Parameter | Value | Class |
|---|---|---|
| `SEVERE_ATTACK_THRESHOLD` | 0.5 | stipulated |
| `WELL_TESTED_MIN_CHALLENGES` | 2 across ≥2 debates | stipulated |
| Verdict weights | held 1.0 / refined-held 1.0 / refined-pending 0.6 / refined-rejected 0.0 / open 0.25 / weakened −0.5 | stipulated |
| `EVIDENCE_SATURATION` | 5 | stipulated |
| Deficit ladder | 1.0 / 0.7 / 0.6 / 0.4 / 0.1 | stipulated |
| Importance weights | 0.35 / 0.25 / 0.20 / 0.20 | stipulated |
| Tier rules (the ladder itself) | — | stipulated instrument |
| `WELL_TESTED_INJECTION_MULTIPLIER` | 0.5 (ordinary debates, soft) | stipulated |
| Scheduler-batch exclusion (hard) | boolean gate, not a magnitude | stipulated instrument |
| `REEXAMINATION_INTERVAL` | 90 days or 20 topic-domain debates, whichever first | stipulated |
| `MAX_CONSECUTIVE_EXCLUDED_CYCLES` | 3 | stipulated |
| `COSMETIC_EDIT_SIMILARITY_THRESHOLD` | 0.98 (embedding cosine similarity) | stipulated |
| Content-increase gate (falsifiability non-decrease) | boolean gate, not a magnitude | stipulated instrument |
| Weakened-verdict aggregation (≥half attributed claims died) | 0.5 proportion, floor of 1 | stipulated |
| `MAX_TESTS_PER_NODE_PER_CYCLE` | 1 (§Program) | stipulated |

### Validation plan (path off "stipulated")

**Scope, stated precisely (external review, 2026-07-13):** this study validates
**reliability** — does the tier accurately summarize what happened in the debates it
is built from — not **validity** in the stronger sense of whether surviving this
closed loop corresponds to real-world epistemic merit. No internal-agreement study
can establish that; per §Survival Is Not Truth But It Ain't Nothing (framing paper),
only the crux handoff to exogenous
evidence can, and this design does not claim otherwise. The register entry and any
future citation of "human-validated" for this instrument must carry that scope
explicitly, not imply the stronger claim.

**Precursor check, before the full study (external review, 2026-07-13): linkage
accuracy is measured separately, first.** Every outcome label depends on the
`taxonomy_refs` join between ephemeral debate claims and taxonomy nodes; a bad κ
result in the full study cannot by itself distinguish a bad severity threshold from
bad linkage from a bad aggregation rule, and the study as originally scoped could not
localize its own failures. Before the tier study runs, a small spot-check (10-15
nodes, CL-reviewed) verifies that `taxonomy_refs` correctly identifies the claims
that actually instantiate each sampled node. This is cheap, and it is the
precondition for the tier study's result being interpretable at all.

After ≥50 harvested debates carry testing records, run a stratified sample of
30 nodes, stratified *by system-assigned tier* so each tier is separately
represented, with blind human judgment on two questions per node ("was this node
severely tested?", "did it hold in its current form?"), and compare against the
assigned tiers. **Statistics, corrected (external review, 2026-07-13):** plain
Cohen's κ is the wrong statistic for an ordinal four-tier scale — it penalizes an
Untested-vs-Well-Tested disagreement identically to a Contested-vs-Well-Tested
one. Use quadratic-weighted κ, or Krippendorff's α with an ordinal metric if more
than two raters are used (this project already has that computation built,
`research/comp-linguist/analyses/reliability_metrics.py`, t/1264). Report per-tier
agreement from the stratified sample, not one pooled statistic across a
naturally skewed distribution (most nodes will be Untested, and pooled agreement
under skew is unstable, the prevalence paradox). Target weighted κ / α ≥ 0.7 to
reclassify the tier instrument as human-validated (reliability sense, per above).
**The "revise thresholds and re-run" loop is retired in its original form**: iterating
against the same rater pool is threshold-tuning against the validation set, the same
overfitting the framing paper's autotuning boundary already forbids for other
metrics. A frozen, held-out node sample is pre-registered and scored exactly once, at
the end, after any threshold revision from an earlier exploratory pass; it is never
re-scored. **Rater pool:** at least one-third of raters must be unfamiliar with this
project's own vocabulary and internal framing, not just blind to the specific tier
assignments — an all-in-house rater pool risks measuring agreement with the project's
worldview rather than with the debate record itself, and the rating rubric itself
must be written in plain language, blind to this document's own internal category
definitions, or the study measures vocabulary transfer rather than measurement
accuracy. Rater count, node count per stratum, and the exact rubric wording are
finalized before the study runs, not adjusted afterward. The CL owns this study and
the register update.

## Ownership & Phasing

The work is cross-scope (data-model change, new harvest module, renderer UX, new
cmdlet), so **Main (Technical Lead)** design review precedes implementation tickets.

**Rollout order revised (external review, 2026-07-13): high-visibility and
high-stakes surfaces wait for the validation study, not the other way around.**
Both external reviews independently raised the same objection: shipping a
prominently displayed tier badge, and especially the exclusion lever that changes
which nodes get debated, before any check that the tier means what it claims to
mean, risks the metric becoming culturally entrenched before it has earned that
trust. The data model and a research-only surface ship first so records can
accumulate; the general-audience UI and any behavior-changing mechanism wait.

| Phase | Work | Owner | Blocked by |
|---|---|---|---|
| 0 | `lib/debate/debateTested.ts`: reverse attribution, verdict rules, record + `sort_key` writer at harvest; pure `computeTierAndSortKey(record, constants)` function (§Reevaluation) usable standalone from the harvest writer; `taxonomyTypes.ts` + JSON schema updates | Shared Lib | TL approval |
| 0b | Backfill job over historical sessions + calibration JSONLs | Shared Lib | 0 |
| 2 | `Get-NodeTestingRecord` cmdlet; `Update-NodeTestingRecord -RecomputeOnly` cmdlet (`/add-ps-cmdlet`). Research-only surface — ships before the general UI so records accumulate under expert eyes first. | PowerShell | 0 |
| **Pilot gate** | **≥50 debates accumulate testing records (Phase 0/0b live); Phase 4's validation study runs against that pilot corpus.** | CL | 0, 0b, 2 |
| 1 | Taxonomy editor: sort option, tier chips, filters, drill-down panel, side-by-side confidence/testing-tier view (§UX). **Held until the pilot gate clears**, or ships with an explicit "preview, unvalidated" label if the owner wants earlier visibility. | Taxonomy Editor | Pilot gate |
| 1b | Graph heatmap overlay (optional) | Taxonomy Editor | 1 |
| 3 | Severe-test scheduler and the exclusion lever (§Excluding Well-Tested Nodes): deficit ranking, targeted topic generation, batch config, forced re-eligibility. **Held until the pilot gate clears** — this phase changes what gets debated, the single highest-stakes surface in the design, and ships last, not concurrently with initial rollout. | Shared Lib + CL | Pilot gate, 2 |
| 4 | Golden-set validation study (reliability scope, §Validation plan); provenance upgrades | CL | Pilot gate |

Verify gates per phase run `npm run verify` (0/0b/1/3) and `Invoke-Pester ./tests/`
(2). Phase 0 needs fault tests for the harvest writer (missing `taxonomy_refs`,
absent `injection_manifest`, malformed sessions) per `/add-fault-test`.

## Open Questions

1. **Situation nodes.** `situationRefs.ts` already gives reference extraction for
   `sit-*`/`cc-*`. Extending verdicts to situations needs a notion of "a situation
   held" that differs from POV claims, since situations are shared rather than
   defended by one camp. Deferred; design when POV-node records prove useful.
2. **Confidence coupling — superseded 2026-07-13.** This item originally asked
   whether a high testing tier should feed a bounded *boost* into
   `beliefConfidence.ts`. Owner direction reversed the framing: the useful coupling
   runs the other way — being well-tested is a reason to *deprioritize* a node for
   further testing, not a reason to inflate an unrelated score. See §Excluding
   Well-Tested Nodes to Protect Testing Attention. Whether testing status should
   *also* someday feed a confidence boost remains open and still deferred to the
   validation study; the two questions are independent and this entry no longer
   blocks on the coupling question, only the deficit-lever design above.
3. **Concession wiring.** `concession_history` exists in the type schema but
   population is unverified. Phase 0 must confirm during implementation and fall
   back to crux-tracker concessions if the node-level field is unpopulated.
4. **Cosmetic-edit exemption — resolved 2026-07-13, no longer open.** Adopted for v1
   via embedding-similarity threshold, not deferred; see §Data Model.
