// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Builds prompts for extracting graph_attributes for a single new taxonomy node.
 */

export function buildAttributeExtractionSystemPrompt(): string {
  return `You are a research analyst for the AI Triad project at the Berkman Klein Center.

Your task is to generate rich analytical attributes for a taxonomy node from the AI policy
debate. These attributes power a graph-based reasoning system that enables assumption
surfacing, argument mapping, and epistemic analysis.

You will receive a single node with its ID, label, description, category, and POV.
Generate a graph_attributes object with the following fields:

ATTRIBUTE VOCABULARY:

  epistemic_type (required, string -- pick ONE):
    "normative_prescription" -- a value judgment or should-statement
    "empirical_claim" -- a factual assertion about the world
    "definitional" -- defines or frames a concept
    "strategic_recommendation" -- proposes a method or course of action
    "predictive" -- forecasts a future state or trend
    "interpretive_lens" -- a framework for understanding other claims

  rhetorical_strategy (required, string -- pick ONE or TWO, comma-separated):
    "precautionary_framing", "inevitability_framing", "cost_benefit_analysis",
    "moral_imperative", "appeal_to_evidence", "appeal_to_authority",
    "analogical_reasoning", "reductio_ad_absurdum", "techno_optimism",
    "structural_critique"

  assumes (required, array of 1-4 strings):
    Key premises that must be true for this node to hold. Be specific and concrete.

  falsifiability (required, string -- pick ONE):
    "high" -- could be clearly disproven by specific evidence or events.
    "medium" -- partially testable but involves value judgments or long time horizons.
    "low" -- primarily a value claim, definitional, or unfalsifiable by nature.
    Category guidance: Beliefs -> usually "high"/"medium", Desires -> usually "low",
    Intentions -> usually "medium". Override when content doesn't match.

  audience (required, string -- pick ONE or TWO, comma-separated):
    "policymakers", "technical_researchers", "industry_leaders",
    "general_public", "civil_society", "academic_community"

  emotional_register (required, string -- pick ONE):
    "urgent", "measured", "optimistic", "cautionary", "defiant",
    "pragmatic", "alarmed", "dismissive", "aspirational"

  policy_actions (required, array of 0-3 objects):
    Each: { "policy_id": null, "action": "5-15 word action", "framing": "1-2 sentences" }
    Empty array is acceptable for purely theoretical nodes.

  intellectual_lineage (required, array of 1-3 strings):
    Major traditions, thinkers, or frameworks this node draws from.

  steelman_vulnerability (required, string):
    The strongest counterargument against the STRONGEST version of this claim. 1-2 sentences.

  possible_fallacies (required, array of 0-3 objects):
    Each: { "fallacy": "key", "type": "formal|informal_structural|informal_contextual|cognitive_bias",
    "confidence": "likely|possible|borderline", "explanation": "1-3 sentences" }
    Empty array is acceptable for well-reasoned nodes. Do not force findings.

  node_scope (required, string -- pick ONE):
    "claim" -- a specific, testable assertion. Most Beliefs nodes.
    "scheme" -- an argumentative strategy or reasoning pattern. Most Intentions nodes.
    "bridging" -- connects claims to schemes or values. Use sparingly.

CROSS-CUTTING NODES:
For cross-cutting nodes (id starts with "cc-"), consider the three POV interpretations
when generating attributes. The epistemic_type and rhetorical_strategy should reflect the
cross-cutting concept itself, not any single POV's interpretation.

RULES:
  - Be precise and analytical. These attributes power automated reasoning.
  - Tailor attributes to the SPECIFIC content of the node's description.
  - Return ONLY a valid JSON object. No markdown fences, no preamble.`;
}

export function buildAttributeExtractionUserPrompt(
  node: {
    id: string; label: string; description: string;
    pov: string; category?: string;
    interpretations?: { accelerationist: string; safetyist: string; skeptic: string };
  },
): string {
  let nodeBlock = `NODE TO ANALYZE:
  ID: ${node.id}
  POV: ${node.pov}
  Category: ${node.category || 'N/A'}
  Label: ${node.label}
  Description: ${node.description}`;

  if (node.interpretations) {
    nodeBlock += `
  Accelerationist Interpretation: ${node.interpretations.accelerationist}
  Safetyist Interpretation: ${node.interpretations.safetyist}
  Skeptic Interpretation: ${node.interpretations.skeptic}`;
  }

  return `${nodeBlock}

OUTPUT SCHEMA:
{
  "${node.id}": {
    "epistemic_type": "...",
    "rhetorical_strategy": "...",
    "assumes": ["..."],
    "falsifiability": "high|medium|low",
    "audience": "...",
    "emotional_register": "...",
    "policy_actions": [],
    "intellectual_lineage": ["..."],
    "steelman_vulnerability": "...",
    "possible_fallacies": [],
    "node_scope": "claim|scheme|bridging"
  }
}

CONSTRAINTS:
  - The top-level key MUST be exactly "${node.id}".
  - All eleven attribute fields are REQUIRED.
  - Return ONLY the JSON object.`;
}
