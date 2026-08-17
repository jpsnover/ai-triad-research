# Stance-Polarity Inversion in Key-Point → Node Assignment — Fix Specification

**Status:** For review
**Author:** Computational Linguist
**Date:** 2026-08-17
**Class:** Extraction quality / ontological compliance (CL mandatory-review surface)
**Case type:** `observed` (empirically reproduced from stored summary — see §2)

---

## 1. Summary

A document key point that argues **against** AI exceptionalism ("ordinary privacy
law applies to AI; no new legal regime is needed") was assigned to taxonomy node
`acc-intentions-047` — *"Argue That AI Requires Entirely New Laws, Not Adapted Old
Ones"* — with **stance `aligned`** and a green retrieval confidence of **0.71**.
The node asserts the **exact opposite proposition** the document argues. The
assignment is not merely low-quality; it is polarity-inverted, and every
downstream quality gate passed it.

This is a **failure class**, not a one-off: any source that argues the *negation*
of a node's asserted proposition is topically near-identical to that node and will
be mis-mapped as `aligned` by the current pipeline. The defect is systemic because
the node-selection signal and all three verification gates measure **topical /
embedding similarity**, which is monotonically **high** for antonymic
(negated) propositions.

---

## 2. Evidence (empirically reproduced)

**Document:** `ai-doesnt-rewrite-privacy-law-it-changes-where-compliance-2026`
**Summary file:** `summaries/ai-doesnt-rewrite-privacy-law-it-changes-where-compliance-2026.json`
**Run metadata (`model_info`):** `model=gemini-3.5-flash-lite`, `temperature=0.1`,
`extraction_mode=fire` (`all_confident`, 0 iterations), `taxonomy_filter=rag`,
`taxonomy_nodes=40`.

Stored key point (accelerationist camp):

| Field | Stored value |
|---|---|
| `verbatim` | "AI presents new privacy challenges, but treating AI as if it lives outside the parameters of ordinary privacy law is **fallacious**. … there is **no AI exceptionalism**. The same principles that have long governed responsible data use still apply." |
| `canonical_proposition` | "Treating artificial intelligence as exempt from ordinary privacy law is **fallacious** because established data protection principles continue to govern responsible use." |
| `attribution_text` | "A **Belief** … that rejecting AI exceptionalism ensures existing privacy principles remain the baseline … **without requiring novel regulatory regimes**." |
| `taxonomy_node_id` | `acc-intentions-047` |
| `category` | `Beliefs` |
| `stance` | **`aligned`** ← defect |
| `extraction_confidence` | 0.95 |
| `retrieval_confidence` | **0.7133** |
| `retrieval_low_confidence` | **false** |

Node `acc-intentions-047` (from `accelerationist.json`), category **Intentions**:

> "…asserts emerging technologies are so transformative they require **entirely new
> legal frameworks rather than adapted existing laws**. … Excludes: general
> arguments that caution hinders advancement or critiques of regulatory
> institutional inertia."

The source's own `canonical_proposition` and `attribution_text` **assert the
negation** of the node proposition. The correct stance is **`strongly_opposed`**
(the source disputes the node's proposition), not `aligned`.

**Two independent defects are visible in one record:**

1. **Stance polarity inversion** — `aligned` where `strongly_opposed` is correct.
2. **Category mismatch** — the key point is tagged `Beliefs` but the assigned node
   is category `Intentions`. A correct propositional match would agree on
   category; a purely topical (bag-of-content-words) match does not. This is a
   corroborating symptom of topical-over-propositional matching.

**Taxonomy gap (secondary finding):** a search of all three POV files finds **no
positive counterpart node** for the anti-exceptionalism / "adapt existing law to
AI" intention. The taxonomy contains the "new laws" pole (`acc-intentions-047`)
but not its opposite. This gap is *why* the model had nowhere correct to land and
reached for the nearest topical node.

---

## 3. Root-cause analysis

### 3.1 Why the model produced it
- The RAG candidate set (40 nodes) surfaced `acc-intentions-047` as the topically
  nearest node — correct on topic (AI + privacy + new-vs-old law), inverted on
  proposition.
- The model conflated **POV-camp membership** with **node alignment**. The document
  *is* accelerationist (rejecting exceptionalism to avoid stifling innovation), so
  the camp is right — but being in the accelerationist camp does **not** mean the
  source aligns with every accelerationist-associated node. It defaulted `stance`
  to `aligned` because the camp matched.
- The prompt gives the model **no signal to do otherwise**:
  - `pov-summary-system.prompt` defines `opposed` / `strongly_opposed` in the
    stance enum (line ~395) but **every one of the three few-shot key-point
    examples uses `aligned`/`strongly_aligned`** (lines ~278, ~290, ~302). The
    model has zero exemplars of the "topically on-node, propositionally opposed"
    pattern.
  - `canonical_proposition` and `attribution_text` — the designated
    embedding-match targets — are explicitly instructed to **"Strip POV framing,
    caveats, and hedging — state the core proposition directly"** (line ~171).
    Stripping produces a polarity-bearing sentence, but nothing downstream reads
    the polarity; only its embedding is used.

### 3.2 Why every gate missed it
All three post-extraction gates in `Finalize-Summary` operate on cosine similarity
of the (polarity-stripped) `attribution_text` embedding. Cosine similarity between
a proposition and its negation is **high** (they share nearly all content words),
so each gate returns a false-green:

| Gate | Mechanism | Why it passed the inversion |
|---|---|---|
| Retrieval-confidence (`Invoke-RetrievalConfidencePass`, t/2288) | cosine(attribution, assigned-node) vs threshold 0.45 | Similarity was **0.71 ≥ 0.45** → `retrieval_low_confidence=false`. High similarity is exactly what a negation produces. |
| Mechanism-5 re-retrieval (`Invoke-Mechanism5RetrievalPass`, t/2357) | flags KP if assigned node is low-confidence **or** absent from attribution top-3 | Assigned node is the **top** topical match → not flagged. |
| Excludes-veto (`Test-ExcludesVeto`, t/2286) | veto if cosine(attr, node.Excludes) − cosine(attr, node.Core) > margin | Node's `Excludes:` clause names *sibling topics* (caution-hinders-advancement, institutional inertia), **not the negation** of Core. Attribution is closer to Core than Excludes → `Pass`. The excludes-veto encodes lateral topic boundaries, not polarity. |

**The single signal none of them computes:** whether the source's asserted
proposition points the **same direction** as the node's asserted proposition or the
**opposite**. That is a **contradiction / entailment (NLI) judgment**, not a
similarity judgment. Embeddings are constitutionally unable to supply it — this is
the well-known polarity-blindness of sentence embeddings, and it is the load-bearing
assumption behind all three current gates.

### 3.3 Failure-class statement
> **A key point that asserts the negation of a node's proposition is embedded near
> that node and will be assigned to it as `aligned`. Similarity-based selection and
> similarity-based verification cannot distinguish "asserts P" from "asserts ¬P".**

---

## 4. Correct output for the repro case

**Decision (2026-08-17): the fixture ground truth is 4b (unmap + taxonomy gap).**
It is the ontologically correct outcome — no positive counterpart node exists — and
it motivates the P2 node proposal. 4a is recorded as the faithful fallback if a
counterpart node lands first.

- **4a (immediate, faithful):** `taxonomy_node_id = acc-intentions-047`,
  `stance = strongly_opposed`. The source directly disputes that node's proposition.
- **4b (alternative):** `taxonomy_node_id = null` + an `unmapped_concepts` entry for
  the anti-exceptionalism / "adapt existing law to AI" intention, since no positive
  node exists (§2 taxonomy gap). Preferred if the category mismatch (Belief vs
  Intentions node) makes 4a awkward.
- **4c (systemic):** the pipeline must be able to *detect* the inversion and either
  flip the stance or unmap — see §5.

---

## 5. Proposed fixes (layered)

### P0 — Prompt: teach directional stance (CL-owned; cheapest, ship first)
File: `scripts/AITriad/Prompts/pov-summary-system.prompt`

1. Add an explicit **directional-stance rule** near the stance enum:
   > *`stance` is your agreement with the ASSIGNED NODE'S asserted proposition —
   > not with the POV camp. A source can be on-topic for a node yet argue its
   > negation. Read the node's description. If the source **asserts** the node's
   > proposition → aligned/strongly_aligned. If it **disputes or argues the
   > opposite** → opposed/strongly_opposed. Never default to `aligned` because the
   > camp matches.*
2. Add a **fourth few-shot example** demonstrating a topically-matched key point
   assigned with `stance: strongly_opposed` (use a sanitized version of this case).
3. Add a **category-consistency check**: the key point's `category` should match the
   assigned node's category; if they differ, re-examine the assignment before
   emitting it.

**Provenance:** stipulated (prompt-engineering change; no metric threshold added).
No provenance-register entry required unless a threshold is introduced in P1.

### P1 — Gate: contradiction-detection pass (Shared Lib / PowerShell-owned; CL-specified)
Add a polarity/contradiction gate to `Finalize-Summary`, running after the
retrieval-confidence pass. For each key point where **topical similarity is high but
the claimed stance is aligned-family**, verify directional agreement with a signal
embeddings cannot provide. Two candidate implementations (decide in review):

- **(a) Lightweight NLI:** score entailment vs contradiction between
  `canonical_proposition` and the node proposition (label + Core description). A
  contradiction verdict with `aligned` stance ⇒ flag/flip.
- **(b) Targeted LLM adjudication:** a single cheap yes/no call — *"Does proposition
  A assert, or dispute, proposition B?"* — batched across the flagged key points
  only (keeps cost bounded; the veto only fires on high-similarity + aligned).

On a detected inversion: set `stance` to the opposed-family value **or** null the
node and record an `unmapped_concept`, and set a new
`stance_polarity_flag = true` for reviewer surfacing. **Do not silently auto-flip
without surfacing** — a wrong flip is as bad as a wrong align.

**Provenance (if a numeric threshold is introduced):** must be declared
(`stipulated` initially) and added to `docs/metric-provenance-register.md` in the
same PR, per the CL provenance rule.

### P2 — Taxonomy: file the missing counterpart node (CL/data-owned)
Propose an accelerationist Intention node for the anti-exceptionalism / "adapt
existing law to AI" pole (genus-differentia, DOLCE-compliant), so future
anti-exceptionalism sources have a correct positive home instead of landing
`opposed` on the "new laws" node. Route through the normal taxonomy-proposal path.

### P3 — Data: re-mediate this record
Re-run the summary for the affected document (or targeted-correct the stored
`stance`) once P0 lands. PowerShell-owned re-run; CL verifies the corrected output.

---

## 6. Acceptance criteria

1. **Repro fixture** (`observed`): a golden fixture pinned to the stored key point
   in §2, asserting the *current* wrong output (`node=acc-intentions-047`,
   `stance=aligned`) and the *target* output (§4a or §4b). The fixture ground truth
   was empirically reproduced from the stored summary, not inferred from node text.
2. **P0 pass:** re-extraction of the affected document (or the fixture passage) no
   longer emits `stance=aligned` for this key point — it emits an opposed-family
   stance **or** unmaps to a taxonomy gap.
3. **P1 pass (both arms):** the contradiction gate (a) fires on the deliberate
   inversion (flag/flip) and (b) is silent on a genuinely aligned high-similarity
   key point (zero false-positive on a control case). A flaky polarity gate is the
   next incident — prove both arms.
4. **No regression:** total key-point count and null-node rate on a 10-document
   sample stay within noise; aligned key points that are genuinely aligned keep
   their stance.
5. **Category consistency:** the emitted key point's `category` matches its assigned
   node's category, or is explicitly flagged.

---

## 7. Ownership & routing

| Layer | Owner | CL role |
|---|---|---|
| P0 prompt | Shared Lib / PowerShell (prompt file lives under `scripts/`) | CL authors + mandatory review |
| P1 gate code | PowerShell (`Finalize-Summary`, new pass) / Shared Lib | CL specifies signal + acceptance; mandatory review |
| P2 taxonomy node | CL / data | CL drafts proposal |
| P3 re-run | PowerShell | CL verifies output |

Gate-touching work (P1, if it introduces a blocking check) routes to **Main (TL)**
for Gate Verification (both-arms proof) per the prevention-per-incident rule.

---

## 9. System-wide occurrence (audit 2026-08-17)

The origin case is **not isolated**. A read-only audit of every "text → POV
node/conflict/situation" mapping surface found the same signature — *select by
embedding/topical similarity, then assign or assume agreement with no direction
(assert-P vs assert-¬P) check* — recurring across the extraction, org-graph, and
debate subsystems. Embedding cosine between a proposition and its negation is high,
so every similarity-only gate false-greens an inversion.

### Confirmed VULNERABLE (assign/reinforce opposite-meaning text as aligned/supporting)

| # | Surface | File:line | Why | Blast radius |
|---|---|---|---|---|
| V1 | `Invoke-OrgClaimMatching` | `scripts/AITriad/Public/Invoke-OrgClaimMatching.ps1:209-332` | node = cosine argmax; edge type (`ADVOCATES_FOR`/`OPPOSES`) taken from the org's polarity toward **its own** sentence, never reconciled with the matched node. `NegationSlice` (`:242-253`) is **report-only**. | **High — persists org→node edges** |
| V2 | QBAF Stage A relation detection | `scripts/AITriad/Public/Invoke-QbafConflictAnalysis.ps1:210-241` | two claims sharing a node, each `doc_position='supports'` (of its own text), classified as a `supports` edge — `doc_position` is not commensurable across different claim texts. | High — feeds QBAF strengths |
| V3 | `computeClaimTaxonomyAttribution` | `lib/debate/argumentNetwork/attribution.ts:104-167` | claim→node `primary_ref` by cosine (thresh 0.35/0.40), no entailment; POV pre-filter constrains camp only, not direction. | High — live debate path |
| V4 | Evidence auto-labeled `'supports'` | `lib/debate/argumentNetwork/processClaims.ts:293-308` | every retrieved passage hardcoded `relation:'supports'` → **boosts** fact-check strength; a contradicting-but-topical passage raises the claim's strength. Code comment concedes "would require NLI." | High — live path |
| V5 | `computeDoctrinalAnchoring` | `lib/debate/doctrinalAnchoring.ts:55` | strips the `REJECT:` prefix **before** embedding the boundary string, collapsing "POV embraces X" and "POV rejects X" to one vector; anchored nodes get a confidence floor. | Medium (curated nodes) |

### PARTIAL (polarity-blind but no false-agreement asserted, or a directional gate exists but is default-off)

- `Resolve-UnmappedConcepts` (`scripts/AITriad/Private/…`) — cosine/Jaccard concept→node collapse; mislabels ¬P onto P but assigns no stance.
- `Get-RelevantTaxonomyNodes` (`scripts/AITriad/Public/…`) — the RAG candidate builder; polarity-blind by design (no exclusion-vector defense, unlike the TS path), safe only because an LLM re-judges downstream. Seeds V1–V4.
- `Find-Conflict` (deprecated) — fuzzy slug/`doc_position`, defaults stance to `neutral`.
- `relinkVocabulary`, `frame_crux_alignment`, `cruxRegistry` dedup, `clause_coverage` — offline-maintenance or diagnostic; topical, not agreement.
- TS `selectRelevantNodes` / crux re-scoring — has an anti-inversion defense (`exclusionGuard.ts` demotes when the query is closer to a node's `exclusion_vector`) but it is **opt-in** (requires `exclusion_vector` + `queryVector`).
- `Find-SituationCandidates` — **the defect done right**: a genuine NLI cross-encoder (`nli-deberta-v3-small`) routes contradiction pairs to debate clusters instead of merging. But it **defaults `NliLabel='entailment'` on NLI failure** (`:410`) and `-NoNLI` reverts to similarity-only.

### The load-bearing insight: the remedies already exist in-repo

Two correct directional mechanisms are already implemented and just aren't applied
at the vulnerable stance-assigning steps:
1. **`nliClassify`** (`lib/debate/aiAdapter.ts:75`) — wired only to steelman/grounding, never to claim↔node or claim↔evidence.
2. **`exclusion_vector` guard** (`lib/debate/exclusionGuard.ts:36-155`) — demotes when a query is nearer a node's exclusion vector; opt-in only.

**Systemic recommendation:** extract a single reusable **directional-agreement gate**
(NLI/entailment, or the exclusion-vector comparison where node vectors carry one)
and apply it at *every* surface that asserts a text↔node stance — V1–V5 — and close
the two default-to-agreement fallbacks (`Find-SituationCandidates` NLI-failure
default; make the `exclusionGuard` non-opt-in on stance-asserting paths). This
generalizes the P1 gate (§5) from the summary pipeline to a shared capability.

---

## 8. Tracking

Tickets to be filed on approval (one per actionable recommendation, per the CL
review-recommendation-tracking rule): P0 prompt fix, P1 contradiction gate
(design + impl), P2 taxonomy-gap node proposal, P3 record re-mediation, and the
regression fixture. Each references this spec section.
