# FIRE: Confidence-Gated Iterative Claim Extraction

## Overview

FIRE (Fact-checking with Iterative Retrieval and Evaluation) replaces single-shot document summarization with a per-claim confidence-gated loop. Instead of trusting the AI's first pass as final, FIRE assesses extraction reliability for each factual claim and iteratively refines uncertain claims through targeted follow-up queries.

**Entry point:** `Invoke-POVSummary -DocId "doc-id" -IterativeExtraction`

**Core files:**
- Engine: `scripts/AITriad/Private/Invoke-IterativeExtraction.ps1`
- Invocation: `scripts/AITriad/Public/Invoke-POVSummary.ps1` (lines 62, 330-349)
- Prompts: `scripts/AITriad/Prompts/pov-summary-system.prompt`, `pov-summary-schema.prompt`
- UI: `taxonomy-editor/src/renderer/components/FireProgressIndicator.tsx`

## Three Phases

### Phase 1: Initial Extraction

A single AI API call generates the full summary — key points, factual claims (with `evidence_criteria`), and unmapped concepts. This is identical to the single-shot path. The AI is instructed to populate `evidence_criteria` on each factual claim:

- **Universal criteria:** `specificity` (vague/qualified/precise), `has_warrant` (boolean), `internally_consistent` (boolean)
- **BDI-specific criteria:** vary by claim category (Beliefs: `evidence_level`; Desires: `values_grounded`, `tradeoff_acknowledged`, `precedent_cited`; Intentions: `mechanism_specified`, `scope_bounded`, `failure_mode_addressed`)

### Phase 2: Confidence Assessment

Each claim's `evidence_criteria` feeds a heuristic that computes `fire_confidence`:

```
fire_confidence = 0.3                                    (base)
               + 0.2 if specificity = 'precise'
               + 0.2 if has_warrant = true
               + 0.1 if internally_consistent = true
```

Range: 0.3 (vague, unwarranted, inconsistent) to 0.8 (precise, warranted, consistent). The threshold for acceptance is **0.7** — claims at or above this score are accepted without iteration.

### Phase 3: Targeted Refinement

Claims below the confidence threshold enter a refinement loop. Each iteration sends a targeted prompt asking the AI to:

1. **Verify** the claim against the source document text
2. **Cite** supporting passages (verbatim quotes)
3. **Re-evaluate** `evidence_criteria` in light of the cited evidence
4. **Update** the claim text if refinement reveals a more precise formulation

The refinement prompt is narrowly scoped — it addresses one uncertain claim at a time, not the full document. This prevents attention dilution by focusing the AI on a single verification task.

If the AI returns `verified: false`, `fire_confidence` is set to 0.1 and iteration stops for that claim. This is a strong signal that the initial extraction hallucinated or misrepresented the source.

## What the Confidence Heuristic Measures

The heuristic captures **extraction surface quality** — observable textual properties that correlate with reliable extraction. It does not measure argument strength, truth, or importance.

| Criterion | What it detects | Linguistic basis |
|-----------|----------------|-----------------|
| `specificity = precise` | Claim names identifiable entities, quantities, or mechanisms | Precise claims are harder to hallucinate — fabricating "GPT-4 scores 90th percentile on the bar exam" requires specific knowledge, while "AI is getting better" can be generated from priors alone |
| `has_warrant = true` | Claim includes reasoning connecting evidence to conclusion | Warranted claims demonstrate the AI engaged with the document's argument structure, not just surface keywords. For Beliefs claims, a specific statistic IS a warrant — the number provides evidential grounds |
| `internally_consistent = true` | Claim doesn't contradict other extracted claims | Inconsistency signals the AI is pattern-matching fragments rather than comprehending the document's argument |

**What the heuristic does NOT capture:**

- **Factual accuracy** — a precise, warranted claim can still be wrong if the AI misreads the source
- **Completeness** — the heuristic scores individual claims, not whether all claims were found
- **Importance** — a trivially true claim ("the paper has 12 pages") scores high but adds no analytical value
- **BDI-specific quality** — the universal heuristic ignores the category-specific criteria (evidence_level, values_grounded, mechanism_specified). These are preserved in `evidence_criteria` for downstream use (QBAF scoring, harvest) but don't contribute to the iteration decision

The heuristic deliberately uses only the three universal criteria because they're reliable across all BDI layers. The Q-0 calibration (e/19) showed that BDI-specific criteria have different reliability profiles — Desires and Intentions are AI-scorable, Beliefs require human judgment. Using only universal criteria for the iteration gate avoids propagating category-specific unreliability into extraction decisions.

## fire_confidence vs base_strength

These are separate fields serving separate purposes:

| Field | Measures | Range | Source | When set |
|-------|----------|-------|--------|----------|
| `fire_confidence` | Extraction reliability — how trustworthy is this claim as an extraction? | 0.1-0.8 | FIRE heuristic from evidence_criteria | During summarization |
| `base_strength` | Argument quality — how strong is this claim as an argument? | 0.1-1.0 | QBAF rubric (AI for Desires/Intentions, human for Beliefs) | During debate / QBAF scoring |

A claim can have high `fire_confidence` (reliably extracted from the document) but low `base_strength` (a weak argument). Conversely, a claim can have low `fire_confidence` (uncertain extraction) but high `base_strength` if it turns out to be a strong argument once verified.

In TypeScript (`lib/debate/types.ts`), the debate context uses `extraction_confidence` (equivalent to `fire_confidence`) on `ArgumentNetworkNode`, separate from `base_strength` and `computed_strength`.

## Termination Guardrails

FIRE is an agent loop that makes multiple API calls. Without guardrails, it could run indefinitely on a dense document. Four hard limits prevent this:

| Guardrail | Default | Purpose |
|-----------|---------|---------|
| Max iterations per claim | 5 | Prevents infinite refinement of a single stubborn claim |
| Max iterations per document | 20 | Bounds total work for documents with many uncertain claims |
| Wall-clock timeout | 60s (1 min) | Hard time limit regardless of iteration state |
| API call budget | 25 per invocation | Cost ceiling — prevents runaway API charges |

When any guardrail triggers, FIRE stops and returns results so far. The `FireStats.termination_reason` field records which guardrail fired:

- `all_confident` — all claims passed the threshold (clean exit)
- `wall_clock_exceeded` — hit the 1-minute limit
- `max_doc_iterations` — hit 20 total iterations
- `api_budget_exceeded` — hit 25 API calls

## Output

FIRE enriches the standard summary output with:

1. **`fire_confidence`** on each factual claim (0.1-0.8)
2. **Refined `evidence_criteria`** — updated by refinement iterations
3. **Updated claim text** — if refinement revealed a more precise formulation
4. **`FireStats` block** — operational metadata:

```json
{
  "mode": "fire",
  "total_iterations": 7,
  "total_api_calls": 8,
  "claims_total": 15,
  "claims_confident": 11,
  "claims_iterated": 4,
  "elapsed_seconds": 42,
  "termination_reason": "all_confident",
  "guardrails": {
    "max_iter_per_claim": 5,
    "max_iter_per_doc": 20,
    "wall_clock_seconds": 60,
    "max_api_calls": 25
  }
}
```

## When to Use FIRE vs Single-Shot

| Scenario | Recommendation | Rationale |
|----------|---------------|-----------|
| Dense academic/policy documents | **FIRE** | High claim density, complex reasoning chains — single-shot extraction misses nuance and fabricates claims under exhaustiveness pressure |
| Short blog posts or opinion pieces | **Single-shot** | Few factual claims, low hallucination risk — FIRE overhead isn't justified |
| Batch re-summarization (TAXONOMY_VERSION bump) | **Single-shot** | Cost: FIRE uses 5-25x the API calls. Batch re-summarization across hundreds of documents would be prohibitively expensive |
| High-stakes documents (feeding into conflict detection) | **FIRE** | Extraction errors in factual claims propagate to conflicts and QBAF scoring — worth the extra API cost to verify |
| Initial triage / exploratory ingestion | **Single-shot** | Speed matters more than precision during discovery |

**Rule of thumb:** Use FIRE when extraction errors have downstream consequences (conflicts, QBAF, debate grounding). Use single-shot when speed or cost matters more than precision.

**Current gap:** `Invoke-BatchSummary` does not support `-IterativeExtraction`. Batch FIRE would require API call budgeting across documents (e.g., 25 calls/doc * 100 docs = 2,500 calls). This is a known gap, not a design omission — batch FIRE requires a cost model before enabling.

## Tradeoffs and Risks

### Advantages Over Single-Shot

1. **Reduces hallucination** — The refinement loop catches fabricated claims (verified=false → confidence 0.1). Single-shot has no verification step; the AI's first answer is the final answer.
2. **Improves precision** — Claims refined through iteration have tighter specificity, better warrant grounding, and more accurate verbatim quotes.
3. **Self-documenting quality** — `fire_confidence` and `evidence_criteria` make extraction quality visible and auditable. Single-shot outputs are opaque — you can't tell which claims the AI was confident about and which it guessed.
4. **Graceful degradation** — If the model is uncertain about a claim, FIRE says so (low confidence) rather than presenting it with false confidence. Downstream consumers can filter by confidence threshold.

### Risks

**Anchoring bias.** The refinement loop starts from the AI's initial extraction. If the initial claim is wrong, the refinement prompt asks the AI to verify *its own prior output*. LLMs exhibit confirmation bias — they tend to find evidence for claims they've already committed to. The mitigation is the `verified: false` escape hatch, but this requires the AI to actively contradict itself, which is psychologically harder than confirming.

*Severity: Medium.* The targeted refinement prompt asks for verbatim source quotes, which grounds verification in text rather than the AI's beliefs. But a sufficiently confident initial hallucination may survive refinement.

**Over-refinement.** Each iteration can update claim text. Over multiple iterations, a claim may drift from what the document actually says toward what the AI thinks the document *should* say. The claim becomes more precise and better-warranted but less faithful to the source.

*Severity: Low.* The per-claim iteration limit (5) bounds drift. The verbatim quote requirement in `evidence_criteria` provides a textual anchor. But this risk increases with iteration count — claims that needed 4-5 iterations should be reviewed with more skepticism than claims that converged in 1-2.

**Cost multiplication.** Single-shot uses 1 API call per document. FIRE uses 1 + N (where N = number of uncertain claims that get refined). For a 10-claim document with 4 uncertain claims needing 2 iterations each, that's 9 API calls — 9x the cost. The guardrails cap this at 25 calls, but cost-per-document is still significantly higher.

*Severity: Low (for interactive use).* The `-IterativeExtraction` switch is opt-in. Batch summarization uses single-shot by default. The cost is justified for high-stakes documents where extraction quality matters.

**Convergence stalling.** Some claims are genuinely ambiguous — the document itself is vague, or the claim sits at a boundary between two taxonomy nodes. FIRE may iterate to the per-claim limit without reaching the confidence threshold, consuming API budget without improving quality.

*Severity: Low.* The guardrails ensure stalling is bounded. Claims that exhaust their iteration budget retain whatever confidence they reached, and `termination_reason` signals when budget limits were hit rather than convergence achieved.

## Confidence Threshold Calibration

The default threshold of 0.7 means a claim needs at least `precise` specificity + `has_warrant` + some base confidence to pass without iteration. This was set to match the point where extraction reliability is "good enough" for downstream use (conflict detection, debate grounding).

The threshold is configurable via `-ConfidenceThreshold` on `Invoke-IterativeExtraction`. Lowering it (e.g., 0.5) reduces API calls but accepts more uncertain claims. Raising it (e.g., 0.9) is impractical — the heuristic maxes at 0.8, so no claim would ever pass without iteration.

If future calibration work (analogous to Q-0 for QBAF) reveals that the heuristic doesn't correlate with actual extraction quality, the threshold and/or the heuristic weights should be re-evaluated. The heuristic was designed to be simple and transparent, not empirically optimal — it's a first-pass gate, not a precision instrument.

## Relationship to Other Systems

| System | Relationship to FIRE |
|--------|---------------------|
| **QBAF** | `fire_confidence` (extraction reliability) is distinct from `base_strength` (argument quality). Both may exist on the same claim. QBAF consumes `base_strength`; it does not read `fire_confidence`. |
| **Conflict detection** | `Find-Conflict.ps1` processes claims regardless of extraction method. `fire_confidence` is passed through to conflict entries when present — a low-confidence claim that generates a conflict is flagged for human review. |
| **Debate grounding** | When debates reference a source document, claims extracted via FIRE carry `extraction_confidence` in the argument network. The moderator and synthesis can use this to weight document-grounded claims. |
| **Concession harvesting** | Independent system. FIRE operates during extraction; concession harvesting operates during debate synthesis. No direct interaction. |
| **Taxonomy health** | `Get-TaxonomyHealth` could use `fire_confidence` to weight claim coverage — high-confidence claims are stronger evidence of taxonomy coverage than low-confidence ones. Not yet implemented. |
