# Reading the Argument Network

**Audience:** Researchers using the debate diagnostics window to understand what arguments were made and how they relate.  
**Related docs:** `aif-debate-tool-analysis.md`, `qbaf-explainability-review.md`, `debate-diagnostics-field-guide.md`

---

## What the Argument Network is

The Argument Network (AN) is a typed graph built incrementally as the debate runs. After each debater turn, the engine extracts 1–4 key claims and maps how those claims relate to prior claims. By the end of a debate, the AN is a complete record of what was argued, who argued it, and what attacked or supported what — structured in a way that makes the logical relationships computable.

This is different from the transcript. The transcript records what was *said*. The Argument Network records what was *argued* — the claims that the engine identified as the logically significant content of each turn, stripped of rhetorical framing.

The AN follows the **Argument Interchange Format (AIF)**, a formal ontology for argumentation established by Chesnevar et al. (2006). See `docs/aif-debate-tool-analysis.md` for the full gap analysis and implementation details.

---

## Node types

Every item in the Argument Network is one of four node types. The diagnostics window labels each one explicitly.

### I-nodes (Information nodes)

The claims themselves. An I-node asserts a proposition: "Scaling compute is sufficient for AGI," "Current AI systems exhibit demographic bias," "Mandatory compute audits would slow progress." Every claim extracted from every turn becomes an I-node.

Each I-node has:
- A unique identifier (`AN-1`, `AN-2`, … in statement order)
- A **speaker** (Accelerationist / Safetyist / Skeptic)
- A **BDI category** (Belief / Desire / Intention) — see below
- A `base_strength` — the initial QBAF node weight, derived from BDI sub-scores
- A `computed_strength` — the QBAF strength after edge propagation (attacks weaken it, supports strengthen it)
- A `claim_taxonomy_attribution` — the taxonomy node(s) this claim is anchored to, if any

### CA-nodes (Conflict Application nodes)

Attack relationships. A CA-node represents the *act* of one claim attacking another. There are three attack types, each targeting a different part of the attacked argument:

| Type | What it attacks | Example |
|---|---|---|
| **Rebut** | The conclusion directly — asserts the opposite | "No, scaling alone is NOT sufficient for AGI" |
| **Undercut** | The inference — accepts the premise but denies it implies the conclusion | "Even if that study is accurate, it doesn't show what you claim it shows" |
| **Undermine** | The premise credibility — attacks the evidence or source | "That study was retracted / has serious methodological flaws" |

In the diagnostics window, CA-nodes appear as red edges between I-nodes. The attack type is shown in the expanded INodeRow view alongside the edge weight.

### RA-nodes (Rule Application nodes)

Support relationships and their warrants. An RA-node explains *why* one claim supports another — the inference scheme or reasoning pattern connecting evidence to conclusion. When you see a green "supports" edge, the RA-node is the warrant: "Argument from analogy," "Argument from evidence," "Argument from expert authority."

RA-nodes are labeled with their **argumentation scheme** — the formal pattern of reasoning being used. Each scheme has associated **critical questions** that identify how to attack it most effectively. An attack that answers a critical question for the scheme produces a stronger undercut than a generic rebuttal.

### PA-nodes (Preference Application nodes)

Conflict resolution. A PA-node appears when the engine determines which of two competing arguments prevails, and why. Criteria include empirical evidence strength, logical validity, and precedent. PA-nodes are less common and appear primarily in synthesis and verdict contexts.

---

## How to read the minimap

The minimap at the top of the Argument Network tab provides a spatial overview of the whole graph before you scroll through the claim list.

**Layout:** Nodes are arranged by speaker in three arcs around a center point. Each speaker's claims form a cluster. Cross-arc edges are attacks or supports between different debaters; within-arc edges are a speaker building on their own prior claims.

**Color:** Each node dot is colored by speaker (Accelerationist = orange-red, Safetyist = blue, Skeptic = purple). Edges are red (attacks) or green (supports) with low opacity to show density without obscuring nodes.

**Density:** A minimap with many cross-arc red edges means the debate was combative — speakers were directly attacking each other's claims. A minimap with mostly within-arc edges and few cross-connections means speakers talked past each other. A minimap with many cross-arc green edges is rare — it means debaters were building on each other's reasoning rather than opposing it.

**Scale limit:** The minimap degrades gracefully above 80 nodes (it switches to a "network too large" message). For large debates, use the filter bar to work through the graph in sections.

---

## Base strength vs. computed strength

Every I-node has two strength values. Understanding the difference is key to reading the AN.

**`base_strength`** is the initial weight assigned to the claim before any edges are considered. It is derived from the claim's **BDI sub-scores** (see `docs/bdi-sub-score-calibration.md`): how well-evidenced the claim is, how falsifiable it is, how grounded in values or precedent. A claim with strong evidence, clear scope, and named failure modes gets a high base_strength. A vague aspiration gets a low one.

**`computed_strength`** is what QBAF gradual semantics produces after propagating all attack and support edges through the graph. A claim that starts with `base_strength = 0.8` but is successfully attacked by two strong opponent claims may end up with `computed_strength = 0.35`. Conversely, a weaker claim that receives strong support from well-established claims may rise from `base_strength = 0.5` to `computed_strength = 0.72`.

The QBAF computation is iterative: strength values propagate from attacker to attacked, from supporter to supported, until the graph stabilizes. See `docs/qbaf-explainability-review.md` for the mathematical semantics.

**Practical reading rules:**

| Situation | What it means |
|---|---|
| `base_strength` high, `computed_strength` low | Claim is well-constructed but successfully attacked — find the attacking CA-edges |
| `base_strength` low, `computed_strength` low | Claim is weak AND attacked — least defensible position in the debate |
| `base_strength` low, `computed_strength` similar | Claim is weak but uncontested — opponents chose not to engage with it |
| `base_strength` high, `computed_strength` similar | Strong claim that held up — the backbone of the speaker's position |
| Large gap between the two in either direction | Interesting node — click to expand and see which edges drove the change |

---

## The claim attribution filters

The filter bar above the claim list lets you narrow the AN to specific subsets. These are most useful when a large debate produces 50+ nodes.

**All claims** — default view.

**Unattributed only** — shows claims where `claim_taxonomy_attribution.unattributed_reason` is set. These are claims the engine could not anchor to any taxonomy node. Two sub-types:

- **Novel arguments** — claims that appear genuinely new: no similar node exists in the taxonomy at above-threshold embedding similarity. These are the most interesting for taxonomy development — they represent arguments that the debate surfaced which the taxonomy doesn't yet cover.
- **Other unattributed** — claims that drifted from the configured scope, were too general to anchor, or had taxonomy references that were demoted by the exclusion guard.

**Novel arguments** — filter to just the novel subset. A high novel-to-total ratio means the debate is ranging beyond the taxonomy's current coverage.

**Attributed only (Anchored)** — claims successfully grounded in a taxonomy node. These are the claims you can directly trace to a specific belief, desire, or intention in the taxonomy.

**Filter by node ID** — type a taxonomy node ID (e.g., `acc-bel-042`) to see only claims attributed to that node. Useful for asking "what did each agent say about this specific concept?"

---

## Moderator banners

Interleaved between groups of claims, gray "Moderator" banners record the moderator's deliberation at the end of each turn. Key fields:

**→ [Speaker]** — who the moderator selected to speak next.

**Selection reason** — why that speaker was chosen:
- `lowest_strength` — moderator gave the floor to the agent with the weakest computed QBAF position
- `highest_crux_burden` — agent with the most unaddressed cruxes gets priority
- `round_robin` — default rotation, no strategic override
- `intervention` — moderator triggered a specific debate move (reframe, challenge, synthesis request)

**Focus point** — the specific argumentative question the moderator asked the next speaker to address. This shapes the brief that agent receives.

**Convergence score** — how close the debaters' argument centroids were at this moment. If `conv_triggered` appears, the convergence exceeded the phase threshold and contributed to a phase transition.

**Candidates** — the ranked list of all debaters and their computed strength at this point. The selected speaker is shown in bold.

---

## Confidence Impact trace

At the bottom of the Argument Network tab, when present, is the Confidence Impact section. This shows which taxonomy nodes had their `confidence_history`, `priority_history`, or `operationality_history` updated as a result of this specific debate.

Each row shows:
- The taxonomy node ID and label
- The value before and after (`value` = current value, `delta` = change)
- The `attack_claim` that drove a confidence drop (if applicable)
- A `robustness` chip if the change was confirmed by 2 or more independent arguments

This is the direct output of the debate: how the living taxonomy was changed by what was argued. A debate with many confidence impacts is moving the taxonomy; a debate with zero is adding claims to the AN but not yet crossing the threshold for taxonomy updates.

---

## Navigating between AN and transcript

Every I-node group is preceded by a clickable source-statement header showing the statement ID (`S3`, `S12`, …), the speaker, and an excerpt. Clicking this header jumps to that entry in the transcript tab and selects it in the per-entry tabs — so you can move from a claim in the AN directly to the full turn context, the draft diagnostics, and the lookahead gate results for that claim in one click.

The reverse also works: clicking a turn in the transcript and opening the Claims per-entry tab shows exactly which I-nodes were extracted from that turn.

---

## What a "healthy" argument network looks like

There's no single ideal shape, but a few patterns are worth knowing:

**Productive disagreement:** Red CA-edges distributed across all three speakers, with rebuttal and undercut attacks dominating (direct engagement rather than source-undermining). High `computed_strength` variance — some claims won, some lost — indicating the debate actually changed something.

**Talking past each other:** Few cross-speaker edges, mostly within-arc. Speakers are making new claims rather than engaging with existing ones. The convergence score will be low not because debaters are far apart but because they're simply not connecting.

**Pile-on:** Many CA-edges all targeting one speaker's nodes, with that speaker's `computed_strength` collapsing across the board. The moderator should have intervened via `lowest_strength` selection, but if the debate is late in its run the opportunity may have passed.

**False consensus:** High convergence score, but many cruxes still unaddressed. Debaters are making similar-sounding claims but haven't actually resolved the underlying disagreements. The Gaps tab will show high unaddressed crux count.

**Novel-heavy:** High fraction of unattributed claims with `novel_argument` reason. The debate is ranging beyond the taxonomy. Productive for taxonomy expansion; less useful for measuring position change on existing nodes.
