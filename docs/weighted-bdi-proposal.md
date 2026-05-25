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

**For existing nodes (~335 Beliefs):**

Run a one-time multi-signal classification pass. The single-signal approach (epistemic_type + falsifiability only) produces a compressed distribution — 100% of nodes land in just two buckets (Well-supported and Plausible) with only 4-5 unique values. The multi-signal formula below spreads the distribution across all five tiers with 42 unique values, validated empirically against the full taxonomy.

**Multi-signal confidence formula:**

```
confidence = clamp(base + evidence_boost + debate_boost + edge_boost, 0.10, 0.95)

where:
  base = f(epistemic_type, falsifiability):
    empirical_claim + high falsifiability  → 0.80
    empirical_claim + medium falsifiability → 0.70
    empirical_claim + low falsifiability   → 0.60
    predictive                             → 0.40
    interpretive_lens                      → 0.50
    definitional                           → 0.50
    other                                  → 0.50

  evidence_boost = min(0.15, source_doc_count × 0.05)
    # +0.05 per unique source document in the evidence index, capped at +0.15
    # Nodes with evidence from 3+ documents get the maximum boost

  debate_boost = min(0.10, debate_ref_count × 0.03)
    # +0.03 per debate that has referenced this node, capped at +0.10
    # Currently sparse (91% of nodes have 0 debate refs) — becomes more
    # discriminative as more debates accumulate

  edge_boost = min(0.05, supports_received × 0.02) - min(0.05, attacks_received × 0.02)
    # Net effect of taxonomy edge support/attack balance
    # 64% of Beliefs have 6+ supports; 39% have 6+ attacks
    # Range: -0.05 (heavily attacked, no support) to +0.05 (heavily supported, no attacks)
```

**Resulting distribution (validated against 335 Belief nodes):**

| Bucket | Before (single-signal) | After (multi-signal) |
|---|---|---|
| Established (0.9-1.0) | 0 (0%) | 74 (22%) |
| Well-supported (0.7-0.9) | 207 (62%) | 138 (41%) |
| Plausible (0.5-0.7) | 128 (38%) | 114 (34%) |
| Speculative (0.3-0.5) | 0 (0%) | 9 (3%) |
| Contested (0.0-0.3) | 0 (0%) | 0 (0%) |

The Contested bucket remains empty at initial assignment — this is correct. No Belief should start as Contested; that status should only come from debate outcomes that undermine it (see Evolution Through Debates below).

**Signal availability and discriminative power:**

| Signal | Coverage | Power | Notes |
|---|---|---|---|
| epistemic_type + falsifiability | 100% | Low | Only 4-5 distinct values |
| Source document count | 74% have docs | High | 51% have 4+ docs |
| Evidence index items | 74% have entries | High | 35.5% have 11+ items |
| Taxonomy supports | 88% have supports | High | 64% have 6+ |
| Taxonomy attacks | 75.5% have attacks | High | 39% have 6+ |
| Debate refs | 8.7% have any | Low (currently) | Will improve as debates accumulate |

- `normative_prescription` → N/A (Desires don't get confidence, they get priority)

For Desires, priority can be seeded from the taxonomy hierarchy:
- Root-level Desires (no parent) → priority 4-5 (these are structural values)
- Mid-tree Desires → priority 3
- Leaf Desires → priority 2
- The doctrinal boundaries in `POVER_INFO` explicitly name the non-negotiable values → those Desire nodes are priority 5

**For new nodes (from ingestion or reflection):**
New nodes start with a base confidence from `epistemic_type` + `falsifiability` (the first term of the multi-signal formula). The evidence, debate, and edge boosts are applied retroactively as the node accumulates data — a new node with zero evidence, zero debates, and zero edges gets the base value only. As it participates in debates and gains evidence index entries, its confidence adjusts upward or downward automatically via the formula above. No LLM-based confidence rating is needed — the multi-signal formula is fully deterministic from existing metadata.

### Per-Claim Taxonomy Attribution (prerequisite for confidence evolution)

> **Implementation approved independently of the broader weighted-BDI proposal.** This section is being implemented regardless of the final decision on confidence/priority scoring. See t/110 (Shared Lib: attribution engine) and t/111 (Taxonomy Editor: diagnostics display, blocked by t/110).

The confidence evolution mechanism below requires knowing which specific taxonomy Belief a given AN claim instantiates. Currently, AN claims inherit `taxonomy_refs` from their parent transcript entry — every claim extracted from a statement gets the **same** set of taxonomy refs, even though individual claims may only relate to one of them. This makes it impossible to attribute a QBAF outcome (attack, defeat, survival) to a specific taxonomy Belief.

**Solution: post-extraction embedding-based attribution.**

After claims are extracted and embedded (all-MiniLM-L6-v2, 384-dim — already computed), compute cosine similarity between each claim's embedding and the embeddings of the parent statement's taxonomy refs. Assign each claim its best-matching taxonomy node(s):

```typescript
interface ClaimTaxonomyAttribution {
  /** The taxonomy node ID this claim most closely instantiates. */
  primary_ref: string;
  /** Cosine similarity between claim embedding and node embedding. */
  attribution_confidence: number;
  /** Secondary refs above a minimum threshold (0.40). */
  secondary_refs?: { node_id: string; similarity: number }[];
}
```

**Process:**

1. For each AN claim, retrieve its 384-dim embedding (already computed at extraction).
2. Compare against **all same-POV Belief nodes** (not just the parent statement's taxonomy refs). The parent statement's refs are too narrow — the claim may instantiate a Belief that wasn't explicitly cited. With ~300 nodes per POV and 384-dim vectors, this is ~300 dot products per claim — trivial. *(Per Technical Lead review, p/35.)*
3. Compute cosine similarity between the claim and each candidate node.
4. Assign `primary_ref` = highest-similarity node. Record `attribution_confidence` = that similarity score.
5. Any additional nodes with similarity > 0.40 become `secondary_refs`.
6. If no node exceeds 0.35 similarity, the claim is **unattributed**. Record the reason:
   - `"novel_argument"` — the claim represents a genuinely new argument not grounded in any taxonomy node
   - `"no_embedding"` — the claim or candidate nodes are missing embeddings (data issue, not semantic)
   *(Per Diagnostics review, p/36#3: distinguish missing data from genuine novelty.)*

**Failure mode handling:** *(Per Diagnostics review, p/36#3.)*
- **Missing embeddings:** Log a flight recorder event (`type: "attribution.missing-embedding"`, `claim_id`). Mark as unattributed with reason `"no_embedding"`.
- **Zero taxonomy_refs on parent statement:** Not a blocker (we now compare against all same-POV nodes), but log a flight recorder event (`type: "attribution.no-statement-refs"`) — it indicates taxonomy context injection may have failed upstream.
- **High unattributed rate:** Track a debate-level metric `unattributed_claim_ratio`. If >50% of claims in a debate are unattributed, log a warning — this signals a systemic problem (bad topic framing, stale taxonomy, or broken injection), not per-claim noise.
- **Flight recorder:** Every attribution decision should be recorded: `{ type: "attribution.computed", claim_id, primary_ref, attribution_confidence, secondary_refs_count, doctrinally_anchored, unattributed_reason }`. Without this, post-hoc debugging of "why was this claim attributed to node X?" is impossible.

**Why embedding-based, not prompt-based:** The embeddings already exist on both sides (claim embeddings for AN-based relevance scoring, node embeddings for taxonomy matching). The computation is a dot product — sub-millisecond per claim. No additional LLM call, no prompt complexity increase, no extraction latency. Post-extraction attribution is deterministic, auditable, and reproducible — you can inspect the similarity score rather than trusting the AI to self-report. *(Per Technical Lead review, p/35.)*

**Storage:** Add `claim_taxonomy_attribution: ClaimTaxonomyAttribution` to `ArgumentNetworkNode`. This is a new optional field — absent in pre-attribution debates, populated going forward. Storage cost: ~150 bytes per AN node (~2-4KB per debate, negligible). Any code path reading AN nodes must handle the missing field (type guard or default). Add orphaned attribution ref detection to `Test-TaxonomyIntegrity` — if a taxonomy node is renamed or deleted, attributions referencing it become stale. *(Per Technical Lead review, p/35.)*

### Evolution Through Debates

This is where the system gets powerful. Confidence and priority should **change based on debate outcomes**.

**Confidence updates (refined — AN-to-taxonomy attribution required):**

An AN claim being attacked is not the same as its parent taxonomy Belief being attacked. The update should only fire when the attack targets the Belief's *substance*, not its *expression*. Three conditions must hold:

1. The AN claim must have `attribution_confidence > 0.60` for the target Belief — the claim genuinely instantiates this Belief, not a loose association.
2. The attack must be an `undermine` type (attacks the premise/evidence) rather than a `rebut` (attacks the conclusion) or `undercut` (attacks the inference) — undermines target the Belief's evidential foundation, which is what confidence measures.
3. The attack claim itself must have QBAF `computed_strength > 0.5` — a weak attack shouldn't reduce confidence even if the defender failed to respond.

When all three conditions hold:
- AN claim with `attribution_confidence > 0.60` to Belief X, **undermined** by attack with `computed_strength > 0.5`, and AN claim's strength drops below 0.3 → reduce Belief X's confidence by 0.05-0.10
- AN claim with `attribution_confidence > 0.60` to Belief X survives attack (maintains `computed_strength > 0.7` despite attacks) → increase confidence by 0.05
- AN claim attributed to Belief X is cited as evidence by the *opposing* camp (cross-POV validation) → increase confidence by 0.10
- When a source document directly contradicts a Belief with empirical data → reduce confidence by 0.15 (this path doesn't require AN attribution — it's document-level)

The update formula should be conservative — Bayesian updating with a strong prior. Single debates shouldn't flip a node from 0.8 to 0.3. But accumulated evidence across many debates should gradually shift confidence toward the empirical reality.

**Cross-debate deduplication (critical for multi-model workflows):**

Researchers often run the same debate topic multiple times with different AI models. Without deduplication, the same Belief gets attacked by structurally identical arguments from each model, compounding confidence reductions for what is essentially one piece of evidence. Three models making the same attack is confirmation of robustness, not three independent reasons to reduce confidence.

Three safeguards:

1. **Topic-based deduplication.** Before applying a confidence update from debate N, check whether a prior debate on a sufficiently similar topic (cosine similarity > 0.80 on the topic embedding) already updated this same Belief node. If so, take the max magnitude of the two updates, don't sum them. The `confidence_history` entry should record `supersedes: "debate-id"` when a prior update is replaced.

2. **Attack-vector deduplication.** Each confidence update records the AN claim text that drove the strength change. Before applying an update, compute cosine similarity between the new attack claim and all prior attack claims on this Belief. If similarity > 0.85, the attacks represent the same argument — the new update replaces the prior one (if stronger) or is discarded (if weaker). Only genuinely novel attack vectors (similarity < 0.85 to all prior attacks) warrant additional confidence reduction.

3. **Cross-model robustness scoring.** When the same Belief is attacked successfully across multiple models on similar topics, record this as a `robustness` field on the confidence history entry rather than as additional reductions:
   ```jsonc
   {
     "date": "2026-05-24",
     "value": 0.42,
     "delta": -0.08,
     "reason": "Debate deb-xyz: claim attacked below 0.3 (QBAF strength 0.22)",
     "attack_claim": "Recursive self-improvement requires capability gains that scaling laws do not predict",
     "robustness": 3,  // Confirmed by 3 different models
     "model_confirmations": ["gemini-2.0-flash", "claude-sonnet-4-20250514", "llama-3.3-70b"]
   }
   ```
   A robustness score of 3+ means the attack is model-independent — strong evidence. But confidence is reduced once, not three times.

The deduplication key is: `(Belief node ID, topic embedding cluster, attack vector embedding cluster)`. Same key = same evidence, regardless of how many models or debate runs produced it.

**Cross-debate state implementation:** *(Per Technical Lead review, p/35 and Diagnostics review, p/36#3.)*

This is the first feature requiring cross-debate queries, which introduces new failure modes:

- **Storage:** Use a lightweight `debate-confidence-index.json` alongside the debates directory: `{ belief_node_id: [{ debate_id, topic_embedding_hash, attack_claim_embedding, delta, date, embedding_model }] }`. This avoids loading full debate JSON files for comparison (~50KB even at 100+ debates). *(Per Technical Lead.)*
- **Embedding model versioning:** If the embedding model changes (e.g., from all-MiniLM-L6-v2 to a newer model), prior debate embeddings are incomparable. Add `embedding_model` to debate sessions and **skip cross-debate comparison when models differ**. *(Per Diagnostics.)*
- **Idempotent dedup:** The dedup logic must be recomputable from current state, not dependent on the supersession chain being intact. If a debate is deleted or a confidence update is manually overridden, the remaining updates should still be consistent. *(Per Diagnostics.)*
- **Corruption resilience:** If the dedup index is corrupted or missing, the system should rebuild it from debate files (one-time scan) rather than failing. Log a flight recorder event: `type: "confidence.dedup-index-rebuild"`.
- **Flight recorder:** Every deduplication decision needs a flight recorder event with the similarity scores that drove it: `{ type: "confidence.dedup-applied", belief_id, superseded_debate_id, similarity_topic, similarity_attack }`. This is the hardest thing to debug after the fact without explicit logging.

**Three-condition gate monitoring:** *(Per Diagnostics review, p/36#3.)*

The conjunction of three conditions (attribution_confidence > 0.60 AND undermine type AND attack strength > 0.5) means very few updates will fire. Track the **near-miss rate**: how often do 2-of-3 conditions hold? If it's high, the thresholds may be too strict and the system appears "stuck" — Beliefs never update despite being debated. Log: `{ type: "confidence.near-miss", belief_id, conditions_met: ["attribution", "attack_strength"], missing: "undermine_type" }`.

**`confidence_history` retention policy:** *(Per Diagnostics review, p/36#3.)*

Cap history at the last 30 entries or 12-month window. When pruning, store a summary: `{ "pruned_count": 47, "earliest_pruned": "2026-03-01", "net_delta_pruned": -0.12 }`. This prevents unbounded growth while preserving the audit trail's essential information.

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
    {"date": "2026-05-15", "value": 0.82, "reason": "Debate deb-abc123: claim survived attack by Safetyist (QBAF strength 0.78)"}
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

### Debate Engine — Doctrinal Boundary Integration with Belief Confidence

Each debater has **doctrinal boundaries** — non-negotiable positions defined in `POVER_INFO.doctrinal_boundaries` and injected into every debate prompt as "positions you must NEVER adopt." These are the system's existing "must not concede" items:

- **Accelerationist:** REJECT precautionary principle as default, capability limitations as permanent, regulatory capture framing of all governance, AI progress as inherently zero-sum
- **Safetyist:** REJECT dismissing existential risk as speculative, speed-over-safety framing, market self-regulation as sufficient, competitive pressure justifying unverified deployment
- **Skeptic:** REJECT binary framing (existential vs trivial), techno-determinism, insider expertise as sole legitimate view, future hypotheticals overriding present documented harms

These doctrinal boundaries should **anchor Belief confidence scoring**. Specifically:

**Beliefs that are cosine-similar to a debater's doctrinal boundaries should receive the highest confidence priority.** A Belief that directly supports or instantiates a doctrinal boundary is, by definition, one the debater considers foundational — it should be treated as high-confidence regardless of its empirical grounding score, because it represents a load-bearing commitment that the debater will defend maximally.

**Implementation:**

1. **Embed the doctrinal boundary strings** for each POV using the same all-MiniLM-L6-v2 model used for taxonomy embeddings. Each POV has 4 boundaries, producing 4 x 384-dim vectors per debater. Compute once at debate setup and cache on the session object — do not recompute per turn. *(Per Technical Lead review, p/35.)*

2. **For each Belief node**, compute cosine similarity against the POV's boundary embeddings. If any boundary similarity exceeds a threshold (e.g., 0.55), the node is **doctrinally anchored**. **Calibration prerequisite:** Before committing to 0.55, run a dry-run of all 12 boundary embeddings against all Belief nodes and inspect the similarity distribution. The boundary strings are short (5-15 words each) which produces less discriminative vectors — the threshold may need adjustment. Add a sanity check at debate setup: if doctrinally anchored count is <3 or >30% of Belief nodes for a POV, log a warning (`type: "doctrinal.threshold-anomaly"`). *(Per Diagnostics review, p/36#3.)*

3. **Doctrinally anchored Beliefs get a confidence floor.** Even if the evidential grounding classifier rates them as "asserted" (0.20), a doctrinally anchored Belief should not score below 0.60 (configurable via prompt config, same pattern as debate temperature — not hardcoded). The debater will fight hardest for these claims — treating them as weak in QBAF propagation misrepresents their actual strategic importance. **Important:** The confidence floor creates a value discontinuity — the confidence no longer represents evidential support, it represents strategic importance. The diagnostics MUST show both values: `confidence: 0.60 (floor applied, evidential: 0.20)`. Without this, a researcher looking at confidence values cannot distinguish "well-supported" (evidential 0.60) from "doctrinally protected" (floor 0.60). *(Per Diagnostics review, p/36#3.)*

4. **Doctrinally anchored Beliefs get injection priority.** In the weighted taxonomy context injection, these nodes should appear in the primary tier alongside high-relevance nodes, even if their topic-relevance score is moderate. The debater needs to see its doctrinal foundations to defend them.

5. **The lookahead gate should treat attacks on doctrinally anchored Beliefs as high-value.** When computing `attack_effectiveness`, weakening an opponent's doctrinally anchored node should count more than weakening a peripheral node. Similarly, when evaluating a speaker's own turn, claims that defend doctrinally anchored Beliefs should receive a utility bonus.

**Connection to the concession exemption (t/58):** The lookahead gate already exempts concession claims from the utility delta to avoid penalizing intellectual honesty. Doctrinally anchored Beliefs represent the flip side — these are claims where concession is *not* honest updating but *structural capitulation*. The anti-sycophancy guard should weight doctrinal boundary violations higher than generic position drift.

**Example:**

Safetyist's doctrinal boundary: "REJECT: Dismissing existential risk as speculative"

Taxonomy node `saf-beliefs-012`: "Current alignment techniques are insufficient for systems exhibiting emergent goal-directed behavior" — cosine similarity to the boundary embedding: 0.68.

This node is doctrinally anchored. Even if it scores "reasoned" (0.50) on evidential grounding, its effective confidence floor is 0.60. It appears in primary-tier context injection. If Safetyist concedes this Belief without explicit, well-reasoned justification, the sycophancy guard treats it as a doctrinal violation, not a legitimate update.

**Data flow:**

```
POVER_INFO.doctrinal_boundaries (4 strings per POV)
  → embed once at debate setup (4 x 384-dim vectors)
  → for each Belief node: max cosine sim against boundary embeddings
  → if sim > 0.55: set doctrinally_anchored = true, confidence_floor = 0.60
  → inject into relevance scoring as a boost (same pattern as lineage boost)
  → inject into lookahead gate as attack-value multiplier
  → inject into sycophancy guard as violation severity weight
```

This connects the existing "must not concede" infrastructure (prompt-level instruction) to the weighted BDI system (data-level scoring), closing the gap between what the debater is *told* to defend and what the system *scores* as defensible.

### Debate Engine — Concession Logic

Currently, concessions are driven by moderator prompts and move selection. With priority:

- Debaters should concede low-priority Desires more readily than high-priority ones
- The moderator can reference priority when forcing engagement: "Safetyist, this is your priority-5 value — defend it specifically, not generically."
- Concession of a priority-5 Desire is a major event — it should be flagged prominently in the transcript
- **Concession of a doctrinally anchored Belief should trigger a doctrinal violation warning** — the debater has crossed a line it was explicitly told not to cross. This is distinct from a low-priority concession (acceptable) or even a high-priority concession (significant but legitimate). A doctrinal boundary violation suggests the prompt constraints failed, not that the debater genuinely updated.

### Edge Weight Modulation by Confidence and Priority

The current 26,023 edges in `edges.json` have weights assigned without knowledge of node confidence or priority. With the weighted BDI data, edge weights should reflect the epistemic and values significance of both endpoints.

**Edge weight modulation formula:**

```
modulated_weight = raw_weight × modulation_factor(source, target, edge_type)
```

The modulation factor depends on the BDI categories of the source and target nodes and the edge type:

**Belief → Belief edges:**
```
CONTRADICTS:  factor = min(source.confidence, target.confidence)
  # A contradiction between two well-supported claims (0.8 vs 0.8) is a genuine
  # empirical tension (factor = 0.8). A contradiction where one side is speculative
  # (0.8 vs 0.3) is less significant (factor = 0.3) — one side is probably wrong.
SUPPORTS:     factor = source.confidence
  # A well-supported Belief lending support transfers its confidence to the target.
ASSUMES:      factor = source.confidence
  # An assumption is only as load-bearing as the claim that makes it.
```

**Desire → Intention edges:**
```
SUPPORTS:     factor = source.priority / 5
  # A priority-5 Desire supporting an Intention makes that Intention critical.
  # A priority-2 Desire supporting the same Intention makes it optional.
  # Example: "Preventing AI-driven extinction" (5) → SUPPORTS → "Mandatory pre-deployment testing"
  #   factor = 1.0 (full weight — this Intention serves a core value)
  # vs: "Improving AI Documentation" (2) → SUPPORTS → same Intention
  #   factor = 0.4 (reduced — this is a nice-to-have connection)
```

**Belief → Intention edges (SUPPORTS/ASSUMES):**
```
factor = source.confidence
  # An Intention grounded in a well-supported Belief (0.85) has strong empirical
  # backing. An Intention grounded in a speculative Belief (0.35) has weak backing.
  # The grounding quality should be visible in the edge weight.
```

**Belief → Desire edges (rare but exist — e.g., ASSUMES):**
```
factor = source.confidence
  # A Desire that assumes a speculative Belief is built on shaky ground.
```

**Cross-POV edges (any type):**
```
  # No additional modulation beyond the above — cross-POV edges already carry
  # significance from the edge type (CONTRADICTS, TENSION_WITH). The confidence/
  # priority modulation applies to the endpoints regardless of POV.
```

**Doctrinally anchored edges:**
When either endpoint is a doctrinally anchored Belief:
```
  # CONTRADICTS targeting a doctrinally anchored node: factor × 1.2 (cap at 1.0)
  #   Attacks on doctrinal positions are higher-stakes — the weight should reflect this.
  # SUPPORTS from a doctrinally anchored node: factor × 1.1 (cap at 1.0)
  #   Doctrinal Beliefs lending support make the target more structurally important.
```

**QBAF propagation impact:**

Edge weight modulation flows directly into DF-QuAD computation. Higher-weight attack edges produce larger strength reductions on the target. This means:
- QBAF outcomes are more decisive when evidence asymmetry is clear (high-confidence Belief attacking low-confidence Belief)
- QBAF outcomes are more balanced when both sides have similar confidence
- Intentions grounded in high-priority Desires are harder to dislodge than those grounded in low-priority Desires
- The argument network becomes a richer representation of the actual epistemic and values landscape, not just a connectivity graph

### Edge Reprocessing Plan

The 26,023 existing edges in `edges.json` need reprocessing once confidence and priority values are assigned (Phase 1). This is a batch operation, not a real-time change.

**Step 1: Assign confidence and priority (Phase 1 prerequisite)**
- Run the multi-signal confidence formula across all 335 Belief nodes
- Assign priority to all Desire nodes from taxonomy hierarchy + doctrinal boundaries
- Store on the node objects in the POV JSON files

**Step 2: Compute modulated weights**
- For each edge in `edges.json`, look up source and target node confidence/priority
- Apply the modulation formula above to compute `modulated_weight`
- Store both `raw_weight` (original) and `modulated_weight` on each edge
- Preserving `raw_weight` allows reverting or recomputing if confidence/priority values change

**Step 3: Validate modulation distribution**
- Before committing, analyze the modulated weight distribution:
  - What fraction of edges have modulated_weight significantly different from raw_weight (delta > 0.1)?
  - Are any edge types disproportionately affected (e.g., all SUPPORTS edges getting boosted)?
  - Do any edges modulate to near-zero (effectively deleted)?
- Flag anomalies for human review before overwriting

**Step 4: Reprocess debate argument networks**
- Existing debates have AN edges with weights that predate confidence/priority modulation
- For active/recent debates: rerun QBAF propagation with modulated weights and log the strength deltas
- For archived debates: do not reprocess — their calibration data was generated under the old weights and should remain consistent
- New debates automatically use modulated weights via the edge discovery pipeline

**Step 5: Update the edge discovery pipeline**
- `Invoke-EdgeDiscovery` (PowerShell) and any TypeScript edge discovery code must apply modulation at edge creation time, not retroactively
- When a new edge is discovered between nodes with confidence/priority data, the `modulated_weight` is computed inline
- When confidence or priority changes (via debate evolution or human override), affected edges are recomputed — this is a targeted update, not a full reprocess

**Reprocessing frequency:**
- Full reprocess: once, after Phase 1 initial assignment
- Targeted reprocess: after each confidence/priority update (post-debate or human override), recompute modulated_weight for edges touching the changed node
- The targeted reprocess touches ~50-100 edges per node (average degree in the edge graph) — trivially fast

**Rollback plan:**
- Preserve `raw_weight` on every edge so modulation can be removed or recomputed
- If the modulation produces pathological QBAF behavior (e.g., debates consistently stalling because all attacks are too weak), the modulation can be disabled by setting `modulated_weight = raw_weight` globally

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

### Diagnostics Window — Per-Claim Taxonomy Attribution Display

Every AN claim in the diagnostics view should show its taxonomy attribution, making it immediately visible which taxonomy node a claim instantiates and how confident that mapping is.

**Claims tab (per-turn entry diagnostics):**

Update the existing AN claim display (currently shows: ID, speaker, BDI category, grounding adjective, strength) to include:

```
AN-8  Safetyist Asserted Belief  Very Weak 0.10  [unaddressed]
      → saf-beliefs-012 (0.72)  "Insufficient alignment techniques for emergent goal-directed behavior"
```

The second line shows:
- `primary_ref` node ID (e.g., `saf-beliefs-012`)
- `attribution_confidence` in parentheses (e.g., `0.72`)
- The taxonomy node's label (truncated to ~70 chars)

**Color coding for attribution confidence:**
- Green (>= 0.60): strong attribution — high confidence this claim instantiates this Belief
- Amber (0.40 - 0.59): moderate — plausible but the claim may be paraphrasing loosely
- Red (< 0.40): weak — the claim may not genuinely instantiate any injected taxonomy node
- Gray: unattributed — no taxonomy ref exceeded the 0.35 minimum threshold

**Argument network overview tab:**

In the full argument network graph view, each node's tooltip or detail panel should show:
- Primary taxonomy attribution (node ID + label + confidence)
- Whether the node is doctrinally anchored (for Belief claims)
- The grounding classification (Grounded/Reasoned/Asserted)

**Filtering:**

Add a filter control to the claims and argument network views:
- "Show only claims attributed to [taxonomy node ID]" — useful for tracing how a specific Belief is represented across the debate
- "Show only unattributed claims" — identifies novel arguments not grounded in the injected taxonomy
- "Show only doctrinally anchored claims" — highlights the debate's load-bearing commitments

**Confidence evolution trace:**

When confidence updates are implemented (Phase 3), the diagnostics should show:
- Which AN claims triggered a confidence update on which taxonomy Belief
- The attack type (undermine/rebut/undercut) and attack strength
- Whether the update was deduplicated against a prior debate
- The before/after confidence values

This creates end-to-end traceability: taxonomy Belief → injected into context → instantiated as AN claim → attacked/defended → confidence updated → fed back to taxonomy.

## Implementation Phases

### Phase 1: Schema + Initial Assignment
- Add `confidence` to Belief nodes, `priority` to Desire nodes
- Add `confidence_history` and `priority_history` arrays
- Run initial assignment script using existing `graph_attributes`
- Display in Node Detail panel
- **Add per-claim taxonomy attribution** (`claim_taxonomy_attribution` on ArgumentNetworkNode) via post-extraction embedding similarity

### Phase 2: Debate Engine Integration
- Weighted taxonomy context injection
- Judge awareness of confidence levels
- Priority-aware concession logic
- **Display per-claim attribution in diagnostics** (claims tab, AN overview, filtering)

### Phase 3: Automated Evolution
- Post-debate confidence updates from QBAF outcomes
- Priority updates from reflection concessions
- Human review/override workflow

### Phase 4: Edge Reprocessing + Downstream Effects
- **Edge weight modulation** — run full reprocess of 26,023 edges with confidence/priority modulation formula (see Edge Weight Modulation section). Store both `raw_weight` and `modulated_weight`. Validate distribution before committing.
- **Edge discovery pipeline update** — modify `Invoke-EdgeDiscovery` and TypeScript edge creation to apply modulation inline at discovery time
- **Targeted reprocess hook** — after any confidence/priority change, recompute modulated_weight for edges touching the affected node (~50-100 edges, trivially fast)
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
