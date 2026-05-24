# Weighted BDI: Adding Confidence and Priority to the Taxonomy

## The Problem

The current BDI model treats every node as equally true and equally important. A Belief that "AI systems exhibit emergent deceptive behavior" (speculative, contested) has the same standing as "Current AI models require significant compute" (empirical, uncontested). A Desire for "Preventing AI Global Catastrophe" (existential priority) is weighted the same as "Improving AI Documentation" (procedural improvement).

This flatness hurts the debate engine in three ways:

1. **Debaters can't prioritize.** When the taxonomy context injects 20 nodes, the debater has no signal about which ones are foundational vs peripheral. It treats a speculative fringe belief the same as a consensus empirical finding.

2. **Conflicts are all equally serious.** A CONTRADICTS edge between two high-confidence Beliefs is a real intellectual tension. A CONTRADICTS edge between a speculative Belief and a well-documented one is just one camp being wrong. The system can't tell the difference.

3. **Reflections can't express "we're less sure about this now."** After a debate where an opponent successfully challenged a Belief, the reflection can DEPRECATE it (binary removal) or leave it unchanged. There's no way to say "this Belief is weaker than we thought but still defensible" — which is how most intellectual updating actually works.

## The Proposal: Two New Dimensions

### 1. Belief Confidence (0.0 – 1.0)

Every Belief node gets a `confidence` score reflecting how well-supported the claim is.

| Confidence | Meaning | Example |
|-----------|---------|---------|
| 0.9 – 1.0 | **Established** — broad empirical support, replicated findings, expert consensus | "Current AI models require massive compute" |
| 0.7 – 0.9 | **Well-supported** — strong evidence but some contested aspects or boundary conditions | "Scaling laws predict capability gains" |
| 0.5 – 0.7 | **Plausible** — theoretical support and some evidence, but not conclusive | "AI systems may develop deceptive alignment" |
| 0.3 – 0.5 | **Speculative** — logically coherent but limited empirical basis | "AI will achieve consciousness" |
| 0.0 – 0.3 | **Contested** — significant counter-evidence or fundamental methodological disputes | "AI safety is regulatory capture" |

**What confidence is NOT:**
- It is not "how much this POV believes this." Every POV believes its own nodes — that's what makes them part of the taxonomy. Confidence is about *evidential support*, not *strength of conviction*.
- It is not a popularity score. A Belief held by one camp with strong evidence should score higher than a Belief held by all three camps with weak evidence.

### 2. Desire Priority (1 – 5)

Every Desire node gets a `priority` ranking reflecting how foundational it is to the camp's value system.

| Priority | Meaning | Example |
|----------|---------|---------|
| 5 | **Core** — non-negotiable value; compromising this would change the camp's identity | "Preventing AI-driven extinction" (safetyist) |
| 4 | **High** — strongly held, will fight hard but could accept tradeoffs under extreme pressure | "Ensuring equitable AI access" (skeptic) |
| 3 | **Important** — valued but explicitly subject to tradeoffs with other priorities | "Maximizing innovation speed" (accelerationist) |
| 2 | **Preferred** — desirable but would concede readily if other priorities demanded it | "Improving AI documentation" |
| 1 | **Nice-to-have** — acknowledged but not actively pursued | "International AI terminology standardization" |

**What priority is NOT:**
- It is not urgency. A priority-5 Desire may not require immediate action; it just can't be compromised.
- It is not the same across camps. "AI safety" is priority 5 for safetyists and priority 2-3 for accelerationists — that's the whole point.

### 3. Intention Feasibility (not proposed yet)

Intentions could get a `feasibility` score (political viability × technical readiness × institutional capacity), but this introduces significant subjectivity and would need its own calibration process. Defer to a future phase — confidence and priority are the high-leverage additions.

## How Confidence and Priority Are Established

### Initial Assignment

**For existing nodes (~800):**
Run a one-time classification pass using the existing `graph_attributes`:

- `epistemic_type: empirical_claim` + `falsifiability: high` → confidence 0.7-0.9
- `epistemic_type: normative_prescription` → N/A (Desires don't get confidence, they get priority)
- `epistemic_type: interpretive_lens` → confidence 0.4-0.6
- `epistemic_type: definitional` → confidence 0.5 (definitional claims are conventional, not empirical)
- Source reference count: nodes with 3+ `source_refs` get a +0.1 confidence boost
- QBAF `base_strength` already exists on AN claims — use as a signal for the parent taxonomy node's confidence

For Desires, priority can be seeded from the taxonomy hierarchy:
- Root-level Desires (no parent) → priority 4-5 (these are structural values)
- Mid-tree Desires → priority 3
- Leaf Desires → priority 2
- The doctrinal boundaries in `POVER_INFO` explicitly name the non-negotiable values → those Desire nodes are priority 5

**For new nodes (from ingestion or reflection):**
The extraction prompt already produces `epistemic_type`. Add a `confidence` instruction:

```
Rate your confidence in this claim on a 0.0-1.0 scale:
- 0.9+: Multiple independent sources confirm this with empirical data
- 0.7-0.9: Strong evidence from authoritative sources, minor caveats
- 0.5-0.7: Plausible with some evidence, but contested or incomplete
- 0.3-0.5: Theoretically motivated but limited empirical support
- Below 0.3: Speculative or actively contested by significant evidence
```

### Evolution Through Debates

This is where the system gets powerful. Confidence and priority should **change based on debate outcomes**.

**Confidence updates:**
- After a debate where a Belief is successfully attacked (AN claim with `computed_strength < 0.3` after QBAF propagation), reduce confidence by 0.05-0.10
- After a debate where a Belief survives attack (AN claim maintains `computed_strength > 0.7` despite attacks), increase confidence by 0.05
- After a debate where a Belief is cited as evidence by the *opposing* camp (cross-POV validation), increase confidence by 0.10
- When a source document directly contradicts a Belief with empirical data, reduce confidence by 0.15

The update formula should be conservative — Bayesian updating with a strong prior. Single debates shouldn't flip a node from 0.8 to 0.3. But accumulated evidence across many debates should gradually shift confidence toward the empirical reality.

**Priority updates:**
- After a reflection where a debater concedes a Desire is less important than they thought, reduce priority by 1
- After a debate where a Desire is the crux of the disagreement (appears in synthesis `cruxes`), maintain or increase priority — contested values are core values
- Priority should NEVER change from debate outcomes alone — it requires the camp's own reflection to acknowledge a priority shift. External pressure doesn't change values; it reveals them.

### Human Override

Both confidence and priority should be editable in the Taxonomy Editor. The automated updates are suggestions — the human researcher makes the final call. The UI should show:
- Current value
- Automated suggestion (with rationale: "Reduced 0.05 because debate X attacked this claim successfully")
- History of changes (audit trail)

## System Changes

### Taxonomy Data Model

```jsonc
// Beliefs get confidence
{
  "id": "acc-beliefs-003",
  "category": "Beliefs",
  "label": "Scaling Laws Predict Capability Gains",
  "confidence": 0.82,
  "confidence_history": [
    {"date": "2026-05-01", "value": 0.75, "reason": "Initial assignment from epistemic_type + source_refs"},
    {"date": "2026-05-15", "value": 0.82, "reason": "Debate deb-abc123: claim survived attack by Sentinel (QBAF strength 0.78)"}
  ],
  // ... existing fields
}

// Desires get priority
{
  "id": "saf-desires-001",
  "category": "Desires",
  "label": "Preventing AI Global Catastrophe",
  "priority": 5,
  "priority_history": [
    {"date": "2026-05-01", "value": 5, "reason": "Doctrinal boundary — non-negotiable safetyist value"}
  ],
  // ... existing fields
}
```

### Debate Engine — Taxonomy Context Injection

Currently, taxonomy context is injected as a flat list of nodes. With confidence and priority, the injection should be **weighted**:

- **Sort by relevance × confidence** (for Beliefs) or **relevance × priority** (for Desires)
- High-confidence Beliefs appear first — debaters ground arguments in well-supported claims
- High-priority Desires appear first — debaters know which values are non-negotiable
- Low-confidence Beliefs can still appear but are marked: "Speculative (confidence 0.4)"

The debater prompt should acknowledge the weighting:
```
Your Beliefs are ordered by evidential confidence. Lead with well-supported
claims. When you cite a low-confidence Belief, acknowledge the uncertainty
explicitly — "While not yet conclusively demonstrated, there is reason
to believe..."
```

### Debate Engine — Judge Quality Assessment

The judge currently evaluates argument quality without knowing how well-supported the claims are. With confidence:

- Citing a confidence-0.9 Belief as "established fact" → appropriate
- Citing a confidence-0.4 Belief as "established fact" → weakness ("Treats speculative claim as settled")
- Citing a confidence-0.4 Belief with appropriate hedging → appropriate
- Building an entire argument on a single confidence-0.4 Belief → structural weakness

The judge prompt would include:
```
The debater's claims reference Beliefs with these confidence levels:
- acc-beliefs-003 (0.82): Scaling Laws Predict Capability Gains
- acc-beliefs-047 (0.41): AI Will Achieve Recursive Self-Improvement

Assess whether the debater's rhetoric matches the evidential basis.
Treating a 0.41-confidence claim as settled fact is a weakness.
Honestly hedging a low-confidence claim is a strength.
```

### Debate Engine — Concession Logic

Currently, concessions are driven by moderator prompts and move selection. With priority:

- Debaters should concede low-priority Desires more readily than high-priority ones
- The moderator can reference priority when forcing engagement: "Sentinel, this is your priority-5 value — defend it specifically, not generically."
- Concession of a priority-5 Desire is a major event — it should be flagged prominently in the transcript

### Edge Discovery

Confidence should influence edge weight:
- CONTRADICTS between two high-confidence Beliefs (0.8 vs 0.8) → weight 0.9 (genuine empirical tension)
- CONTRADICTS between a high-confidence and a low-confidence Belief (0.8 vs 0.3) → weight 0.5 (one side is probably wrong)
- SUPPORTS from a high-confidence Belief to an Intention → strong grounding
- SUPPORTS from a low-confidence Belief to an Intention → weak grounding (flag in edge rationale)

### Synthesis and News Report

The synthesis phase currently lists all disagreements equally. With confidence:

- Disagreements between high-confidence Beliefs on both sides → genuine empirical tension worth investigating
- Disagreements where one side has confidence 0.8 and the other 0.3 → the evidence favors one side; the synthesis should say so
- The news report "The Crux" section can distinguish: "This is a genuine scientific disagreement" vs "The evidence strongly favors one position, but the other camp maintains its stance for values-based reasons"

### Policy Consensus Scoring

The `computeConsensusScores()` function currently weights by member_count and cross-POV distribution. With priority:

- A policy endorsed by priority-5 Desires across camps is more significant than one endorsed by priority-2 Desires
- Policies that serve high-priority Desires from opposing camps are the strongest consensus candidates
- The PolicyDashboard should surface: "This policy serves the highest-priority values of both safety researchers and AI skeptics"

### Reflection and Post-Debate Updates

The reflection prompt should receive confidence and priority data:

```
Your Beliefs, ranked by confidence:
  0.82  Scaling Laws Predict Capability Gains
  0.65  Compute Governance as Regulatory Capacity
  0.41  AI Will Achieve Recursive Self-Improvement

After this debate, consider:
- Should any confidence levels change based on what your opponents demonstrated?
- Did you successfully defend your high-confidence claims?
- Did you rely on a low-confidence claim that your opponents effectively challenged?

For Desires, your priorities:
  5  Preventing AI Global Catastrophe
  4  Ensuring Pre-Deployment Safety Verification
  3  Maintaining Human Oversight
  2  Improving AI Documentation

Did this debate reveal that any priority should shift? Note: priority changes
are significant — they indicate a genuine values reassessment, not just a
tactical concession.
```

### UI Changes

**Node Detail panel:**
- Confidence/priority displayed as a colored bar alongside the node label
- History timeline showing how the value has evolved across debates
- "Override" button for human adjustment with rationale field

**Taxonomy overview:**
- Heat map by confidence: high-confidence nodes are solid, low-confidence nodes are faded
- Priority indicators on Desire nodes: stars, numbers, or size scaling

**Debate transcript:**
- When a debater cites a low-confidence Belief, the transcript could show a subtle indicator
- The Caveats panel already exists — low-confidence claims would appear there automatically

## Implementation Phases

### Phase 1: Schema + Initial Assignment
- Add `confidence` to Belief nodes, `priority` to Desire nodes
- Add `confidence_history` and `priority_history` arrays
- Run initial assignment script using existing `graph_attributes`
- Display in Node Detail panel

### Phase 2: Debate Engine Integration
- Weighted taxonomy context injection
- Judge awareness of confidence levels
- Priority-aware concession logic

### Phase 3: Automated Evolution
- Post-debate confidence updates from QBAF outcomes
- Priority updates from reflection concessions
- Human review/override workflow

### Phase 4: Downstream Effects
- Edge weight modulation by confidence
- Synthesis confidence-aware preference evaluation
- Policy consensus scoring with priority weighting
- News report distinction between empirical and values disputes

## Risks and Mitigations

**Risk: Confidence becomes a popularity contest.**
Mitigation: Confidence is evidential, not social. A Belief with strong empirical support but held by only one camp should score high. The assignment rubric anchors on evidence quality, not breadth of endorsement.

**Risk: Priority gaming — camps inflate priorities to win debates.**
Mitigation: Priority is set by the taxonomy, not by the debater in real-time. Changes require reflection + human review. The doctrinal boundaries already pin the top priorities.

**Risk: Confidence values drift through accumulation of small updates.**
Mitigation: Bayesian updating with strong priors. Cap total drift at ±0.3 from initial assignment. Require human review for any change >0.2 from the initial value.

**Risk: Over-engineering — adding complexity without measurable improvement.**
Mitigation: Start with Phase 1 (display only) and measure whether human reviewers find the confidence/priority annotations useful before wiring them into the debate engine. If they don't help humans evaluate the taxonomy, they won't help the AI either.
