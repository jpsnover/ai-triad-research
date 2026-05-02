# Artifact Guide: How and When Debate Artifacts Are Created and Used

This document explains five artifacts produced by the AI Triad debate system: what they are, when they are created, where they are stored, how they flow through the system, and where they surface in the UI.

---

## 1. Factual Claims (Argument Network Nodes)

### What They Are

Factual claims are individual assertions extracted from debater statements and organized into an argument network. Each claim is a node (`AN-1`, `AN-2`, ...) with edges (supports/attacks) connecting it to other claims. Together they form a directed graph — the argument network — that is the structural backbone of the debate.

Every claim is classified along three dimensions:

- **BDI category**: Is this a Belief (empirical — testable against reality), a Desire (normative — what should be true), or an Intention (strategic — how to achieve a goal)?
- **Specificity**: Precise (contains numbers, dates, named entities), General, or Abstract.
- **Base strength**: Grounded (strong evidence), Reasoned (logical inference), or Asserted (stated without support). This is the starting strength before QBAF propagation adjusts it.

### When They Are Created

Claims are created at three points in the debate lifecycle:

**1. Document pre-analysis (before the debate starts)**

For document- or URL-grounded debates, the system extracts "i-nodes" (information nodes) from the source material. These are typed as empirical, normative, definitional, assumption, or evidence. They become the `D-1`, `D-2`, ... nodes in `session.document_analysis.i_nodes`.

The user can review and edit these in the **edit-claims phase** — a dedicated UI step between clarification and opening statements where extracted claims are shown as editable cards. Deleted claims are excluded from the debate entirely.

**2. After every debater turn (during the debate)**

After each statement, the system runs claim extraction via one of two pathways:

- **Full extraction** (`extractClaimsPrompt`): An LLM analyzes the raw statement and produces 3-6 claims with BDI classification, specificity, base strength, argumentation scheme (one of 14: EVIDENCE, EXPERT_OPINION, CONSEQUENCES, ANALOGY, etc.), and relationship edges to prior claims.
- **Hybrid extraction** (`classifyClaimsPrompt`): When the debater's DRAFT stage already produced inline claim sketches (`my_claims`), a lighter LLM call classifies relationships without re-extracting claims from scratch.

Each extracted claim goes through `processExtractedClaims()`, which filters duplicates (>30% text overlap with existing nodes → rejected), builds edges, populates BDI sub-scores, and updates commitment stores.

**3. Post-extraction QBAF propagation**

After new nodes and edges are added, the DF-QuAD algorithm recomputes all `computed_strength` values across the entire network:

```
strength(v) = base_strength(v) x (1 - attackAggregation) x (1 + supportAggregation)
```

This means a claim's effective strength is not just what the debater asserted — it is mechanically adjusted by what other claims support or attack it.

### Where They Are Stored

- **In the debate session**: `session.argument_network.nodes[]` and `session.argument_network.edges[]`
- **In per-turn diagnostics**: `session.diagnostics.entries[entryId].extracted_claims` (accepted and rejected with overlap percentages)
- **In the extraction trace**: `session.diagnostics.entries[entryId].extraction_trace` (full pipeline telemetry: candidates proposed, accepted, rejected, reasons)
- **On disk**: Serialized as part of the debate JSON file (`ai-triad-data/debates/debate-*.json`)

### Where They Surface in the UI

- **Edit-claims phase**: Editable cards for document i-nodes before the debate begins
- **Diagnostics Window > Argument Network tab**: Hierarchical tree of all AN nodes with BDI badges, QBAF strength visualization, edge relationships with warrants, and expandable per-criterion sub-scores
- **Diagnostics Window > Extraction Timeline**: Chart showing AN node growth per round, plateau detection, acceptance/rejection rates
- **QBAF overlay badges**: Per-claim strength indicator on transcript entries
- **Convergence Radar**: Claims grouped by taxonomy reference form convergence "issues"

### How They Are Used Downstream

| Consumer | What it uses claims for |
|----------|------------------------|
| **QBAF propagation** | Computes argument acceptability from graph topology |
| **Convergence tracker** | Groups claims by taxonomy ref into "issues" and scores convergence |
| **Moderator** | Identifies unanswered claims (PIN move), strong attacks (CHALLENGE move) |
| **Concession candidates** | QBAF-ranked opposing claims not yet addressed, shown to debaters |
| **Neutral evaluator** | Independently assesses claim quality (well_supported, contested, refuted) |
| **Coverage tracker** | Maps document D-nodes to debate AN-nodes to measure source engagement |
| **Taxonomy refinement** | Post-debate, claims inform suggestions to revise taxonomy nodes |
| **Fact-checking** | Belief claims with `specificity: 'precise'` are auto-verified via web search |
| **Synthesis** | The argument map in synthesis is built from the claim network |

---

## 2. Situations (Cross-Cutting Contested Concepts)

### What They Are

Situations are contested concepts that all three perspectives (accelerationist, safetyist, skeptic) recognize but interpret differently. They are the shared battleground — the topics where the three POVs actually engage each other rather than talking past each other.

Each situation node has:

- **A neutral description** (genus-differentia format) that all sides would accept as a factual characterization
- **Three POV-specific interpretations** — one per perspective, optionally BDI-decomposed:
  - **Belief**: What each POV thinks is empirically true about this concept
  - **Desire**: What each POV thinks should be done about it
  - **Intention**: How each POV proposes to achieve their goals
- **Linked nodes**: References to POV-specific taxonomy nodes (`acc-*`, `saf-*`, `skp-*`) that elaborate this concept from each perspective
- **Conflict IDs**: References to documented conflicts (disagreements with evidence from multiple sources)
- **Graph attributes**: Steelman vulnerabilities, underlying assumptions, possible fallacies, intellectual lineage

Example: The concept "AI Alignment" is a situation node. The accelerationist interprets it as a solvable engineering problem that shouldn't slow development. The safetyist interprets it as the central unsolved challenge that must gate deployment. The skeptic questions whether the framing itself is useful.

### When They Are Created

**Manual creation**: A researcher clicks "New" in the Situations tab, fills in the label, description, per-POV interpretations, and links to relevant POV nodes. This is the primary creation path.

**Potential automated creation**: The debate system has a cross-cutting node promotion mechanism — when all three debaters agree on something during a debate, the system can propose a new situation node with BDI-decomposed interpretations. However, this currently requires manual review; there is no automatic promotion.

### Where They Are Stored

- **Primary file**: `taxonomy/Origin/situations.json` (with legacy fallback to `cross-cutting.json`)
- **Schema**: `{ _schema_version, _doc, last_modified, nodes: SituationNode[] }`
- **Node IDs**: `sit-NNN` format (legacy `cc-NNN` IDs are auto-normalized)

### How They Are Used

**As debate topics**: The most direct use. A situation node can be the source for a debate:

1. User clicks "Debate" on a situation node
2. `createSituationDebate(nodeId)` resolves linked nodes, conflict summaries, and BDI interpretations
3. `formatSituationDebateContext()` builds a rich context block including: node description, all three POV interpretations, underlying assumptions, steelman vulnerabilities, identified fallacies, linked node descriptions, and documented conflicts
4. This context is injected into every debater's prompts — all three agents debate the situation with full awareness of each other's stated positions

**As taxonomy structure**: Situations organize the taxonomy's cross-cutting concerns. POV nodes reference situations via `situation_refs[]`, creating a bidirectional link. The Situations tab shows the full hierarchy (situations can have parent-child relationships: `is_a`, `part_of`, `specializes`).

**As conflict anchors**: Conflicts (documented disagreements between sources) are linked to situation nodes via `conflict_ids[]`. When browsing a situation, you see which specific source-document conflicts involve this concept.

### Where They Surface in the UI

- **Situations tab**: Hierarchical tree/flat list of all situation nodes with search, keyboard navigation, and toolbar panels
- **Situation Detail panel**: Full editor with tabs for Overview, Attributes, and per-POV interpretation editors (with BDI decomposition)
- **New Debate Dialog**: Situation nodes appear as a source type option
- **POV node detail**: `situation_refs` shown as linked chips on individual POV nodes
- **Debate source viewer**: For situation-grounded debates, shows the formatted situation context

---

## 3. Cruxes (Pivotal Disagreement Points)

### What They Are

A crux is a specific factual question, value tension, or definitional disagreement that, if resolved, would cause at least one debater to change their position. Cruxes are the highest-value output of a debate — they name the exact point where the disagreement is load-bearing.

Each crux has:

- **Description**: The question or tension (e.g., "Does scaling compute reliably produce capability jumps, or are they unpredictable?")
- **Disagreement type**: Empirical (resolvable by evidence), Values (negotiable via tradeoffs), or Definitional (requires term clarification)
- **Status**: Addressed (debaters engaged and made progress), Partially addressed, or Unaddressed
- **Confidence**: High, Medium, or Low
- **Speakers involved**: Which debaters are on each side (anonymized in neutral evaluation as Speaker A/B/C)

### When They Are Created

Cruxes emerge at multiple points:

**1. During debate rounds (implicit identification)**

The turn pipeline includes `IDENTIFY-CRUX` as a dialectical move type. When a debater uses this move, the convergence signal `crux_rate` records it:
- `used_this_turn`: Did the speaker explicitly name a crux?
- `cumulative_count`: Total crux identifications by this speaker
- `cumulative_follow_through`: How many identified cruxes led to substantive engagement in subsequent turns

**2. During adaptive staging (structural detection)**

`detectCruxNodes()` in the phase transition engine identifies crux nodes structurally — argument network nodes that are attacked by 2+ different POVs with `computed_strength > 0.5`. These are claims that multiple perspectives find threatening enough to challenge. The `crux_maturity` signal (weighted 0.25 in the saturation score) measures:
- How many structural cruxes have been identified
- Whether debaters are following through on them (engaging within 2 rounds)
- Whether the argumentation scheme diversity covers the crux adequately

This signal drives phase transitions: when crux maturity is high, the exploration phase has done its job and the debate can move toward synthesis.

**3. During synthesis (explicit extraction)**

The synthesis prompt explicitly asks for cruxes in a structured format:
```json
{
  "question": "the factual or value question that would change minds",
  "if_yes": "which position strengthens and why",
  "if_no": "which position strengthens and why",
  "type": "EMPIRICAL or VALUES"
}
```

**4. During neutral evaluation (independent assessment)**

The neutral evaluator — which strips all persona labels and POV context — independently identifies cruxes at three checkpoints (baseline, midpoint, final). These are compared against the persona-grounded synthesis to detect divergences:
- **Crux omitted**: Neutral evaluator saw a crux that synthesis missed
- **Status mismatch**: Both identified the crux but disagree on whether it was addressed
- **Assessment mismatch**: Synthesis treats an issue as resolved, but the neutral evaluator sees it as contested

### Where They Are Stored

- **In synthesis metadata**: `session.transcript[synthesisEntry].metadata.synthesis.cruxes`
- **In neutral evaluations**: `session.neutral_evaluations[checkpoint].cruxes`
- **In convergence signals**: `session.convergence_signals[turn].crux_rate`
- **In adaptive staging diagnostics**: `session.adaptive_staging_diagnostics.signal_telemetry[round].crux_maturity`
- **In phase transition regressions**: When synthesis started too early and the system regresses to exploration, the regression record includes `crux_id` — the crux that triggered the regression

### Where They Surface in the UI

- **Neutral Evaluation Panel**: Cruxes displayed with color-coded status badges (green = addressed, orange = partial, red = unaddressed), disagreement type badge, speakers involved, and full description
- **Convergence Signals Panel**: `crux_rate` line chart showing per-turn crux identification and cumulative follow-through
- **Diagnostics Window > Adaptive tab**: Regressions table shows crux IDs that triggered phase regressions
- **Synthesis transcript entry**: Cruxes rendered as part of the structured synthesis output

### How They Are Used Downstream

| Consumer | What it uses cruxes for |
|----------|------------------------|
| **Adaptive staging** | `crux_maturity` signal determines when exploration has identified enough pivotal points |
| **Phase regression** | If synthesis starts but cruxes resurface, the system regresses to exploration |
| **Neutral evaluator divergence** | Crux status mismatches between neutral and persona views flag potential bias |
| **Synthesis quality metric** | Number of addressed cruxes is a key success metric (target: >= 2 per debate) |
| **Theory of success** | Crux discovery is criterion #1 for a successful debate |

---

## 4. Policy Actions (Concrete Policy Recommendations)

### What They Are

Policy actions are concrete, actionable policy recommendations that taxonomy nodes support, oppose, or have implications for. Each policy is a short statement (5-20 words) like "Establish AI safety certification standards" or "Increase R&D funding for AI transparency research."

Each policy has:

- **A registry ID**: `pol-NNN` (e.g., `pol-001`) — a globally unique identifier in the shared policy registry
- **Action text**: The policy statement itself
- **Source POVs**: Which perspectives endorse or reference this policy
- **Member count**: How many taxonomy nodes reference this policy
- **Per-node framing**: When a specific taxonomy node references a policy, it includes a 1-2 sentence framing explaining how *that node's position* relates to the policy

The key design insight is that the same policy can be referenced by multiple nodes across multiple POVs. Policy `pol-042` might appear on an accelerationist node (framed as "enables innovation") and a safetyist node (framed as "necessary safeguard"). This shared-reference model enables cross-POV policy alignment analysis.

### When They Are Created

**Batch extraction via PowerShell**: The primary creation path is the `Find-PolicyAction` cmdlet:

1. Loads existing `policy_actions.json` registry
2. Sends batches of taxonomy nodes to an LLM with a policy-extraction prompt
3. The LLM generates `{ policy_id, action, framing }` objects for each node
4. New policies get the next available `pol-NNN` ID; existing policies are reused by ID
5. Updated nodes are written back to POV files; new policies are appended to the registry

**Manual creation via UI**: In the Graph Attributes Panel, a user can search the registry via typeahead, select a policy, and write a node-specific framing.

### Where They Are Stored

- **Central registry**: `taxonomy/Origin/policy_actions.json` — the single source of truth for all ~270 policies with their `id`, `action`, `source_povs`, and `member_count`
- **On taxonomy nodes**: `node.graph_attributes.policy_actions[]` — array of `{ policy_id, action, framing }` objects linking the node to specific policies with node-specific framing
- **Policy-to-policy edges**: `taxonomy/Origin/edges.json` — ~452 edges typed CONTRADICTS, COMPLEMENTS, or TENSION_WITH between policies
- **Policy embeddings**: `taxonomy/Origin/embeddings.json` — 384-dimensional vectors (all-MiniLM-L6-v2) for policy text, enabling semantic similarity search

### How They Are Used in Debates

**Context injection**: During the CITE stage of the turn pipeline, up to 10 relevant policies are injected into the debater's prompt:

```
=== POLICY ACTIONS (reference by pol-NNN ID when relevant) ===
These are concrete policy actions identified in the research. When your argument
supports or opposes a specific policy, reference its ID in your policy_refs.
(★ = most relevant to current topic)
★ [pol-001] Establish AI safety certification standards (accelerationist, safetyist)
  [pol-002] Increase R&D funding for AI transparency research (safetyist)
```

Debaters then include `policy_refs` in their output — linking their arguments to concrete policy positions. This grounds abstract philosophical debate in actionable recommendations.

**Transcript entries**: Each statement's `policy_refs` field records which policies the debater referenced, enabling post-debate analysis of which policies received the most engagement.

### Where They Surface in the UI

- **Policy Dashboard**: Summary statistics (total count, cross-POV count), top 10 most-referenced policies, POV distribution bar chart, contradiction hotspots (policies involved in the most CONTRADICTS edges), and source timeline
- **Policy Alignment Panel**: Shows "shared policies" — policies endorsed by 2+ POVs with their respective framings side-by-side. This is the primary tool for discovering cross-POV policy agreement.
- **Graph Attributes Panel**: Per-node policy list with editable framings and typeahead search for adding new policy references
- **Debate transcript**: Policy refs shown as pill badges on individual statements

---

## 5. Intellectual Lineage (Philosophical and Research Traditions)

### What They Are

Intellectual lineage identifies the philosophical traditions, schools of thought, research programs, and intellectual movements that inform a taxonomy node's position. They are the "intellectual DNA" of a node — connecting a specific claim about AI policy to the broader tradition of thought that produced it.

The system catalogs 331 distinct lineage values organized into 10 root categories:

| Category | Examples |
|----------|----------|
| AI & Machine Learning | AI alignment, interpretability, scaling laws |
| Techno-Political Movements | Effective altruism, longtermism, transhumanism, accelerationism |
| Ethics & Moral Philosophy | Deontology, utilitarianism, precautionary principle, existential risk |
| Political & Legal Theory | Governance theory, digital rights, intellectual property |
| Economics & Political Economy | Marxism, Keynesian economics, labor economics, automation |
| Social & Behavioral Sciences | HCI, psychology, education, communications theory |
| Science, Technology & Society | STS, technological determinism, innovation diffusion |
| Formal & Mathematical Sciences | Game theory, systems theory, cybernetics, decision theory |
| Risk, Security & Resilience | Cybersecurity, biosecurity, safety engineering |
| Philosophy & Epistemology | Ontology, phenomenology, epistemology, logic |

Each lineage entry in the catalog has: a display label, a 2-3 sentence summary, an example of how it appears in taxonomy nodes, a frequency description (which POVs use it most), and reference links (Wikipedia, Stanford Encyclopedia, etc.).

### When They Are Created

**Batch extraction via PowerShell**: The `Invoke-AttributeExtraction` cmdlet runs an LLM prompt that populates `graph_attributes` on taxonomy nodes, including `intellectual_lineage: string[]`. The LLM assigns 1-5 lineage values per node based on the node's content.

**Canonicalization at lookup time**: Raw LLM output is messy — inconsistent casing, parenthetical qualifiers, trailing attributions. The system handles this with a three-step lookup at display time:
1. Exact match against the catalog
2. Case-insensitive match
3. Canonicalized match (strip parentheses, trailing commas, collapse whitespace, lowercase)

This resolves ~500 raw variants to 579 canonical entries without mutating the source data.

### Where They Are Stored

- **On taxonomy nodes**: `node.graph_attributes.intellectual_lineage: string[]` — an array of free-form strings
- **In the catalog**: `taxonomy-editor/src/renderer/data/intellectualLineageInfo.ts` — ~1.5 MB file with 331 entries, each containing label, summary, example, frequency, and reference links
- **In the lookup layer**: `lineageLookup.ts` (canonicalization) and `lineageCategories.ts` (10-category classification with regex-based pattern matching)

### How They Are Used in Debates

Lineage is injected into debater prompts as part of the taxonomy context. For each relevant node, the context includes:

```
Intellectual lineage: Effective altruism; Existential risk; Bayesian reasoning
```

The debate prompt instructions specify three argumentative uses of lineage:

1. **Grounding**: Situate your position in its intellectual tradition to add weight. ("This follows the precautionary principle tradition in environmental law.")
2. **Shared roots**: Identify common intellectual ground to narrow disputes. ("We both draw on consequentialist reasoning here, so our disagreement is about which consequences we measure.")
3. **Exposing tensions**: Surface inherited tensions to attack positions more precisely. ("The techno-accelerationist tradition your argument draws from has historically struggled with the distribution problem.")

### Where They Surface in the UI

- **Node Detail**: Lineage values shown as interactive chips. Click to expand inline detail (summary, example, links). Right-click to open the full Attribute Info panel.
- **Lineage Panel** (toolbar): Searchable, browsable catalog of all 331 lineage entries grouped by category, with collapse/expand and keyboard navigation.
- **Attribute Info Panel**: Full detail view for a single lineage entry with "See Also" section listing related lineages in the same category (ranked by token overlap).
- **POV Tab detail pane**: Selected lineage entry shown with full metadata: label, category badge, summary, example, frequency, external reference links, and "See Also" section.
- **Graph Attributes Panel**: Read-only display of lineage values with badge click to filter nodes.

---

## Artifact Relationship Map

These five artifacts are not independent — they form an interconnected system:

```
                         Intellectual Lineage
                         (traditions informing positions)
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────┐
│                    TAXONOMY NODES                            │
│   (POV positions with BDI categories, graph attributes)      │
│                                                              │
│   graph_attributes:                                          │
│     intellectual_lineage: ["Effective altruism", ...]         │
│     policy_actions: [{ pol-001, action, framing }]           │
│     steelman_vulnerability: "..."                            │
│     situation_refs: ["sit-042"]                              │
└────────┬───────────────────────┬────────────────────┬────────┘
         │                       │                    │
         ▼                       ▼                    ▼
   Policy Actions          Situations            Debates
   (concrete recs)    (contested concepts)    (structured argument)
   pol-001, pol-002    sit-001, sit-002           │
         │                    │                    │
         │                    │                    ▼
         │                    │          ┌─────────────────────┐
         │                    │          │  Factual Claims     │
         │                    │          │  (AN nodes + edges) │
         │                    │          │  AN-1, AN-2, ...    │
         │                    │          └────────┬────────────┘
         │                    │                   │
         │                    │                   ▼
         │                    │             ┌──────────┐
         │                    └────────────►│  Cruxes  │
         │                                 │  (pivotal│
         └────────────────────────────────►│  points) │
                                           └──────────┘
```

**Taxonomy nodes** are the foundation — they hold lineage and policy attributes, link to situations, and provide the context that shapes debate arguments.

**Situations** organize the cross-cutting concerns that multiple POVs engage with. They are the most common debate topics.

**Factual claims** are extracted from debate turns and organized into an argument network. They reference taxonomy nodes and policies.

**Cruxes** emerge from the claim network — they are the points where the argument network reveals load-bearing disagreements.

**Policies** ground abstract positions in concrete recommendations. They are referenced by taxonomy nodes, cited by debaters during debates, and tracked for cross-POV alignment.

**Lineage** contextualizes everything — connecting specific claims and policies to the intellectual traditions that produced them, enabling deeper analysis of why disagreements exist.

---

## Lifecycle Summary

| Artifact | Created By | Created When | Stored In | Primary Consumer |
|----------|-----------|--------------|-----------|------------------|
| Factual Claims | LLM extraction from debater statements | After every debate turn | `session.argument_network` | QBAF, convergence tracker, moderator, synthesis |
| Situations | Manual creation by researcher | Taxonomy editing | `taxonomy/Origin/situations.json` | Debate topics, POV node linking, conflict anchoring |
| Cruxes | LLM synthesis + structural detection | During and after debate | Synthesis metadata, neutral evaluations | Phase transitions, success metrics, divergence detection |
| Policies | `Find-PolicyAction` cmdlet or manual | Taxonomy attribute extraction | `policy_actions.json` registry + node attributes | Debate CITE stage, alignment analysis, dashboard |
| Intellectual Lineage | `Invoke-AttributeExtraction` cmdlet | Taxonomy attribute extraction | Node `graph_attributes` + catalog data file | Debate context injection, UI browsing, tradition analysis |
