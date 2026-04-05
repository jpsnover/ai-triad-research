// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * AI prompts for research prompt generation (copied to clipboard for use in external AI tools).
 * Prompts are separated from logic per project convention.
 */

export function researchPrompt(label: string, description: string): string {
  const position = `${label}\n${description}`;

  return `Role: Strategic Auditor and High-Impact Researcher.
Objective: Conduct a rigorous, bi-lateral investigation into the following position:
${position}

Constraint - Impact & Recency:
Recency: Prioritize sources published within the last 18\u201324 months to capture the post-Generative AI shift.
Impact: Prioritize "Widely Cited" sources. Use citation counts (h-index of authors) or institutional weight (e.g., IMF, World Bank, top-tier university labs) as a proxy for authority.

Part 1: The Thesis (Supporting Evidence)
Identify 3-5 authoritative, high-citation sources that provide the modern empirical foundation for this position.
Detail the specific mechanisms (economic, technical, or social) they propose.

Part 2: The Antithesis (Structural Opposition)
Identify 3-5 "Steel Man" critiques from the most recent literature. Look for "Disruptive Analysis" that accounts for 2024-2026 technological benchmarks.
Expose the "Friction Point": What specific variable in the original position do these recent critiques claim has become obsolete?

Part 3: Synthesis & Velocity
The Delta: Identify how the consensus on this position has changed in the last 12 months.
The Trade-Off: Define the primary risk a practitioner must accept today if they adopt the original position.

Output Format: For each source: Title & Link, Publication Date, Citation/Impact Context, and a Summary of the Core Argument.`;
}

export function conflictResearchPrompt(
  claimLabel: string,
  description: string,
  stances: string,
): string {
  return `Role: Strategic Auditor and Conflict Resolution Researcher.
Objective: Investigate the following factual conflict identified in AI policy/safety research:

Claim: ${claimLabel}
Description: ${description}

Documented stances:
${stances}

Constraint - Impact & Recency:
Recency: Prioritize sources published within the last 18\u201324 months to capture the post-Generative AI shift.
Impact: Prioritize "Widely Cited" sources. Use citation counts (h-index of authors) or institutional weight as a proxy for authority.

Part 1: Evidence Audit
For each stance above, find 2-3 authoritative sources that support or refute the specific assertion.
Assess the empirical quality: is this claim based on peer-reviewed data, modeling, expert opinion, or anecdote?

Part 2: Root Cause Analysis (BDI Layer)
Identify WHY the sources disagree, and classify the disagreement:
  - **Belief-level (empirical):** Different data, methods, or interpretations of evidence → potentially resolvable with better evidence
  - **Desire-level (normative):** Different values, priorities, or risk tolerances → negotiable via tradeoffs, not resolvable by evidence alone
  - **Intention-level (definitional):** Different definitions, scope, or framing of the concept → requires term clarification
Common specific causes:
  - Different definitions or scope (e.g., "AI" means different things)
  - Different time horizons or geographic contexts
  - Conflicting empirical data or methodological approaches
  - Values-driven framing differences vs. genuine factual disagreement

Part 3: Resolution Assessment
Can this conflict be resolved with current evidence? Rate as:
  - RESOLVABLE: One side has clearly stronger empirical support
  - CONDITIONAL: Both sides are correct under different assumptions/contexts
  - OPEN: Genuinely unresolved — insufficient evidence or fundamentally different values

Provide a 2-3 sentence synthesis of the current scholarly consensus (if any).

Output Format: For each source: Title & Link, Publication Date, Citation/Impact Context, and a Summary of the Core Argument.`;
}
