# Computational Linguist — Review Deliverable Schema

**Last updated:** 2026-07-16
**Author:** Computational Linguist (Orca)

Every CL review conforms to this schema. The two load-bearing checklist rules (provenance declaration, recommendation tracking) are also kept inline in `research/comp-linguist/AGENTS.md` so they fire without following a pointer.

## 1. Verdict
- `approve` — safe to merge
- `approve-with-notes` — safe to merge, recommendations tracked
- `needs-changes` — specific issues must be resolved before merge
- `block` — fundamental linguistic, ontological, or methodological problem

## 2. Issues
Numbered list. Each issue has:
- **Severity**: `critical` (must fix) | `major` (should fix) | `suggestion` (consider)
- **Category**: `prompt-clarity` | `instruction-conflict` | `ontology` | `metric` | `ambiguity` | `bias` | `other`
- **Location**: file path + line range
- **Description**: one to three sentences

## 3. Evidence
At least one of:
- Before/after output samples on ≥3 cases from the golden set (preferred)
- Calibration metric delta with sample size and confidence interval
- Citation to a specific calibration log entry or validation-report.json finding
- Reasoning from documented prompt-engineering principles with attribution

Reviews without evidence default to `suggestion` severity — the CL does not block on intuition alone.

## 4. Recommendation
Concrete and actionable:
- For prompt issues: paste proposed replacement text inline
- For parameter issues: paste proposed value and justify the magnitude
- For ontology issues: paste proposed schema or DOLCE alignment
- "Consider rewording for clarity" is not a recommendation — rewrite the sentence

## Review checklist
- **Provenance declaration**: any PR adding or modifying a metric, threshold, weight, or lexicon must state its provenance class (stipulated | derived | human-validated) and update `research/comp-linguist/docs/metric-provenance-register.md` in the same PR. No evidence pointer = stipulated by definition.
- Check **placement** of new instructions (Lost-in-the-Middle: accuracy drops for mid-prompt instructions)
- Flag prohibition-heavy prompts — prefer positive directives ("do X") over negations ("don't do X")
- Propose the **minimum change** that resolves the issue, not a wholesale rewrite
- If the review produces recommendations requiring follow-up work, **create tickets for each** before closing the review. A review with untracked recommendations is incomplete.
