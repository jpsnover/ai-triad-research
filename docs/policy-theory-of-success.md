# Policy Items: Theory of Success

## What a Policy Item Is

A policy item (`pol-NNN`) is a concrete, actionable policy proposal extracted from the AI policy literature and refined through multi-perspective debate. Where taxonomy nodes capture what each camp *believes*, *values*, and *intends*, policy items capture what any of them would actually *do* — the specific legislative, regulatory, or institutional mechanism they propose.

"Regulate AI" is not a policy item. "Require annual third-party safety audits for hiring AI" is.

Each policy item has:
- **Canonical action text** — a 5-15 word POV-neutral description of the mechanism
- **Source POVs** — which camps endorse or engage with this policy
- **Member count** — how many taxonomy nodes reference it
- **Tags** — topical categories (workforce, funding, taxation, etc.)
- **Per-node framings** — each referencing node explains how *its* position connects to the shared policy

## The Lifecycle

### Stage 1: Extraction from Sources

When a new document is ingested and summarized, the attribute extraction pipeline (`Invoke-AttributeExtraction`) identifies 0-3 policy actions per taxonomy node. At this point, actions have `policy_id: null` — they're raw proposals without registry identity.

The extraction prompt enforces specificity: it rejects vague proposals ("improve AI governance") and requires a named mechanism, target, and scope ("Mandate algorithmic impact assessments for federal procurement contracts exceeding $10M").

### Stage 2: Registry Matching and ID Assignment

`Find-PolicyAction` takes the raw actions and matches them against the existing registry (`policy_actions.json`, ~1,500 entries). If an action matches an existing policy (≥0.85 similarity), it reuses that `pol-NNN` ID. If novel, it assigns the next sequential ID.

This is the critical deduplication step. Without it, every source document would generate its own version of "require algorithmic audits" — the registry ensures that one canonical entry accumulates references from across the corpus.

### Stage 3: Registry Validation

`Update-PolicyRegistry` audits the registry for integrity:
- **Orphans** — policies in the registry that no node references (dead entries)
- **Unregistered** — node actions without a `policy_id` (missed in Stage 2)
- **Missing** — nodes referencing pol-NNN IDs that don't exist in the registry

The `-Fix` flag auto-repairs these issues: removing orphans, assigning IDs to unregistered actions, and recalculating `member_count` and `source_povs`.

### Stage 4: Multi-Node Refinement

When a policy has `member_count > 1` (referenced by two or more nodes, often across POVs), `Invoke-PolicyRefinement` calls an LLM to synthesize a better canonical action text from all the different framings. The refined text is POV-neutral — it describes the mechanism without endorsing or opposing it.

Refined text cascades to both the registry and all referencing nodes, keeping the entire system consistent.

### Stage 5: Debate Integration

During debates, the engine injects the top policies into the synthesis phase context. Debaters can cite policies by ID in their `policy_refs`, explaining how their argument supports, opposes, or modifies a specific policy. The cite stage prompt requires a 1-2 sentence relevance explanation per policy reference — not just a bare ID.

This creates a traced connection from abstract argumentation to concrete policy consequences: "My argument that compute should be governed as a public utility directly supports pol-042's proposal for tiered compute access."

### Stage 6: Debate Reflections and Evolution

Post-debate reflections can propose new taxonomy nodes (via REVISE/ADD/QUALIFY/DEPRECATE). When new nodes emerge from debate, they carry their own `policy_actions`, which feed back into Stage 2 — new policies enter the registry, or existing policies gain new cross-POV references.

This closes the loop: sources → taxonomy → debate → reflection → taxonomy → registry.

### Stage 7: Visualization and Analysis

The Taxonomy Editor provides two dedicated policy views:
- **PolicyDashboard** — registry overview: total count, cross-POV distribution, top-referenced policies, contradiction hotspots, timeline
- **PolicyAlignmentPanel** — cross-POV consensus analysis: which policies have support from multiple camps, which are contested, what edges connect them

## How Policy Items Make Things Better

### For researchers
Policy items answer "so what?" — they connect abstract positions to concrete legislative/regulatory actions. A researcher exploring the taxonomy doesn't just see that accelerationists believe in compute scaling; they see that this belief implies `pol-1001: Establish regulatory sandboxes for AI development`.

### For policymakers
The cross-POV alignment view reveals unexpected consensus. When an accelerationist and a safetyist both reference the same policy from different framings, that's a signal: this policy may be politically viable because it satisfies concerns on both sides.

### For the debate engine
Policy references ground the debate in consequences. Without them, debaters argue about abstract principles. With them, they argue about what Congress should actually do — and the synthesis can identify which specific policies the debate has strengthened, weakened, or complicated.

### For the academic paper
The policy registry provides empirical evidence for the paper's central claim: that structured multi-perspective debate can surface actionable policy consensus from contested AI discourse.

## What's Working

1. **Deduplication works.** ~1,500 policies with minimal redundancy, thanks to registry matching at extraction time.
2. **Cross-POV tracking works.** Policies with `member_count > 1` and multiple `source_povs` genuinely represent cross-cutting concerns, not just relabeled versions of the same position.
3. **Framing separation works.** The same policy can be endorsed by a safetyist (framing: "prevents harm") and an accelerationist (framing: "creates regulatory clarity"), and both framings are preserved.
4. **Debate citation works.** Since the cite stage prompt was updated to require relevance explanations, policy references are substantive connections, not decorative tags.

## What Needs Improvement

### 1. Policy items lack provenance to real-world legislation

**Problem:** Policy items are extracted from the literature, but they don't link to actual bills, regulations, or executive orders. `pol-1001: Establish regulatory sandboxes` doesn't reference the EU AI Act's sandbox provisions or any US state-level sandbox bills.

**Suggestion:** Add an optional `real_world_refs` field to each policy entry: `[{jurisdiction: "EU", instrument: "AI Act Art. 57-58", status: "enacted", url: "..."}]`. This turns policy items from academic proposals into traceable connections to real governance — the most valuable thing for a policymaker.

### 2. Policy items don't have a strength/consensus score

**Problem:** All policies are created equal. A policy referenced by 15 nodes across 3 POVs is listed alongside one referenced by a single node. The `member_count` helps, but there's no composite score reflecting cross-POV endorsement strength.

**Suggestion:** Compute a `consensus_score` from: (a) member_count, (b) number of distinct source_povs, (c) whether the policy appears in debate synthesis `policy_implications`, (d) edge analysis (more SUPPORTS than CONTRADICTS). Display this in PolicyDashboard as a ranked list.

### 3. Debate debaters underuse policies

**Problem:** Policy references appear reliably in the cite stage but debaters rarely *argue about* policies in their statements. They argue about principles, then the cite stage bolts on policy IDs after the fact.

**Suggestion:** Inject a policy challenge into the moderator's intervention repertoire: "Accelerationist, you've argued for regulatory sandboxes. Safetyist, pol-1001 proposes exactly this — do you support the specific mechanism, or only the principle?" This forces debaters to engage with concrete policy rather than staying at the level of abstract values.

### 4. Policy refinement is one-shot

**Problem:** `Invoke-PolicyRefinement` runs once per policy. But as new sources are ingested and new framings accumulate, the canonical text may drift from the best current synthesis.

**Suggestion:** Track a `last_refined_at` timestamp and `framing_count_at_refinement`. When `member_count` has grown by ≥3 since last refinement, flag for re-refinement. Automate this as a post-ingestion hook.

### 5. No policy lifecycle status

**Problem:** Policies are static once created. There's no way to mark a policy as superseded, split, merged, or archived. Over time, some policies will become redundant as the taxonomy evolves.

**Suggestion:** Add a `status` field: `active | superseded | merged | archived`. When a policy is superseded, record `superseded_by: "pol-NNN"`. When merged, record `merged_into: "pol-NNN"`. This prevents the registry from growing indefinitely while preserving history.

### 6. Policies don't flow into the news report

**Problem:** The news report feature (newly implemented) transforms debate synthesis into journalistic articles, but it doesn't surface policy implications. A policymaker reading the news report doesn't learn which specific `pol-NNN` actions are at stake.

**Suggestion:** Add a "Policy Implications" section to the news report template that lists 2-3 policies most affected by the debate's conclusions, with the consensus/conflict status from the synthesis.

### 7. No policy impact tracking across debates

**Problem:** If the same policy is cited in 5 different debates, there's no way to see how debate outcomes have affected its standing. Has it been consistently strengthened? Has a specific argument undermined it?

**Suggestion:** Build a `policy_debate_history` index: for each policy, record which debates cited it, what the synthesis verdict was (strengthened/weakened/complicated), and which arguments were most decisive. This would make the PolicyDashboard a longitudinal analysis tool, not just a snapshot.

## The North Star

The ultimate measure of success for the policy registry is: **can a congressional staffer look at the top 10 cross-POV policies and immediately understand what actions have multi-stakeholder support, what the strongest objections are, and what evidence would resolve the remaining disagreements?**

Today, the registry gets about 60% of the way there. The canonical action text and cross-POV tracking provide the "what" and "who agrees." The missing pieces are the "why this over alternatives" (real-world legislation links), "how strong is the agreement" (consensus scoring), and "what changed over time" (debate impact tracking).
