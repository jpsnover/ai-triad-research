# `logical_form` (FOL): UX surfacing + downstream consumption — options proposal

**Author:** Computational Linguist (CL.Investigate1)
**Date:** 2026-09-07
**Ticket:** t/3353 (TL-created, PI ask p/548#72)
**Status:** Options proposal. Returns to **Main (TL)** for architecture review and **PI** for direction before any implementation ticket is cut. Part A (UX) build decomposes to the renderer owner (Taxonomy Editor); this doc is the CL-authored options set, **not** the build.
**Related:** `logical-form-schema.md` (schema of record), `claims-entity-fol-recommendations.md` §7 (FOL track design of record), `metric-provenance-register.md` (measured maturity), `concept-entity-bdi-grounding-ux-spec.md` (the sibling grounding-UX precedent this mirrors), t/3352 (status-vocab bug, **Done**), t/3127 (TPTP export), t/3128 (z3 edge-verify pilot), t/3379/t/3381 (`about[]` Option C).

---

## 1. Problem

`logical_form` is **produced and validated but a dark layer**: an LLM formalization pass writes a neo-Davidsonian event frame onto every BDI node (641 node frames) and onto claims, one canonical Zod schema validates it — and **nothing downstream reads it**. No QBAF/contradiction/retrieval/debate/renderer consumer; only gated-off TPTP (t/3127) and z3 (t/3128) research pilots. It has **no UX surface at all**. The PI ask (p/548#72) is two halves:

- **Part A** — options for exposing `logical_form` in the BDI node/claim user experience.
- **Part B** — options for how the rest of the system could *use* it.

The governing constraint, stated up front because it disciplines every option below: **the prover (and any consumer) is only as sound as the logical form** (`claims-entity-fol-recommendations.md` §8.1). This layer has real, measured weak axes. An option that presents a shaky frame as authoritative, or builds a consumer on an unvalidated axis, is the characteristic failure mode this role exists to block.

## 2. Measured maturity (ground truth, not recalled — the gate on every option)

Every option in §4–§5 is graded against these numbers. Sources: `logical-form-schema.md`, `metric-provenance-register.md`, `analyses/lf-golden-v2/`, `analyses/t3381-about-golden/`.

| Axis / field | Measured status | Consumer implication |
|---|---|---|
| **Claim-level `formalization_accuracy`** | **strict 0.778 / lenient 0.978** (n=45, v2 census, prompt `a9c93103`) — **DERIVED**, paper-canonical. Prior n=31=0.802 per-component is **superseded**. | The frame *as a whole* renders the claim faithfully ~78% strictly / ~98% leniently. Good enough to **show honestly**; not good enough for an **automated gate**. |
| **`predicate`** | Weak axis: **~0.50** on multi-clause meta-descriptive BDI (D3b); ~0.68 elsewhere. | Predicate-dependent consumers (contradiction detection keyed on predicate identity) are **premature**. |
| **`args[]` (participants + roles)** | **Weakest axis, ~0.30.** | **Do NOT build any args-dependent consumer** (role-based inference, participation reasoning) until this improves. Do NOT present args as authoritative in UI. |
| **`polarity` / `modality` / `temporal`** | Mechanical, **~1.00** (copied from category/POV/claim; not re-judged). | Reliable. Safe to surface and to consume (cross-camp modality analytics). |
| **`about[]` — entity-anchored** | 1.00 on ent-only golden — but that measured only trivial id-projection. | Reliable *for entities*, but the number over-credits. |
| **`about[]` — concept-anchored** | **FAIL: component 0.6357 < 0.80 floor** (t/3381, blind n=61). Failure mode = concept **over-selection** (micro precision 0.537, recall 0.946: 75 FP vs 87 TP). Ruling fell back to **Option C** (t/3379). | **`about[]` on nodes is actively being repaired** (Main's live t/3389/90/91 cluster). Any `about[]`-consuming surface must wait for Option C to land, or it renders known-noisy topical refs. |
| **`match_level`** | **`exact`-only in practice** — the resolver (`ClaimEntityResolution.ps1`) hardcodes it; 540/540 corpus refs are `exact`. Non-exact values are **aspirational vocabulary**, untested on real data. | Any consumer keying on `instance_of`/`subclass`/`superclass` semantics (subsumption-aware contradiction) is **testable only on constructed cases**, not production. |
| **`formalization_confidence`** | **STIPULATED** — a pass self-rating, *not* correlated with golden-set correctness. | **Do not use as a filter threshold yet.** Presenting it as a reliability bar in UI would be false precision. |
| **z3 edge-verify pilot (t/3128)** | Sound-but-narrow: **1/18 edges** produced a verdict. | Prover-as-gate is far off. Prover-as-annotation (surface-only) is the ceiling today. |
| **`status` vocab (t/3352)** | **FIXED (Done).** The `approved`→`accepted` drift that stripped 100% of node frames at load is resolved; a golden asserts the enum. | A UX surface will no longer silently lose the whole node-FOL layer. Prerequisite cleared. |

**One-line reading:** the *scaffold* fields (polarity/modality/temporal, entity-`about[]`) are reliable; the *semantic core* (predicate, args) and `formalization_confidence` are weak or stipulated. This split is the spine of both recommendations — **surface the honest whole, consume only the reliable axes.**

---

## PART A — Surfacing FOL in the BDI user experience

### 3. The natural home already exists

`taxonomy-editor/src/renderer/components/analysis/BdiGroundingPanel.tsx` already renders a node's `concept_refs[]` and `entity_refs[]` as honest rows — surface, method, status, `link_confidence` %, with distinct styling for `proposed` links. `logical_form` is the **sibling layer** to those refs (same node, derived, provenance-carrying). The design instinct is therefore *not* a new surface but a **Formalization section within the existing grounding panel** — it inherits the panel's honesty conventions (proposed-styling, confidence %) for free.

### 4. Part A options (each: sketch + tradeoffs)

#### A1 — Formalization section in `BdiGroundingPanel` (RECOMMENDED)

A collapsible "Formalization (derived)" section appended to the existing grounding panel, rendering the frame as a **structured predicate/args table with per-axis honesty cues**, not raw JSON.

```
▾ Formalization (derived · experimental)
  predicate   acquire                         [belief · camp:acc]
  polarity    positive        temporal  at 2025-02
  ─ participants ───────────────────────────  ⚠ low-reliability axis
    agent     ent-034  Anthropic      (exact)
    patient   ent-055  Claude models  (exact)
  about       Claude models · AI safety            proposed
  status      accepted                confidence  0.85 (self-rated)*
  * confidence is a pass self-rating, not calibrated — see docs
```

- **Where:** node detail → existing grounding panel. Claims: the same component pattern in the summary-viewer claim view.
- **Rendering:** structured table (predicate/modality header + participants sub-table + scaffold row). NL gloss offered as a secondary toggle (A3), never the primary.
- **Honesty:** the participants block carries a standing **⚠ low-reliability** marker (args ~0.30); `formalization_confidence` is rendered with a `*self-rated` footnote (it is stipulated, §2); `about[]` rows use the panel's existing `proposed` styling until Option C lands.
- **Default visibility:** section present but **collapsed by default**, labeled *experimental*. Power-user/reviewer-facing, not a headline claim feature.
- **Tradeoffs:** ✅ reuses an honest, tested component; minimal new surface; inherits proposed/confidence conventions. ➖ requires the panel to load node `logical_form` (already in the store post-t/3352). ➖ table layout work for the participants sub-block.

#### A2 — Inline badge/tooltip on a claim or node

A small `ƒ` badge on a claim/node indicating a formalized frame exists; hover → compact tooltip with predicate + modality + polarity (scaffold only, **no args** in the hover).

- **Tradeoffs:** ✅ lowest footprint; discoverable. ➖ a badge implies "this is formalized and trustworthy" — must be styled as *experimental*, and must **not** surface the weak args axis in a glanceable tooltip (glance = implied authority). Best as a **complement** to A1 (badge opens the A1 section), not a standalone.

#### A3 — NL gloss ("pretty-print") view

Render the frame as a generated natural-language sentence: *"The accelerationist camp believes that Anthropic acquired Claude models (as of 2025-02)."*

- **Tradeoffs:** ✅ most human-readable; good for non-technical reviewers. ➖ **actively dangerous as a primary view**: a fluent gloss *launders* a weak-args frame into confident prose — the reader cannot see that `patient=Claude models` scored ~0.30. Gloss hides exactly the axis that needs scrutiny. **Recommend: secondary toggle only, never default**, and derive the gloss from scaffold + predicate (the reliable axes), degrading gracefully ("…believes something about Claude models") when args are low-confidence rather than asserting a shaky participant.

#### A4 — Raw JSON / debug view

A "view raw frame" expander showing the validated JSON.

- **Tradeoffs:** ✅ zero-interpretation, correct for CL/TL debugging and for the reviewer validating the pass. ➖ not a user surface. **Recommend: keep, behind a debug toggle** (developer/reviewer audience), as the ground-truth escape hatch beneath A1.

### Part A recommendation

**A1 (structured section in the existing grounding panel) as the primary surface, collapsed + experimental-labeled, with A4 (raw JSON) behind a debug toggle and A3 (gloss) as an opt-in secondary.** A2 badge is a nice discoverability add-on that *opens* A1. The load-bearing UI rule across all of them: **the participants/args block always carries a low-reliability marker, `formalization_confidence` always renders as self-rated, and `about[]` waits for Option C.** Honesty-in-the-UI is not decoration here — it is the mitigation for the §2 weak axes.

---

## PART B — How the rest of the system could use `logical_form`

Each option: **value · maturity/risk · prerequisites · recommended sequencing.** Ordered from most-ready to not-yet-safe.

#### B1 — Cross-camp modality analytics (READY — recommended first consumer)

- **Value:** the reification (`holds(camp, attitude, p)`) makes the signature FOL query cheap: *"which propositions does acc believe and saf reject?"* — cross-camp belief/desire/intention comparison, per-camp attitude inventories, disagreement surfacing keyed on `modality.holder` × `modality.attitude` × `polarity`.
- **Maturity/risk:** builds **only on the ~1.00 mechanical axes** (modality/polarity are copied from POV/category, not judged). **Low risk.** Does not touch predicate or args.
- **Prerequisites:** node/claim FOL loaded (done, post-t/3352). No proposition *identity* matching required if scoped to descriptive analytics (counts, groupings) rather than "p = ¬q" equality.
- **Sequencing:** **first.** Highest value-to-risk ratio; exercises the reification the schema was built for without leaning on a weak axis.

#### B2 — Retrieval / dedup / entity-grounding leverage via `about[]` (READY-*after Option C*)

- **Value:** `about[]` is a per-claim/per-node topical index over resolved refs — a structured signal for retrieval filtering, near-duplicate detection, and reinforcing entity-grounding coverage.
- **Maturity/risk:** entity-anchored `about[]` is reliable; **concept-anchored `about[]` currently FAILS its floor (0.6357, over-selection).** Consuming it today imports known noise (75 FP on the blind golden).
- **Prerequisites:** **Option C must land** (Main's live t/3389/90/91 — separates the quality-marked topical field from `args`). Then re-verify the component floor.
- **Sequencing:** **blocked on Option C**, then ready. Do not wire a retrieval consumer onto the current about[].

#### B3 — Contradiction / conflict detection (COMPLEMENT, not gate — medium term)

- **Value:** an NLI-independent check that edges labeled `attacks`/`rebut` are formally incompatible and `supports` edges are at least consistent — feeding better-grounded edges to QBAF/Dung. Prover-vs-NLI disagreements are the gold (each is a formalization bug, an NLI failure, or a mislabeled edge).
- **Maturity/risk:** the z3 pilot (t/3128) was **sound-but-narrow: 1/18 edges** produced a verdict. Predicate ~0.50 and args ~0.30 mean most incompatibility conjectures either can't be built or would be built on a wrong frame. **A wrong frame "proved inconsistent" against a correct claim is the characteristic failure mode.**
- **Prerequisites:** predicate axis lift; args axis lift (for participant-level incompatibility); prover recall (t/3271 already tracks raising edge-verify recall). Must stay **surface-only annotation** (Mechanism-5 precedent), never auto-modify edges.
- **Sequencing:** **complement NLI, never gate it.** Ship as an annotation/disagreement-report *after* B1, contingent on predicate improvement. NLI stays primary.

#### B4 — QBAF/Dung attack-edge derivation from formal incompatibility (RESEARCH — longer term)

- **Value:** derive Dung attack edges from proven formal incompatibility rather than only NLI polarity — a second, symbolic evidence source for the argumentation layer. t/3127 TPTP export is the groundwork; t/3128 is the pilot.
- **Maturity/risk:** **highest.** Depends on B3 producing stable signal, which depends on predicate+args lift. Same soundness-dominated-by-formalization risk, amplified because it would *derive graph structure*, not just annotate.
- **Prerequisites:** B3 stable; match_level actually populated (subsumption-aware attacks need a hierarchical resolver — currently exact-only, aspirational).
- **Sequencing:** **contingent on B3's measured signal.** Explicitly staged, each phase gated on the prior phase's measured result (the §7.2 discipline). Not scheduled now.

#### B5 — Explicitly NOT yet safe to build on

State plainly, so no consumer is built on sand:

- **`args[]`-dependent inference** (role-based reasoning, participation logic) — args ~0.30. **Off-limits** until the axis improves.
- **`match_level` semantics** (`instance_of`/`subclass`/`superclass`/`related`) — `exact`-hardcoded in the resolver; the non-exact vocabulary and the t/3127/t/3128 match_level-sensitive axiom modules are **untested on real data**, constructed-cases-only. A subsumption-aware consumer is unverifiable on production until a hierarchical resolver exists (separate resolution-strategy initiative, out of FOL-track scope).
- **`formalization_confidence` as a filter threshold** — **stipulated**, not correlated with correctness. Filtering consumers on it would be false precision. Needs a golden-set correlation study first.
- **Predicate-identity equality across claims** (dedup/contradiction keyed on predicate string match) — predicate ~0.50 on the meta-descriptive majority; string-equality over a coin-flip axis is unsafe.

---

## 6. Overall recommendation + sequencing

1. **Part A:** land **A1** (structured Formalization section in the existing `BdiGroundingPanel`, collapsed + experimental), with **A4** raw-JSON debug toggle and **A3** gloss as opt-in secondary. Non-negotiable honesty rules: args block carries a low-reliability marker; `formalization_confidence` renders as self-rated; `about[]` waits for Option C. **Routes to Taxonomy Editor** (renderer owner) as a build ticket once TL/PI approve direction.
2. **Part B first consumer: B1** (cross-camp modality analytics) — READY, low-risk, exercises the reification on the reliable mechanical axes.
3. **B2** (about[]-based retrieval/dedup) — **blocked on Option C** (t/3389 cluster), then ready after a floor re-verify.
4. **B3** (contradiction annotation, complement-not-gate) — medium-term, contingent on predicate-axis lift; surface-only.
5. **B4** (QBAF attack derivation) — research, contingent on B3 signal; not scheduled.
6. **Do not build** anything in **B5** until its blocking axis is measured-good.

**Sequencing intent:** surface the layer honestly (A1) and light up the one safe consumer (B1) now; everything predicate/args/subsumption-dependent waits behind a measured improvement, never a hopeful ship. This is the same "each phase gated on the prior phase's measured signal" discipline the FOL track was designed under (`claims-entity-fol-recommendations.md` §7.2), applied to consumption.

## 7. What this doc does NOT decide (routes onward)

- **Part A implementation** → Taxonomy Editor (renderer), on TL/PI approval. This doc is options, not build.
- **The predicate/args axis-improvement work** (the gate on B3/B4/B5) → a CL prompt/golden initiative; not scoped here beyond naming it the blocker.
- **`about[]` Option C** → already in flight (Main-CL, t/3389/90/91). B2 depends on it; no new work proposed here.
- **Prover-as-CI-gate** → out of scope; would route to Main (TL) for both-arms Gate Verification per the standing rule. Nothing here proposes a gate.

*Grounding basis: `logical-form-schema.md`, `claims-entity-fol-recommendations.md` §7, `metric-provenance-register.md` (rows for `formalization_accuracy`, `formalization_confidence`, the t/3379/t/3381 about[] acceptance rule + FAIL), `analyses/lf-golden-v2/`, `analyses/t3381-about-golden/`, `BdiGroundingPanel.tsx`, and tickets t/3127/t/3128/t/3352. Maturity figures are quoted from the measured artifacts, not recalled.*
