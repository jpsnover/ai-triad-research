// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ADR-007 file-size split of turnValidator.ts (t/1686).
// Canonical move catalog, alias/fuzzy resolution, and relevance-filler
// detection. MOVE_CATALOG_RAW / MOVE_CATALOG / DISAGREEMENT_TYPES are exported
// for use by the sibling modules (core, repair, stageValidation) but are NOT
// re-exported by the turnValidator barrel — the public surface stays limited to
// resolveMoveName and isFillerRelevance.

// ── Canonical move catalog — 10 well-differentiated dialectical moves ──
export const MOVE_CATALOG_RAW = [
  'DISTINGUISH',
  'COUNTEREXAMPLE',
  'CONCEDE-AND-PIVOT',
  'REFRAME',
  'EMPIRICAL CHALLENGE',
  'EXTEND',
  'UNDERCUT',
  'SPECIFY',
  'INTEGRATE',
  'BURDEN-SHIFT',
];

function normalizeMoveName(name: string): string {
  return name.toUpperCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Alias map: near-synonyms and hallucinated names → one of the 10 canonical moves.
// For multi-word aliases, both word orders are registered automatically below.
const MOVE_ALIAS_ENTRIES: [string, string][] = [
  // → DISTINGUISH
  ['MECHANISM DISTINGUISH', 'DISTINGUISH'],
  ['DIFFERENTIATE', 'DISTINGUISH'],
  ['SCOPE LIMIT', 'DISTINGUISH'],
  // → COUNTEREXAMPLE
  ['COUNTER EXAMPLE', 'COUNTEREXAMPLE'],
  ['EXPOSE CONTRADICTION', 'COUNTEREXAMPLE'],
  ['CHALLENGE ANALOGY', 'COUNTEREXAMPLE'],
  ['ANALOGY ATTACK', 'COUNTEREXAMPLE'],
  ['REDUCTIO', 'COUNTEREXAMPLE'],
  ['COUNTERPOINT', 'COUNTEREXAMPLE'],
  // → CONCEDE-AND-PIVOT
  ['CONCEDE AND PIVOT', 'CONCEDE AND PIVOT'],
  ['CONCEDE', 'CONCEDE AND PIVOT'],
  ['CONDITIONAL CONCESSION', 'CONCEDE AND PIVOT'],
  ['PIVOT', 'CONCEDE AND PIVOT'],
  ['ACKNOWLEDGE PROGRESS', 'CONCEDE AND PIVOT'],
  ['ACKNOWLEDGE AND PIVOT', 'CONCEDE AND PIVOT'],
  ['ACKNOWLEDGE-AND-PIVOT', 'CONCEDE AND PIVOT'],
  ['PARTIAL CONCESSION', 'CONCEDE AND PIVOT'],
  ['RETRACT', 'CONCEDE AND PIVOT'],
  // → REFRAME
  ['EXPOSE ASSUMPTION', 'REFRAME'],
  ['SURFACE ASSUMPTION', 'REFRAME'],
  ['STATE ASSUMPTIONS', 'REFRAME'],
  ['ASSUMPTION AUDIT', 'REFRAME'],
  ['CHALLENGE ASSUMPTION', 'REFRAME'],
  ['MODIFY FRAMEWORK', 'REFRAME'],
  ['PROPOSE FRAMEWORK', 'REFRAME'],
  ['INVERT CAUSATION', 'REFRAME'],
  ['ESCALATE', 'REFRAME'],
  ['SHIFT FRAME', 'REFRAME'],
  // → EMPIRICAL CHALLENGE
  ['GROUND CHECK', 'EMPIRICAL CHALLENGE'],
  ['FACT CHECK', 'EMPIRICAL CHALLENGE'],
  ['CITE EVIDENCE', 'EMPIRICAL CHALLENGE'],
  ['APPEAL TO EVIDENCE', 'EMPIRICAL CHALLENGE'],
  ['EVIDENCE', 'EMPIRICAL CHALLENGE'],
  ['CHALLENGE EVIDENCE', 'EMPIRICAL CHALLENGE'],
  ['NORMATIVE JUSTIFICATION', 'EMPIRICAL CHALLENGE'],
  ['CHALLENGE', 'EMPIRICAL CHALLENGE'],
  ['CITE AUTHORITY', 'EMPIRICAL CHALLENGE'],
  ['PRECEDENT', 'EMPIRICAL CHALLENGE'],
  // → EXTEND
  ['STEEL BUILD', 'EXTEND'],
  ['STEELMAN', 'EXTEND'],
  ['BUILD ON', 'EXTEND'],
  ['PROPOSE ADDITION', 'EXTEND'],
  ['AMPLIFY', 'EXTEND'],
  ['ELABORATE', 'EXTEND'],
  ['ASSERT', 'EXTEND'],
  // → UNDERCUT
  ['REDUCE', 'UNDERCUT'],
  ['ATTACK WARRANT', 'UNDERCUT'],
  ['CHALLENGE REASONING', 'UNDERCUT'],
  ['CHALLENGE LOGIC', 'UNDERCUT'],
  // → SPECIFY
  ['IDENTIFY CRUX', 'SPECIFY'],
  ['SURFACE CRUX', 'SPECIFY'],
  ['PROPOSE CRUX', 'SPECIFY'],
  ['NARROW', 'SPECIFY'],
  ['OPERATIONALIZE', 'SPECIFY'],
  ['PROPOSE TEST', 'SPECIFY'],
  ['PROPOSE BENCHMARK', 'SPECIFY'],
  ['EMPIRICAL BET', 'SPECIFY'],
  ['FALSIFY', 'SPECIFY'],
  ['SPECIFY FALSIFIABILITY', 'SPECIFY'],
  ['SPECIFY REQUIREMENTS', 'SPECIFY'],
  ['THRESHOLD SPECIFY', 'SPECIFY'],
  ['DEMAND SPECIFICATION', 'SPECIFY'],
  ['CLARIFY', 'SPECIFY'],
  ['PROPOSE STANDARD', 'SPECIFY'],
  ['SPECIFY STANDARD', 'SPECIFY'],
  ['PROPOSE CRITERION', 'SPECIFY'],
  // → INTEGRATE
  ['CONDITIONAL AGREE', 'INTEGRATE'],
  ['CONDITIONAL AGREEMENT', 'INTEGRATE'],
  ['CONDITIONAL ACCEPTANCE', 'INTEGRATE'],
  ['CONDITIONAL', 'INTEGRATE'],
  ['SYNTHESIZE', 'INTEGRATE'],
  ['PROPOSE SYNTHESIS', 'INTEGRATE'],
  ['BRIDGE', 'INTEGRATE'],
  ['RESOLVE TENSION', 'INTEGRATE'],
  ['PROPOSE CONVERGENCE', 'INTEGRATE'],
  ['RECONCILE', 'INTEGRATE'],
  ['PROPOSE', 'INTEGRATE'],
  ['ANALOGICAL REASONING', 'INTEGRATE'],
  ['ANALOGY', 'INTEGRATE'],
  // → BURDEN-SHIFT
  ['DEMAND EVIDENCE', 'BURDEN SHIFT'],
  ['SHIFT BURDEN', 'BURDEN SHIFT'],
  ['BURDEN OF PROOF', 'BURDEN SHIFT'],
];

// Build alias map with automatic reverse word-order registration for 2-word aliases
const MOVE_ALIASES = new Map<string, string>();
for (const [alias, canonical] of MOVE_ALIAS_ENTRIES) {
  MOVE_ALIASES.set(alias, canonical);
  const words = alias.split(' ');
  if (words.length === 2) {
    const reversed = `${words[1]} ${words[0]}`;
    if (!MOVE_ALIASES.has(reversed)) MOVE_ALIASES.set(reversed, canonical);
  }
}

/** Fuzzy keyword patterns — catch hallucinated move names that don't match any exact alias.
 *  Order matters: more specific patterns first to avoid false matches. */
const FUZZY_MOVE_KEYWORDS: [RegExp, string][] = [
  [/COUNTER.*EXAMPLE|EXCEPTION/i, 'COUNTEREXAMPLE'],
  [/COUNTER/i, 'COUNTEREXAMPLE'],
  [/ANALOG/i, 'INTEGRATE'],
  [/INTEGRAT|SYNTHESIZ|RECONCIL|BRIDG/i, 'INTEGRATE'],
  [/CONCEDE|CONCESSION|PIVOT|RETRACT/i, 'CONCEDE AND PIVOT'],
  [/CHALLENG/i, 'EMPIRICAL CHALLENGE'],
  [/DISTINGU|NARROW|SCOPE|BOUNDAR/i, 'DISTINGUISH'],
  [/REFRAME|RECAST|FRAME/i, 'REFRAME'],
  [/EXTEND|EXPAND|ELABORATE|BUILD/i, 'EXTEND'],
  [/UNDERCUT|UNDERMINE/i, 'UNDERCUT'],
  [/SPECIFY|OPERATIONALIZE|CLARIF/i, 'SPECIFY'],
  [/BURDEN|PROOF/i, 'BURDEN SHIFT'],
  [/ASSUMPTION|PRESUPPOS/i, 'EXPOSE ASSUMPTION'],
  [/STEEL|STRENGTHEN/i, 'STEEL BUILD'],
  [/GROUND|FACT.*CHECK|VERIFY/i, 'GROUND CHECK'],
  [/CRUX|TENSION/i, 'IDENTIFY CRUX'],
  [/CONDITION|QUALIF|PARTIAL/i, 'INTEGRATE'],
];

/** Resolve a move name (including aliases and hallucinated variants) to a canonical move name. */
export function resolveMoveName(raw: string): string {
  const normalized = normalizeMoveName(raw);
  const exact = MOVE_ALIASES.get(normalized);
  if (exact) return exact;
  if (MOVE_CATALOG.has(normalized)) return normalized;
  for (const [pattern, canonical] of FUZZY_MOVE_KEYWORDS) {
    if (pattern.test(normalized)) return canonical;
  }
  return normalized;
}

export const MOVE_CATALOG = new Set<string>(MOVE_CATALOG_RAW.map(normalizeMoveName));

export const DISAGREEMENT_TYPES = new Set(['EMPIRICAL', 'VALUES', 'DEFINITIONAL']);

// Only reject prefix openers when the ENTIRE string is short and generic.
// "Supports my position" (filler) vs "Supports the pivot toward empirical telemetry..." (substantive).
const FILLER_RELEVANCE = /^(supports|relevant|important|my view|this is)\s[\w\s]{0,30}$/i;

const RELEVANCE_STOP_WORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'been', 'very', 'much',
  'also', 'just', 'some', 'more', 'most', 'such', 'than', 'then',
  'when', 'what', 'which', 'where', 'their', 'there', 'about',
  'would', 'could', 'should', 'because', 'important', 'relevant',
  'supports', 'position', 'regarding', 'debate', 'point', 'view',
  'argument', 'overall', 'general', 'clearly', 'essentially',
  'basically', 'here', 'they', 'does', 'into', 'will', 'being',
  'these', 'those', 'other', 'each', 'both', 'many', 'well',
]);

export function isFillerRelevance(text: string): boolean {
  if (FILLER_RELEVANCE.test(text)) return true;
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  if (words.length === 0) return true;
  const stopCount = words.filter(w => RELEVANCE_STOP_WORDS.has(w)).length;
  if (stopCount / words.length > 0.5) return true;
  const hasDomainTerm = words.some(w => w.length > 6 && !RELEVANCE_STOP_WORDS.has(w));
  if (!hasDomainTerm) return true;
  return false;
}
