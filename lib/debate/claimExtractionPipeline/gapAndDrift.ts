// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import path from 'path';
import { fileURLToPath } from 'url';
import type { ExtendedAIAdapter } from '../aiAdapter.js';
import type {
  SpeakerId,
  ArgumentNetworkNode,
  GapArgument,
  GapInjection,
  CrossCuttingProposal,
} from '../types.js';
import { POVER_INFO, POV_KEYS } from '../types.js';
import type { PovKey } from '../types.js';
import type { UnengagedNode } from '../gapCheck.js';

import { parseJsonRobust, formatRecentTranscript } from '../helpers.js';
import { cosineSimilarity, scoreNodesLexical } from '../taxonomyRelevance.js';
import { factCheckToBaseStrength } from '../argumentNetwork.js';
import { generateId, nowISO } from '../helpers.js';
import { midDebateGapPrompt, crossCuttingNodePrompt } from '../prompts.js';
import {
  findUnengagedHighRelevanceNodes,
  shouldRunGapCheck,
  collectEngagedNodeIds,
  GAP_CHECK_INTERVAL,
  MAX_GAP_INJECTIONS,
} from '../gapCheck.js';
import { computeTaxonomyGapAnalysis } from '../taxonomyGapAnalysis.js';
import { extractSituationDebateRefs } from '../situationRefs.js';
import type { SituationDebateRef } from '../situationRefs.js';
import { readCalibrationLog } from '../calibrationLogger.js';
import { optimizeRelevanceThreshold, applyRelevanceThresholdAdaptation } from '../calibrationOptimizer.js';
import { loadProvisionalWeights } from '../phaseTransitions.js';
import { resolveRepoRoot, resolveSourcesDir } from '../taxonomyLoader.js';
import { getGlobalRecorder } from '../../flight-recorder/index.js';
import { detectSycophancy, runEvidenceQbaf } from './helpers.js';
import type { ClaimExtractionContext } from './context.js';

// ── Mid-debate gap injection ("fourth voice") ──────────────

/**
 * Mid-debate pass: a fresh LLM with no persona surfaces 1-2 strong arguments
 * that no debater made — cross-cutting positions, compromises, blind spots.
 * Non-blocking — failure never aborts the debate.
 *
 * Returns true if a gap injection was appended (caller increments the counter).
 */
export async function runGapInjection(
  ctx: ClaimExtractionContext,
  round: number,
  trigger: 'scheduled' | 'responsive',
  focusNodes?: UnengagedNode[],
): Promise<boolean> {
  try {
    const label = trigger === 'responsive' ? 'Responsive gap check' : 'Analyzing debate gaps';
    ctx.progress('gap-injection', undefined, label);

    const transcriptText = formatRecentTranscript(ctx.session.transcript, 20, ctx.session.context_summaries);

    const summaryLines: string[] = [];
    for (const povKey of POV_KEYS) {
      const povData = ctx.taxonomy[povKey];
      if (!povData?.nodes) continue;
      for (const node of povData.nodes) {
        const cat = node.category ?? 'unknown';
        summaryLines.push(`[${node.id}] ${node.label} (${cat}) — ${povKey}`);
      }
    }
    const taxSummary = summaryLines.slice(0, 80).join('\n');

    const anTexts = (ctx.session.argument_network?.nodes || []).map(n => n.text);
    const focusForPrompt = focusNodes?.slice(0, 5);
    const gapPrompt = midDebateGapPrompt(ctx.session.topic.final, transcriptText, taxSummary, anTexts, focusForPrompt);

    const gapResult = await ctx.adapter.generateText(gapPrompt, ctx.config.model, {
      temperature: 0.5,
    });
    ctx.incrementApiCallCount();

    const parsed = parseJsonRobust(gapResult) as { gap_arguments?: GapArgument[] };
    const gapArgs: GapArgument[] = parsed?.gap_arguments ?? [];

    if (gapArgs.length > 0) {
      const headerLabel = trigger === 'responsive' ? 'Responsive Gap Analysis' : 'Mid-Debate Gap Analysis';
      const gapContent = gapArgs.map((g: GapArgument, i: number) =>
        `**Gap ${i + 1} (${g.gap_type}):** ${g.argument}\n*Why missing:* ${g.why_missing}`,
      ).join('\n\n');

      const entry = ctx.addEntry({
        type: 'system',
        speaker: 'system',
        content: `## ${headerLabel}\n\n${gapContent}`,
        taxonomy_refs: [],
      });

      ctx.recordDiagnostic(entry.id, {
        prompt: gapPrompt,
        raw_response: gapResult,
        model: ctx.config.model,
      });

      const injection: GapInjection = {
        round,
        arguments: gapArgs,
        transcript_entry_id: entry.id,
        responses: [],
        trigger,
        focus_nodes: focusNodes?.map(n => n.id),
      };

      if (!ctx.session.gap_injections) {
        ctx.session.gap_injections = [injection];
      } else {
        ctx.session.gap_injections.push(injection);
      }

      return true;
    }
    return false;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: ctx.session?.id, message: 'Mid-debate gap injection failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    ctx.warn('Mid-debate gap injection', err, 'Non-critical — debate continues without gap analysis');
    return false;
  }
}

/**
 * Deterministic responsive gap check — finds high-relevance taxonomy nodes
 * that no debater has engaged. Returns the unengaged nodes (caller triggers
 * the LLM gap injection). Returns an empty array when the check is skipped or
 * nothing unengaged is found.
 */
export function computeResponsiveGap(
  ctx: ClaimExtractionContext,
  round: number,
  initialGapRound: number,
  gapInjectionCount: number,
): UnengagedNode[] {
  const maxInjections = ctx.config.maxGapInjections ?? MAX_GAP_INJECTIONS;
  const checkInterval = ctx.config.gapCheckInterval ?? GAP_CHECK_INTERVAL;

  if (!shouldRunGapCheck(round, initialGapRound, gapInjectionCount, maxInjections, checkInterval)) {
    return [];
  }

  const anNodes = ctx.session.argument_network?.nodes ?? [];
  const engagedIds = collectEngagedNodeIds(anNodes as unknown as ReadonlyArray<{ taxonomy_refs: ReadonlyArray<{ node_id: string }> }>, ctx.session.transcript);

  const allTaxNodes: Array<{ id: string; label: string; description: string }> = [];
  for (const povKey of POV_KEYS) {
    const povData = ctx.taxonomy[povKey];
    if (!povData?.nodes) continue;
    for (const node of povData.nodes) {
      allTaxNodes.push({ id: node.id, label: node.label, description: node.description });
    }
  }

  const recentText = formatRecentTranscript(ctx.session.transcript, 8, ctx.session.context_summaries);
  const query = `${ctx.session.topic.final}\n\n${recentText}`.slice(0, 500);
  const scores = scoreNodesLexical(query, allTaxNodes, []);

  return findUnengagedHighRelevanceNodes(allTaxNodes, engagedIds, scores);
}

// ── Cross-cutting node promotion (post-synthesis) ──────────

/**
 * Post-synthesis pass: when synthesis identifies areas of agreement across
 * all three POVs, propose new situation nodes or map to existing ones.
 * Non-blocking — failure never blocks debate results.
 */
export async function runCrossCuttingProposalPass(ctx: ClaimExtractionContext): Promise<void> {
  try {
    const synthEntry = ctx.session.transcript.find(e => e.type === 'concluding');
    const concludingData = synthEntry?.metadata?.synthesis as Record<string, unknown> | undefined;
    if (!concludingData) return;

    const agreements = ((concludingData.areas_of_agreement ?? []) as { point: string; povers: string[] }[])
      .filter(a => (a.povers?.length ?? 0) >= 3);

    if (agreements.length === 0) return;

    ctx.progress('cross-cutting', undefined, 'Analyzing cross-cutting proposals');

    const sitLabels = (ctx.taxonomy.situations?.nodes || []).map(n => n.label);
    const ccPrompt = crossCuttingNodePrompt(agreements, sitLabels, ctx.session.topic.final);

    const ccResult = await ctx.adapter.generateText(ccPrompt, ctx.config.model, {
      temperature: 0.3,
    });
    ctx.incrementApiCallCount();

    const ccParsed = parseJsonRobust(ccResult) as { proposals?: CrossCuttingProposal[] };
    ctx.session.cross_cutting_proposals = ccParsed?.proposals ?? [];
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: ctx.session?.id, message: 'Cross-cutting proposal pass failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    ctx.warn('Cross-cutting proposal pass', err, 'Non-critical — debate results unaffected');
  }
}

// ── Taxonomy gap analysis (post-synthesis, deterministic) ──

/**
 * Post-synthesis pass: compute deterministic taxonomy coverage analysis.
 * Identifies per-POV coverage, BDI balance, unmapped arguments, and cross-POV gaps.
 * No LLM calls — purely deterministic computation.
 * Non-blocking — failure never blocks debate results.
 */
export function runTaxonomyGapAnalysisPass(ctx: ClaimExtractionContext): void {
  try {
    const taxonomyNodes: Record<string, { id: string; label: string; category: string; description?: string }[]> = {};
    for (const pov of POV_KEYS) {
      taxonomyNodes[pov] = (ctx.taxonomy[pov]?.nodes || []).map(n => ({
        id: n.id, label: n.label, category: n.category, description: n.description,
      }));
    }

    // Context manifests are accumulated during the debate via _contextManifests.
    // In the CLI engine path, manifests may be empty if computeInjectionManifest
    // results aren't captured per turn — pass what we have.
    ctx.session.taxonomy_gap_analysis = computeTaxonomyGapAnalysis(
      ctx.session.transcript,
      ctx.session.argument_network?.nodes || [],
      taxonomyNodes,
      ctx.contextManifests,
    );
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: ctx.session?.id, message: 'Taxonomy gap analysis failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    ctx.warn('Taxonomy gap analysis', err, 'Non-critical — debate results unaffected');
  }
}

// ── Situation debate_refs extraction (t/193) ────────────

/**
 * Post-debate pass that identifies which situations were substantively
 * discussed and stores the references on the session for consumers
 * to write back to situation nodes in the taxonomy.
 */
export function runSituationRefExtraction(ctx: ClaimExtractionContext): void {
  const situations = ctx.taxonomy.situations?.nodes;
  if (!situations || situations.length === 0) return;

  try {
    const result = extractSituationDebateRefs(
      ctx.session.id,
      ctx.session.transcript,
      situations,
    );

    // Store refs as a serializable object on the session
    // Consumers (taxonomy-editor) can read this to write debate_refs back to disk
    const refsObj: Record<string, SituationDebateRef> = {};
    for (const [sitId, ref] of result.refs) {
      refsObj[sitId] = ref;
    }

    ctx.session.situation_debate_refs = {
      refs: refsObj,
      stats: result.stats,
    };
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: ctx.session?.id, message: 'Situation ref extraction failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    ctx.warn('Situation ref extraction', err, 'Non-critical — debate results unaffected');
  }
}

// ── Position drift detection (sycophancy guard) ────────────

/**
 * Cache opening statement embeddings for drift comparison.
 * Called once after all opening statements are generated.
 */
export async function cacheOpeningEmbeddings(
  ctx: ClaimExtractionContext,
  openingEmbeddings: Map<string, number[]>,
): Promise<void> {
  const adapter = ctx.adapter as ExtendedAIAdapter;
  if (!adapter.computeQueryEmbedding) return;

  for (const entry of ctx.session.transcript) {
    if (entry.type !== 'opening' || entry.speaker === 'system') continue;
    try {
      const result = await adapter.computeQueryEmbedding(entry.content.slice(0, 1000));
      openingEmbeddings.set(entry.speaker, result.vector);
    } catch { /* telemetry — silent by design: per-speaker opening embedding is best-effort */ }
  }
}

/**
 * Cache opening claim embeddings from the AN for per-claim drift tracking.
 * Called after opening statements + first AN extraction.
 */
export async function cacheOpeningClaims(
  ctx: ClaimExtractionContext,
  openingClaims: Map<string, Array<{ id: string; text: string; embedding: number[] }>>,
): Promise<void> {
  const adapter = ctx.adapter as ExtendedAIAdapter;
  if (!adapter.computeQueryEmbedding) return;
  const an = ctx.session.argument_network;
  if (!an) return;

  // Group opening AN nodes by speaker (turn_number 0..2 = opening round)
  const bySpeaker = new Map<string, Array<{ id: string; text: string }>>();
  const openingTurnMax = (ctx.config.activePovers?.length ?? 3) - 1;
  for (const node of an.nodes) {
    if (node.turn_number <= openingTurnMax && node.speaker && node.speaker !== 'system' && node.speaker !== 'document') {
      const list = bySpeaker.get(node.speaker) ?? [];
      list.push({ id: node.id, text: node.text });
      bySpeaker.set(node.speaker, list);
    }
  }

  for (const [speaker, nodes] of bySpeaker) {
    const claims: Array<{ id: string; text: string; embedding: number[] }> = [];
    for (const node of nodes.slice(0, 8)) {
      try {
        const { vector } = await adapter.computeQueryEmbedding(node.text.slice(0, 300));
        claims.push({ id: node.id, text: node.text, embedding: vector });
      } catch { /* telemetry — silent by design: per-claim opening embedding is best-effort */ }
    }
    if (claims.length > 0) {
      openingClaims.set(speaker, claims);
    }
  }
}

/**
 * Track per-claim drift: compare each opening claim embedding against
 * current-round claims to classify as maintained/refined/abandoned.
 */
export async function trackPerClaimDrift(
  ctx: ClaimExtractionContext,
  openingClaimsMap: Map<string, Array<{ id: string; text: string; embedding: number[] }>>,
  speaker: Exclude<SpeakerId, 'user'>,
  round: number,
): Promise<void> {
  const openingClaims = openingClaimsMap.get(speaker);
  if (!openingClaims || openingClaims.length === 0) return;

  const adapter = ctx.adapter as ExtendedAIAdapter;
  if (!adapter.computeQueryEmbedding) return;

  const an = ctx.session.argument_network;
  if (!an) return;

  // Get current-round AN nodes for this speaker
  const currentTurnNumber = ctx.session.transcript
    .filter(e => (e.type === 'statement' || e.type === 'opening') && e.speaker === speaker)
    .length - 1;
  const currentClaims = an.nodes.filter(n =>
    n.speaker === speaker && n.turn_number === currentTurnNumber,
  );
  if (currentClaims.length === 0) return;

  // Embed current claims
  const currentEmbeddings: Array<{ id: string; embedding: number[] }> = [];
  for (const claim of currentClaims.slice(0, 8)) {
    try {
      const { vector } = await adapter.computeQueryEmbedding(claim.text.slice(0, 300));
      currentEmbeddings.push({ id: claim.id, embedding: vector });
    } catch { /* telemetry — silent by design: per-claim current embedding is best-effort */ }
  }
  if (currentEmbeddings.length === 0) return;

  // Get conceded claim IDs for this speaker
  const concededIds = new Set<string>();
  const concessions = ctx.session.commitments?.[speaker]?.conceded ?? [];
  for (const concText of concessions) {
    // Match concession text against opening claim text (fuzzy)
    for (const oc of openingClaims) {
      if (oc.text.toLowerCase().includes(concText.toLowerCase().slice(0, 40))
        || concText.toLowerCase().includes(oc.text.toLowerCase().slice(0, 40))) {
        concededIds.add(oc.id);
      }
    }
  }

  // Compare each opening claim against current claims
  const entries: import('../types.js').ClaimDriftEntry[] = [];
  for (const opening of openingClaims) {
    let bestSim = 0;
    for (const current of currentEmbeddings) {
      const sim = cosineSimilarity(current.embedding, opening.embedding);
      if (sim > bestSim) bestSim = sim;
    }

    const concessionExempt = concededIds.has(opening.id);
    let status: 'maintained' | 'refined' | 'abandoned';
    if (bestSim >= 0.7) status = 'maintained';
    else if (bestSim >= 0.3) status = 'refined';
    else status = 'abandoned';

    entries.push({ claim_id: opening.id, similarity: bestSim, status, concession_exempt: concessionExempt });
  }

  // Compute sycophancy score
  const abandonedNoExcuse = entries.filter(e => e.status === 'abandoned' && !e.concession_exempt);
  const sycophancyScore = abandonedNoExcuse.length / entries.length;

  if (!ctx.session.per_claim_drift) ctx.session.per_claim_drift = [];
  ctx.session.per_claim_drift.push({ round, speaker, claims: entries, sycophancy_score: sycophancyScore });

  // Fire guard if >50% abandoned without concession after 3+ turns
  if (sycophancyScore > 0.5 && round >= 3) {
    const abandonedTexts = abandonedNoExcuse
      .map(e => openingClaims.find(c => c.id === e.claim_id)?.text)
      .filter(Boolean) as string[];
    const speakerLabel = POVER_INFO[speaker]?.label ?? speaker;
    const entry = ctx.addEntry({
      type: 'system',
      speaker: 'system',
      content: `[Sycophancy guard — per-claim] ${speakerLabel} has abandoned ${abandonedNoExcuse.length}/${entries.length} opening claims without concession (score: ${sycophancyScore.toFixed(2)}). Abandoned: ${abandonedTexts.slice(0, 3).map(t => `"${t.slice(0, 60)}…"`).join(', ')}`,
      taxonomy_refs: [],
    });
    ctx.recordDiagnostic(entry.id, {
      raw_response: JSON.stringify({ speaker, round, sycophancy_score: sycophancyScore, claims: entries }),
    });
  }
}

/**
 * Track position drift: compare current response embedding against
 * the speaker's opening and each opponent's opening.
 */
export async function trackPositionDrift(
  ctx: ClaimExtractionContext,
  openingEmbeddings: Map<string, number[]>,
  openingClaims: Map<string, Array<{ id: string; text: string; embedding: number[] }>>,
  speaker: Exclude<SpeakerId, 'user'>,
  responseText: string,
  round: number,
): Promise<void> {
  const adapter = ctx.adapter as ExtendedAIAdapter;
  if (!adapter.computeQueryEmbedding || openingEmbeddings.size === 0) return;

  const selfOpening = openingEmbeddings.get(speaker);
  if (!selfOpening) return;

  try {
    const responseEmbed = await adapter.computeQueryEmbedding(responseText.slice(0, 1000));

    const selfSim = cosineSimilarity(responseEmbed.vector, selfOpening);
    const opponentSims: Record<string, number> = {};
    for (const [pover, embed] of openingEmbeddings.entries()) {
      if (pover !== speaker) {
        opponentSims[pover] = cosineSimilarity(responseEmbed.vector, embed);
      }
    }

    if (!ctx.session.position_drift) ctx.session.position_drift = [];
    ctx.session.position_drift.push({
      round,
      speaker,
      self_similarity: selfSim,
      opponent_similarities: opponentSims,
    });

    // Check for sycophancy
    detectSycophancy(ctx, openingClaims, speaker, round);
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: ctx.session?.id, message: 'Position drift tracking failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    ctx.warn('Position drift tracking', err, 'Non-critical — drift data unavailable this turn');
  }
}

// ── Post-debate calibration ──────────────────────────────────

/**
 * After debate, run the relevance threshold optimizer and apply the
 * recommendation if safety rails pass. Non-critical — failures are logged
 * but never affect the completed debate.
 */
export function runPostDebateCalibration(ctx: ClaimExtractionContext, dataRoot: string): void {
  try {
    const data = readCalibrationLog(dataRoot);
    const recommendation = optimizeRelevanceThreshold(data);

    // Count debates since last adjustment by checking adaptation_history
    const weights = loadProvisionalWeights();
    const history = (weights as Record<string, unknown> as { relevance?: { adaptation_history?: Array<{ at: string }> } }).relevance?.adaptation_history ?? [];
    const lastAdjustedAt = history.length > 0 ? history[history.length - 1].at : null;
    let debatesSince = data.length;
    if (lastAdjustedAt) {
      debatesSince = data.filter(d => d.timestamp > lastAdjustedAt).length;
    }

    const result = applyRelevanceThresholdAdaptation(
      recommendation,
      { debates_since_last_adjustment: debatesSince, last_adjusted_at: lastAdjustedAt },
    );

    if (result.applied) {
      console.log(`[calibration] Relevance threshold adapted: ${result.reason}`);
    }
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: ctx.session?.id, message: 'Post-debate calibration failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    ctx.warn('Post-debate calibration', err, 'Threshold adaptation skipped');
  }
}

// ── Steelman validation ────────────────────────────────────

/**
 * After claim extraction, check if any claims are steelmans of opponents.
 * Uses NLI to compare steelman text against opponent's actual assertions.
 * If max entailment < 0.6, inserts a system warning.
 */
export async function validateSteelmans(
  ctx: ClaimExtractionContext,
  newNodes: ArgumentNetworkNode[],
  speaker: Exclude<SpeakerId, 'user'>,
): Promise<void> {
  const adapter = ctx.adapter as ExtendedAIAdapter;
  if (!adapter.nliClassify) return; // NLI not available in CLI adapter

  const steelmanNodes = newNodes.filter(n => n.steelman_of);
  if (steelmanNodes.length === 0) return;

  for (const node of steelmanNodes) {
    try {
      const targetPover = node.steelman_of!;
      const targetCommitments = ctx.session.commitments?.[targetPover];
      if (!targetCommitments || targetCommitments.asserted.length === 0) continue;

      // Compare steelman against opponent's actual assertions
      const pairs = targetCommitments.asserted.slice(-10).map(assertion => ({
        text_a: node.text,
        text_b: assertion,
      }));

      const result = await adapter.nliClassify(pairs);
      const maxEntailment = Math.max(...result.results.map(r => r.nli_entailment ?? 0));

      if (maxEntailment < 0.6) {
        const targetLabel = POVER_INFO[targetPover as Exclude<SpeakerId, 'user'>]?.label ?? targetPover;
        const speakerLabel = POVER_INFO[speaker]?.label ?? speaker;
        const topAssertions = targetCommitments.asserted.slice(-3).map(a => `"${a}"`).join('; ');

        const steelEntry = ctx.addEntry({
          type: 'system',
          speaker: 'system',
          content: `[Steelman check] ${speakerLabel}'s steelman of ${targetLabel}'s position (max entailment: ${maxEntailment.toFixed(2)}) diverges from their actual assertions. ${targetLabel} actually asserted: ${topAssertions}`,
          taxonomy_refs: [],
        });
        ctx.recordDiagnostic(steelEntry.id, {
          raw_response: JSON.stringify({ steelman_text: node.text, target_pover: targetPover, max_entailment: maxEntailment, nli_results: result.results }),
          model: 'nli',
        });
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: ctx.session?.id, message: `Steelman validation failed for ${POVER_INFO[speaker].label}`, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      ctx.warn(`Steelman validation for ${POVER_INFO[speaker].label}`, err, 'Non-critical — skipping validation');
    }
  }
}

// ── Inline empirical verification ─────────────────────────

/**
 * After claim extraction, auto-fact-check precise Belief claims via web search.
 * Cap at 2 per turn. Updates node verification_status and inserts system warning if disputed.
 *
 * When source corpus is available, runs evidence QBAF pipeline (retrieve → classify → QBAF)
 * for richer strength scoring. Falls back to single-verdict web search when sources are absent.
 */
export async function verifyPreciseClaims(
  ctx: ClaimExtractionContext,
  newNodes: ArgumentNetworkNode[],
): Promise<void> {
  const adapter = ctx.adapter as ExtendedAIAdapter;
  // Known limitation (t/1782 / t/1769): evidence verification — which populates
  // node.evidence_graph.evidence_items, the substrate for source_authority/recency —
  // requires a search-capable adapter. The CLI adapter has none, so CLI-generated
  // debates (how the calibration corpus is batch-produced) carry no evidence and yield
  // null source-authority BY DESIGN. That is expected, not a dead metric; audits (e.g.
  // the Wachsmuth coverage scan) should not re-flag it. Enabling it on the corpus is a
  // feature (search-capable adapter + source corpus), not a bug fix.
  if (!adapter.generateTextWithSearch) return; // Search not available in CLI adapter

  const preciseBeliefs = newNodes.filter(
    n => n.bdi_category === 'belief' && n.specificity === 'precise',
  );
  if (preciseBeliefs.length === 0) return;

  // Resolve sources directory for evidence QBAF (lazy, on-demand)
  let sourcesDir: string | null = null;
  try {
    const __engineDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolveRepoRoot(__engineDir);
    sourcesDir = resolveSourcesDir(repoRoot);
  } catch { /* telemetry — silent by design: sources dir resolution is best-effort fallback */ }

  for (const node of preciseBeliefs.slice(0, 2)) {
    try {
      // ── Evidence QBAF path: retrieve from source corpus, classify, compute strength
      if (sourcesDir) {
        const evidenceResult = await runEvidenceQbaf(ctx, node, sourcesDir);
        if (evidenceResult) continue; // Successfully scored via evidence QBAF
      }

      // ── Fallback: single-verdict web search
      const prompt = `Verify this empirical claim using web search evidence.

Claim: "${node.text}"

Assess whether available evidence supports, disputes, or cannot verify this claim.

Return ONLY JSON (no markdown, no code fences):
{
  "verdict": "verified" or "disputed" or "unverifiable",
  "evidence": "1-2 sentence summary of the most relevant evidence found",
  "confidence": "high" or "medium" or "low"
}`;

      const result = await adapter.generateTextWithSearch(prompt, ctx.config.model);
      const parsed = parseJsonRobust(result.text) as { verdict?: ArgumentNetworkNode['verification_status']; evidence?: string; confidence?: number };

      if (parsed.verdict) {
        node.verification_status = parsed.verdict;
        node.verification_evidence = parsed.evidence;
        node.base_strength = factCheckToBaseStrength(parsed.verdict, parsed.confidence as unknown as string | undefined);
        node.scoring_method = 'fact_check';

        ctx.session.transcript.push({
          id: generateId(),
          timestamp: nowISO(),
          type: 'fact-check',
          speaker: 'system',
          content: `Claim ${node.id} — ${parsed.verdict}: ${parsed.evidence ?? ''}`.trim(),
          taxonomy_refs: [],
          metadata: {
            source: 'auto',
            claim_id: node.id,
            claim_text: node.text,
            verdict: parsed.verdict,
            evidence: parsed.evidence,
            confidence: parsed.confidence,
            web_search_used: !!(result.citations?.length || result.searchQueries?.length),
            web_search_queries: result.searchQueries,
            web_search_evidence: parsed.evidence,
            web_search_citations: result.citations,
          },
        });
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'ai.error', component: 'debate-engine', level: 'warn', debate_id: ctx.session?.id, message: `Inline verification failed for ${node.id}`, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      ctx.warn(`Inline verification for ${node.id}`, err, 'Non-critical — claim unverified');
      node.verification_status = 'pending';
      ctx.session.transcript.push({
        id: generateId(),
        timestamp: nowISO(),
        type: 'fact-check',
        speaker: 'system',
        content: `Claim ${node.id} — verification pending (adapter error)`,
        taxonomy_refs: [],
        metadata: {
          source: 'auto',
          claim_id: node.id,
          claim_text: node.text,
          verdict: 'pending',
        },
      });
    }
  }
}
