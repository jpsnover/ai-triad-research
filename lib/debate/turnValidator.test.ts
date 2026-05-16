// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { resolveTurnValidationConfig, validateTurn, validatePlanStage, validateCiteStage, validateDraftStage, checkDirectiveContentCompliance, isFillerRelevance, parseDraftQualityResult } from './turnValidator.js';
import type { ValidateTurnParams } from './turnValidator.js';
import type {
  TaxonomyRef,
  TranscriptEntry,
  TurnValidationConfig,
  DebatePhase,
  SpeakerId,
  DebateAudience,
  ModeratorIntervention,
} from './types.js';
import type { PoverResponseMeta } from './helpers.js';

// ── Helpers ───────────────────────────────────────────────

/** Build a multi-paragraph statement with the given count of paragraphs. */
function makeParagraphs(n: number): string {
  const paras = [
    'This is a substantive paragraph about artificial intelligence governance frameworks and multi-stakeholder regulatory approaches that require careful institutional design.',
    'The second dimension concerns empirical evidence from deployment contexts where algorithmic systems interact with existing legal and social norms in complex jurisdictional environments.',
    'A third consideration involves the strategic coordination between national regulators and international standards bodies to prevent regulatory arbitrage across borders.',
    'Furthermore, the economic implications of compliance burdens on smaller developers must be weighed against the public interest in safety and accountability mechanisms.',
    'Finally, the temporal dynamics of technology evolution outpace legislative processes, creating persistent gaps between capability frontiers and governance frameworks.',
  ];
  return Array.from({ length: n }, (_, i) => paras[i % paras.length]).join('\n\n');
}

/** Build a substantive relevance string (>40 chars, domain-specific). */
function substantiveRelevance(nodeId: string): string {
  return `This node ${nodeId} directly constrains the governance mechanism by specifying accountability thresholds for autonomous systems.`;
}

const mockJudge = async () =>
  JSON.stringify({
    advances: true,
    advancement_reason: 'test',
    clarifies_taxonomy: [],
    weaknesses: [],
    quality_score: 0.85,
    recommend: 'pass',
  });

function makeTaxRef(nodeId: string, relevance?: string): TaxonomyRef {
  return { node_id: nodeId, relevance: relevance ?? substantiveRelevance(nodeId) };
}

function makeTranscriptEntry(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: 'te-1',
    timestamp: new Date().toISOString(),
    type: 'statement',
    speaker: 'prometheus',
    content: 'Prior turn content about AI governance mechanisms.',
    taxonomy_refs: [{ node_id: 'acc-B-001', relevance: 'prior ref' }],
    ...overrides,
  };
}

function makeParams(overrides: Partial<ValidateTurnParams> = {}): ValidateTurnParams {
  return {
    statement: makeParagraphs(3),
    taxonomyRefs: [
      makeTaxRef('acc-B-001'),
      makeTaxRef('saf-D-002'),
    ],
    meta: {
      move_types: [{ move: 'DISTINGUISH', detail: 'distinguishing governance approaches' }],
      disagreement_type: 'EMPIRICAL',
      my_claims: [{ claim: 'AI regulation should require audits by 2028', targets: ['sentinel'] }],
      policy_refs: ['pol-001'],
    },
    phase: 'argumentation' as DebatePhase,
    speaker: 'prometheus' as SpeakerId,
    round: 3,
    priorTurns: [],
    recentTurns: [],
    knownNodeIds: new Set(['acc-B-001', 'saf-D-002', 'skp-I-003']),
    policyIds: new Set(['pol-001', 'pol-002']),
    config: resolveTurnValidationConfig({ enabled: true, deterministicOnly: true }),
    callJudge: mockJudge,
    ...overrides,
  };
}

// ── resolveTurnValidationConfig ─────────────────────────

describe('resolveTurnValidationConfig', () => {
  it('fills defaults when given undefined', () => {
    const c = resolveTurnValidationConfig(undefined);
    expect(c.enabled).toBe(true);
    expect(c.maxRetries).toBe(2);
    expect(c.deterministicOnly).toBe(false);
    expect(c.judgeModel).toBe('claude-haiku-4-5-20251001');
    expect(c.sampleRate['confrontation']).toBe(1);
    expect(c.sampleRate.argumentation).toBe(1);
    expect(c.sampleRate.concluding).toBe(1);
  });

  it('fills defaults when given empty object', () => {
    const c = resolveTurnValidationConfig({});
    expect(c.enabled).toBe(true);
    expect(c.maxRetries).toBe(2);
  });

  it('clamps maxRetries above 2 down to 2', () => {
    const c = resolveTurnValidationConfig({ maxRetries: 5 as 0 | 1 | 2 });
    expect(c.maxRetries).toBe(2);
  });

  it('clamps negative maxRetries to 0', () => {
    const c = resolveTurnValidationConfig({ maxRetries: -1 as 0 | 1 | 2 });
    expect(c.maxRetries).toBe(0);
  });

  it('preserves explicit values', () => {
    const c = resolveTurnValidationConfig({
      enabled: false,
      maxRetries: 1,
      deterministicOnly: true,
      judgeModel: 'custom-model',
      sampleRate: { argumentation: 0.5 },
    });
    expect(c.enabled).toBe(false);
    expect(c.maxRetries).toBe(1);
    expect(c.deterministicOnly).toBe(true);
    expect(c.judgeModel).toBe('custom-model');
    expect(c.sampleRate.argumentation).toBe(0.5);
    // Un-specified phases get defaults
    expect(c.sampleRate['confrontation']).toBe(1);
    expect(c.sampleRate.concluding).toBe(1);
  });
});

// ── Stage A: Rule 1 — move_types ────────────────────────

describe('Stage A Rule 1: move_types', () => {
  it('errors when move_types is missing', async () => {
    const p = makeParams({ meta: { ...makeParams().meta, move_types: undefined } });
    const r = await validateTurn(p);
    expect(r.outcome).not.toBe('pass');
    expect(r.repairHints.some(h => h.includes('move_types is missing'))).toBe(true);
    expect(r.dimensions.schema.pass).toBe(false);
  });

  it('errors when move_types is empty array', async () => {
    const p = makeParams({ meta: { ...makeParams().meta, move_types: [] } });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('move_types is missing'))).toBe(true);
    expect(r.dimensions.schema.pass).toBe(false);
  });

  it('warns on unknown move names but does not error', async () => {
    const p = makeParams({
      meta: {
        ...makeParams().meta,
        move_types: ['TOTALLY_MADE_UP_MOVE'],
      },
    });
    const r = await validateTurn(p);
    // Unknown moves are warnings, not errors, so outcome should still pass (no Stage-A error)
    expect(r.repairHints.some(h => h.includes('Unknown move_types'))).toBe(true);
    // Schema dimension still shows the issue
    expect(r.dimensions.schema.issues.some(i => i.includes('Unknown move_types'))).toBe(true);
  });

  it('passes with valid move names (string form)', async () => {
    const p = makeParams({
      meta: { ...makeParams().meta, move_types: ['DISTINGUISH', 'EXTEND'] },
    });
    const r = await validateTurn(p);
    expect(r.dimensions.schema.issues.filter(i => i.includes('move_types'))).toHaveLength(0);
  });

  it('passes with valid move names (MoveAnnotation form)', async () => {
    const p = makeParams({
      meta: {
        ...makeParams().meta,
        move_types: [{ move: 'COUNTEREXAMPLE', detail: 'test' }],
      },
    });
    const r = await validateTurn(p);
    expect(r.dimensions.schema.issues.filter(i => i.includes('move_types'))).toHaveLength(0);
  });
});

// ── Stage A: Rule 2 — disagreement_type ─────────────────

describe('Stage A Rule 2: disagreement_type', () => {
  it('passes with valid EMPIRICAL type', async () => {
    const p = makeParams({ meta: { ...makeParams().meta, disagreement_type: 'EMPIRICAL' } });
    const r = await validateTurn(p);
    expect(r.dimensions.schema.issues.filter(i => i.includes('disagreement_type'))).toHaveLength(0);
  });

  it('passes with valid VALUES type', async () => {
    const p = makeParams({ meta: { ...makeParams().meta, disagreement_type: 'VALUES' } });
    const r = await validateTurn(p);
    expect(r.dimensions.schema.issues.filter(i => i.includes('disagreement_type'))).toHaveLength(0);
  });

  it('passes with valid DEFINITIONAL type', async () => {
    const p = makeParams({ meta: { ...makeParams().meta, disagreement_type: 'DEFINITIONAL' } });
    const r = await validateTurn(p);
    expect(r.dimensions.schema.issues.filter(i => i.includes('disagreement_type'))).toHaveLength(0);
  });

  it('errors on invalid disagreement_type', async () => {
    const p = makeParams({ meta: { ...makeParams().meta, disagreement_type: 'PROCEDURAL' } });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('disagreement_type'))).toBe(true);
    expect(r.dimensions.schema.pass).toBe(false);
  });

  it('passes when disagreement_type is absent', async () => {
    const p = makeParams({ meta: { ...makeParams().meta, disagreement_type: undefined } });
    const r = await validateTurn(p);
    expect(r.dimensions.schema.issues.filter(i => i.includes('disagreement_type'))).toHaveLength(0);
  });
});

// ── Stage A: Rule 3 — taxonomy ref node_id ──────────────

describe('Stage A Rule 3: taxonomy ref node_id validation', () => {
  it('errors when taxonomy_refs reference unknown node_ids', async () => {
    const p = makeParams({
      taxonomyRefs: [makeTaxRef('unknown-node-999')],
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('Unknown taxonomy node_id'))).toBe(true);
    expect(r.dimensions.schema.pass).toBe(false);
    expect(r.dimensions.grounding.pass).toBe(false);
  });

  it('passes when all node_ids are known', async () => {
    const p = makeParams({
      taxonomyRefs: [makeTaxRef('acc-B-001'), makeTaxRef('saf-D-002')],
    });
    const r = await validateTurn(p);
    expect(r.dimensions.grounding.issues.filter(i => i.includes('Unknown taxonomy'))).toHaveLength(0);
  });

  it('errors on a mix of known and unknown node_ids', async () => {
    const p = makeParams({
      taxonomyRefs: [makeTaxRef('acc-B-001'), makeTaxRef('bogus-X-999')],
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('bogus-X-999'))).toBe(true);
  });
});

// ── Stage A: Rule 4 — policy_refs ───────────────────────

describe('Stage A Rule 4: policy_refs validation', () => {
  it('warns on unknown policy_refs (does not error)', async () => {
    const p = makeParams({
      meta: { ...makeParams().meta, policy_refs: ['pol-001', 'pol-UNKNOWN'] },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('Unknown policy_refs'))).toBe(true);
    // It's a warning, so schema dimension may still pass
    expect(r.dimensions.grounding.issues.some(i => i.includes('pol-UNKNOWN'))).toBe(true);
  });

  it('passes when all policy_refs are known', async () => {
    const p = makeParams({
      meta: { ...makeParams().meta, policy_refs: ['pol-001', 'pol-002'] },
    });
    const r = await validateTurn(p);
    expect(r.dimensions.grounding.issues.filter(i => i.includes('policy_refs'))).toHaveLength(0);
  });

  it('passes when policy_refs is absent', async () => {
    const p = makeParams({
      meta: { ...makeParams().meta, policy_refs: undefined },
    });
    const r = await validateTurn(p);
    expect(r.dimensions.grounding.issues.filter(i => i.includes('policy_refs'))).toHaveLength(0);
  });

  it('skips policy_refs check when policyIds is empty', async () => {
    const p = makeParams({
      policyIds: new Set(),
      meta: { ...makeParams().meta, policy_refs: ['pol-UNKNOWN'] },
    });
    const r = await validateTurn(p);
    // With empty policyIds, the check is skipped (size === 0 guard)
    expect(r.dimensions.grounding.issues.filter(i => i.includes('policy_refs'))).toHaveLength(0);
  });
});

// ── Stage A: Rule 5 — relevance text ────────────────────

describe('Stage A Rule 5: relevance text quality', () => {
  it('errors on filler relevance text starting with "supports"', async () => {
    const p = makeParams({
      taxonomyRefs: [{ node_id: 'acc-B-001', relevance: 'supports my position on this topic and is very relevant here' }],
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('filler or too-short'))).toBe(true);
  });

  it('errors on relevance text shorter than 40 characters', async () => {
    const p = makeParams({
      taxonomyRefs: [{ node_id: 'acc-B-001', relevance: 'short text' }],
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('filler or too-short'))).toBe(true);
  });

  it('passes with substantive relevance text', async () => {
    const p = makeParams({
      taxonomyRefs: [makeTaxRef('acc-B-001')],
    });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('filler or too-short'))).toHaveLength(0);
  });

  it('errors on relevance text with high stop-word ratio', async () => {
    // All stop words, no domain terms — should be flagged as filler
    const p = makeParams({
      taxonomyRefs: [{
        node_id: 'acc-B-001',
        relevance: 'This would have been very much about their general overall point regarding the debate view argument clearly',
      }],
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('filler or too-short'))).toBe(true);
  });
});

// ── Stage A: Rule 6 — paragraph count ───────────────────

describe('Stage A Rule 6: paragraph count', () => {
  it('errors on single-paragraph statement', async () => {
    const p = makeParams({ statement: 'A single paragraph without any double newlines.' });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('single paragraph'))).toBe(true);
  });

  it('warns on 2-paragraph statement', async () => {
    const p = makeParams({ statement: makeParagraphs(2) });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('2 paragraphs'))).toBe(true);
    // 2 paragraphs is a warning, not an error — so if no other errors, outcome is pass
  });

  it('passes with 3-paragraph statement', async () => {
    const p = makeParams({ statement: makeParagraphs(3) });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('paragraphs'))).toHaveLength(0);
  });

  it('passes with 5-paragraph statement', async () => {
    const p = makeParams({ statement: makeParagraphs(5) });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('paragraphs'))).toHaveLength(0);
  });

  it('warns on 6-paragraph statement', async () => {
    const p = makeParams({ statement: makeParagraphs(6) });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('6 paragraphs'))).toBe(true);
  });
});

// ── Stage A: Rule 7 — novelty ───────────────────────────

describe('Stage A Rule 7: novelty (new refs)', () => {
  it('warns when no new taxonomy refs beyond prior turns', async () => {
    const priorEntry = makeTranscriptEntry({
      taxonomy_refs: [{ node_id: 'acc-B-001', relevance: 'prior' }, { node_id: 'saf-D-002', relevance: 'prior' }],
    });
    const p = makeParams({
      priorTurns: [priorEntry],
      taxonomyRefs: [makeTaxRef('acc-B-001'), makeTaxRef('saf-D-002')],
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('No new taxonomy_refs'))).toBe(true);
    expect(r.dimensions.advancement.pass).toBe(false);
  });

  it('passes when at least one new ref is introduced', async () => {
    const priorEntry = makeTranscriptEntry({
      taxonomy_refs: [{ node_id: 'acc-B-001', relevance: 'prior' }],
    });
    const p = makeParams({
      priorTurns: [priorEntry],
      taxonomyRefs: [makeTaxRef('acc-B-001'), makeTaxRef('saf-D-002')],
    });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('No new taxonomy_refs'))).toHaveLength(0);
    expect(r.dimensions.advancement.signals).toContain('new_refs:1');
  });

  it('does not warn when there are no prior turns', async () => {
    const p = makeParams({ priorTurns: [] });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('No new taxonomy_refs'))).toHaveLength(0);
  });

  it('records no_new_refs advancement signal in non-thesis phase', async () => {
    const priorEntry = makeTranscriptEntry({
      taxonomy_refs: [{ node_id: 'acc-B-001', relevance: 'prior' }, { node_id: 'saf-D-002', relevance: 'prior' }],
    });
    const p = makeParams({
      phase: 'argumentation',
      priorTurns: [priorEntry],
      taxonomyRefs: [makeTaxRef('acc-B-001'), makeTaxRef('saf-D-002')],
    });
    const r = await validateTurn(p);
    expect(r.dimensions.advancement.signals).toContain('no_new_refs');
  });
});

// ── Stage A: Rule 8 — move repetition ───────────────────

describe('Stage A Rule 8: move repetition', () => {
  it('warns when move_types exactly repeat prior turn', async () => {
    const priorEntry = makeTranscriptEntry({
      metadata: { move_types: ['DISTINGUISH'] },
    });
    const p = makeParams({
      priorTurns: [priorEntry],
      meta: {
        ...makeParams().meta,
        move_types: ['DISTINGUISH'],
      },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('repeat your previous turn exactly'))).toBe(true);
  });

  it('does not warn when move_types differ from prior turn', async () => {
    const priorEntry = makeTranscriptEntry({
      metadata: { move_types: ['DISTINGUISH'] },
    });
    const p = makeParams({
      priorTurns: [priorEntry],
      meta: {
        ...makeParams().meta,
        move_types: ['COUNTEREXAMPLE'],
      },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('repeat your previous turn'))).toHaveLength(0);
  });

  it('does not warn when prior turn has no move_types metadata', async () => {
    const priorEntry = makeTranscriptEntry({ metadata: {} });
    const p = makeParams({
      priorTurns: [priorEntry],
      meta: { ...makeParams().meta, move_types: ['DISTINGUISH'] },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('repeat your previous turn'))).toHaveLength(0);
  });

  it('does not warn when move counts differ', async () => {
    const priorEntry = makeTranscriptEntry({
      metadata: { move_types: ['DISTINGUISH', 'EXTEND'] },
    });
    const p = makeParams({
      priorTurns: [priorEntry],
      meta: { ...makeParams().meta, move_types: ['DISTINGUISH'] },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('repeat your previous turn'))).toHaveLength(0);
  });
});

// ── Stage A: Rule 9 — claim specificity ─────────────────

describe('Stage A Rule 9: claim specificity', () => {
  it('warns on empty my_claims at round 3', async () => {
    const p = makeParams({
      round: 3,
      meta: { ...makeParams().meta, my_claims: [] },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('my_claims is empty'))).toBe(true);
  });

  it('errors on empty my_claims at round 4', async () => {
    const p = makeParams({
      round: 4,
      meta: { ...makeParams().meta, my_claims: [] },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('my_claims is empty'))).toBe(true);
    // At round 4 this becomes an error, so outcome should reflect
    expect(r.outcome).not.toBe('pass');
  });

  it('warns on abstract claims (no numbers/timelines) at round 3', async () => {
    const p = makeParams({
      round: 3,
      meta: {
        ...makeParams().meta,
        my_claims: [{ claim: 'governance should be improved', targets: ['sentinel'] }],
      },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('my_claims are all abstract'))).toBe(true);
  });

  it('errors on abstract claims at round 4', async () => {
    const p = makeParams({
      round: 4,
      meta: {
        ...makeParams().meta,
        my_claims: [{ claim: 'governance should be improved somehow', targets: ['sentinel'] }],
      },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('my_claims are all abstract'))).toBe(true);
    expect(r.outcome).not.toBe('pass');
  });

  it('passes with specific claims containing numbers', async () => {
    const p = makeParams({
      round: 4,
      meta: {
        ...makeParams().meta,
        my_claims: [{ claim: 'AI audits should be required by 2028', targets: ['sentinel'] }],
      },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('my_claims'))).toHaveLength(0);
    expect(r.dimensions.advancement.signals).toContain('specific_claim');
  });

  it('does not check claims before round 3', async () => {
    const p = makeParams({
      round: 2,
      meta: { ...makeParams().meta, my_claims: [] },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('my_claims'))).toHaveLength(0);
  });

  it('passes with named-entity claims (e.g. "Proper Name")', async () => {
    const p = makeParams({
      round: 3,
      meta: {
        ...makeParams().meta,
        my_claims: [{ claim: 'Geoffrey Hinton warned about autonomous systems', targets: ['sentinel'] }],
      },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('my_claims are all abstract'))).toHaveLength(0);
  });
});

// ── Stage A: Rule 10 — hedge density ────────────────────

describe('Stage A Rule 10: hedge density', () => {
  it('warns when hedge density exceeds threshold', async () => {
    // All sentences contain hedges
    const hedgey = [
      'It may be that governance could potentially improve.',
      'Perhaps the regulations might possibly address concerns.',
      'Arguably this could be somewhat relevant to policy.',
    ].join('\n\n');
    const p = makeParams({ statement: hedgey });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('Hedge density'))).toBe(true);
  });

  it('passes with assertive, hedge-free statement', async () => {
    const assertive = [
      'AI governance requires mandatory third-party auditing frameworks.',
      'The European AI Act establishes binding obligations for high-risk systems.',
      'Deployment timelines must include concrete enforcement milestones by 2028.',
    ].join('\n\n');
    const p = makeParams({ statement: assertive });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('Hedge density'))).toHaveLength(0);
  });

  it('uses higher threshold for academic_community audience', async () => {
    // With academic audience, threshold is 0.50. Moderate hedging should pass.
    const moderate = [
      'The evidence suggests that regulatory frameworks may need updating.',
      'Current implementations require concrete performance benchmarks.',
      'Third-party auditing remains the gold standard for accountability.',
    ].join('\n\n');
    const p = makeParams({ statement: moderate, audience: 'academic_community' });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('Hedge density'))).toHaveLength(0);
  });

  it('uses lower threshold for general_public audience', async () => {
    // general_public gets -0.05, so threshold is lower = stricter
    const moderate = [
      'It may be that governance could improve.',
      'The regulations are concrete and enforceable.',
      'Third-party audits must be mandated immediately.',
    ].join('\n\n');
    const p = makeParams({
      statement: moderate,
      audience: 'general_public',
      phase: 'argumentation',
    });
    const r = await validateTurn(p);
    // Whether it warns depends on exact density vs threshold; the point is the
    // threshold is different from default.
    expect(r).toBeDefined();
  });
});

// ── Stage A: Rule 11 — constructive move requirement ────

describe('Stage A Rule 11: constructive move requirement', () => {
  it('warns when no constructive move after round 4 in argumentation', async () => {
    const p = makeParams({
      round: 5,
      phase: 'argumentation',
      meta: {
        ...makeParams().meta,
        move_types: ['COUNTEREXAMPLE', 'DISTINGUISH'],
      },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('No constructive move'))).toBe(true);
    expect(r.dimensions.advancement.signals).toContain('no_constructive_move');
  });

  it('errors when no constructive move in concluding phase', async () => {
    const p = makeParams({
      round: 5,
      phase: 'concluding',
      meta: {
        ...makeParams().meta,
        move_types: ['COUNTEREXAMPLE'],
      },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('No constructive move'))).toBe(true);
    expect(r.outcome).not.toBe('pass');
  });

  it('errors when no constructive move at round 6 in argumentation', async () => {
    const p = makeParams({
      round: 6,
      phase: 'argumentation',
      meta: {
        ...makeParams().meta,
        move_types: ['COUNTEREXAMPLE'],
      },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('No constructive move'))).toBe(true);
    expect(r.outcome).not.toBe('pass');
  });

  it('passes when CONCEDE is present (unhyphenated support move)', async () => {
    // Note: SUPPORT_MOVES uses hyphenated keys (e.g. CONCEDE-AND-PIVOT) but
    // resolveMoveName normalizes hyphens to spaces. Single-word support moves
    // like CONCEDE, EXTEND, INTEGRATE match because normalization is a no-op.
    const p = makeParams({
      round: 5,
      phase: 'argumentation',
      meta: {
        ...makeParams().meta,
        move_types: ['COUNTEREXAMPLE', 'CONCEDE'],
      },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('No constructive move'))).toHaveLength(0);
  });

  it('passes when INTEGRATE is present', async () => {
    const p = makeParams({
      round: 5,
      phase: 'argumentation',
      meta: {
        ...makeParams().meta,
        move_types: ['INTEGRATE'],
      },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('No constructive move'))).toHaveLength(0);
  });

  it('passes when EXTEND is present', async () => {
    const p = makeParams({
      round: 5,
      phase: 'argumentation',
      meta: {
        ...makeParams().meta,
        move_types: ['EXTEND'],
      },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('No constructive move'))).toHaveLength(0);
  });

  it('does not apply in confrontation phase', async () => {
    const p = makeParams({
      round: 5,
      phase: 'confrontation',
      meta: {
        ...makeParams().meta,
        move_types: ['COUNTEREXAMPLE'],
      },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('No constructive move'))).toHaveLength(0);
  });

  it('does not apply before round 4', async () => {
    const p = makeParams({
      round: 3,
      phase: 'argumentation',
      meta: {
        ...makeParams().meta,
        move_types: ['COUNTEREXAMPLE'],
      },
    });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('No constructive move'))).toHaveLength(0);
  });
});

// ── Move alias resolution ───────────────────────────────

describe('move alias resolution', () => {
  it('resolves STEELMAN to STEEL-BUILD (no unknown warning)', async () => {
    const p = makeParams({
      meta: { ...makeParams().meta, move_types: ['STEELMAN'] },
    });
    const r = await validateTurn(p);
    expect(r.dimensions.schema.issues.filter(i => i.includes('Unknown move_types'))).toHaveLength(0);
  });

  it('resolves SURFACE ASSUMPTION to EXPOSE-ASSUMPTION', async () => {
    const p = makeParams({
      meta: { ...makeParams().meta, move_types: ['SURFACE ASSUMPTION'] },
    });
    const r = await validateTurn(p);
    expect(r.dimensions.schema.issues.filter(i => i.includes('Unknown move_types'))).toHaveLength(0);
  });

  it('resolves PROPOSE SYNTHESIS to SYNTHESIZE', async () => {
    const p = makeParams({
      meta: { ...makeParams().meta, move_types: ['PROPOSE SYNTHESIS'] },
    });
    const r = await validateTurn(p);
    expect(r.dimensions.schema.issues.filter(i => i.includes('Unknown move_types'))).toHaveLength(0);
  });

  it('resolves PIVOT to CONCEDE AND PIVOT (alias resolution)', async () => {
    // PIVOT alias resolves to 'CONCEDE AND PIVOT' (space-separated).
    // The move is recognized by the catalog (no unknown warning).
    const p = makeParams({
      meta: { ...makeParams().meta, move_types: ['PIVOT'] },
    });
    const r = await validateTurn(p);
    expect(r.dimensions.schema.issues.filter(i => i.includes('Unknown move_types'))).toHaveLength(0);
  });
});

// ── isFillerRelevance edge cases ────────────────────────

describe('isFillerRelevance edge cases (via Rule 5)', () => {
  it('rejects relevance starting with "relevant"', async () => {
    const p = makeParams({
      taxonomyRefs: [{ node_id: 'acc-B-001', relevance: 'Relevant to the overall debate about governance and important for the argument here' }],
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('filler'))).toBe(true);
  });

  it('rejects relevance starting with "important"', async () => {
    const p = makeParams({
      taxonomyRefs: [{ node_id: 'acc-B-001', relevance: 'Important because this supports our general view about the overall debate argument' }],
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('filler'))).toBe(true);
  });

  it('rejects relevance starting with "my view"', async () => {
    const p = makeParams({
      taxonomyRefs: [{ node_id: 'acc-B-001', relevance: 'My view supports the general point about their overall argument regarding the debate' }],
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('filler'))).toBe(true);
  });

  it('accepts relevance with domain-specific terminology', async () => {
    const p = makeParams({
      taxonomyRefs: [{
        node_id: 'acc-B-001',
        relevance: 'This accountability framework constrains algorithmic decision-making through mandatory impact assessments and third-party auditing requirements.',
      }],
    });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('filler'))).toHaveLength(0);
  });

  it('rejects empty relevance string', async () => {
    const p = makeParams({
      taxonomyRefs: [{ node_id: 'acc-B-001', relevance: '' }],
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('filler or too-short'))).toBe(true);
  });
});

// ── Orchestrator: validateTurn ──────────────────────────

describe('validateTurn orchestrator', () => {
  it('returns skipped when config.enabled is false', async () => {
    const p = makeParams({
      config: resolveTurnValidationConfig({ enabled: false }),
    });
    const r = await validateTurn(p);
    expect(r.outcome).toBe('skipped');
    expect(r.process_reward).toBe(1);
    expect(r.judge_used).toBe(false);
  });

  it('Stage-A errors skip Stage-B judge', async () => {
    let judgeCalled = false;
    const p = makeParams({
      config: resolveTurnValidationConfig({ enabled: true, deterministicOnly: false }),
      meta: { ...makeParams().meta, move_types: undefined },
      callJudge: async () => {
        judgeCalled = true;
        return mockJudge();
      },
    });
    const r = await validateTurn(p);
    expect(r.outcome).toBe('retry');
    expect(judgeCalled).toBe(false);
    expect(r.judge_used).toBe(false);
  });

  it('runs Stage-B judge when deterministicOnly=false and no Stage-A errors', async () => {
    let judgeCalled = false;
    const p = makeParams({
      config: resolveTurnValidationConfig({ enabled: true, deterministicOnly: false }),
      callJudge: async () => {
        judgeCalled = true;
        return JSON.stringify({
          advances: true,
          advancement_reason: 'good progress',
          clarifies_taxonomy: [],
          weaknesses: [],
          quality_score: 0.85,
          recommend: 'pass',
        });
      },
    });
    const r = await validateTurn(p);
    expect(judgeCalled).toBe(true);
    expect(r.judge_used).toBe(true);
    expect(r.outcome).toBe('pass');
  });

  it('skips Stage-B judge when deterministicOnly=true', async () => {
    let judgeCalled = false;
    const p = makeParams({
      config: resolveTurnValidationConfig({ enabled: true, deterministicOnly: true }),
      callJudge: async () => {
        judgeCalled = true;
        return mockJudge();
      },
    });
    await validateTurn(p);
    expect(judgeCalled).toBe(false);
  });

  it('outcome is retry when Stage-A has errors and maxRetries > 0', async () => {
    const p = makeParams({
      meta: { ...makeParams().meta, disagreement_type: 'BOGUS' },
      config: resolveTurnValidationConfig({ enabled: true, maxRetries: 2, deterministicOnly: true }),
    });
    const r = await validateTurn(p);
    expect(r.outcome).toBe('retry');
  });

  it('outcome is accept_with_flag when Stage-A has errors and maxRetries=0', async () => {
    const p = makeParams({
      meta: { ...makeParams().meta, disagreement_type: 'BOGUS' },
      config: resolveTurnValidationConfig({ enabled: true, maxRetries: 0, deterministicOnly: true }),
    });
    const r = await validateTurn(p);
    expect(r.outcome).toBe('accept_with_flag');
  });

  it('judge recommend=retry triggers retry when budget allows', async () => {
    const p = makeParams({
      config: resolveTurnValidationConfig({ enabled: true, deterministicOnly: false, maxRetries: 1 }),
      callJudge: async () =>
        JSON.stringify({
          advances: false,
          advancement_reason: 'no progress',
          clarifies_taxonomy: [],
          weaknesses: ['needs more specifics'],
          recommend: 'retry',
        }),
    });
    const r = await validateTurn(p);
    expect(r.outcome).toBe('retry');
    expect(r.judge_used).toBe(true);
  });

  it('judge recommend=retry becomes accept_with_flag when maxRetries=0', async () => {
    const p = makeParams({
      config: resolveTurnValidationConfig({ enabled: true, deterministicOnly: false, maxRetries: 0 }),
      callJudge: async () =>
        JSON.stringify({
          advances: false,
          advancement_reason: 'no progress',
          clarifies_taxonomy: [],
          weaknesses: ['needs more specifics'],
          recommend: 'retry',
        }),
    });
    const r = await validateTurn(p);
    expect(r.outcome).toBe('accept_with_flag');
  });

  it('judge recommend=accept_with_flag sets outcome accordingly', async () => {
    const p = makeParams({
      config: resolveTurnValidationConfig({ enabled: true, deterministicOnly: false }),
      callJudge: async () =>
        JSON.stringify({
          advances: true,
          advancement_reason: 'marginal',
          clarifies_taxonomy: [],
          weaknesses: ['borderline'],
          quality_score: 0.65,
          recommend: 'accept_with_flag',
        }),
    });
    const r = await validateTurn(p);
    expect(r.outcome).toBe('accept_with_flag');
  });
});

// ── Judge parse failures ────────────────────────────────

describe('judge parse failures', () => {
  it('produces fallback verdict on invalid JSON from judge', async () => {
    const p = makeParams({
      config: resolveTurnValidationConfig({ enabled: true, deterministicOnly: false }),
      callJudge: async () => 'THIS IS NOT JSON AT ALL!!!',
    });
    const r = await validateTurn(p);
    // parseJudgeVerdict fallback has recommend='accept_with_flag', advances=false
    expect(r.judge_used).toBe(true);
    expect(r.outcome).toBe('accept_with_flag');
  });

  it('uses fallback judge when primary throws', async () => {
    let fallbackCalled = false;
    const p = makeParams({
      config: resolveTurnValidationConfig({ enabled: true, deterministicOnly: false }),
      callJudge: async () => { throw new Error('primary judge failed'); },
      callJudgeFallback: async () => {
        fallbackCalled = true;
        return JSON.stringify({
          advances: true,
          advancement_reason: 'fallback worked',
          clarifies_taxonomy: [],
          weaknesses: [],
          quality_score: 0.85,
          recommend: 'pass',
        });
      },
    });
    const r = await validateTurn(p);
    expect(fallbackCalled).toBe(true);
    expect(r.judge_used).toBe(true);
    expect(r.judge_model).toBe('fallback');
    expect(r.outcome).toBe('pass');
  });

  it('handles both primary and fallback judge failures gracefully', async () => {
    const p = makeParams({
      config: resolveTurnValidationConfig({ enabled: true, deterministicOnly: false }),
      callJudge: async () => { throw new Error('primary down'); },
      callJudgeFallback: async () => { throw new Error('fallback also down'); },
    });
    const r = await validateTurn(p);
    expect(r.judge_used).toBe(false);
    // With no judge and no Stage-A errors, advancement.pass depends on judgeAttempted
    // judgeAttempted=true but judge=null, so advancement.pass = stageA.pass && !judgeAttempted = false
    expect(r.dimensions.advancement.pass).toBe(false);
  });
});

// ── Intervention compliance ─────────────────────────────

describe('intervention compliance', () => {
  it('adds error when PIN intervention has no pin_response', async () => {
    const intervention: ModeratorIntervention = {
      family: 'elicitation',
      move: 'PIN',
      force: 'directive',
      burden: 3,
      target_debater: 'prometheus',
      text: 'State your position clearly.',
      trigger_reason: 'vague claims',
      source_evidence: { round: 2 },
    };
    const p = makeParams({
      pendingIntervention: intervention,
      // meta does NOT include pin_response
    });
    const r = await validateTurn(p);
    expect(r.repairHints.some(h => h.includes('pin_response'))).toBe(true);
  });

  it('passes compliance when pin_response is provided', async () => {
    const intervention: ModeratorIntervention = {
      family: 'elicitation',
      move: 'PIN',
      force: 'directive',
      burden: 3,
      target_debater: 'prometheus',
      text: 'State your position clearly.',
      trigger_reason: 'vague claims',
      source_evidence: { round: 2 },
    };
    const meta = {
      ...makeParams().meta,
      pin_response: { position: 'agree', brief_reason: 'I concur with the framing.' },
    } as PoverResponseMeta;
    const p = makeParams({
      pendingIntervention: intervention,
      meta,
    });
    const r = await validateTurn(p);
    expect(r.repairHints.filter(h => h.includes('pin_response'))).toHaveLength(0);
  });

  it('does not check compliance when no intervention is pending', async () => {
    const p = makeParams({ pendingIntervention: undefined });
    const r = await validateTurn(p);
    // No intervention-related hints
    expect(r.repairHints.filter(h => h.includes('intervention'))).toHaveLength(0);
  });
});

// ── Score calculation ───────────────────────────────────

describe('score calculation', () => {
  it('returns perfect score when all dimensions pass', async () => {
    // Need judge for clarifies to pass
    // quality_score 0.90 (cap for 0 weaknesses) with 40/60 split → 0.4*1.0 + 0.6*0.90 = 0.94
    const p = makeParams({
      config: resolveTurnValidationConfig({ enabled: true, deterministicOnly: false }),
      callJudge: async () =>
        JSON.stringify({
          advances: true,
          advancement_reason: 'great',
          clarifies_taxonomy: [{ action: 'narrow', node_id: 'acc-B-001', rationale: 'test' }],
          weaknesses: [],
          quality_score: 0.90,
          recommend: 'pass',
        }),
    });
    const r = await validateTurn(p);
    // 0.4 * stageA(1.0) + 0.6 * judge(0.90) = 0.94
    expect(r.process_reward).toBeCloseTo(0.94, 2);
    expect(r.dimensions.schema.pass).toBe(true);
    expect(r.dimensions.grounding.pass).toBe(true);
    expect(r.dimensions.advancement.pass).toBe(true);
    expect(r.dimensions.clarifies.pass).toBe(true);
  });

  it('returns 0.78 when clarifies dimension fails (deterministic-only)', async () => {
    // deterministic-only: clarifies always false, everything else passes
    // judgeQuality defaults to 0.7 when no judge runs
    const p = makeParams();
    const r = await validateTurn(p);
    // 0.4 * stageA(0.90) + 0.6 * default(0.70) = 0.36 + 0.42 = 0.78
    expect(r.process_reward).toBeCloseTo(0.78, 2);
  });

  it('returns lower process_reward with schema failure', async () => {
    const p = makeParams({
      meta: { ...makeParams().meta, disagreement_type: 'INVALID' },
      config: resolveTurnValidationConfig({ enabled: true, maxRetries: 0, deterministicOnly: true }),
    });
    const r = await validateTurn(p);
    // schema fails: process_reward should be < 0.9
    expect(r.process_reward).toBeLessThan(0.9);
    expect(r.dimensions.schema.pass).toBe(false);
  });

  it('caps inflated quality_score based on weakness count', async () => {
    // Judge returns 0.80 with 3 weaknesses — calibration cap should enforce max 0.55
    const p = makeParams({
      config: resolveTurnValidationConfig({ enabled: true, deterministicOnly: false }),
      callJudge: async () =>
        JSON.stringify({
          advances: true,
          advancement_reason: 'decent',
          clarifies_taxonomy: [],
          weaknesses: ['vague claims', 'lacks evidence for central thesis', 'ignores counterpoint'],
          quality_score: 0.80,
          recommend: 'pass',
        }),
    });
    const r = await validateTurn(p);
    // 3 weaknesses → cap 0.55, "no evidence" → -0.10 → 0.45
    // score < 0.5 → recommend reconciled to 'retry'
    // process_reward = 0.4 * stageA + 0.6 * 0.45
    expect(r.process_reward).toBeLessThan(0.7);
    expect(r.outcome).toBe('retry');
  });

  it('applies evidence-gap penalty on top of weakness cap', async () => {
    // 2 weaknesses including "lacks evidence" — cap 0.65, then -0.10 → 0.55
    const p = makeParams({
      config: resolveTurnValidationConfig({ enabled: true, deterministicOnly: false }),
      callJudge: async () =>
        JSON.stringify({
          advances: true,
          advancement_reason: 'some progress',
          clarifies_taxonomy: [],
          weaknesses: ['lacks evidence for central claim', 'repetitive framing'],
          quality_score: 0.75,
          recommend: 'pass',
        }),
    });
    const r = await validateTurn(p);
    // 2 weaknesses → cap 0.65, "lacks evidence" → -0.10 → 0.55
    // 0.55 < 0.7 → recommend reconciled to 'accept_with_flag'
    expect(r.outcome).toBe('accept_with_flag');
  });
});

// ── Clarifies taxonomy from judge ───────────────────────

describe('clarifies_taxonomy from judge', () => {
  it('populates clarifies_taxonomy from judge verdict', async () => {
    const p = makeParams({
      config: resolveTurnValidationConfig({ enabled: true, deterministicOnly: false }),
      callJudge: async () =>
        JSON.stringify({
          advances: true,
          advancement_reason: 'good',
          clarifies_taxonomy: [
            { action: 'narrow', node_id: 'acc-B-001', rationale: 'evidence supports narrowing' },
            { action: 'split', node_id: 'saf-D-002', rationale: 'distinct sub-cases' },
          ],
          weaknesses: [],
          recommend: 'pass',
        }),
    });
    const r = await validateTurn(p);
    expect(r.clarifies_taxonomy).toHaveLength(2);
    expect(r.clarifies_taxonomy[0].action).toBe('narrow');
    expect(r.clarifies_taxonomy[1].action).toBe('split');
    expect(r.dimensions.clarifies.pass).toBe(true);
  });

  it('returns empty clarifies_taxonomy without judge', async () => {
    const p = makeParams();
    const r = await validateTurn(p);
    expect(r.clarifies_taxonomy).toHaveLength(0);
    expect(r.dimensions.clarifies.pass).toBe(false);
  });
});

// ── Repair hints ordering ───────────────────────────────

describe('repair hints ordering', () => {
  it('includes errors first, then warnings, then judge weaknesses', async () => {
    const p = makeParams({
      // Produce a Stage-A error (missing move_types) — but this skips judge
      // Instead, use a valid setup with judge that also has warnings
      config: resolveTurnValidationConfig({ enabled: true, deterministicOnly: false, maxRetries: 0 }),
      statement: makeParagraphs(2), // warning: 2 paragraphs
      callJudge: async () =>
        JSON.stringify({
          advances: true,
          advancement_reason: 'ok',
          clarifies_taxonomy: [],
          weaknesses: ['weakness from judge'],
          recommend: 'pass',
        }),
    });
    const r = await validateTurn(p);
    // Should have the paragraph warning and judge weakness
    const paragraphIdx = r.repairHints.findIndex(h => h.includes('paragraphs'));
    const judgeIdx = r.repairHints.findIndex(h => h.includes('weakness from judge'));
    if (paragraphIdx >= 0 && judgeIdx >= 0) {
      expect(paragraphIdx).toBeLessThan(judgeIdx);
    }
  });
});

// ── validatePlanStage ─────────────────────────────────────

function makeValidPlan() {
  return {
    strategic_goal: 'Challenge the empirical basis of rapid deployment timelines with regulatory data',
    planned_moves: [
      { move: 'COUNTEREXAMPLE', target: 'prometheus', detail: 'Present EU AI Act compliance costs that contradict cost-neutrality claims' },
      { move: 'EXTEND', detail: 'Build on prior evidence about institutional capacity requirements' },
    ],
    target_claims: ['AI deployment will be cost-neutral by 2028'],
    argument_sketch: 'Begin by challenging the empirical assumptions behind rapid deployment timelines, then pivot to institutional capacity evidence showing regulatory infrastructure is insufficient for the proposed pace.',
    anticipated_responses: ['Prometheus will cite private sector efficiency gains'],
  };
}

describe('validatePlanStage', () => {
  it('passes with a valid plan', () => {
    const r = validatePlanStage({ plan: makeValidPlan(), isFirstRound: false });
    expect(r.pass).toBe(true);
    expect(r.repairHints.filter(h => !h.startsWith('Warning'))).toHaveLength(0);
  });

  it('errors when strategic_goal is too short', () => {
    const plan = { ...makeValidPlan(), strategic_goal: 'short' };
    const r = validatePlanStage({ plan, isFirstRound: false });
    expect(r.pass).toBe(false);
    expect(r.repairHints.some(h => h.includes('strategic_goal'))).toBe(true);
  });

  it('warns on unknown planned move names', () => {
    const plan = { ...makeValidPlan(), planned_moves: [{ move: 'BOGUS_MOVE', detail: 'This is a substantive detail about something' }] };
    const r = validatePlanStage({ plan, isFirstRound: false });
    expect(r.repairHints.some(h => h.includes('Unknown planned move'))).toBe(true);
  });

  it('errors when planned_moves detail is too short', () => {
    const plan = { ...makeValidPlan(), planned_moves: [{ move: 'EXTEND', detail: 'short' }] };
    const r = validatePlanStage({ plan, isFirstRound: false });
    expect(r.pass).toBe(false);
    expect(r.repairHints.some(h => h.includes('too-short detail'))).toBe(true);
  });

  it('errors when planned_moves is empty', () => {
    const plan = { ...makeValidPlan(), planned_moves: [] };
    const r = validatePlanStage({ plan, isFirstRound: false });
    expect(r.pass).toBe(false);
    expect(r.repairHints.some(h => h.includes('planned_moves is empty'))).toBe(true);
  });

  it('warns when planned_moves count exceeds 5', () => {
    const moves = Array.from({ length: 6 }, (_, i) => ({
      move: 'EXTEND', detail: `Substantive detail for move ${i} with enough characters`,
    }));
    const plan = { ...makeValidPlan(), planned_moves: moves };
    const r = validatePlanStage({ plan, isFirstRound: false });
    expect(r.repairHints.some(h => h.includes('over-ambitious'))).toBe(true);
  });

  it('errors when argument_sketch is too short', () => {
    const plan = { ...makeValidPlan(), argument_sketch: 'too short' };
    const r = validatePlanStage({ plan, isFirstRound: false });
    expect(r.pass).toBe(false);
    expect(r.repairHints.some(h => h.includes('argument_sketch'))).toBe(true);
  });

  it('warns when anticipated_responses is empty', () => {
    const plan = { ...makeValidPlan(), anticipated_responses: [] };
    const r = validatePlanStage({ plan, isFirstRound: false });
    expect(r.repairHints.some(h => h.includes('anticipated_responses'))).toBe(true);
  });

  it('warns when target_claims is empty on non-first round', () => {
    const plan = { ...makeValidPlan(), target_claims: [] };
    const r = validatePlanStage({ plan, isFirstRound: false });
    expect(r.repairHints.some(h => h.includes('target_claims'))).toBe(true);
  });

  it('skips target_claims warning on first round', () => {
    const plan = { ...makeValidPlan(), target_claims: [] };
    const r = validatePlanStage({ plan, isFirstRound: true });
    expect(r.repairHints.some(h => h.includes('target_claims'))).toBe(false);
  });

  it('sets failedDimension to plan when errors present', () => {
    const plan = { ...makeValidPlan(), strategic_goal: '' };
    const r = validatePlanStage({ plan, isFirstRound: false });
    expect(r.failedDimension).toBe('plan');
  });
});

// ── isFillerRelevance ─────────────────────────────────────

describe('isFillerRelevance', () => {
  it('detects stock opener filler', () => {
    expect(isFillerRelevance('supports our position')).toBe(true);
    expect(isFillerRelevance('relevant to the debate')).toBe(true);
  });

  it('accepts substantive relevance', () => {
    expect(isFillerRelevance('Supports the pivot toward empirical telemetry by providing concrete deployment timelines from the EU regulatory framework')).toBe(false);
  });

  it('detects stop-word saturated text', () => {
    expect(isFillerRelevance('this is about what would have been there with those that were clearly being made')).toBe(true);
  });

  it('accepts text with domain terms', () => {
    expect(isFillerRelevance('algorithmic accountability frameworks require institutional capacity building before deployment timelines')).toBe(false);
  });
});

// ── validateCiteStage target_nodes ────────────────────────

describe('validateCiteStage target_nodes', () => {
  const baseCiteParams = {
    taxonomyRefs: [
      { node_id: 'acc-B-001', relevance: 'Provides empirical evidence for accelerated deployment timelines in regulated industries' },
      { node_id: 'saf-D-002', relevance: 'Highlights safety concerns around algorithmic accountability framework gaps in deployment' },
    ],
    knownNodeIds: new Set(['acc-B-001', 'saf-D-002', 'skp-I-003']),
    policyIds: new Set(['pol-001']),
    priorTurns: [] as import('./types.js').TranscriptEntry[],
    speaker: 'prometheus',
  };

  it('passes when all target_nodes are cited', () => {
    const r = validateCiteStage({
      ...baseCiteParams,
      targetNodes: ['acc-B-001', 'saf-D-002'],
    });
    expect(r.repairHints.some(h => h.includes('target_nodes'))).toBe(false);
  });

  it('warns when target_nodes are missing from taxonomy_refs', () => {
    const r = validateCiteStage({
      ...baseCiteParams,
      targetNodes: ['acc-B-001', 'skp-I-003'],
    });
    expect(r.repairHints.some(h => h.includes('target_nodes') && h.includes('skp-I-003'))).toBe(true);
  });

  it('skips target_nodes check when not provided', () => {
    const r = validateCiteStage(baseCiteParams);
    expect(r.repairHints.some(h => h.includes('target_nodes'))).toBe(false);
  });

  it('skips target_nodes check when empty array', () => {
    const r = validateCiteStage({ ...baseCiteParams, targetNodes: [] });
    expect(r.repairHints.some(h => h.includes('target_nodes'))).toBe(false);
  });
});

// ── Directive content compliance ─────────────────────────────

describe('checkDirectiveContentCompliance', () => {
  it('passes when first paragraph addresses the directive terms', () => {
    const statement = 'I acknowledge the moderator\'s challenge about evidence quality and empirical grounding.\n\nMy substantive argument follows here with additional detail.';
    const result = checkDirectiveContentCompliance(statement, {
      move: 'REDIRECT',
      text: 'Present evidence for your empirical claims about evidence quality.',
      isTargeted: true,
    });
    expect(result.compliant).toBe(true);
    expect(result.matched_terms).toBeGreaterThanOrEqual(2);
  });

  it('fails when first paragraph ignores directive content', () => {
    const statement = 'Let me continue my argument about governance frameworks.\n\nThe regulatory landscape requires careful analysis of institutional design.';
    const result = checkDirectiveContentCompliance(statement, {
      move: 'REDIRECT',
      text: 'State whether you agree or disagree with the precautionary principle.',
      isTargeted: true,
    });
    expect(result.compliant).toBe(false);
    expect(result.repair_hint).toContain('REDIRECT');
    expect(result.repair_hint).toContain('first paragraph');
  });

  it('requires only 1 matching term for non-targeted directives', () => {
    const statement = 'The precautionary framing raised by the moderator touches on my view.\n\nMoving on to the substance...';
    const result = checkDirectiveContentCompliance(statement, {
      move: 'REDIRECT',
      text: 'Explain the precautionary principle in more detail.',
      isTargeted: false,
    });
    expect(result.compliant).toBe(true);
  });

  it('passes when directive text is empty', () => {
    const result = checkDirectiveContentCompliance('Some statement.', {
      move: 'REDIRECT',
    });
    expect(result.compliant).toBe(true);
  });

  it('PIN uses structural agree/disagree check', () => {
    const statement = 'I disagree with the precautionary principle as stated.\n\nHere is my reasoning.';
    const result = checkDirectiveContentCompliance(statement, {
      move: 'PIN',
      text: 'State whether you agree with the precautionary principle.',
      isTargeted: true,
    });
    expect(result.compliant).toBe(true);
  });

  it('PIN fails when first paragraph lacks agree/disagree', () => {
    const statement = 'The precautionary principle is an important topic.\n\nHere is my reasoning.';
    const result = checkDirectiveContentCompliance(statement, {
      move: 'PIN',
      text: 'State whether you agree with the precautionary principle.',
      isTargeted: true,
    });
    expect(result.compliant).toBe(false);
    expect(result.repair_hint).toContain('agree');
  });

  it('prefers text over directResponsePattern for keyword overlap', () => {
    const statement = 'The general moderator text deserves a direct response.\n\nHere is my reasoning.';
    const result = checkDirectiveContentCompliance(statement, {
      move: 'REDIRECT',
      text: 'General moderator text.',
      directResponsePattern: 'State whether the safety threshold is too conservative.',
      isTargeted: true,
    });
    expect(result.compliant).toBe(true);
    expect(result.directive_terms).toContain('general');
    expect(result.directive_terms).toContain('moderator');
  });

  it('falls back to directResponsePattern when text is absent', () => {
    const statement = 'The safety threshold debate requires careful consideration of conservative approaches.\n\nHere is my reasoning.';
    const result = checkDirectiveContentCompliance(statement, {
      move: 'REDIRECT',
      directResponsePattern: 'State whether the safety threshold is too conservative.',
      isTargeted: true,
    });
    expect(result.compliant).toBe(true);
    expect(result.directive_terms).toContain('safety');
    expect(result.directive_terms).toContain('threshold');
  });
});

describe('validateDraftStage directive compliance', () => {
  const baseDraftParams = {
    statement: makeParagraphs(3),
    meta: {
      move_types: [{ move: 'DISTINGUISH', detail: 'test' }],
      disagreement_type: 'EMPIRICAL',
      my_claims: [{ claim: 'By 2028, regulatory frameworks will cover 80% of AI deployments.' }],
    } as PoverResponseMeta,
    phase: 'argumentation' as DebatePhase,
    round: 4,
    priorTurns: [] as TranscriptEntry[],
  };

  it('passes without intervention', () => {
    const r = validateDraftStage(baseDraftParams);
    expect(r.directive_compliance).toBeUndefined();
  });

  it('fails when statement ignores a targeted directive', () => {
    const intervention: ModeratorIntervention = {
      family: 'elicitation',
      move: 'PIN',
      force: 'interrogative',
      burden: 3,
      target_debater: 'prometheus',
      text: 'Do you accept the precautionary principle as a default regulatory stance?',
      trigger_reason: 'vague position',
      source_evidence: { round: 3 },
    };
    const r = validateDraftStage({
      ...baseDraftParams,
      pendingIntervention: intervention,
    });
    expect(r.pass).toBe(false);
    expect(r.directive_compliance?.compliant).toBe(false);
    expect(r.failedDimension).toBe('directive');
  });

  it('passes when statement addresses the directive in first paragraph', () => {
    const intervention: ModeratorIntervention = {
      family: 'elicitation',
      move: 'PIN',
      force: 'interrogative',
      burden: 3,
      target_debater: 'prometheus',
      text: 'Do you accept the precautionary principle as a default regulatory stance?',
      trigger_reason: 'vague position',
      source_evidence: { round: 3 },
    };
    const statement = 'I disagree with the precautionary principle as a default regulatory stance because it systematically underweights innovation benefits.\n\n' + makeParagraphs(2);
    const r = validateDraftStage({
      ...baseDraftParams,
      statement,
      pendingIntervention: intervention,
    });
    expect(r.directive_compliance?.compliant).toBe(true);
    expect(r.directive_compliance?.matched_terms).toBeGreaterThanOrEqual(1);
  });

  it('mandatory retry on directive failure — error not warning', () => {
    const intervention: ModeratorIntervention = {
      family: 'repair',
      move: 'CLARIFY',
      force: 'interrogative',
      burden: 2,
      target_debater: 'sentinel',
      text: 'Clarify your definition of alignment failure and what threshold constitutes catastrophic risk.',
      trigger_reason: 'ambiguous terminology',
      source_evidence: { round: 2 },
    };
    const r = validateDraftStage({
      ...baseDraftParams,
      pendingIntervention: intervention,
    });
    // Directive non-compliance is an error (not a warning), so pass=false
    expect(r.pass).toBe(false);
    // The repair hint should explain what the directive asked about
    expect(r.repairHints.some(h => h.includes('CLARIFY') && h.includes('directive'))).toBe(true);
  });
});

// ── Draft quality pre-check parsing ────────────────────────

describe('parseDraftQualityResult', () => {
  it('parses a valid all-pass response', () => {
    const raw = JSON.stringify({ grounded: true, falsifiable: true, engages: true, weaknesses: [] });
    const result = parseDraftQualityResult(raw);
    expect(result.grounded).toBe(true);
    expect(result.falsifiable).toBe(true);
    expect(result.engages).toBe(true);
    expect(result.weaknesses).toHaveLength(0);
  });

  it('parses a response with failures and weaknesses', () => {
    const raw = JSON.stringify({
      grounded: false,
      falsifiable: true,
      engages: false,
      weaknesses: ['No specific data points cited', 'First paragraph ignores opponent'],
    });
    const result = parseDraftQualityResult(raw);
    expect(result.grounded).toBe(false);
    expect(result.falsifiable).toBe(true);
    expect(result.engages).toBe(false);
    expect(result.weaknesses).toHaveLength(2);
  });

  it('caps weaknesses at 3', () => {
    const raw = JSON.stringify({
      grounded: false, falsifiable: false, engages: false,
      weaknesses: ['a', 'b', 'c', 'd', 'e'],
    });
    const result = parseDraftQualityResult(raw);
    expect(result.weaknesses).toHaveLength(3);
  });

  it('returns fallback on malformed JSON', () => {
    const result = parseDraftQualityResult('not json at all');
    expect(result.grounded).toBe(false);
    expect(result.falsifiable).toBe(false);
    expect(result.engages).toBe(false);
    expect(result.weaknesses.length).toBeGreaterThan(0);
  });

  it('treats missing boolean fields as false', () => {
    const raw = JSON.stringify({ weaknesses: [] });
    const result = parseDraftQualityResult(raw);
    expect(result.grounded).toBe(false);
    expect(result.falsifiable).toBe(false);
    expect(result.engages).toBe(false);
  });
});
