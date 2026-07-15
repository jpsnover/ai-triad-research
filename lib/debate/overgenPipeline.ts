// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Over-generate / select / rewrite pipeline (t/1581, design t/1290).
 *
 * 5-stage pipeline that replaces the single draft call when the
 * experiment_overgen_select_rewrite flag is enabled:
 *
 * 1. Over-generation — N=3 parallel draft calls
 * 2. Claim pool dedup — embedding cosine similarity ≥ 0.82
 * 3. Greedy top-K selection — marginal Δu via selectGreedyClaims
 * 4. Rewrite — draftFromSelectedClaimsPrompt with selected claims
 * 5. Coherence gate — ≥3/4 selected claims preserved at cosine ≥ 0.80
 */

import type {
  SpeakerId,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  TrackedCrux,
  DraftWorkProduct,
  DebateAudience,
  TopicScope,
} from './types.js';
import type { LookaheadGateInput, PerClaimResult } from './lookaheadGate.js';
import { evaluateLookaheadPerClaim, selectGreedyClaims } from './lookaheadGate.js';
import { draftFromSelectedClaimsPrompt } from './prompts.js';
import type { RewriteFromClaimsInput } from './prompts.js';
import { cosineSimilarity } from '../embeddings/similarity.js';
import { parseJsonRobust } from './helpers.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';

// ── Types ────────────────────────────────────────────────

export interface OvergenPipelineInput {
  speaker: SpeakerId;
  existingNodes: readonly ArgumentNetworkNode[];
  existingEdges: readonly ArgumentNetworkEdge[];
  cruxes?: readonly TrackedCrux[];
  label: string;
  pov: string;
  topic: string;
  recentTranscript: string;
  audience?: DebateAudience;
  currentCruxContext?: string;
  topicScope?: TopicScope;
}

export interface OvergenPipelineOptions {
  N?: number;
  K?: number;
  dedupThreshold?: number;
  coherenceThreshold?: number;
  coherenceMinClaims?: number;
}

export interface OvergenDiagnostics {
  drafts_generated: number;
  claims_pooled: number;
  claims_after_dedup: number;
  claims_selected: number;
  claims_preserved: number;
  coherence_gate_pass: boolean;
  coherence_attempts: number;
  elapsed_ms: number;
}

export interface OvergenPipelineResult {
  draft: DraftWorkProduct;
  diagnostics: OvergenDiagnostics;
  coherence_gate_miss: boolean;
}

interface PooledClaim {
  text: string;
  targets: string[];
  base_strength: number;
  source_draft: number;
  embedding?: number[];
}

// ── Constants ────────────────────────────────────────────

const DEFAULT_N = 3;
const DEFAULT_K = 4;
const DEFAULT_DEDUP_THRESHOLD = 0.82;
const DEFAULT_COHERENCE_THRESHOLD = 0.80;
const DEFAULT_COHERENCE_MIN_CLAIMS = 3;
const DEFAULT_BASE_STRENGTH = 0.5;
const MAX_COHERENCE_ATTEMPTS = 2;

// ── Pipeline ─────────────────────────────────────────────

export async function runOvergenPipeline(
  draftFn: () => Promise<DraftWorkProduct>,
  rewriteGenerateFn: (prompt: string) => Promise<string>,
  embedFn: (text: string) => Promise<number[]>,
  input: OvergenPipelineInput,
  options?: OvergenPipelineOptions,
): Promise<OvergenPipelineResult> {
  const N = options?.N ?? DEFAULT_N;
  const K = options?.K ?? DEFAULT_K;
  const dedupThreshold = options?.dedupThreshold ?? DEFAULT_DEDUP_THRESHOLD;
  const coherenceThreshold = options?.coherenceThreshold ?? DEFAULT_COHERENCE_THRESHOLD;
  const coherenceMinClaims = options?.coherenceMinClaims ?? DEFAULT_COHERENCE_MIN_CLAIMS;

  const t0 = Date.now();

  // ── Stage 1: Over-generation ───────────────────────────
  const draftPromises = Array.from({ length: N }, () => draftFn());
  const drafts = await Promise.allSettled(draftPromises);

  const successfulDrafts: DraftWorkProduct[] = [];
  for (const result of drafts) {
    if (result.status === 'fulfilled' && result.value?.claim_sketches?.length > 0) {
      successfulDrafts.push(result.value);
    }
  }

  if (successfulDrafts.length === 0) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'overgen-pipeline', level: 'warn',
      message: `All ${N} over-gen drafts failed — falling back to first draft`,
    });
    const fallback = drafts.find(d => d.status === 'fulfilled')?.value as DraftWorkProduct | undefined;
    if (!fallback) throw drafts.find(d => d.status === 'rejected')!.reason;
    return {
      draft: fallback,
      diagnostics: {
        drafts_generated: 0, claims_pooled: 0, claims_after_dedup: 0,
        claims_selected: 0, claims_preserved: 0, coherence_gate_pass: false,
        coherence_attempts: 0, elapsed_ms: Date.now() - t0,
      },
      coherence_gate_miss: false,
    };
  }

  // ── Stage 2: Claim pool dedup ──────────────────────────
  const pool: PooledClaim[] = [];
  for (let d = 0; d < successfulDrafts.length; d++) {
    for (const cs of successfulDrafts[d].claim_sketches) {
      pool.push({
        text: typeof cs === 'string' ? cs : cs.claim,
        targets: (cs as { targets?: string[] }).targets ?? [],
        base_strength: DEFAULT_BASE_STRENGTH,
        source_draft: d,
      });
    }
  }

  const claimsPooled = pool.length;

  const embeddings = await Promise.all(pool.map(c => embedFn(c.text)));
  for (let i = 0; i < pool.length; i++) {
    pool[i].embedding = embeddings[i];
  }

  const dedupedPool = deduplicateClaims(pool, dedupThreshold);

  // ── Stage 3: Greedy top-K selection ────────────────────
  const tentativeEdges = buildEdgesFromTargets(
    dedupedPool, input.existingNodes, input.speaker,
  );

  const lookaheadInput: LookaheadGateInput = {
    speaker: input.speaker,
    existingNodes: input.existingNodes,
    existingEdges: input.existingEdges,
    tentativeClaims: dedupedPool.map(c => ({
      text: c.text,
      base_strength: c.base_strength,
    })),
    tentativeEdges,
    cruxes: input.cruxes,
  };

  const { perClaim } = evaluateLookaheadPerClaim(lookaheadInput);
  const { selected, avoided } = selectGreedyClaims(perClaim, lookaheadInput, K);

  const preserved = selected.filter(c => c.classification === 'PRESERVE');

  // ── Stage 4: Rewrite ───────────────────────────────────
  const rewriteInput: RewriteFromClaimsInput = {
    label: input.label,
    pov: input.pov,
    topic: input.topic,
    recentTranscript: input.recentTranscript,
    selectedClaims: selected.map(c => ({
      text: c.text,
      classification: c.classification as 'STRONG' | 'PRESERVE',
      dominant_component: c.dominant_component,
      reason: generateClaimReason(c),
    })),
    avoidClaims: avoided.map(c => ({
      text: c.text,
      reason: generateClaimReason(c),
    })),
    audience: input.audience,
    currentCruxContext: input.currentCruxContext,
    topicScope: input.topicScope,
  };

  const rewritePrompt = draftFromSelectedClaimsPrompt(rewriteInput);

  // ── Stage 5: Coherence gate ────────────────────────────
  let coherencePass = false;
  let finalDraft: DraftWorkProduct | undefined;
  let coherenceAttempts = 0;

  for (let attempt = 0; attempt < MAX_COHERENCE_ATTEMPTS; attempt++) {
    coherenceAttempts++;
    const promptToUse = attempt === 0
      ? rewritePrompt
      : rewritePrompt + '\n\nCRITICAL: Your prior rewrite dropped selected claims. Every claim marked [STRONG] or [PRESERVE] MUST appear in your response. Re-read the selected claims and ensure each one is present.';

    const rawRewrite = await rewriteGenerateFn(promptToUse);
    const parsed = parseRewriteDraft(rawRewrite);
    if (!parsed) continue;

    finalDraft = parsed;

    const rewriteClaimTexts = parsed.claim_sketches?.map(
      cs => typeof cs === 'string' ? cs : cs.claim,
    ) ?? [];

    if (rewriteClaimTexts.length === 0) continue;

    const rewriteEmbeddings = await Promise.all(
      rewriteClaimTexts.map(t => embedFn(t)),
    );
    const selectedEmbeddings = await Promise.all(
      selected.map(c => embedFn(c.text)),
    );

    let matchCount = 0;
    for (const selEmb of selectedEmbeddings) {
      const maxSim = Math.max(
        ...rewriteEmbeddings.map(re => cosineSimilarity(selEmb, re)),
      );
      if (maxSim >= coherenceThreshold) matchCount++;
    }

    if (matchCount >= Math.min(coherenceMinClaims, selected.length)) {
      coherencePass = true;
      break;
    }

    getGlobalRecorder()?.record({
      type: 'debate.quality', component: 'overgen-pipeline', level: 'info',
      message: `Coherence gate attempt ${attempt + 1}: ${matchCount}/${selected.length} claims matched (need ${coherenceMinClaims})`,
    });
  }

  if (!finalDraft) {
    finalDraft = successfulDrafts[0];
  }

  const coherenceGateMiss = !coherencePass && coherenceAttempts > 0;

  if (coherenceGateMiss) {
    getGlobalRecorder()?.record({
      type: 'debate.quality', component: 'overgen-pipeline', level: 'warn',
      message: `Coherence gate miss after ${coherenceAttempts} attempts — committing first rewrite`,
    });
  }

  return {
    draft: finalDraft,
    diagnostics: {
      drafts_generated: successfulDrafts.length,
      claims_pooled: claimsPooled,
      claims_after_dedup: dedupedPool.length,
      claims_selected: selected.length,
      claims_preserved: preserved.length,
      coherence_gate_pass: coherencePass,
      coherence_attempts: coherenceAttempts,
      elapsed_ms: Date.now() - t0,
    },
    coherence_gate_miss: coherenceGateMiss,
  };
}

// ── Dedup ─────────────────────────────────────────────────

function deduplicateClaims(
  pool: PooledClaim[],
  threshold: number,
): PooledClaim[] {
  if (pool.length <= 1) return pool;

  const merged = new Array<boolean>(pool.length).fill(false);
  const representatives: PooledClaim[] = [];

  for (let i = 0; i < pool.length; i++) {
    if (merged[i]) continue;

    let best = pool[i];
    for (let j = i + 1; j < pool.length; j++) {
      if (merged[j]) continue;
      if (!pool[i].embedding || !pool[j].embedding) continue;

      const sim = cosineSimilarity(pool[i].embedding!, pool[j].embedding!);
      if (sim >= threshold) {
        merged[j] = true;
        if (pool[j].base_strength > best.base_strength) {
          best = pool[j];
        }
      }
    }

    representatives.push(best);
  }

  return representatives;
}

// ── Edge inference ───────────────────────────────────────

function buildEdgesFromTargets(
  claims: PooledClaim[],
  existingNodes: readonly ArgumentNetworkNode[],
  speaker: SpeakerId,
): ArgumentNetworkEdge[] {
  const nodeMap = new Map(existingNodes.map(n => [n.id, n]));
  const edges: ArgumentNetworkEdge[] = [];

  const startId = existingNodes.length > 0
    ? Math.max(...existingNodes.map(n => {
        const match = n.id.match(/^AN-(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      })) + 1
    : 1;

  for (let i = 0; i < claims.length; i++) {
    const claimId = `AN-${startId + i}`;
    for (const targetId of claims[i].targets) {
      const targetNode = nodeMap.get(targetId);
      if (!targetNode) continue;

      const edgeType = targetNode.speaker === speaker ? 'supports' : 'attacks';
      edges.push({
        id: `${claimId}-${edgeType}-${targetId}`,
        source: claimId,
        target: targetId,
        type: edgeType,
        weight: 0.5,
      } as ArgumentNetworkEdge);
    }
  }

  return edges;
}

// ── Helpers ──────────────────────────────────────────────

function parseRewriteDraft(raw: string): DraftWorkProduct | null {
  try {
    const parsed = parseJsonRobust(raw) as Record<string, unknown>;
    if (typeof parsed?.statement !== 'string') return null;
    return {
      statement: parsed.statement as string,
      turn_symbols: Array.isArray(parsed.turn_symbols) ? parsed.turn_symbols : [],
      claim_sketches: Array.isArray(parsed.claim_sketches) ? parsed.claim_sketches : [],
      key_assumptions: Array.isArray(parsed.key_assumptions) ? parsed.key_assumptions : [],
      disagreement_type: (parsed.disagreement_type as string) ?? '',
      position_update: parsed.position_update as string | undefined,
      commitment: parsed.commitment as Record<string, unknown> | undefined,
    };
  } catch {
    return null;
  }
}

function generateClaimReason(claim: PerClaimResult): string {
  if (claim.classification === 'PRESERVE') {
    return 'Concession claim — preserves intellectual honesty.';
  }
  if (claim.classification === 'STRONG') {
    const delta = (claim.marginal_delta * 100).toFixed(1);
    return `Positive marginal utility (Δu +${delta}%) via ${claim.dominant_component}.`;
  }
  const delta = (claim.marginal_delta * 100).toFixed(1);
  return `Negative marginal utility (Δu ${delta}%) — weakens ${claim.dominant_component}.`;
}
