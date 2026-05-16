# Consensus Detection in Post-Debate Reflection

## Problem

When a debate produces consensus, each POV's reflection independently proposes taxonomy edits for the same convergence point. This creates 2-3 duplicate nodes (e.g., "Procedural Triggers for AI Misinformation Regulation" appears under acc-intentions, saf-intentions, AND skp-intentions). Situation nodes (sit-*/cc-*) are architecturally designed to hold multi-POV interpretations of shared concepts — consensus should route there.

## Where Consensus Detection Fits

The reflection system has two prompt paths:

1. **`reflectionPrompt`** — runs per POV after the debate, each debater proposes edits to their own taxonomy
2. **`taxonomyRefinementPrompt`** — runs once with the concluding summary, proposes edits across all referenced nodes

Consensus detection must happen **after** the per-POV reflections but **before** the user reviews edits. The system compares proposals across POVs and flags overlapping ADD proposals as consensus candidates.

## Detection Logic (Deterministic)

After all three reflections produce their `edits[]` arrays:

1. **Collect ADD proposals** — filter edits where `edit_type === 'add'` from all three POVs
2. **Pairwise similarity** — for each pair of ADD proposals across different POVs, compute embedding similarity between `proposed_description` texts
3. **Threshold** — pairs with similarity > 0.70 are consensus candidates
4. **Clustering** — group overlapping pairs into consensus clusters (2 or 3 POVs converging)

This is deterministic — no LLM call for the detection step itself.

## Situation Node Generation (LLM Call)

For each consensus cluster, a single LLM call generates the situation node:

### Prompt

```
You are a neutral taxonomy editor. Three debate perspectives have independently proposed
new taxonomy nodes that converge on the same concept. Your job is to create ONE situation
node that captures the shared concept with each perspective's interpretation.

=== CONVERGING PROPOSALS ===

Accelerationist proposes:
  Label: "[acc proposed label]"
  Description: "[acc proposed description]"
  Rationale: "[acc rationale]"

Safetyist proposes:
  Label: "[saf proposed label]"
  Description: "[saf proposed description]"
  Rationale: "[saf rationale]"

Skeptic proposes:
  Label: "[skp proposed label]"
  Description: "[skp proposed description]"
  Rationale: "[skp rationale]"

=== TASK ===

Create a situation node that:
1. Captures the SHARED concept all perspectives are converging on
2. Provides each perspective's interpretation as a sub-entry
3. Uses neutral, non-partisan language for the main description

Return ONLY JSON:
{
  "label": "Neutral label for the shared concept",
  "description": "A situation [that/where/in which] [neutral differentia]. Encompasses: [shared scope items]. Excludes: [boundaries].",
  "interpretations": {
    "accelerationist": "How the accelerationist frames this convergence point — what they emphasize, what conditions they attach.",
    "safetyist": "How the safetyist frames this convergence point.",
    "skeptic": "How the skeptic frames this convergence point."
  },
  "convergence_type": "full" | "partial" | "conditional",
  "convergence_source": {
    "debate_id": "[filled by caller]",
    "original_proposals": {
      "accelerationist": { "proposed_label": "...", "evidence_entries": ["S5", "S9"] },
      "safetyist": { "proposed_label": "...", "evidence_entries": ["S7", "S11"] },
      "skeptic": { "proposed_label": "...", "evidence_entries": ["S8", "S12"] }
    },
    "similarity_scores": { "acc-saf": 0.82, "acc-skp": 0.75, "saf-skp": 0.78 }
  }
}

convergence_type:
- "full": All perspectives endorse the same core concept with minor framing differences
- "partial": 2 of 3 perspectives converge; the third has a substantively different position
- "conditional": Perspectives agree on the concept but attach incompatible conditions
```

### Situation Node Template (DOLCE-Compliant)

```
Label: [Neutral concept name — no POV-specific framing]

Description:
  "A situation [that/where/in which] [neutral differentia describing the convergence].
  Encompasses: [shared scope items all POVs agree belong here].
  Excludes: [concepts that at least 2 POVs agree are outside this scope]."

Interpretations:
  accelerationist: "[How this POV frames the situation — what they emphasize]"
  safetyist: "[How this POV frames the situation]"
  skeptic: "[How this POV frames the situation]"
```

## CONVERGES_WITH Edge Type

### Semantics

`CONVERGES_WITH` is a directed edge from a POV node to a situation node, indicating that the POV's position aligns with or endorses the shared concept captured by the situation node.

```
Source: acc-intentions-XXX (POV node)
Target: sit-XXX (consensus situation node)
Type: CONVERGES_WITH
Weight: 0.8 (high — this was a debated and confirmed alignment)
Metadata:
  debate_id: "..."
  convergence_type: "full" | "partial" | "conditional"
  evidence_entries: ["S5", "S9"]
```

### When to Create

- When a per-POV REVISE edit brings a node closer to a consensus situation node's position
- When a per-POV node was argued during the debate in ways that aligned with the consensus

### When NOT to Create

- Between two POV nodes directly (POV-to-POV convergence is captured by the situation node's interpretations)
- When the alignment is superficial (same topic but different claims about it)

## Integration with Existing Edit Types

| Reflection proposes | Without consensus detection | With consensus detection |
|---|---|---|
| 3 POVs ADD overlapping nodes | 3 separate per-POV nodes created | 1 situation node + CONVERGES_WITH edges |
| 2 POVs ADD overlapping, 1 doesn't | 2 per-POV nodes created | 1 situation node (partial) + 2 CONVERGES_WITH edges; non-converging POV gets its own node if distinct |
| 1 POV REVISE toward consensus + 1 ADD | 1 revision + 1 new node | 1 situation node + CONVERGES_WITH from revised node |
| All ADD but dissimilar | 3 separate per-POV nodes | No change — each gets its own node (no consensus detected) |

## Implementation Notes

- The consensus detection runs in the **caller** (useDebateStore or debateEngine), not in the prompt itself — the reflection prompts don't change
- Embedding similarity uses the existing `computeQueryEmbedding` infrastructure
- The situation node LLM call uses a new `consensusSituationPrompt` function
- The user sees "These 3 proposals converge — create a situation node?" in the reflection review UI, with the option to accept (creates situation), reject (creates per-POV nodes as before), or edit

---

*Spec: 2026-05-16 · Computational Linguist · AI Triad Research*
