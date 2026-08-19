# Post-Debate Reflections: Theory of Operations

After synthesis completes, each debating camp reviews the full debate and proposes edits to its own taxonomy. This is the reflection phase. The goal is to keep the taxonomy honest: nodes that failed under scrutiny get revised or deprecated; arguments that surfaced during debate but lack backing get added.

## Ordering and why it matters

Reflections run in the order camps appear in `active_povers`. For a standard three-way debate that order is Accelerationist, then Safetyist, then Skeptic. The `active_povers` list in the session is the sole authority on order; a two-camp session follows the same rule with whichever camps are active.

Order matters because of cross-camp visibility (see below). Accelerationist runs first and sees nothing from peers. Safetyist runs second and sees what Accelerationist proposed. Skeptic runs last and sees proposals from both prior camps. This asymmetry is intentional: it prevents three camps from independently arriving at the same node and flooding the taxonomy with duplicates.

## Cross-camp visibility

Before each camp generates its reflection, the engine builds a `priorReflections` block from every reflection completed so far. That block lists each prior camp's proposed label, edit type, and category, giving the current camp enough context to recognize conceptual overlap.

The prompt instructs the current camp not to propose a node that an earlier camp already covers, even if the wording would differ. The rule is one node per concept, owned by whichever camp has the strongest claim to it. If Safetyist already proposed "Epistemic Asymmetry Under Opacity," Skeptic should not duplicate it. Skeptic moves on and focuses on nodes unique to its perspective, or on revising its existing nodes.

## Proposal generation

Each camp receives the full debate transcript, its own taxonomy nodes (with current confidence/priority ratings), the argument network, its commitment store, and the convergence signals. It returns up to five proposals with debate-grounded rationale.

There are two dispositions:

**edit_existing** modifies an existing node. Three edit types apply:

- **Revise** rewrites a node's label or description to reflect what the debate revealed. Use when the current wording was imprecise or misleading.
- **Qualify** adds nuance or caveats to an existing node based on valid counterarguments. The node's core claim survives, but the debate revealed a limiting condition.
- **Deprecate** marks a node as weak or unsupported. Use when opponents effectively refuted it and the camp conceded or had no counter.

**propose_new** creates a new node and wires it into the existing taxonomy. Every propose_new must include at least one edge to an existing node. Valid edge types are SUPPORTS, CONTRADICTS, ASSUMES, WEAKENS, RESPONDS_TO, TENSION_WITH, INTERPRETS, and CONVERGES_WITH. A proposal with no valid edge is dropped because an unconnected node cannot be meaningfully used.

Each proposal carries a confidence rating (high / medium / low) and a list of evidence entries.

## Evidence references

Evidence entries are turn IDs from the debate transcript. For example, `["S13", "S15"]` means turns S13 and S15 support the proposed change. Each entry points to the specific moment in the debate that justifies the edit. Proposals must be grounded in the transcript; general-knowledge reasoning that does not tie back to a specific exchange is not valid grounds for a reflection edit.

## DOLCE compliance

All proposed descriptions, for both edit_existing and propose_new, must follow the DOLCE genus-differentia format:

```
Line 1: "A [Belief|Desire|Intention] within [pov] discourse that [ONE distinguishing concept]."
Line 2: "Encompasses: [3-5 sub-themes as comma-separated list]."
Line 3: "Excludes: [2-3 neighboring concepts named neutrally]."
```

The differentia states *what* the position is, not why it is correct. Causal connectors (`rendering`, `thereby`, `thus`, `therefore`, `contingent on`) are not allowed in line 1. Each description carries exactly one concept in the differentia. Packing mechanism, target, and caveats into one clause is a compliance failure.

After the model returns its proposals, the engine checks each proposed description against these rules. If any description fails, the engine sends a targeted retry prompt with the specific violations listed. It retries up to three times per edit. A description that still fails after three attempts is surfaced to the human as-is.

## Approval flow

The Reflections panel presents each camp's proposals grouped by camp. Each item is pending until the user acts on it.

**Per-item actions:**

- **Approve & Apply** saves the change to the taxonomy immediately. For edit_existing, the existing node's label and/or description is updated in place. For propose_new, the new node is created and all its proposed edges are persisted atomically, so no orphaned node is left without connections.
- **Dismiss** discards the proposal and leaves the node unchanged.

Applying an edit optionally triggers phrase regeneration for the modified node (the user can opt in via the editing surface before clicking Approve & Apply).

Edge targets for propose_new proposals are re-validated against live node IDs at apply time. If a target no longer exists, those edges are silently dropped and only the remaining valid edges are persisted.

**Bulk actions (shown when pending items exist):**

- **Approve All (N)** applies every pending edit and proposal across all camps in sequence. N is the count of pending items.
- **Dismiss All** dismisses every pending item across all camps.

After all items are resolved, the total applied count is shown in the panel header.
