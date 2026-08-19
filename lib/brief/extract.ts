// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T2 Brief Export — Extract stage (t/2800).
// Deterministic, no model. Maps a closed DebateSession → deck_spec.json IR.
// Validates output against the strict write schema before returning.

import Ajv from 'ajv';
import type { DebateSession } from '../debate/types.js';
import type { SynthesisResult, SynthesisCrux, PreferenceEntry } from '../debate/types/synthesis.js';
import type { ArgumentNetworkNode, CommitmentStore } from '../debate/types/argumentNetwork.js';
import type { TrackedCrux } from '../debate/types/convergence.js';
import { ActionableError } from '../debate/errors.js';
import { normalizeVerdict } from '../debate/types/factVerdict.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';
import type {
  DeckSpec, TextNode, Disagreement, Crux, FactCheck,
  CampConcessions, TopClaim, ConvergenceScore, FactCheckVerdict,
} from './types.js';
import deckSpecWriteSchema from './schemas/deck_spec.write.json' with { type: 'json' };

const LOCATION = 'lib/brief/extract.ts:extractDeckSpec';
const DECK_SPEC_VERSION = '1.0';

// Session fields actively used in extraction
const MAPPED_FIELDS = new Set([
  'id', 'run_id', 'title', 'debate_model', 'stage_models', 'protocol_id', 'phase',
  'topic', 'transcript', 'argument_network', 'commitments', 'convergence_tracker',
  'crux_tracker',
]);

// Session fields explicitly excluded — large/diagnostic, no deck_spec value
const STRIP_LIST = new Set([
  'turn_embeddings', 'frame_embeddings', 'frame_similarity_series',
  'turn_validations', 'convergence_signals', 'process_rewards',
  'diagnostics', 'qbaf_timeline', 'per_claim_drift', 'position_drift',
  // Session bookkeeping not relevant to the IR
  'created_at', 'updated_at', 'app_version', '_saveVersion', 'audience',
  'moderator_mode', 'talmudic_references', 'source_type', 'source_ref',
  'source_content', 'active_povers', 'opening_order', 'user_is_pover',
  'context_summaries', 'generated_with_prompt_version', 'evaluator_model',
  'speaker_models', 'model_tier', 'exclude_greatest_hits', 'config',
  'debate_temperature', 'adaptive_staging', 'adaptive_staging_diagnostics',
  'unanswered_claims_ledger', 'missing_arguments', 'taxonomy_suggestions',
  'dialectic_traces', 'extraction_summary', 'claim_coverage',
  'neutral_speaker_mapping', 'evaluator_model_id', 'neutral_evaluations',
  'document_analysis', 'qbaf_runs_total', 'qbaf_runs_oscillated',
  'max_qbaf_damping_level', 'last_qbaf_result', 'cross_cutting_proposals',
  'taxonomy_gap_analysis', 'situation_debate_refs', 'context_rot',
  'metadata', 'moderator_state', 'interrupted_turn', 'diversity_round_fired',
  'situation_score_map', 'promotion_candidates', 'reflection_proposals',
  'gap_injections', 'origin', 'perturbation_result', 'lookahead_filter_weak',
  'topic_structure', 'exploration_summary', 'exploration_source_id',
  'doc_meta', 'position_drift', 'per_claim_drift', 'run_id',
]);

const KNOWN_FIELDS = new Set([...MAPPED_FIELDS, ...STRIP_LIST]);

/**
 * Extract a `deck_spec.json` IR from a closed debate session.
 * All 14 sections are deterministically derived — no model calls.
 * Validates output against the strict write schema; throws ActionableError on failure.
 */
export function extractDeckSpec(session: DebateSession): DeckSpec {
  if (session.phase !== 'closed') {
    throw new ActionableError({
      goal: 'Extract deck_spec from debate session',
      problem: `Session phase is '${session.phase}' — must be 'closed'`,
      location: LOCATION,
      nextSteps: ['Close the debate before exporting (run the synthesis phase first).'],
    });
  }

  const concludingEntry = session.transcript.find(e => e.type === 'concluding');
  if (!concludingEntry) {
    throw new ActionableError({
      goal: 'Extract deck_spec from debate session',
      problem: 'No concluding transcript entry found',
      location: LOCATION,
      nextSteps: ['Run the synthesis pipeline on the session before calling extractDeckSpec.'],
    });
  }

  const synthesis = (concludingEntry.metadata?.['synthesis'] ?? {}) as Partial<SynthesisResult>;
  const recorder = getGlobalRecorder();

  // Warn on unmapped non-strip fields (silent-degradation guard, t/2800#1)
  for (const key of Object.keys(session)) {
    if (!KNOWN_FIELDS.has(key)) {
      recorder?.record({
        type: 'system.error' as const,
        component: 'brief-extract',
        level: 'warn' as const,
        message: `Unmapped debate-JSON field will not appear in deck_spec: ${key}`,
        data: { field: key },
      });
    }
  }

  const spec: DeckSpec = {
    deck_spec_version: DECK_SPEC_VERSION,
    meta: buildMeta(session),
    question: buildQuestion(session),
    framing_critique: buildFramingCritique(session),
    agreements: buildAgreements(synthesis),
    disagreements: buildDisagreements(synthesis),
    cruxes: buildCruxes(synthesis),
    resolution_analysis: buildResolutionAnalysis(synthesis),
    unresolved_questions: buildUnresolvedQuestions(synthesis),
    argument_map: buildArgumentMap(synthesis),
    fact_checks: buildFactChecks(session),
    concessions: buildConcessions(session),
    top_claims: buildTopClaims(session),
    convergence: buildConvergence(session),
    open_threads: buildOpenThreads(session),
  };

  validateDeckSpec(spec);
  return spec;
}

// ── Section builders ──────────────────────────────────────────────────────────

function buildMeta(session: DebateSession): DeckSpec['meta'] {
  return {
    id: session.id,
    run_id: session.run_id ?? session.id,
    title: session.title,
    model: session.debate_model ?? (session.stage_models?.['draft'] as string | undefined) ?? 'unknown',
    protocol: session.protocol_id ?? 'structured',
    phase: 'closed',
  };
}

function buildQuestion(session: DebateSession): DeckSpec['question'] {
  const scope = session.topic.scope;
  return {
    core_proposition: session.topic.final,
    tensions: scope?.key_tensions?.length ? scope.key_tensions : undefined,
    qualifiers: scope?.explicit_qualifiers?.length ? scope.explicit_qualifiers : undefined,
    exclusions: scope?.excluded_scenarios?.length ? scope.excluded_scenarios : undefined,
    time_horizon: scope?.time_horizon ?? undefined,
  };
}

function buildFramingCritique(session: DebateSession): DeckSpec['framing_critique'] {
  const raw = session.topic.critique as Record<string, unknown> | undefined;
  if (!raw) {
    return { rating: 'unavailable', composite: 0 };
  }
  const score = raw['composite_score'] ?? raw['composite'] ?? 0;
  const rating = String(raw['rating'] ?? 'unrated');
  const rewritten = raw['reframing_suggestion'] ?? raw['rewritten_motion'];
  return {
    rating,
    composite: Number(score),
    rewritten_motion: typeof rewritten === 'string' && rewritten ? rewritten : undefined,
  };
}

function buildAgreements(synthesis: Partial<SynthesisResult>): TextNode[] {
  return (synthesis.areas_of_agreement ?? []).map(a => ({ text: a.point }));
}

function buildDisagreements(synthesis: Partial<SynthesisResult>): Disagreement[] {
  return (synthesis.areas_of_disagreement ?? []).map(d => {
    const bdi = (d as Record<string, unknown>)['bdi_layer'] as string | undefined;
    const kind = bdi === 'belief' ? 'EMPIRICAL' : 'VALUES';
    const resolvability = (d as Record<string, unknown>)['resolvability'] as string | undefined;
    return {
      text: d.point,
      kind,
      resolution_path: resolvability?.replace(/_/g, ' ') ?? '',
      source_ref: undefined,
    };
  });
}

function buildCruxes(synthesis: Partial<SynthesisResult>): Crux[] {
  return (synthesis.cruxes ?? []).map((c: SynthesisCrux) => ({
    text: c.question,
    kind: c.type === 'EMPIRICAL' ? 'EMPIRICAL' : 'VALUES',
    if_yes: c.if_yes ?? '',
    if_no: c.if_no ?? '',
  }));
}

function buildResolutionAnalysis(synthesis: Partial<SynthesisResult>): DeckSpec['resolution_analysis'] {
  const prefs = (synthesis.preferences ?? []) as PreferenceEntry[];
  const stronger_camp_findings = prefs
    .filter(p => p.prevails !== 'undecidable')
    .map(p => ({ camp: p.prevails, finding: `${p.criterion}: ${p.rationale}` }));
  const would_change_if = prefs
    .filter(p => p.what_would_change_this)
    .map(p => ({ camp: p.prevails, falsifier: p.what_would_change_this! }));
  return { stronger_camp_findings, would_change_if: would_change_if.length ? would_change_if : undefined };
}

function buildUnresolvedQuestions(synthesis: Partial<SynthesisResult>): TextNode[] {
  return (synthesis.unresolved_questions ?? []).map(q => ({ text: q }));
}

function buildArgumentMap(synthesis: Partial<SynthesisResult>): DeckSpec['argument_map'] {
  const claims = synthesis.argument_map ?? [];
  const nodes = claims.map(c => ({
    id: c.claim_id,
    camp: String(c.claimant),
    label: c.claim,
  }));

  const relations: DeckSpec['argument_map']['relations'] = [];
  for (const c of claims) {
    for (const sup of c.supported_by ?? []) {
      const fromId = typeof sup === 'string' ? sup : sup.claim_id;
      relations.push({ from: fromId, to: c.claim_id, type: 'supports' });
    }
    for (const atk of c.attacked_by ?? []) {
      relations.push({ from: atk.claim_id, to: c.claim_id, type: 'attacks' });
    }
  }
  return { nodes, relations };
}

function mapVerdict(raw: string | undefined): FactCheckVerdict {
  const v = normalizeVerdict(raw ?? 'unverifiable');
  switch (v) {
    case 'supported':
    case 'partially_accurate': return 'Supported';
    case 'disputed':
    case 'false': return 'Disputed';
    default: return 'Unverifiable';
  }
}

function buildFactChecks(session: DebateSession): FactCheck[] {
  const nodes = (session.argument_network?.nodes ?? []) as ArgumentNetworkNode[];
  return nodes
    .filter(n => n.scoring_method === 'fact_check')
    .map(n => {
      const node = n as ArgumentNetworkNode & {
        verification_status?: string;
        verification_evidence?: string;
      };
      return {
        claim: node.text,
        verdict: mapVerdict(node.verification_status),
        sources: node.verification_evidence ? [node.verification_evidence] : undefined,
        explanation: node.verification_evidence ?? undefined,
        speaker: String(node.speaker),
      };
    });
}

function buildConcessions(session: DebateSession): CampConcessions[] {
  const commitments = (session.commitments ?? {}) as Record<string, CommitmentStore>;
  return Object.entries(commitments).map(([camp, store]) => ({
    camp,
    asserted: store.asserted.length,
    conceded: store.conceded.length,
    challenged: store.challenged.length,
  }));
}

function buildTopClaims(session: DebateSession): TopClaim[] {
  const nodes = (session.argument_network?.nodes ?? []) as ArgumentNetworkNode[];
  return nodes
    .filter(n =>
      n.computed_strength !== undefined &&
      n.computed_strength !== null &&
      n.speaker !== 'system'   // spec: camp claims only
    )
    .sort((a, b) => (b.computed_strength ?? 0) - (a.computed_strength ?? 0))
    .map(n => ({
      camp: String(n.speaker),
      claim: n.text,
      strength: n.computed_strength!,
    }));
}

function buildConvergence(session: DebateSession): ConvergenceScore[] {
  const tracker = session.convergence_tracker as {
    issues?: { taxonomy_ref?: string | null; convergence?: number; qbaf_strength?: number }[];
  } | undefined;
  return (tracker?.issues ?? []).map(i => ({
    issue: i.taxonomy_ref ?? '',
    score: i.qbaf_strength ?? i.convergence ?? 0,
  }));
}

function buildOpenThreads(session: DebateSession): TextNode[] {
  const recorder = getGlobalRecorder();
  if (!session.crux_tracker) {
    recorder?.record({
      type: 'system.error' as const,
      component: 'brief-extract',
      level: 'warn' as const,
      // Approximation: open_threads derived from unresolved cruxes (no dedicated session field — t/2800)
      message: 'crux_tracker absent; open_threads will be empty',
      data: {},
    });
    return [];
  }
  // Approximation: unresolved crux entries (t/2800 design choice, TL-approved t/2800#4)
  return (session.crux_tracker as TrackedCrux[])
    .filter(c => c.state !== 'resolved')
    .map(c => ({ text: c.description ?? '' }))
    .filter(t => t.text);
}

// ── AJV validation against the strict write schema (additionalProperties:false) ──

const _ajv = new Ajv({ allErrors: true, strict: false });
const _validateSchema = _ajv.compile(deckSpecWriteSchema);

/** Validate a DeckSpec against the strict write schema. Throws ActionableError on failure. */
export function validateDeckSpec(spec: DeckSpec): void {
  const valid = _validateSchema(spec);
  if (!valid) {
    const errors = _validateSchema.errors ?? [];
    const first = errors[0];
    const firstMsg = first
      ? `${first.instancePath || '(root)'} ${first.message ?? 'failed'}`
      : 'unknown error';
    throw new ActionableError({
      goal: 'Produce valid deck_spec.json',
      problem: `AJV schema validation failed (${errors.length} error${errors.length > 1 ? 's' : ''}): ${firstMsg}`,
      location: LOCATION,
      nextSteps: [
        ...errors.slice(0, 5).map(e => `${e.instancePath || '(root)'}: ${e.message ?? 'failed'}`),
        'Check the field mapping in lib/brief/extract.ts against deck_spec.write.json.',
      ],
    });
  }
}
