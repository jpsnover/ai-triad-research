# POV Edges: Theory, System Usage, and Weight & Confidence

**Last updated:** 2026-08-11

The **Related Edges** panel shows the *edges* connected to a taxonomy node, the typed and
directional relationships that link one position to another. This document explains what an
edge asserts, how the system uses edges, and how to read the **weight** and **confidence**
numbers shown in the Edge Detail panel. It is the reference behind the Related Edges panel
bookmark.

The first two sections are for anyone browsing the taxonomy. The last section gives the exact
meaning of every number, with the code that produces it, for anyone who needs to trust those
numbers. Pipeline internals come at the end.

## What a POV edge asserts

The taxonomy is a **graph, not a tree**. A tree would let each position have one parent and no
cross-links. Real policy discourse does not work that way. A Safetyist belief can *contradict*
an Accelerationist desire, an intention can *assume* a belief in a different camp, and two
positions from opposite POVs can sit *in tension* over the same situation. Those relationships
are the edges. Encoding them as a graph is what lets the system surface conflicts, cruxes, and
cross-POV structure that a strict hierarchy would hide.

An edge is a directed or bidirectional **typed** relationship from a **source** node to a
**target** node. There are eight canonical edge types. Each carries a short definition, an
equivalence to a standard argumentation-theory role (AIF, the Argument Interchange Format), and
a direction. The canonical set is seeded in
`scripts/AITriad/Public/Invoke-EdgeDiscovery.ps1` (lines 277-286) and defined for the data file
in `ai-triad-data/taxonomy/Origin/edges.json` (`edge_types`, lines 5-67):

| Type | What it asserts | AIF role | Direction |
|------|-----------------|----------|-----------|
| `SUPPORTS` | Source gives reason to accept target | RA (inference) | Directed |
| `ASSUMES` | Source presupposes target | RA (presupposition) | Directed |
| `CONTRADICTS` | Source and target cannot both hold | CA (rebut) | Bidirectional |
| `WEAKENS` | Source undermines target without fully refuting it | CA (undermine) | Directed |
| `RESPONDS_TO` | Source is a dialogical reply to target | Dialogue | Directed |
| `TENSION_WITH` | Source and target sit in unresolved tension | CA (tension) | Bidirectional |
| `INTERPRETS` | Source reads or frames a situation | RA (interpretation) | Directed (POV→Situation) |
| `CONVERGES_WITH` | Source arrives at the same place as target | RA (convergence) | Directed (POV→Situation) |

The type vocabulary is canonical and enforced. The discovery pipeline reclassifies or drops
anything outside the eight types through `scripts/AITriad/Private/Resolve-EdgeType.ps1`. The
list was fixed under t/1093, which removed the older `CITES`/`SUPPORTED_BY`/`PROPOSES` and added
`CONVERGES_WITH`. In code the type is a string-literal union that still *accepts* unknown legacy
strings so old data loads without error (`lib/debate/taxonomyTypes.ts`, `CanonicalEdgeType` at
lines 279-290).

> **Data-file note:** the live `edges.json` describes each type with `direction` and `aif_equiv`
> fields, while the schema the code reads and writes uses `bidirectional` and `definition`. The
> `aif_equiv` label is documentation in the data file only; no code branches on it. Neither
> shape stores an inverse-type pointer.

## How edges are used in the system

**Discovery and review lifecycle (proposed to approved).** Most edges are proposed by an
LLM-driven discovery pass (`Invoke-EdgeDiscovery.ps1`), which writes each new edge with
`status: 'proposed'` and de-duplicates on a `source|type|target` key. A human then reviews them,
per-edge or in bulk, via `Approve-Edge.ps1`, `Set-Edge.ps1 -Status approved`, or the **Edge
Browser**'s bulk approve/reject buttons, which flip `status` to `approved` or `rejected`.
Approval stamps a timestamp (`taxonomy-editor/src/server/storage/fileIO.ts`, `updateEdgeStatus`,
lines 683-688). Edges can also be proposed from a finished debate. The reflection step
(`debateReflectionSlice.ts`, `applyReflectionProposal`) appends `status: 'proposed'` edges
tagged `model: 'debate-reflection'`.

**Where edges show up.** Edges are loaded into the taxonomy snapshot at runtime
(`lib/debate/taxonomyLoader.ts`, line 235) and surfaced in three UI components under
`taxonomy-editor/src/renderer/components/edge-browser/`:

- **Related Edges panel**, the per-node view (grouped by type, confidence-sorted) where this
  bookmark lives.
- **Edge Browser**, the full browse, filter, and bulk-review table.
- **Edge Detail panel**, the single-edge view that shows the **Weight and Confidence** section
  explained below, plus the edge's rationale.

**A note on runtime debate scoring.** Taxonomy POV edges and the debate engine's live argument
scoring are **decoupled**. The runtime QBAF (quantitative bipolar argumentation) graph is built
from *debate claims and detected contradictions* (`lib/debate/qbafCombinator.ts`), not from
`edges.json`. So the weight and confidence on a taxonomy edge are properties of the *taxonomy
relationship*, not live debate-turn strengths. The next section leans on that distinction.

## Weight and Confidence

The Edge Detail panel shows two bars, labeled **`w`** (weight) and **`c`** (confidence), and the
Related Edges rows show the same as `w…`/`c…` tags. They measure different things, and one edge
can have a high `c` with no `w` at all. Here is what each one is.

### Confidence (`c`)

**Confidence is how certain the system is that the edge *exists and is correctly typed*, not how
true the underlying claim is.** It is a number in `[0, 1]`, produced by the LLM discovery pass,
whose response schema requires a `confidence` field (`Invoke-EdgeDiscovery.ps1`, line 427; the
prompt asks for "Confidence (0.0-1.0)" at line 626). When an edge arrives without one, discovery
defaults it to `0.5` (line 684), and debate-reflection edges default to `0.7`
(`debateReflectionSlice.ts`, line 885). Discovery discards any candidate below `0.5` (lines 909,
1233), so stored proposed edges start at 0.5 or above. The UI tooltip states the meaning in the
same terms, certainty that the edge is correct rather than the claim's truth
(`EdgeDetailPanel.tsx`, lines 272-273).

### Weight (`w`)

**Weight is the LLM's estimate of how *strong* the relationship is**, a firmly load-bearing
`SUPPORTS` versus a marginal one. It is an optional number in `[0, 1]` (the prompt reads "Weight
(0.0-1.0): strength of the relationship," line 627), stored only when the value falls within
range (`Invoke-EdgeDiscovery.ps1`, lines 1260-1263). Because it is optional, many edges have a
confidence but no weight, which is why the weight bar renders only when a value is present
(`EdgeDetailPanel.tsx`, `wPct` at line 173).

### `modulated_weight` and `strength`

Two related fields you may see on an edge:

- **`modulated_weight`** is `weight` adjusted for the *kind of nodes* it connects. It is
  computed only by the batch tool `lib/debate/modulateEdgeWeights.ts` as
  `modulated_weight = weight × modulation_factor` (line 208), where the factor depends on the
  edge type and the endpoints' BDI attributes. A belief-to-belief attack uses
  `min(source.confidence, target.confidence)`, a desire-to-intention support uses
  `source.priority / 5`, and doctrinally-anchored endpoints get a ×1.2 (attack) or ×1.1
  (support) nudge capped at 1.0 (lines 63-119). It needs a `weight` to exist and depends on node
  priority and confidence written earlier by `lib/debate/assignWeights.ts`. The Edge Detail
  panel displays the raw `weight`, not `modulated_weight` (`EdgeDetailPanel.tsx`, line 173).
- **`strength`** is a separate *categorical* LLM label, `'strong' | 'moderate' | 'weak'`
  (`taxonomyTypes.ts`, line 305), shown as its own badge. It is not the numeric weight and plays
  no part in modulation.

### The "Confidence ≥ N%" filter

Both edge views can filter by confidence, and both threshold on the `confidence` field. Their
defaults differ, so the same node can look busier in one than the other. The **Related Edges
panel** slider labeled "Confidence ≥ N%" defaults to **0.75** (`RelatedEdgesPanel.tsx`, line
203), so by default it hides lower-confidence edges. The **Edge Browser** "Conf ≥" filter
defaults to **0** (`EdgeBrowser.tsx`, line 49), so by default it shows everything.

### Rationale coverage

Each edge can carry a **`rationale`**, a short explanation of *why* the edge was proposed. All
current writers emit and persist it. Discovery requires it in the LLM schema
(`Invoke-EdgeDiscovery.ps1`, lines 433, 773; persisted at 1255/926/686), and debate-reflection
passes it through (`debateReflectionSlice.ts`, line 893). Most existing edges, however, do not
have one. As of this writing only about 165 of roughly 33,621 edges carry a rationale, because
the large 2026-03 discovery cohort predates the rationale-emitting prompt. Expect the Edge
Detail rationale to be present on recent edges and blank on older ones. Closing that gap, a
prospective write-time requirement plus a backfill decision, is tracked under t/2444. The Edge
Detail panel lazy-loads the rationale on demand because the list API strips it for payload size
(`EdgeDetailPanel.tsx`, `useEdgeRationale`, lines 34-115).

## Under the hood

**One writer per language.** Every code path that writes `edges.json` must go through a single
serializer, either `serializeEdgesJson` in TypeScript (`lib/edges/serializeEdges.ts`) or
`Write-EdgesFile` in PowerShell (`scripts/AITriad/Private/Write-EdgesFile.ps1`). A guard test
(`lib/edges/edgesWriterGuard.test.ts`, t/1960) enforces that no new writer bypasses them. The
writers of record are the discovery pipeline (`Invoke-EdgeDiscovery.ps1`, in three sub-modes:
per-node, batch, and embedding-first), the field mutator `Set-Edge.ps1`, the lifecycle tool
`Approve-Edge.ps1`, the debate-reflection path, and the server routes in
`taxonomy-editor/src/server/routes/edges.ts` backed by
`taxonomy-editor/src/server/storage/fileIO.ts`.

**Field provenance.** `confidence`, `weight`, `strength`, and `rationale` originate from the LLM
discovery output or debate reflection. `modulated_weight` is derived only by the batch
modulation tool. `status`, `discovered_at`, `model`, and (embedding-first only) `discovered_by`
are stamped by the writer. `base_strength` is **not** an edge field at all. It belongs to the
runtime QBAF *node* (`lib/debate/qbaf.ts`, line 23) and should not be confused with edge weight.

**Discovery constants worth knowing** (all in `Invoke-EdgeDiscovery.ps1` unless noted): the
`confidence < 0.5` acceptance floor (lines 909, 1233), the default confidence `0.5` when the
model omits it (line 684), and the discovery run defaults `Temperature=0.3`, `MinSimilarity=0.20`,
`TopKCandidates=30`, and `EmbeddingFirstThreshold=0.30`.
