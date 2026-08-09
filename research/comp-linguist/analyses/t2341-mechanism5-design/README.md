# t/2341 — Mechanism #5 design: per-key_point retrieval + `mechanism_type` consumption

**Ticket:** t/2341 · **Epic origin:** t/2285 (retrieval-quality bundle, closed) · **Author:** Computational Linguist · **Date:** 2026-08-09
**Status:** APPROVED — TL sign-off t/2341#2 (2026-08-09). Proceed to validation on A(b) before PS implements. See §8 for sign-off conditions.
**Provenance:** derived (this design), grounded in t/2306 (rerank NO-GO) + the t/2294 `saf-167-repro` fixture (both `observed`).

---

## 1. Problem & evidence

**Failure class:** vocabulary-collision misfire — the LLM assigns a key_point to a taxonomy node that shares surface vocabulary with the *document* but is semantically wrong for that *key_point*.

**Flagship (t/2294 case_1, observed):** `why-new-mexico-v-meta-matters` — a youth-product-mandate key_point was assigned `saf-intentions-167` ("NTSB-style incident investigation body"). Correct home is the contested youth-protection family (`saf-intentions-171/104/222`).

**Two evidence-grounded facts fix the design:**

1. **`mechanism_type` is inert.** t/2290 shipped the closed-enum field in the extraction prompt, but `git grep mechanism_type scripts/**/*.ps1` (non-prompt) = **0 hits**. Emitted on key_points, consumed nowhere. *(Confirmed 2026-08-09.)*
2. **The misfire is a doc-level-RAG + LLM-free-selection artifact** (t/2306 Finding 3 / t/2294 `empirical_findings`). The run used chunk/doc-level RAG (`taxonomy_filter=rag`, `taxonomy_nodes=40`); the LLM free-selected from that broad candidate set. Critically: **`saf-167` is absent from the key_point's own bi-encoder top-80** (`saf_167_rank: >80` on all three key_point fields), while the correct youth family ranks **1–4**. So narrowing retrieval to the key_point structurally removes the wrong node from reach and surfaces the right family.

---

## 2. Current pipeline seam

`Invoke-DocumentSummary.ps1` → `Invoke-ChunkedSummary` (docs > 20k tok) or single-call:
- Splits into chunks (`Split-DocumentChunks`, 6k/1.5k tok).
- **One RAG query per *chunk*** (`Invoke-BatchEmbeddings` on chunk text → `Get-RelevantTaxonomyNodes`) → a chunk-scoped candidate node set (~40).
- LLM extracts key_points **and free-selects `taxonomy_node_id`** from that chunk-scoped set. **← the misfire seam.**

`Get-RelevantTaxonomyNodes.ps1` (504 ln): cosine over cached embeddings, adaptive top-K + threshold floor + min-per-BDI; `-CrossEncoderRerank` opt-in/OFF (t/2306 NO-GO). Query is whatever text is passed — today a *chunk*, not a key_point.

**Key point:** retrieval granularity is the chunk; assignment granularity is the key_point. The mismatch is the bug.

---

## 3. Lever A — per-key_point re-retrieval / re-scoring  *(evidence-backed, no new data)*

After extraction, for each key_point re-run `Get-RelevantTaxonomyNodes` with the **key_point's own text** (canonical_proposition / attribution_text / verbatim) as query, POV-scoped. Reuses existing embeddings — no schema/data change.

Two variants:

- **A(a) — hard-constrain:** restrict the LLM's `taxonomy_node_id` to the per-key_point top-K candidate slice. *Structurally* prevents the saf-167 class (wrong node isn't in the slice). **Risk:** clean-case regression — a doc-context-justified correct node that ranks below K for the key_point in isolation gets excluded. This is exactly the arm that ruled rerank NO-GO (t/2306). **Do not default-ON without the two-arm bar.**
- **A(b) — flag → surface → graduated correct** *(recommended)*: reuse the shipped **t/2288 `retrieval_confidence`** (cosine of the *assigned* node to the key_point). When the LLM's pick (i) has low `retrieval_confidence` AND (ii) diverges from the per-key_point top-3, surface the per-key_point top-3; **auto-select top-1 only when its margin over the assigned pick is decisive**, else flag for human override (t/2289 path). This is precisely the t/2294 case_1 expected outcome: **MITIGATED (flag + surface), not auto-corrected** (correct home is a contested family).

**Recommendation within A:** ship **A(b)** as default behavior (flag + surface, conservative auto-correct on decisive margin only); keep **A(a) hard-constrain behind an opt-in switch** for evaluation, mirroring how rerank shipped opt-in pending validation.

---

## 4. Lever B — `mechanism_type` structural pre-filter  *(blocked on a data dependency)*

Intended use: restrict candidates to matching-mechanism nodes before embedding comparison.

**Dependency, now scoped (2026-08-09):** taxonomy nodes carry **no `mechanism_type`** (0/342 safetyist; `graph_attributes` has `epistemic_type`, `rhetorical_strategy`, `node_scope`, … but not mechanism). `mechanism_type` exists **only on the query side** (extracted key_points). A pre-filter needs node-side mechanism labels → either **(i) enrich ~889 POV nodes with `mechanism_type`** (an `Invoke-AttributeExtraction`-class batch pass + register/provenance + human QC), or **(ii) build a `mechanism_type → node[]` map**. Either is a **separate upstream ticket**, not implementable inside this one.

**Assessment:** B is structural insurance but **gated on node enrichment**; it cannot be validated until node-side mechanism labels exist. Also note a risk: a hard mechanism pre-filter has the same exclusion-regression exposure as A(a) if the emitted `mechanism_type` enum is noisy (its own accuracy is unvalidated).

---

## 5. Recommendation

1. **Primary: Lever A(b)** — per-key_point re-retrieval feeding a flag→surface→graduated-correct step on top of t/2288. Directly evidence-backed, no new data, honors the fixture's "mitigate not auto-correct" expectation.
2. **A(a) hard-constrain** ships opt-in only, as the evaluation arm.
3. **Lever B deferred** to a follow-up that first enriches nodes with `mechanism_type` (file the dependency ticket; do not block A on it). Revisit B once node labels exist and the emitted enum's accuracy is validated.

Rationale: A is the lever the evidence identifies; B's originally-intended pre-filter is inert precisely because its node-side half was never built. Do A now; make B *possible* separately.

---

## 6. Validation plan (two-arm bar, per t/2306)

Reuse the **t/2294 `saf-167-repro` fixture** + the **t/2306 retrieval-layer harness** (deterministic ordering; sample breadth over replication).

- **Arm 1 — misfire reduction:** on case_1, A(b) must (a) read `retrieval_confidence(saf-167)` **low** (below the 0.45 bi-encoder gate — saf-167 absent from top-80), and (b) surface the youth family (`saf-171` ~1–2, `saf-104` ~2–4) in the per-key_point top-3. **Auto-correction NOT required** (contested family) — mitigation is the pass condition.
- **Arm 2 — clean-case regression (the veto arm):** on a representative set of **already-correct** assignments (extend t/2306's 10 safetyist key_points + a positive control set), A(b) must show **~zero** correct→wrong flips. A(a) hard-constrain must clear the *same* bar before it could ever go default-ON.
- **Negative controls:** the excludes-veto must not fire spuriously (case_1); case_2 remains the veto-positive check (separate lever, out of scope here).
- **NO-GO discipline:** if net improvement is absent or Arm 2 regresses, document a NO-GO exactly as t/2306 did — mechanism #5 stays field-only and B remains the only remaining path.

**Instrument note (t/2294 discipline):** the fixture's `correct_node` is a *contested family*, not one node; the harness scores "surfaced the family / flagged the wrong node," never "picked node X." Do not regress to single-node ground truth.

---

## 7. Ownership, provenance, open questions for TL

- **CL:** this design + the validation (harness + fixture + ruling).
- **PowerShell:** the pipeline seam — per-key_point re-retrieval call in `Invoke-DocumentSummary` after extraction; consumes t/2288 `retrieval_confidence`; the surface/override wiring. Route to PS **after** TL signs off this design.
- **Provenance:** any new threshold (divergence margin, decisive-auto-correct margin) is `stipulated` on landing → `metric-provenance-register.md` in the implementing PR; promote to `derived` only via the Arm-1/Arm-2 study.

**Open questions for TL:**
1. Approve **A(b) default / A(a) opt-in** split, or prefer A(a) hard-constrain evaluated first?
2. OK to **defer Lever B** and file a separate node-`mechanism_type`-enrichment dependency ticket (vs. scoping enrichment into this ticket)?
3. Per-key_point re-retrieval adds one embed + cosine pass **per key_point** (vs. one per chunk today). Acceptable cost, or should re-retrieval fire **only** on low-`retrieval_confidence` assignments (cheaper; A(b)-native)? — CL leans **conditional re-retrieval** (fire only when t/2288 flags), which also bounds the regression surface.

---

## 8. TL sign-off (t/2341#2, 2026-08-09) — APPROVED, with conditions

- **Q1 → A(b) is the ship target.** A(b) only *acts* on already-low-confidence + divergent picks, so it structurally cannot degrade a confident-correct assignment — the property A(a) lacks. **A(a) hard-constrain is eval-only/optional**, run *only if* A(b)'s misfire recall disappoints, and can never go default-ON without first clearing Arm 2. **Do not gate the A(b) ship on running A(a).**
- **Q2 → Defer Lever B, confirmed.** File a separate node-`mechanism_type`-enrichment follow-up that **first validates the emitted `mechanism_type` enum's accuracy** *before* committing to the ~889-node pass — an inaccurate pre-filter would exclude correct candidates (same regression failure mode). Filed as **t/2355**, linked to t/2341.
- **Q3 → flag-gate for v1, but MEASURE the ceiling it caps.** The binding constraint is *regression surface*, not cost (the per-key_point bi-encoder re-query is cheap; no LLM re-call if A(b) auto-corrects on bi-encoder margin). Vocabulary-collision misfires can be **high-confidence** (wrong node semantically close → LLM confidently wrong → t/2288 does *not* flag), so flag-gating silently caps the fix's ceiling. **Validation must quantify the high-confidence-misfire miss rate** on the representative set; if material, evaluate a **divergence-triggered** variant (always compute per-key_point top-1, act on divergence from the LLM pick) and report the number.
- **Guardrails reinforced:** two-arm bar stands — **A(b) must clear Arm 2 too** (the surface / auto-correct-on-margin path can still flip a correct pick if the margin logic misfires). Negative net → documented NO-GO, field stays as-is.
- **Implementation routing:** once validated, the `Invoke-DocumentSummary` / `Get-RelevantTaxonomyNodes` seam is PowerShell scope and a *novel pipeline change* → the PS ticket routes to **Main (TL)** for review (not self-cert); register/provenance in the same PR.

### Validation deliverables (this ticket, before PS implements)
1. **Arm 1 — misfire mitigation** on t/2294 case_1: `retrieval_confidence(saf-167)` low + youth family (`saf-171/104`) in per-key_point top-3. Mitigation (flag + surface) passes; auto-correction not required (contested family).
2. **Arm 2 — clean-case regression** on a correct-assignment control set (extend the t/2306 10 safetyist key_points): ~zero correct→wrong flips under A(b)'s surface/auto-correct-on-margin path.
3. **Q3 — high-confidence-misfire miss rate:** fraction of the misfire class where the assigned wrong node has *high* `retrieval_confidence` (t/2288 would not flag). Report the number; if material, add the divergence-triggered variant to the eval.
4. **Ruling:** GO (A(b) net-positive, Arm 2 clean) or NO-GO (documented, field-only), routed back to TL with the numbers.
