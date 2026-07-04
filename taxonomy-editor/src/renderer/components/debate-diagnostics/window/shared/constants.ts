// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/** Tooltip text for intervention suppression reason codes. */
export const SUPPRESSION_REASON_TOOLTIPS: Record<string, string> = {
  budget_exhausted: 'The intervention budget for this debate has been fully consumed. No more interventions can fire.',
  cooldown_active: 'A recent intervention is still in its cooldown window. The engine enforces a gap between interventions to avoid overwhelming debaters.',
  phase_mismatch: 'This intervention type is not appropriate for the current debate phase (e.g., CHALLENGE blocked in early confrontation, COMMIT blocked outside concluding phase).',
  same_debater_consecutive: 'The same debater was targeted by the previous intervention. The engine alternates targets to prevent repeatedly pressuring one debater.',
  prerequisite_override: 'A prerequisite condition for this intervention type was not met (e.g., a required prior move was not observed).',
  burden_cap: 'This debater\'s cumulative intervention burden exceeds 1.5× the average. High-burden moves are blocked to prevent disproportionate targeting.',
  engine_override: 'The engine overrode the moderator\'s recommendation. This can happen when the moderator chose not to intervene, suggested an unknown move, or other engine-level validation failed.',
};

/** Tooltip text for AIF node type badges. */
export const AIF_TOOLTIPS: Record<string, string> = {
  'I-node': 'I-node (Information node) — a claim, proposition, or data point. These are the passive content of arguments: what is being asserted.',
  'CA-node': 'CA-node (Conflict Application) — an attack relationship. Three types: rebut (contradicts conclusion), undercut (denies the inference), undermine (attacks premise credibility).',
  'RA-node': 'RA-node (Rule Application) — an inference scheme explaining WHY one claim supports another. The warrant is the reasoning pattern connecting evidence to conclusion.',
  'PA-node': 'PA-node (Preference Application) — resolves conflicts by determining which argument prevails and why, based on criteria like evidence strength or logical validity.',
};

import { POV_META, povKeyFromNodeId, type PovMetaKey } from '@lib/electron-shared/povMeta';

/** POV node ID prefix → CSS color variable mapping (derived from POV_META). */
export const POV_NODE_COLOR: Record<string, string> = Object.fromEntries(
  Object.values(POV_META).map(m => [m.prefix, `var(${m.cssVar})`]),
);

/** Returns CSS color for a node ID via POV_META lookup. */
export function nodeIdColor(id: string): string {
  const key = povKeyFromNodeId(id);
  return key ? `var(${POV_META[key].cssVar})` : 'var(--text-muted)';
}

/** Debater name → CSS color variable. */
export const DEBATER_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(POV_META).filter(([k]) => k !== 'situations').map(([k, v]) => [k, `var(${v.cssVar})`]),
);

export function debaterColor(name: string): string {
  return DEBATER_COLORS[name.toLowerCase()] ?? '#888';
}

export function truncateLabel(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** Short tooltip text for BDI sub-score keys. */
export const SUB_SCORE_TIPS: Record<string, string> = {
  evidence_quality: 'How well-supported is this claim by cited evidence?',
  source_reliability: 'How credible and authoritative are the sources cited?',
  falsifiability: 'Can this claim be tested or disproven with observable evidence?',
  values_grounding: 'Is this value claim explicitly grounded in stated values or principles?',
  tradeoff_acknowledgment: 'Does the claim acknowledge competing tradeoffs or costs?',
  precedent_citation: 'Does the claim cite relevant precedent, norms, or established practice?',
  mechanism_specificity: 'How specific is the proposed mechanism, action, or implementation path?',
  scope_bounding: 'Are the boundaries, limitations, and applicability conditions defined?',
  failure_mode_addressing: 'Does it address what could go wrong or how failures would be handled?',
};

/** Belief-category sub-score keys — these are human-editable via slider. */
export const BELIEF_KEYS = new Set(['evidence_quality', 'source_reliability', 'falsifiability']);

/**
 * Stage A dimension weights — must match turnValidator.ts scoring.
 * schema=0.4, grounding=0.3, advancement=0.2, clarifies=0.1
 */
export const DIMENSION_WEIGHTS: Record<string, { weight: number; description: string }> = {
  schema:      { weight: 0.4, description: 'Structural validity — JSON schema compliance, required fields, format constraints' },
  grounding:   { weight: 0.3, description: 'Evidence grounding — claims reference taxonomy nodes, sources, or prior turns' },
  advancement: { weight: 0.2, description: 'Dialectical advancement — turn moves the debate forward, introduces new reasoning' },
  clarifies:   { weight: 0.1, description: 'Taxonomy clarification — turn suggests refinements to taxonomy nodes or structure' },
};
