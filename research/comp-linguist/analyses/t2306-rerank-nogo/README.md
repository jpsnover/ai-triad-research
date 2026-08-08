# t/2306 — Cross-encoder rerank: NO-GO for default-ON

**Ticket:** t/2306 (validation) · **Epic:** t/2285 (retrieval-quality bundle) · **Author:** Computational Linguist · **Date:** 2026-08-08
**Ruling:** **NO-GO.** Cross-encoder rerank (`-CrossEncoderRerank`, `Get-RelevantTaxonomyNodes.ps1`) stays **opt-in / default-OFF**.
**Provenance:** derived (this study), exploratory (verbatim-proxy query, n=10) — but the mechanism is structural and deterministic, so the direction is robust.

## Finding (one line)

The **ms-marco-MiniLM cross-encoder systematically promotes Beliefs-category nodes** to rank-1 when reranking BDI-typed POV node descriptions, degrading retrieval quality for Intention/Desire key_points — the majority of policy-action content.

## Why this matters

Flipping rerank default-ON was gated (t/2287 AC, t/2285 epic AC) on a CL net-improvement validation. This study is that gate. It also closes t/2301 (CE-based `retrieval_confidence`) won't-do — with rerank not default-ON, a cross-encoder confidence has no default path.

## Method

Retrieval-layer eval, chosen over full-pipeline OFF/ON because **rerank's effect on retrieval ordering is deterministic** (same query → same bi-encoder candidates → same cross-encoder scores); only the downstream LLM pick is stochastic. So the replication gate (R-1, n≥10) does **not** apply — more runs cannot change a deterministic ordering. The instrument under test is the *configuration*, not a draw.

- **Query:** each key_point's `verbatim` field — the real source excerpt that generated it (a faithful chunk proxy). An earlier pilot using the synthesized `attribution_text` proved invalid: a node the pipeline *assigned* wasn't even retrieved by its own attribution query (the assignment path is doc-level chunk RAG + LLM free-selection, not per-key_point retrieval).
- **Cases:** 10 real safetyist key_points — legal/collision core (New Mexico v. Meta, products-liability, Section 230, EU liability directive, AI-Act incident reporting) + AI-safety controls (interpretability, alignment).
- **Measure:** for each, run `Get-RelevantTaxonomyNodes -POV safetyist` OFF vs `-CrossEncoderRerank` ON; record the ranked node list and the BDI type of rank-1.

## Results

### Rank-1 BDI distribution (the headline)

| rank-1 BDI type | OFF (bi-encoder) | ON (cross-encoder rerank) |
|---|---|---|
| Beliefs | 4 / 10 | **9 / 10** |
| Intentions | 5 / 10 | 1 / 10 |
| Desires | 1 / 10 | 0 / 10 |

Rerank converts a mixed BDI distribution into 90% Beliefs at rank-1, independent of the query's actual type.

### Per-case (rank-1 node, OFF → ON)

| # | Source doc | query type | OFF rank-1 | ON rank-1 |
|---|---|---|---|---|
| 1 | new-mexico-v-meta | Desire | saf-intentions-148 (I) | saf-beliefs-214 (B) |
| 2 | new-mexico-v-meta | Belief | saf-intentions-165 (I) | saf-beliefs-043 (B) |
| 3 | new-mexico-v-meta (**saf-167 misfire**) | Intention | **saf-intentions-171 (I)** | saf-beliefs-229 (B) |
| 4 | products-liability | Intention | saf-beliefs-214 (B) | saf-beliefs-214 (B) |
| 5 | section-230 | Intention | saf-intentions-170 (I) | saf-beliefs-243 (B) |
| 6 | eu-liability-directive | Intention | saf-beliefs-122 (B) | saf-beliefs-210 (B) |
| 7 | incident-reporting | Intention | saf-desires-026 (D) | saf-beliefs-013 (B) |
| 8 | adolescence (interpretability) | Intention | saf-beliefs-038 (B) | saf-beliefs-223 (B) |
| 9 | adolescence (constitution) | Intention | saf-intentions-204 (I) | saf-intentions-204 (I) |
| 10 | adolescence (safety tension) | Desire | saf-beliefs-119 (B) | saf-beliefs-091 (B) |

### The flagship saf-167 case (case 3), top-5

- **OFF (bi-encoder):** `saf-intentions-171`, `saf-intentions-104`, saf-intentions-236, saf-beliefs-229, saf-intentions-204 — the **correct youth-protection nodes (171, 104) at rank 1-2.**
- **ON (rerank):** saf-beliefs-229, saf-intentions-236, saf-beliefs-240, saf-beliefs-230, saf-beliefs-141 — **171 and 104 gone from the top-5.**

On the one case bi-encoder gets right, rerank buries the correct answer under Beliefs nodes.

## Interpretation

**Mechanism hypothesis:** ms-marco-MiniLM is trained on MS MARCO web passage-ranking (informational Q→A relevance). Node descriptions differ by BDI type — Beliefs are declarative ("X is the case"), Intentions prescriptive ("do X"), Desires optative ("X ought to"). ms-marco relevance appears to favor the declarative/expository phrasing of Belief descriptions, so it promotes Beliefs regardless of the query's intent. This is a property of scoring the **node descriptions**, hence query-independent and robust to the verbatim-vs-chunk fidelity gap.

**Decision rule (pre-registered):** GO required BOTH net improvement AND ~zero clean-case regression. Observed: net improvement **negative** (correct nodes demoted) and clean-case regression **severe** (saf-167 correct answer buried). Both arms fail.

**Asymmetric stakes:** NO-GO preserves the shipped status quo (rerank already opt-in/OFF). A wrong GO ships a category bias into production affecting Intention/Desire assignments. Under uncertainty, the conservative ruling is correct.

## Bonus finding (epic-relevant)

The **per-key_point verbatim query retrieves the correct youth nodes at rank 1-2** for saf-167, while the production **doc-level chunk RAG** assigned the wrong `saf-intentions-167`. This is direct evidence the misfire is a **doc-level-chunking + LLM-selection artifact** — and that **narrower per-key_point retrieval (mechanism #5, `mechanism_type` pre-filtering) is the real lever**, not reranking.

## Caveats

- Query is `verbatim` (real excerpt), a proxy for the production **chunk** text. Mitigated: the bias is a node-description-scoring property, query-independent; a 90/10 skew across 10 varied queries is not a query artifact.
- n=10, exploratory. Not a limitation for a deterministic instrument — sample breadth, not replication, is the axis, and 10 diverse cases show a consistent structural effect.
- Assigned-node ranks (many at rank >10 or absent on verbatim) reflect that neither attribution nor verbatim reproduces the doc-level assignment path; they are not used as the ruling's basis. The ruling rests on the rank-1 BDI skew + the saf-167 burial, which need no assigned-node ground truth.

## Re-entry condition

Rerank could be revisited only with a **reconfigured reranker** — BDI-type-aware reranking (e.g. type-matched scoring), or a cross-encoder not biased toward declarative text — and a fresh validation. A new ticket, not t/2306. Until then rerank is opt-in/OFF and CE-based confidence (t/2301) is cancelled.
