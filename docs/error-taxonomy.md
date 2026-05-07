# Error Taxonomy — Failure Mode Classification

Categorizes known system failures by root cause following the methodology of Hude (2025), who demonstrates that failures in neurosymbolic systems trace to specific architectural decisions rather than stochastic model behavior. This classification determines the appropriate fix path.

## Categories

| Category | Definition | Fix Path | Example |
|----------|-----------|----------|---------|
| **Architectural** | Inherent to the decomposition — the task requires capabilities the assigned component lacks | Redesign the decomposition boundary | Belief scoring requires external evidence the LLM cannot access |
| **Prompt-level** | The LLM has the capability but instructions are inadequate | Improve prompts | BDI misclassification from ambiguous disambiguation test |
| **Parameter-level** | The algorithm is correct but thresholds/weights are miscalibrated | Calibration tuning | Convergence threshold too low → premature synthesis |
| **Stochastic** | Random model variation — inconsistent across runs with identical input | Increase sampling or accept variance | Occasional edge type confusion on borderline cases |

## Known Failure Modes

### Architectural Failures

| Failure | Description | Consistent? | Status |
|---------|-------------|-------------|--------|
| **Belief scoring low correlation** | Empirical claims require external verification (source checking, fact databases) that the LLM lacks. Calibration shows r=-0.12 to 0.20 for Beliefs vs r=0.65/0.71 for Desires/Intentions. | Yes — consistent across all models and prompt variants | Addressed by evidence QBAF pipeline (ArgRAG review, D1) |
| **Single-pass extraction misses** | One LLM call cannot reliably extract all claims from long documents. Attention tunnel effect fixates on salient themes, missing secondary arguments. | Yes — same claims missed across runs | Addressed by FIRE iterative refinement |
| **Sycophancy drift** | LLM agents accommodate opponents without principled concession when no structural identity grounding prevents it. | Yes — consistent drift pattern | Addressed by per-claim drift detection (t/276) + doctrinal boundaries (HDE review, D1) |
| **Compression-window blindness** | Claims from early debate rounds are forgotten as context is compressed. | Yes — same claims forgotten at same round | Addressed by unanswered claims ledger |
| **Coverage tracker Jaccard limits** | Word-overlap comparison misses semantic equivalence when vocabulary differs. | Yes — consistent misses on paraphrased claims | Partially addressed by BDI prefix (t/349) + domain vocabulary (t/350) |

### Prompt-Level Failures

| Failure | Description | Consistent? | Status |
|---------|-------------|-------------|--------|
| **BDI misclassification** | Disambiguation test ("could this be proven?") sometimes yields different categories for the same claim. | Partial — ~70% consistent, 30% variable | Refinement ongoing via rubric updates |
| **Edge type confusion** | LLM occasionally classifies SUPPORTS as WEAKENS or vice versa on borderline cases. | Partial — consistent on some pairs, variable on others | Addressed by domain vocabulary (t/350) reducing terminology ambiguity |
| **Move type hallucination** | LLM generates dialectical move names not in the canonical set. | Yes (pre-fix) → No (post-fix) | Fixed by semantic move normalization (alias resolution + strict validation) |
| **Genus-differentia non-compliance** | LLM-generated descriptions don't follow the required 3-line format. | Partial — depends on model and prompt context | Ongoing — enforcement in all prompt templates |

### Parameter-Level Failures

| Failure | Description | Consistent? | Status |
|---------|-------------|-------------|--------|
| **Premature phase transition** | Saturation score exceeds threshold before genuine exhaustion occurs. | No — varies by topic and debate dynamics | Addressed by adaptive threshold (t/273) + confidence floor escalation (t/271) |
| **Over-aggressive GC pruning** | Argument network pruned below useful density when thresholds are too tight. | No — depends on debate length and claim density | Configurable via provisional-weights.json |
| **Relevance threshold miscalibration** | Too many or too few taxonomy nodes injected per turn. | No — varies by topic match to taxonomy | Self-tuning via adaptive relevance threshold (t/273) |
| **QBAF oscillation on cycles** | DF-QuAD fails to converge on triangular attack patterns. | Yes (pre-fix, specific topologies) → No (post-fix) | Fixed by Jacobi iteration + adaptive damping (t/270) |

### Stochastic Failures

| Failure | Description | Consistent? | Status |
|---------|-------------|-------------|--------|
| **Argumentation scheme variation** | Same claim classified as ARGUMENT_FROM_EVIDENCE in one run and ARGUMENT_FROM_CONSEQUENCES in another. | No — run-to-run variance | Accept — categorical schemes have inherent boundary ambiguity |
| **Concession detection sensitivity** | Subtle concessive language ("I take your point") sometimes detected, sometimes missed. | No — depends on surrounding context | Accept — pragmatic signal negation handling (t/275) reduces but doesn't eliminate |
| **Claim count variation** | Same turn produces 3-6 claims depending on run, with some claims split differently. | No — inherent LLM generation variance | Accept — downstream QBAF handles variable network sizes |

## Consistency Analysis Protocol

To classify a new failure mode, following Hude (2025):

1. Run the same input through the failing pipeline 5 times
2. Count how many runs produce the same error
3. Classify:
   - 5/5 consistent → **Architectural** (the decomposition can't handle this)
   - 3-4/5 consistent → **Prompt-level** (the LLM can do it but isn't being instructed well)
   - 1-2/5 consistent → **Stochastic** (random variation)
4. For parameter-level: vary the threshold ±20% and check if the failure appears/disappears. If threshold-dependent, it's parameter-level.

## Implications for Evaluation

When reporting system accuracy in papers:
- **Architectural failures** are limitations to acknowledge honestly — they bound what the system can achieve without redesign
- **Prompt-level failures** represent optimization opportunities — they show the system's ceiling is higher than current performance
- **Parameter-level failures** are calibration work — they improve with more debate data
- **Stochastic failures** set the noise floor — they define the system's irreducible variance

This taxonomy ensures that evaluation discussions distinguish between "the system can't do this" (architectural), "the system could do this better" (prompt/parameter), and "this is inherent model variance" (stochastic).

---

*Created: 2026-05-06 · Computational Linguist · AI Triad Research*
*Methodology: Hude, Z. (2025). Where has legal knowledge gone: Constraining LLMs with knowledge graphs for interpretable reasoning.*
