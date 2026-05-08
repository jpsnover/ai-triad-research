// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Hybrid process reward model for per-turn debate validation.
 *
 * Combines deterministic symbolic verification (Stage-A: 9 structural rules)
 * with an optional neural judge (Stage-B: LLM quality assessment). Unlike
 * standard PRMs that rely on a single neural verifier, this hybrid approach
 * provides transparent, reproducible base scoring with neural augmentation
 * for soft quality dimensions (argument advancement, taxonomy clarification).
 *
 * The process reward (formerly "score") evaluates each debate turn as an
 * intermediate reasoning step — correct process matters independent of
 * final debate outcome (Lightman et al. 2023).
 *
 * See docs/debate-turn-validation.md for the design, and
 * specs/debate-turn-validation-impl.md for the implementation spec.
 */

import type {
  DebatePhase,
  DebateAudience,
  SpeakerId,
  TaxonomyRef,
  TranscriptEntry,
  TurnValidation,
  TurnValidationConfig,
  TurnValidationDimensions,
  TaxonomyClarificationHint,
} from './types.js';
import type { PoverResponseMeta } from './helpers.js';
import { parseJsonRobust, getMoveName, SUPPORT_MOVES } from './helpers.js';
import { checkInterventionCompliance } from './moderator.js';

// ── Canonical move catalog — 10 well-differentiated dialectical moves ──
const MOVE_CATALOG_RAW = [
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

function resolveMoveName(raw: string): string {
  const normalized = normalizeMoveName(raw);
  return MOVE_ALIASES.get(normalized) ?? normalized;
}

const MOVE_CATALOG = new Set<string>(MOVE_CATALOG_RAW.map(normalizeMoveName));

const DISAGREEMENT_TYPES = new Set(['EMPIRICAL', 'VALUES', 'DEFINITIONAL']);

const FILLER_RELEVANCE = /^(supports|relevant|important|my view|this is)/i;

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

function isFillerRelevance(text: string): boolean {
  if (FILLER_RELEVANCE.test(text)) return true;
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  if (words.length === 0) return true;
  const stopCount = words.filter(w => RELEVANCE_STOP_WORDS.has(w)).length;
  if (stopCount / words.length > 0.5) return true;
  const hasDomainTerm = words.some(w => w.length > 6 && !RELEVANCE_STOP_WORDS.has(w));
  if (!hasDomainTerm) return true;
  return false;
}

// ── Config resolution ────────────────────────────────────

export function resolveTurnValidationConfig(
  c: TurnValidationConfig | undefined,
): Required<TurnValidationConfig> {
  const src = c ?? {};
  const rawRetries = src.maxRetries ?? 2;
  const clamped = Math.max(0, Math.min(2, rawRetries)) as 0 | 1 | 2;
  return {
    enabled: src.enabled ?? true,
    maxRetries: clamped,
    deterministicOnly: src.deterministicOnly ?? false,
    judgeModel: src.judgeModel ?? 'claude-haiku-4-5-20251001',
    sampleRate: {
      'thesis-antithesis': src.sampleRate?.['thesis-antithesis'] ?? 1,
      exploration: src.sampleRate?.exploration ?? 1,
      synthesis: src.sampleRate?.synthesis ?? 1,
    },
  };
}

// ── Validation entry point ───────────────────────────────

export interface ValidateTurnParams {
  statement: string;
  taxonomyRefs: TaxonomyRef[];
  meta: PoverResponseMeta;
  phase: DebatePhase;
  speaker: SpeakerId;
  round: number;
  /** Last up to 2 same-agent prior turns, newest last. */
  priorTurns: TranscriptEntry[];
  /** Up to 2 most-recent turns from any agent (newest last) — judge context. */
  recentTurns: TranscriptEntry[];
  knownNodeIds: ReadonlySet<string>;
  policyIds: ReadonlySet<string>;
  audience?: DebateAudience;
  config: Required<TurnValidationConfig>;
  callJudge: (prompt: string, label: string) => Promise<string>;
  /** Optional fallback judge caller using the debate's own model when the primary judge fails. */
  callJudgeFallback?: (prompt: string, label: string) => Promise<string>;
  /** Active moderator intervention that preceded this turn — triggers compliance checks. */
  pendingIntervention?: import('./types').ModeratorIntervention;
}

interface StageAResult {
  errorIssues: string[];
  warningIssues: string[];
  dimensions: TurnValidationDimensions;
}

function runStageA(p: ValidateTurnParams): StageAResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const schemaIssues: string[] = [];
  const groundingIssues: string[] = [];
  const advancementSignals: string[] = [];

  const { statement, taxonomyRefs, meta, round, phase, priorTurns, knownNodeIds, policyIds } = p;

  // Rule 1: move_types present and valid — normalize to canonical 10, error on unmappable
  if (meta.move_types && meta.move_types.length > 0) {
    const resolved: typeof meta.move_types = [];
    const unmappable: string[] = [];
    for (const m of meta.move_types) {
      const rawName = getMoveName(m);
      const resolvedName = resolveMoveName(rawName);
      if (MOVE_CATALOG.has(resolvedName)) {
        // Normalize the move to its canonical name
        if (typeof m === 'string') {
          resolved.push(resolvedName);
        } else {
          resolved.push({ ...m, move: resolvedName });
        }
      } else {
        unmappable.push(rawName);
      }
    }
    if (unmappable.length > 0) {
      const msg = `Unknown move_types: ${unmappable.join(', ')}. Use ONLY the 10 canonical moves: ${MOVE_CATALOG_RAW.join(', ')}.`;
      errors.push(msg);
      schemaIssues.push(msg);
    }
    // Replace with normalized moves (drop unmappable)
    meta.move_types = resolved.length > 0 ? resolved : meta.move_types;
  } else {
    const msg = 'move_types is missing or empty — declare at least one dialectical move.';
    errors.push(msg);
    schemaIssues.push(msg);
  }

  // Rule 2: disagreement_type enum (error, only if present)
  if (meta.disagreement_type && !DISAGREEMENT_TYPES.has(meta.disagreement_type)) {
    const msg = `disagreement_type '${meta.disagreement_type}' is not one of EMPIRICAL | VALUES | DEFINITIONAL.`;
    errors.push(msg);
    schemaIssues.push(msg);
  }

  // Rule 3: every taxonomy_refs[i].node_id exists (error)
  const unknownRefs = taxonomyRefs.filter(r => !knownNodeIds.has(r.node_id));
  if (unknownRefs.length > 0) {
    const msg = `Unknown taxonomy node_id(s): ${unknownRefs.map(r => r.node_id).join(', ')}. Cite only nodes that exist in the loaded taxonomy.`;
    errors.push(msg);
    schemaIssues.push(msg);
    groundingIssues.push(msg);
  }

  // Rule 4: policy_refs exist (warning only)
  if (meta.policy_refs && policyIds.size > 0) {
    const unknownPolicies = meta.policy_refs.filter(pid => !policyIds.has(pid));
    if (unknownPolicies.length > 0) {
      const msg = `Unknown policy_refs: ${unknownPolicies.join(', ')}.`;
      warnings.push(msg);
      groundingIssues.push(msg);
    }
  }

  // Rule 5: every relevance must be substantive (error)
  const weakRelevance = taxonomyRefs.filter(
    r => (r.relevance ?? '').trim().length < 40 || isFillerRelevance((r.relevance ?? '').trim()),
  );
  if (weakRelevance.length > 0) {
    const msg = `taxonomy_refs with filler or too-short 'relevance' (≥40 chars, no stock openers): ${weakRelevance.map(r => r.node_id).join(', ')}. Explain the mechanism by which the node supports or complicates your claim.`;
    errors.push(msg);
    groundingIssues.push(msg);
  }

  // Rule 6: paragraph count 3–5 (single-paragraph is error; other deviations are warning)
  const paragraphs = statement.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (paragraphs.length === 1) {
    const msg = 'Statement is a single paragraph — split into 3–5 double-newline-separated blocks.';
    errors.push(msg);
  } else if (paragraphs.length === 2 || paragraphs.length > 5) {
    const msg = `Statement has ${paragraphs.length} paragraphs — target 3–5 double-newline-separated blocks.`;
    warnings.push(msg);
  }

  // Rule 7: novelty (warning everywhere; harder expectation outside thesis-antithesis)
  const priorNodeIds = new Set<string>();
  for (const t of priorTurns) {
    for (const r of t.taxonomy_refs ?? []) priorNodeIds.add(r.node_id);
  }
  const newRefs = taxonomyRefs.filter(r => !priorNodeIds.has(r.node_id));
  if (newRefs.length === 0 && priorNodeIds.size > 0) {
    const msg = 'No new taxonomy_refs beyond your last two turns — introduce at least one node you have not cited recently.';
    warnings.push(msg);
    if (phase !== 'thesis-antithesis') {
      // Treat as a stronger advancement failure in later phases but still warning-level.
      advancementSignals.push('no_new_refs');
    }
  } else if (newRefs.length > 0) {
    advancementSignals.push(`new_refs:${newRefs.length}`);
  }

  // Rule 8: move repetition vs most recent same-agent turn (warning)
  const lastMoves = priorTurns.length > 0
    ? (((priorTurns[priorTurns.length - 1].metadata as Record<string, unknown> | undefined)?.move_types) as (string | import('./helpers').MoveAnnotation)[] | undefined)
        ?.map(m => resolveMoveName(getMoveName(m)))
    : undefined;
  if (
    lastMoves && lastMoves.length > 0 &&
    meta.move_types && meta.move_types.length > 0 &&
    lastMoves.length === meta.move_types.length &&
    lastMoves.every((m, i) => m === resolveMoveName(getMoveName(meta.move_types![i])))
  ) {
    const msg = `move_types repeat your previous turn exactly (${lastMoves.join(', ')}). Vary your dialectical move.`;
    warnings.push(msg);
  }

  // Rule 9: claim specificity — warning after round 3, error after round 4
  if (round >= 3) {
    const claims = meta.my_claims ?? [];
    const specific = claims.some(c =>
      /\d|[A-Z][a-z]+\s[A-Z][a-z]+|within|by\s\d{4}|percent|%|per year/.test(c.claim),
    );
    const target = round >= 4 ? errors : warnings;
    if (claims.length === 0) {
      const msg = 'my_claims is empty — add at least one claim with a number, timeline, or named entity.';
      target.push(msg);
    } else if (!specific) {
      const msg = 'my_claims are all abstract — include a number, named entity, or timeline (e.g. "by 2028", "within 12 months", "≥20%").';
      target.push(msg);
    } else {
      advancementSignals.push('specific_claim');
    }
  }

  // Rule 10: hedge density — audience-aware, phase-aware warning
  const hedgeDensity = computeHedgeDensity(statement);
  const hedgeThreshold = getHedgeThreshold(phase, p.audience);
  if (hedgeDensity > hedgeThreshold) {
    const pct = (hedgeDensity * 100).toFixed(0);
    const thresh = (hedgeThreshold * 100).toFixed(0);
    const msg = `Hedge density ${pct}% exceeds ${thresh}% threshold — replace qualifiers (may, might, could, perhaps, potentially) with definitive assertions. Use specific actors, timelines, and numbers.`;
    warnings.push(msg);
    advancementSignals.push(`high_hedge_density:${pct}%`);
  }

  // Rule 11: constructive move requirement — at least one support move after round 4
  if (phase !== 'thesis-antithesis' && round >= 4 && meta.move_types && meta.move_types.length > 0) {
    const resolved = meta.move_types.map(m => resolveMoveName(getMoveName(m)));
    const hasConstructive = resolved.some(m => SUPPORT_MOVES.has(m));
    if (!hasConstructive) {
      const constructiveList = 'CONCEDE-AND-PIVOT, INTEGRATE, EXTEND, SPECIFY';
      const msg = `No constructive move found — include at least one of: ${constructiveList}. Convergence requires engaging with opponents' strongest points, not just attacking.`;
      if (phase === 'synthesis' || round >= 6) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
      advancementSignals.push('no_constructive_move');
    }
  }

  const schemaPass = schemaIssues.length === 0;
  const groundingPass = groundingIssues.length === 0;
  // advancement pass decided later composite with judge signal
  const advancementPass = !advancementSignals.includes('no_new_refs');

  return {
    errorIssues: errors,
    warningIssues: warnings,
    dimensions: {
      schema:      { pass: schemaPass, issues: schemaIssues },
      grounding:   { pass: groundingPass, issues: groundingIssues },
      advancement: { pass: advancementPass, signals: advancementSignals },
      clarifies:   { pass: false, signals: [] },
    },
  };
}

// ── Stage B judge ────────────────────────────────────────

function buildJudgePrompt(p: ValidateTurnParams): string {
  const window = p.recentTurns.slice(-2).map(t => {
    const content = typeof t.content === 'string' ? t.content : JSON.stringify(t.content);
    return `[${t.speaker}] ${content.slice(0, 800)}`;
  }).join('\n\n');

  const turnJson = JSON.stringify({
    statement: p.statement.slice(0, 2000),
    taxonomy_refs: p.taxonomyRefs,
    move_types: p.meta.move_types ?? [],
    disagreement_type: p.meta.disagreement_type ?? null,
    my_claims: p.meta.my_claims ?? [],
  }, null, 2);

  return `You are a debate-progress referee. You do NOT take sides. You judge ONE turn against the last two turns of the same debate.

Phase: ${p.phase}
Agent: ${p.speaker}
Round: ${p.round}

Previous turns (last 2, any agent):
${window || '(no prior turns)'}

Current turn (JSON):
${turnJson}

Decide:
1. ADVANCES — does this turn do something the previous turns did not? (distinguish, concede-and-pivot, falsifiable prediction, narrowed crux, new steelman)
2. CLARIFIES_TAXONOMY — does it imply a taxonomy edit? Choose zero or more of:
   narrow <node_id> | broaden <node_id> | split <node_id> | merge <node_ids> | qualify <node_id> | retire <node_id> | new_node <label>
   Only mark a hint when the turn contains evidence for it — never speculative.
3. WEAKNESSES — list at most 3, each ≤15 words. Each names a concrete fix the debater could apply on retry.

Return ONLY JSON in this shape (no prose, no code fences):
{
  "advances": true|false,
  "advancement_reason": "...",
  "clarifies_taxonomy": [ { "action": "narrow|broaden|split|merge|qualify|retire|new_node", "node_id": "...", "node_ids": ["..."], "label": "...", "evidence_claim_id": "...", "rationale": "..." } ],
  "weaknesses": ["..."],
  "recommend": "pass" | "retry" | "accept_with_flag"
}`;
}

interface JudgeVerdict {
  advances: boolean;
  advancement_reason: string;
  clarifies_taxonomy: TaxonomyClarificationHint[];
  weaknesses: string[];
  recommend: 'pass' | 'retry' | 'accept_with_flag';
}

function parseJudgeVerdict(raw: string): JudgeVerdict {
  const fallback: JudgeVerdict = {
    advances: false,
    advancement_reason: 'judge_parse_failure',
    clarifies_taxonomy: [],
    weaknesses: [],
    recommend: 'accept_with_flag',
  };
  try {
    const parsed = parseJsonRobust(raw) as Record<string, unknown>;
    const rec = typeof parsed.recommend === 'string' ? parsed.recommend : 'pass';
    const recommend: JudgeVerdict['recommend'] =
      rec === 'retry' || rec === 'accept_with_flag' ? rec : 'pass';
    const hintsRaw = Array.isArray(parsed.clarifies_taxonomy) ? parsed.clarifies_taxonomy : [];
    const hints: TaxonomyClarificationHint[] = hintsRaw
      .map(h => h as Record<string, unknown>)
      .filter(h => typeof h.action === 'string')
      .map(h => ({
        action: h.action as TaxonomyClarificationHint['action'],
        node_id: typeof h.node_id === 'string' ? h.node_id : undefined,
        node_ids: Array.isArray(h.node_ids) ? (h.node_ids as string[]) : undefined,
        label: typeof h.label === 'string' ? h.label : undefined,
        evidence_claim_id: typeof h.evidence_claim_id === 'string' ? h.evidence_claim_id : undefined,
        rationale: typeof h.rationale === 'string' ? h.rationale : '',
      }));
    return {
      advances: parsed.advances !== false,
      advancement_reason: typeof parsed.advancement_reason === 'string' ? parsed.advancement_reason : '',
      clarifies_taxonomy: hints,
      weaknesses: Array.isArray(parsed.weaknesses)
        ? (parsed.weaknesses as unknown[]).filter(w => typeof w === 'string').map(w => w as string)
        : [],
      recommend,
    };
  } catch {
    return fallback;
  }
}

// ── Orchestrator ─────────────────────────────────────────

export async function validateTurn(p: ValidateTurnParams): Promise<TurnValidation> {
  if (!p.config.enabled) {
    return zeroValidation('skipped', 1);
  }

  const stageA = runStageA(p);

  // Intervention compliance check — if a moderator intervention preceded this turn,
  // verify the debater included the required response field.
  // Hard-compliance failures are schema errors (fail the schema dimension → process_reward ≤ 0.60).
  if (p.pendingIntervention) {
    const rawMeta = (p.meta as Record<string, unknown>) ?? {};
    const compliance = checkInterventionCompliance(p.pendingIntervention.move, rawMeta);
    if (!compliance.compliant && compliance.repair_hint) {
      stageA.errorIssues.push(compliance.repair_hint);
      // Route to schema dimension so the turn fails hard
      stageA.dimensions.schema.issues.push(compliance.repair_hint);
      stageA.dimensions.schema.pass = false;
    }
  }

  const hasStageAError = stageA.errorIssues.length > 0;

  // Sample rate check — treat out-of-sample as deterministic-only.
  const phaseRate = p.config.sampleRate[p.phase] ?? 1;
  const sampled = phaseRate >= 1 ? true : Math.random() < phaseRate;

  const shouldRunJudge =
    !p.config.deterministicOnly &&
    !hasStageAError &&
    sampled;

  let judge: JudgeVerdict | null = null;
  let judgeUsed = false;
  let judgeAttempted = false;
  let judgeModel: string | undefined;
  if (shouldRunJudge) {
    judgeAttempted = true;
    const judgePrompt = buildJudgePrompt(p);
    const judgeLabel = `turn-validator judge (${p.speaker} r${p.round})`;
    try {
      const raw = await p.callJudge(judgePrompt, judgeLabel);
      judge = parseJudgeVerdict(raw);
      judgeUsed = true;
      judgeModel = p.config.judgeModel;
    } catch {
      // Primary judge failed (e.g. missing Anthropic key) — try fallback model.
      if (p.callJudgeFallback) {
        try {
          const raw = await p.callJudgeFallback(judgePrompt, `${judgeLabel} [fallback]`);
          judge = parseJudgeVerdict(raw);
          judgeUsed = true;
          judgeModel = 'fallback';
        } catch {
          judge = null;
        }
      }
    }
  }

  // Compose dimensions — if judge was attempted but fully failed, don't default to advances=true
  const dims: TurnValidationDimensions = {
    schema: stageA.dimensions.schema,
    grounding: stageA.dimensions.grounding,
    advancement: {
      pass: stageA.dimensions.advancement.pass && (judge ? judge.advances : !judgeAttempted),
      signals: [
        ...stageA.dimensions.advancement.signals,
        ...(judge && judge.advances ? ['judge_advances'] : []),
        ...(judge?.advancement_reason ? [judge.advancement_reason] : []),
      ],
    },
    clarifies: {
      pass: !!(judge && judge.clarifies_taxonomy.length > 0),
      signals: (judge?.clarifies_taxonomy ?? []).map(h =>
        `${h.action}${h.node_id ? `:${h.node_id}` : ''}`,
      ),
    },
  };

  // Repair hints — errors first, then warnings, then judge weaknesses.
  const repairHints = [
    ...stageA.errorIssues,
    ...stageA.warningIssues,
    ...(judge?.weaknesses ?? []),
  ];

  // Outcome
  const retryBudget = p.config.maxRetries;
  let outcome: TurnValidation['outcome'];
  if (hasStageAError && retryBudget > 0) {
    outcome = 'retry';
  } else if (judge && judge.recommend === 'retry' && retryBudget > 0) {
    outcome = 'retry';
  } else if (judge && judge.recommend === 'retry' && retryBudget === 0) {
    outcome = 'accept_with_flag';
  } else if (judge && judge.recommend === 'accept_with_flag') {
    outcome = 'accept_with_flag';
  } else if (hasStageAError && retryBudget === 0) {
    outcome = 'accept_with_flag';
  } else {
    outcome = 'pass';
  }

  const process_reward =
    0.4 * (dims.schema.pass ? 1 : 0) +
    0.3 * (dims.grounding.pass ? 1 : 0) +
    0.2 * (dims.advancement.pass ? 1 : 0) +
    0.1 * (dims.clarifies.pass ? 1 : 0);

  return {
    outcome,
    process_reward,
    dimensions: dims,
    repairHints,
    clarifies_taxonomy: judge?.clarifies_taxonomy ?? [],
    judge_used: judgeUsed,
    judge_model: judgeUsed ? judgeModel : undefined,
  };
}

function zeroValidation(outcome: TurnValidation['outcome'], process_reward: number): TurnValidation {
  return {
    outcome,
    process_reward,
    dimensions: {
      schema:      { pass: true, issues: [] },
      grounding:   { pass: true, issues: [] },
      advancement: { pass: true, signals: [] },
      clarifies:   { pass: false, signals: [] },
    },
    repairHints: [],
    clarifies_taxonomy: [],
    judge_used: false,
  };
}

// ── Repair prompt builder ────────────────────────────────

export function buildRepairPrompt(
  basePrompt: string,
  v: TurnValidation,
  attempt: number,
): string {
  const sections: string[] = [];
  sections.push('--- REPAIR INSTRUCTIONS ---');
  sections.push('Your prior response was rejected for the following reasons:');
  for (const h of v.repairHints) sections.push(`- ${h}`);
  sections.push('');
  sections.push('Do NOT repeat the rejected response. On this retry you MUST:');
  if (!v.dimensions.schema.pass) {
    sections.push('• Fix the JSON/schema issues above before anything else.');
    const hasMoveError = v.repairHints.some(h => h.includes('Unknown move_types'));
    if (hasMoveError) {
      sections.push(`• CRITICAL: move_types must use ONLY these exact values: ${MOVE_CATALOG_RAW.join(', ')}. Do NOT invent new move names.`);
    }
  }
  if (!v.dimensions.grounding.pass) {
    sections.push('• Replace filler `relevance` strings with one concrete sentence explaining the mechanism by which the cited node supports or complicates your claim.');
  }
  if (!v.dimensions.advancement.pass) {
    sections.push('• Include at least one NEW move from: DISTINGUISH, CONCEDE-AND-PIVOT, COUNTEREXAMPLE, or a falsifiable prediction with a timeline. Cite at least one taxonomy node you have not referenced in your last two turns.');
  }
  if (!v.dimensions.clarifies.pass) {
    sections.push('• If the evidence warrants it, use one `taxonomy_refs[i].relevance` to propose a node clarification — say whether its description should be narrowed, broadened, or split, and cite the evidence from this turn.');
  }
  sections.push('• Keep `statement` to 3–5 paragraphs. Do not restate your opening.');

  if (attempt >= 2) {
    sections.push('');
    sections.push('Required JSON shape (minimal reminder):');
    sections.push('{ "statement": "…", "taxonomy_refs": [{"node_id":"…","relevance":"…"}], "move_types": [{"move":"…","detail":"…"}], "disagreement_type": "EMPIRICAL|VALUES|DEFINITIONAL", "my_claims": [{"claim":"…","targets":["…"]}] }');
  }

  const hasHedgeWarning = v.repairHints.some(h => h.includes('Hedge density'));
  if (hasHedgeWarning) {
    sections.push('• Reduce hedge-stacking: replace "may potentially", "could possibly", "it seems likely" with direct assertions. Name the actor and use active voice.');
  }

  return `${basePrompt}\n\n${sections.join('\n')}\n`;
}

// ── Hedge-density helpers (Rule 10) ─────────────────────────

const HEDGE_MARKERS = [
  /\bmay\b/gi, /\bmight\b/gi, /\bcould\b/gi, /\bperhaps\b/gi,
  /\bpossibly\b/gi, /\bpotentially\b/gi, /\barguably\b/gi,
  /\bseems?\b/gi, /\bappears?\b/gi, /\bsomewhat\b/gi,
  /\btends?\sto\b/gi, /\bit is (possible|conceivable|plausible) that\b/gi,
  /\bsome (argue|suggest|believe|contend)\b/gi,
  /\bit has been (suggested|argued|noted)\b/gi,
  /\bmay potentially\b/gi, /\bcould potentially\b/gi,
  /\bcould possibly\b/gi, /\bmight possibly\b/gi,
];

function computeHedgeDensity(statement: string): number {
  const sentences = statement.split(/[.!?]+/).filter(s => s.trim().length > 10);
  if (sentences.length === 0) return 0;
  let hedgedSentences = 0;
  for (const sentence of sentences) {
    if (HEDGE_MARKERS.some(rx => rx.test(sentence))) {
      hedgedSentences++;
    }
    for (const rx of HEDGE_MARKERS) rx.lastIndex = 0;
  }
  return hedgedSentences / sentences.length;
}

function getHedgeThreshold(phase: DebatePhase, audience?: DebateAudience): number {
  if (audience === 'academic_community') return 0.50;
  const byPhase: Record<DebatePhase, number> = {
    'thesis-antithesis': 0.40,
    exploration: 0.30,
    synthesis: 0.20,
  };
  if (audience === 'general_public') {
    return (byPhase[phase] ?? 0.30) - 0.05;
  }
  return byPhase[phase] ?? 0.30;
}
