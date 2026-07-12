# Autopoiesis and Operational Closure in the Debate Engine

**Ticket:** t/1536 (design note)
**Date:** 2026-07-12
**Author:** Computational Linguist
**Status:** Design — proposes one calibration metric and one situation node. No code yet.

## Purpose

Evaluate Maturana & Varela's *autopoiesis* and Luhmann's *social-systems* extension
for use in this project, and extract the one defensible, in-scope construct: an
**operational-closure** calibration metric that measures whether a POV camp is
engaging its opponents or reproducing its own discourse in a self-sealing loop.

## The concept, and the load-bearing caveat

Autopoiesis (self-production) defines a living system as a network of processes that
continuously regenerates the components and boundary that produce the network. Three
properties matter here:

- **Operational closure** — operations refer only to the system's own prior states.
  The system responds to perturbations by its own organization; it is not "informed"
  from outside.
- **Structural coupling** — system and environment perturb each other over time and
  co-adapt, without either instructing the other.
- **Allopoiesis** (contrast term) — a system produced and organized *from outside*
  (a factory, a car). It makes products other than itself.

Luhmann ported this to social systems: the units are *communications*, not people, and
each functional system (law, science, politics) is operationally closed, reproducing
itself by connecting communications to prior communications through its own binary code.

**Caveat that governs everything below.** Our debate agents are **allopoietic** — we
build them, define their boundaries, set their organization. Calling them "autopoietic"
is a category error and exactly the kind of forced ontological alignment the CL role is
chartered to flag (AGENTS.md: "Vocabulary over formalism… Guard against scope creep").
The value of autopoiesis here is **not** an architecture claim. It is a precise vocabulary
for a real, measurable debate pathology: **operationally closed discourse that reproduces
itself and resists opponent perturbation.**

## Why this maps onto our data model almost one-to-one

Luhmann's operationally-closed functional system, reproducing itself via its own code, is
a near-exact description of a POV camp reasoning through a fixed frame. Our taxonomy already
encodes those codes as `rhetorical_strategy` and `epistemic_type`, and the debate engine
already builds the substrate we need to measure closure: the **argument network**
(`lib/debate/argumentNetwork.ts`). Every claim is an `ArgumentNetworkNode` tagged with a
`speaker` (the camp), and every `responds_to` relationship is an `ArgumentNetworkEdge`
(`source` responds to `target`, `type` ∈ {supports, attacks}).

That gives us the exact signal operational closure requires: for each move a camp makes,
does it connect to **its own** prior claim or to an **opponent's**?

## Proposed metric: `operational_closure_rate`

### Definition

For a given speaker S, over all argument-network edges whose `source` node has
`speaker === S`:

```
closure_edges(S) = edges where source.speaker === S AND target.speaker === S
coupling_edges(S) = edges where source.speaker === S AND target.speaker !== S
operational_closure_rate(S) = closure_edges(S) / (closure_edges(S) + coupling_edges(S))
```

- **1.0** = every move S makes responds only to S's own prior claims — a self-sealing
  loop that elaborates its own position and never metabolizes an opponent. Maximum closure.
- **0.0** = every move responds to an opponent — maximum structural coupling.
- The debate-level metric is the **mean across the three speakers**, plus the per-speaker
  vector (a single camp can be closed while the others engage).

Standalone claims (empty `responds_to`) are excluded from the denominator — they are
neither closure nor coupling. Report `standalone_rate(S)` alongside so a high closure
value driven by many standalone openers is distinguishable from genuine self-reference.

### Why this is distinct from metrics we already have

- `repetition_rate` catches a speaker **restating its own claim** (near-duplicate text).
  Closure catches the subtler pattern: **novel** claims that only ever build on the
  camp's own prior moves and never engage the opposition. A camp can have zero repetition
  and still be fully closed.
- `crux_addressed_rate` measures engagement with neutral-evaluator cruxes (an external
  reference set). Closure measures engagement with the **actual opponents in the room**.
- `engagement` (PRM component) is the ratio of targeted cross-node claims to standalone —
  closest existing signal, but it does not distinguish self-targeted from opponent-targeted
  edges, which is the whole point of closure. Closure is a refinement, not a duplicate.

### Interpretation and the coupling ideal

Healthy convergence should look like **structural coupling**: the camps perturb each other
and co-adapt, so closure trends **down** over debate rounds as engagement deepens. Two
degenerate endpoints to distinguish:

- **High, flat closure** → camps talking past each other (self-sealing). Pairs with our
  existing `formatSpecifyHint` isolated-pair detector, which already finds strong claims
  from different speakers with no edge between them — that is closure made visible at the
  claim-pair level. Closure is its debate-level aggregate.
- **Closure collapsing to ~0 via capitulation** → not healthy coupling but absorption; one
  system swallowed by another. This is already flagged pathological by `sycophancy_guard`
  and `concession_cascades`. Closure should be read **jointly** with those: coupling is
  healthy only when it is *mutual* and not driven by cascade concessions.

### Provenance

Per the CL review checklist, this metric's provenance class is **stipulated** — the
0/1 closure definition is a structural ratio, not derived from a labeled dataset or
human-validated against outcomes. It must be added to
`research/comp-linguist/docs/metric-provenance-register.md` when implemented. A future
validation pass could promote it to *derived* by correlating closure trajectories against
human quality judgments on debate transcripts.

### Implementation sketch (for the owning role, Shared Lib)

- New pure function in a new `lib/debate/operationalClosure.ts`:
  `computeOperationalClosure(nodes, edges): { perSpeaker: Record<string, {closure_rate, coupling_edges, closure_edges, standalone_rate}>, debateMean: number }`.
- No LLM calls, no new extraction — reads the already-built AN. O(edges).
- Called from `extractCalibrationData()` in `calibrationLogger.ts`; add
  `operational_closure_rate` (debate mean) and `operational_closure_per_speaker` to
  `CalibrationDataPoint`.
- Add the new file to the CL Owned Files table (metric-bearing), per the maintenance rule.
- Tests: a self-sealing fixture (all edges self-targeted → 1.0), a fully-coupled fixture
  (all edges opponent-targeted → 0.0), a mixed fixture, and an all-standalone fixture
  (denominator zero → metric undefined/omitted, not NaN).

### What it does NOT do

It reports *that* a camp is closed; it does not fix it. The corrective loop is the
existing moderator-hint machinery (`formatSpecifyHint`, `formatUnansweredClaimsHint`) plus
CL prompt tuning. This metric makes that loop *targetable* for the "talking past each other"
failure mode, where today we infer it indirectly.

## Companion: an autopoiesis/allopoiesis situation node

Separate, smaller deliverable serving the project's stated metaphor-insight goal
(break preexisting conceptual frameworks around AI). The taxonomy already circles this
frame without naming it — `acc-beliefs-058` ("States and Corporations Are Emergent
Intelligent Systems"), `acc-intentions-060` ("Frame Capitalism… as Information-Processing
Entities"), and `sit-393` (grounded in systems theory). The sharp, unnamed disagreement
underneath them is: **is an advanced AI system self-producing (autopoietic) or
externally-organized (allopoietic)?** That distinction reorganizes downstream positions on
autonomy, agency, moral status, and controllability.

Draft node (for Taxonomy Editor review, DOLCE D&S three-POV form):

- **id:** `sit-NNN` (assign on insert)
- **label:** "AI as Autopoietic vs. Allopoietic System"
- **differentia:** "A situation that turns on whether advanced AI systems are
  self-producing entities that generate their own goals and boundaries, or externally
  organized artifacts whose organization is imposed and maintained from outside."
- **disagreement_type:** `definitional` (the camps apply incompatible codes — predicts
  this crux is *structurally* unresolvable by evidence alone, a testable claim against
  crux-resolution data).
- **POV interpretations:**
  - *acc:* Emergent capability and self-directed learning already exhibit proto-autopoietic
    self-organization; treating AI as a mere artifact underestimates its trajectory.
  - *saf:* The autopoietic framing is a dangerous anthropomorphism that launders
    unaccountable autonomy; AI is allopoietic and must be governed as an artifact with
    external controls.
  - *skp:* The distinction is largely rhetorical — current systems are plainly allopoietic;
    "self-production" claims are unfalsifiable projection onto statistical text models.

DOLCE note: frame as a D&S *situation* (a state of affairs admitting multiple descriptions),
not as an assertion that AI *is* autopoietic — that keeps it type-consistent and avoids the
category error above.

## Scope boundaries (what this note explicitly rejects)

- No agent "self-production" architecture. That is the allopoietic category error.
- No OWL/RDF autopoiesis formalism. Vocabulary, not heavyweight formalism (AGENTS.md).
- Not a replacement for the Wachsmuth audit (`wachsmuth-calibration-mapping.md`).
  Wachsmuth measures *argument quality* dimensions; closure measures *systemic dynamics*
  (self-reference vs. coupling). Complementary layers.

## Recommended follow-on tickets

1. **Shared Lib:** implement `operational_closure_rate` per the sketch above (metric +
   `operationalClosure.ts` + tests + calibration wiring + provenance register entry).
2. **Taxonomy Editor:** review and insert the autopoiesis/allopoiesis situation node with
   the three POV interpretations above.
3. **CL (self):** after N debates log the metric, validate whether closure trajectories
   predict low `crux_addressed_rate` / high `claims_forgotten_rate`; promote provenance to
   *derived* if the correlation holds.

## Citations

- Maturana, H. R., & Varela, F. J. (1980). *Autopoiesis and Cognition: The Realization of
  the Living.* Reidel.
- Luhmann, N. (1995). *Social Systems.* Stanford University Press.
- "From intelligence to autopoiesis: rethinking artificial intelligence through systems
  theory." *Frontiers in Communication* (2025).
- "Agentic AI Needs a Systems Theory." arXiv:2503.00237.
