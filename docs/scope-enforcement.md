# Scope Enforcement: Exclusion Guards and Drift Detection

**Audience:** Researchers and developers who need to understand why claims were flagged, blocked, or demoted during a debate, and how to configure scope correctly.  
**Related docs:** `debate-system-overview.md`, `citation-diagnostics-design.md`, `debate-diagnostics-field-guide.md`

---

## The problem scope enforcement solves

A debate configured around "AI governance mechanisms" should not produce claims about "quantum computing supply chains." A debate about "AI safety techniques" should not cite papers whose scope excludes the configured topic. Without active enforcement, large language models will drift — they fill context gaps with plausible-sounding content that is adjacent to the topic but outside it.

The engine uses **embedding-based exclusion** to enforce scope at four points in the turn pipeline. Rather than checking keywords, it checks semantic similarity: if a claim's embedding is too close to a known out-of-scope concept's embedding, the claim is flagged regardless of its surface language.

---

## Exclusion vectors

The core mechanism. An **exclusion vector** is an embedding representation of a concept or domain that is explicitly *outside* the debate's scope. Exclusion vectors are attached to taxonomy nodes and debate configurations.

When the engine checks a claim against exclusion, it computes the cosine similarity between the claim's embedding and each applicable exclusion vector. High similarity means the claim is semantically close to an out-of-scope concept — flagged. Low similarity means the claim is safely within scope.

**Similarity color bands** (used in the Exclusion Guard tab):
- **Red** (> 0.8) — high similarity to exclusion vector: strong out-of-scope signal
- **Amber** (0.6–0.8) — moderate similarity: borderline, worth inspecting
- **Green** (< 0.6) — low similarity: within scope

These thresholds are configurable per debate. The threshold value shown in each section of the Exclusion Guard tab is the one that was active for this turn.

---

## The four guardrails

The engine applies scope enforcement at four distinct points, each visible as a section in the Exclusion Guard per-entry tab.

### 1. Claim Extraction Guard

**When it runs:** After claims are extracted from the turn draft, before they are inserted into the argument network.

**What it checks:** Each extracted claim is checked against the exclusion vectors for the taxonomy nodes it was attributed to. If `similarity_exclusion > threshold`, the claim is flagged as a violation.

**What happens on violation:** The claim is marked as `unattributed` with reason `exclusion_violation` and is not inserted into the argument network as an attributed node. It may still appear in the transcript (the agent said it) but it does not contribute to QBAF strength computations or crux engagement.

**Reading the tab:** The header line shows how many claims were checked and how many exclusion vectors were in play. Violation rows show:
- `claim_id` — the internal claim identifier
- `claim_text` — the claim content
- `node_id` — the taxonomy node it was attributed to
- `similarity_main` — how similar the claim is to the *intended* taxonomy concept (should be high for a well-attributed claim)
- `similarity_exclusion` — how similar the claim is to the *exclusion* vector for that node (should be low for an in-scope claim)

A claim can have high `similarity_main` and high `similarity_exclusion` simultaneously — this means the claim is about the right topic but in a way that touches the excluded sub-domain. This is the most common false-positive pattern.

**All clear:** If the banner shows "All N claims within scope — 0 exclusion violations," every extracted claim passed the check. This is the normal case.

---

### 2. Draft Scope Check

**When it runs:** After the full draft text is produced, checking the draft as a whole rather than individual extracted claims.

**What it checks:** The draft text is embedded and checked against exclusion vectors for all taxonomy nodes referenced in the turn. This catches out-of-scope content that may not have been extracted as a discrete claim — rhetorical framing, transitional arguments, background context — but is still semantically near excluded territory.

**What happens on warning:** Scope drift warnings do not block the turn. They are logged as diagnostics. The `scope_drift_warnings` field records the debater, the taxonomy node whose exclusion vector triggered the warning, the similarity score, and an excerpt of the draft text near the flagged content.

**Reading the tab:** Warning rows show the debater label, the triggering `node_id`, the similarity score (colored by band), and a draft excerpt showing approximately which part of the text triggered the warning.

**Distinction from Claim Extraction Guard:** The extraction guard is binary (claim is flagged or not). The draft scope check is advisory (warning issued but turn proceeds). In practice, repeated scope drift warnings in successive turns often predict extraction guard violations a few rounds later — the model is drifting before the drift becomes claim-level.

---

### 3. Taxonomy Context Injection Demotion

**When it runs:** Before the turn prompt is assembled, when the engine selects which taxonomy nodes to inject as context for the debater.

**What it checks:** Candidate taxonomy nodes for context injection are screened against exclusion vectors. A node that is too similar to an exclusion vector is **demoted** — removed from the injected context — even if it is nominally in scope based on its taxonomy position.

**Why this matters:** A debater that receives an out-of-scope taxonomy node as context will write about it. The most reliable way to prevent scope drift is to not inject the material in the first place. Demotion is the upstream prevention; the extraction guard is the downstream catch.

**Reading the tab:** The section header shows how many nodes were considered and how many were demoted. Demoted node rows show the `node_id` and its `exclusion_similarity` score. Nodes in amber and red bands were the ones removed.

**False demotion:** A legitimate taxonomy node can be demoted if it sits near a concept that is excluded. If you see important context missing from an agent's reasoning, check this section — the node you expected to appear may have been demoted. Widen the exclusion threshold or restructure the exclusion vector if this is causing problems.

---

### 4. Situation Injection Filtering

**When it runs:** Alongside taxonomy context injection, when the engine selects which debate situations (configured scenario contexts) to inject.

**What it checks:** Each candidate situation is checked against exclusion vectors. Situations that are too similar to excluded concepts are filtered out before injection.

**What happens on filtering:** The situation is excluded from the turn's context. The engine continues with the remaining situations.

**Reading the tab:** Similar to taxonomy injection: header shows considered and excluded counts; rows show `situation_id` and `exclusion_similarity`.

---

## Interpreting "all clear" vs. violation patterns

### All four sections show "all clear"

Normal. The turn's content was within scope at every check point. Most turns in a well-configured debate will look like this.

### Claim Extraction Guard has violations, Draft Scope Check is clear

The draft text as a whole stayed within scope, but one or more discrete extracted claims crossed into excluded territory. This typically means the agent's main argument was on-topic but included a supporting claim that touched excluded ground. The supporting claim was dropped from the AN; the turn still contributed its in-scope claims.

### Draft Scope Check has warnings, Claim Extraction Guard is clear

The draft *text* drifted near excluded territory but didn't produce any discrete out-of-scope *claims* — either the drift was in framing language rather than claim content, or the extraction process filtered it out before flagging. Monitor: if this pattern repeats for the same agent across several turns, it often progresses to extraction violations.

### Taxonomy Injection shows high demotion count

Many taxonomy nodes were considered and removed. The exclusion vectors are catching a lot. Two possibilities: (a) the debate topic genuinely has many near-scope nodes that need to be excluded, in which case this is correct behavior; (b) the exclusion vectors are too broad and are catching legitimate context. Check which `node_id`s were demoted against your intended scope — if you see nodes you wanted, narrow the exclusion vectors.

### Extraction guard violations in consecutive turns from the same agent

The agent is consistently drifting. Likely causes:
1. The agent's reflection is inaccurate — it has built a self-model that includes out-of-scope territory
2. The moderator's focus points are pointing toward near-scope content
3. The crux set includes concepts that are semantically adjacent to excluded territory

Check the Reflections overview tab for the affected agent and compare the reflection to the topic scope. Also check the Moderator per-entry tab for recent turns to see what focus points were set.

---

## Configuring scope

Scope is configured at debate setup, not during a running debate. The relevant parameters:

**Crux set** — the core contested questions. These define what the debate *is about*. Claims near the crux embeddings score high on topic coherence; claims far from them score low.

**Exclusion vectors** — per-node vectors attached to taxonomy nodes in the data model, plus debate-level exclusion lists. A taxonomy node can have a main embedding (what it's about) and one or more exclusion embeddings (what it's *not* about, even though it's topically adjacent).

**Threshold** — the cosine similarity cutoff for each guardrail. Lowering the threshold is more permissive (fewer violations); raising it is stricter (more violations, tighter scope enforcement). The threshold shown in the Exclusion Guard tab is the one that was active — if you see many false positives or false negatives, this is the value to tune.

---

## Common false-positive patterns

**Policy mechanism claims near excluded implementation details:**  
A debate about "AI compute governance" may legitimately discuss semiconductor supply chains as part of the argument. If semiconductor supply chains are in the exclusion list (because the debate is about governance *mechanisms*, not supply chain logistics), technically on-topic claims will be flagged. Solution: add a carve-out to the exclusion vector for the governance-mechanism framing, or raise the threshold for that specific node.

**Citation text including excluded context:**  
If a cited source discusses both in-scope and out-of-scope content, the claim extracted from that citation may inherit the out-of-scope signal from the source text. The Draft Scope Check is more likely to catch this than the Claim Extraction Guard (since the claim may be a clean summary of the in-scope portion).

**Near-synonym node demotion:**  
Two taxonomy nodes that are conceptually distinct but semantically similar in embedding space — e.g., "AI deployment risks" and "AI development risks" — can have overlapping exclusion vectors. Demoting one may inadvertently demote near-synonyms. Inspect the demoted node list carefully when you see unexpected demotion.
