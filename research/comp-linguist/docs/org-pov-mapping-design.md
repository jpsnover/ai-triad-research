# Organization → POV Mapping: Methodology Review and Edge-Acquisition Design

**Date:** 2026-07-12
**Author:** Computational Linguist
**Owner request:** review the organizations work; suggest better ways to map orgs to
specific POVs, including how to acquire org→node edges.
**Companion docs:** `docs/organizations-status.md` (TL status audit) and
`docs/hld-organization-relationship-graph.md` (TL HLD, approved; edge storage shipped
2026-07-12 per TL, remaining UI in progress). Those documents cover the infrastructure. This note covers the measurement
methodology they don't: where alignment scores come from, and how org→node edges
get made.

## Findings (current mapping methodology)

1. **All 75 camp scores are stipulated.** 25 orgs × 3 camps of `pov_alignment` scores,
   hand-authored 2026-07-01, `source_refs: []` on every record. No evidence pointer,
   no generation pipeline, no update mechanism. By the provenance register's rule these
   are stipulated by definition. org-001 lists Anthropic's RSP position paper in
   `external_links`, so the evidence exists; it just isn't wired as evidence.
2. **Mapping stops above the BDI-node level.** `topic_engagement` on 9/25 orgs (11
   links), `policy_engagement` on 8/25 (8 links), and (post-HLD data, 2026-07-12) 36
   curated `ADVOCATES_FOR`/`OPPOSES` edges — all targeting `sit-*` situations.
   **Org→BDI-node mappings: zero.** The question the feature exists to answer, "which
   real organizations hold *this specific position*?", still has no data path at node
   granularity.
3. **The score construct is undefined.** Anthropic's accelerationist rationale cites
   *behavior* ("builds and deploys rapidly"); its safetyist rationale cites *stated
   commitments* (RSP). Two constructs feed one undefined decimal, and nothing anchors
   what +0.4 means vs +0.3. This is the same false-precision problem the Debate-Tested
   design rejected.

## Recommendations (summary)

| # | Recommendation | Cost | Ticket |
|---|---|---|---|
| R1 | Org→node edges via the claim-matching pipeline (design below) | M | t/1553 (PS pipeline), t/1554 (review UI) |
| R2 | Derive camp scores as rollups of approved org→node edges | S (after R1) | folded into t/1553 AC |
| R3 | Replace decimal camp scores with 5-point anchored tiers; split rhetorical vs behavioral stance | S (schema decision) | t/1556 (CL, blocked by t/1553 — tier boundaries derive from R2's real score distribution, per TL p/38#4) |
| R4 | `assessed_at` field + populate `source_refs` from `external_links` | XS | t/1555 |
| R5 | Consistency audit: camp scores vs topic/policy stances | XS (manual at 25 orgs) | CL runs after R4; instrument only if roster grows |

## R1 design: acquiring org→node edges

The pipeline reuses three assets that already exist: the ingested source corpus
(~650 documents, many *by* these orgs), the claim-extraction and
`canonical_proposition` register normalization from the debate engine, and the
claim→node embedding matcher evaluated end-to-end during the t/524 experiments. It
follows the machine-proposes / human-disposes pattern used everywhere else in the
system, because the matcher's measured accuracy (MRR ≈ 0.31 against the automated
golden set) is nowhere near auto-write quality. The HLD already commits to org edges
being "curated facts, not LLM-discovered claims"; proposal-then-curation automates the
expensive part while keeping that commitment true.

### Stage 0: Link orgs to documents (`PUBLISHED` edges)

Before any stance can be attributed, the system needs to know which documents speak
*for* an org.

- **Seed set:** each org's `external_links` (position papers, already curated, so this
  set is free).
- **Corpus match:** match org `name`/`short_name`/aliases against source-record
  metadata (publisher, author affiliation, URL domain) across the ingested corpus.
  Domain matching (`anthropic.com` → org-001) is high-precision; author-affiliation
  matching is noisier and goes to review rather than auto-link.
- **Output:** proposed `PUBLISHED` edges (`org-* → source id`) into the HLD's
  `organization_edges.json` with `status: "proposed"`. A human approves; approved edges
  are the document set for Stage 1.
- **Authorship ≠ endorsement caveat:** a document *hosted* by an org (a workshop paper,
  a guest post) is not the org's voice. The review step is the filter; the proposal
  carries the match basis (domain / metadata / manual) so the reviewer can judge.

### Stage 1: Extract stance claims per document

New UsageID `enrichment.org-stance-extraction`, with a CL-owned prompt. Given a
document published by the org, it extracts the positions **the org itself asserts or
opposes**, as distinct from positions the document merely reports, quotes, or attacks.
Each claim comes back with:
- `text` (near-verbatim) and `canonical_proposition` (≤30 words, register-normalized;
  the same field and rules as debate claim extraction, so the matcher sees the register
  it was tuned for),
- `polarity`: `asserts` | `opposes`,
- `extraction_confidence` (the existing 0–1 rubric).

Documents already carrying POV summaries provide a cross-check, not a substitute.
Summaries describe what a document says about the camps; this extraction captures what
the org commits to.

### Stage 2: Match claims to BDI nodes

Embedding match of each claim's `canonical_proposition` against node embeddings,
top-k = 5 candidates with cosine scores. Two implementation notes from the t/524
experiment series:
- Use description+assumes weights **0.67/0.33**, the grid-search optimum (MRR 0.3128)
  over the production 0.80/0.20 (MRR 0.3009). If production embeddings haven't been
  re-weighted yet, this pipeline is the second consumer that justifies doing it.
- Do NOT fine-tune the matcher for this task. All four fine-tuning attempts degraded
  the baseline (catastrophic forgetting at 22M params); composition and thresholds are
  the available levers.

### Stage 3: Aggregate into proposed edges

- Group matched claims by (node, polarity). A proposal is emitted when **either**
  ≥2 independent claims (different documents, or well-separated passages) agree, **or**
  1 claim matches with cosine at or above a high-precision threshold (stipulated start
  0.60, reevaluable from the review queue's accept/reject telemetry).
- `asserts` produces a proposed `ADVOCATES_FOR org-* → node` edge; `opposes` produces
  `OPPOSES`.
- Each proposal bundles its evidence (claim texts, source doc ids, similarity scores,
  match basis). That bundle **is** the `source_refs` and `rationale` of the eventual
  edge, so provenance is built in rather than bolted on.
- Per-org cap per batch (stipulated 20) so review stays a session, not a backlog.

### Stage 4: Human review

Proposals land in the HLD's `organization_edges.json` as `status: "proposed"`; the
reviewer approves, rejects, or edits. Two viable surfaces, in preference order:
1. **Extend the claim-attribution annotation tool** (`_annotation_tool.html`), which
   already has exactly the right interaction shape (claim text, candidate nodes,
   search by ID/label, POV/BDI filters, accept/reject, keyboard flow). An "org edge"
   mode is a variant, not a new tool.
2. The taxonomy-editor `OrganizationDetail` UI once the HLD's edge display lands.
   Better long-term home, but blocked on that work.

Rejected proposals are kept with status `rejected`. They are free threshold telemetry:
the accept rate per similarity band is the data that later moves the Stage 3 threshold
from stipulated to derived.

### Stage 5: Camp-score rollup (R2)

Once an org has approved edges, its per-camp alignment becomes computable from the
share and polarity of approved edges into each camp's nodes (a signed ratio, or the
anchored tier of R3 chosen by thresholds on that ratio). Scores become **derived**,
with the edges as evidence; the hand-written rationales remain as human context.
The rhetorical-vs-behavioral split (R3) stays orthogonal. This pipeline measures the
*rhetorical* stance (what the org publishes); the behavioral assessment stays a
human-curated annotation.

### Scale and cost

25 orgs × ~3–10 linked documents × ~5–15 stance claims ≈ 1–3K claims, reducing to a
few hundred proposals after aggregation. All extraction and matching runs on
flash-lite plus local embeddings; the binding cost is human review time, which the
per-org cap and evidence bundles are designed around.

### Provenance declarations (register entries at implementation time)

| Parameter | Value | Class |
|---|---|---|
| High-precision single-claim cosine threshold | 0.60 | stipulated |
| Multi-claim agreement minimum | 2 | stipulated |
| Per-org review batch cap | 20 | stipulated |
| Stage-2 field weights | 0.67/0.33 | derived (t/524 grid search) |
| Camp rollup formula (R2) | signed edge ratio | stipulated until validated |

## What this deliberately does not do

- **No auto-written edges.** Every edge a user sees passed human review.
- **No web-research stance inference.** Deriving org positions from live web search
  (rather than the ingested corpus) is hallucination-prone and unauditable. If the
  corpus lacks an org's documents, the fix is ingesting them, not asking a model to
  remember.
- **No debate-derived org stances.** Debater personas citing an org is evidence about
  our debates, not about the org.
- **Camp scores don't feed scoring/relevance anywhere**, matching the presentational
  discipline of `aphorism` and `external_evidence`, until R2 rollups are validated.
