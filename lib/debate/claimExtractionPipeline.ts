// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Session-write map (t/1300 condition 1 — C2):
//
//  Method                       → session fields written
//  ─────────────────────────────────────────────────────────────
//  extractClaims()              → argument_network.{nodes,edges} (push)
//                                 commitments[speaker].{asserted,conceded,challenged}
//                                 diagnostics.overview.{claims_accepted,claims_rejected}
//                                 last_qbaf_result, max_qbaf_damping_level
//                                 qbaf_runs_total, qbaf_runs_oscillated
//                                 convergence_tracker.issues[].{qbaf_strength,convergence,history}
//                                 qbaf_timeline (push), transcript[].metadata.qbaf_net_delta
//                                 convergence_signals (push), turn_embeddings
//                                 crux_tracker (transition, refresh)
//                                 process_rewards (push)
//                                 unanswered_claims_ledger (replace)
//  cacheOpeningEmbeddings()     → (none — writes _openingEmbeddings private field)
//  cacheOpeningClaims()         → (none — writes _openingClaims private field)
//  trackPerClaimDrift()         → per_claim_drift (push), transcript (system entry)
//  trackPositionDrift()         → position_drift (push)
//  detectSycophancy()           → transcript (system entry via addEntry)
//  validateSteelmans()          → transcript (system entry via addEntry)
//  verifyPreciseClaims()        → transcript (fact-check entries push)
//  runEvidenceQbaf()            → transcript (fact-check entries push)
//  runGapInjection()            → gap_injections (push), transcript (gap entries)
//  runResponsiveGapCheck()      → (delegates to runGapInjection)
//  runCrossCuttingProposalPass()→ cross_cutting_proposals (replace)
//  runTaxonomyGapAnalysisPass() → taxonomy_gap_analysis (replace)
//  runSituationRefExtraction()  → situation_debate_refs (replace)
//  runPostDebateCalibration()   → (none — writes provisional weights file)
//  hashString()                 → (none — pure helper)
//  looksTruncated()             → (none — pure helper)
//  updateExtractionSummary()    → diagnostics.extraction_summary (replace)

import path from 'path';
import { fileURLToPath } from 'url';
import type { ExtendedAIAdapter } from './aiAdapter.js';
import type { LoadedTaxonomy } from './taxonomyLoader.js';
import type {
  DebateSession,
  SpeakerId,
  TranscriptEntry,
  TaxonomyRef,
  ArgumentNetworkNode,
  DebatePhase,
  ClaimExtractionTrace,
  ExtractionSummary,
  GapArgument,
  GapInjection,
  CrossCuttingProposal,
  ProcessRewardEntry,
  EntailmentRepairEvent,
  EntryDiagnostics,
} from './types.js';
import { POVER_INFO, POV_KEYS, type PovKey } from './types.js';
import type { ContextManifestEntry } from './taxonomyGapAnalysis.js';
import type { UnengagedNode } from './gapCheck.js';

import { generateId, nowISO, parseJsonRobust, formatRecentTranscript, wordOverlap } from './helpers.js';
import { cosineSimilarity, scoreNodesLexical } from './taxonomyRelevance.js';
import {
  extractClaimsPrompt,
  classifyClaimsPrompt,
  updateUnansweredLedger,
  processExtractedClaims,
  factCheckToBaseStrength,
  computeClaimTaxonomyAttribution,
  sampleNodesForEntailment,
  getNextArgumentNodeNumber,
  assertUniqueArgumentNodeIds,
  type RawExtractedClaim,
} from './argumentNetwork.js';
import { computeQbafStrengths, computeQbafConvergence } from './qbaf.js';
import { computeConvergenceSignals, boostConvergenceOnConcession, boostConvergenceFromTaxonomyEdges } from './convergenceSignals.js';
import { detectConcessionCascade, transitionCrux, updateCruxTracker } from './cruxResolution.js';
import { computeProcessReward } from './processReward.js';
import { retrieveEvidence } from './evidenceRetriever.js';
import { buildEvidenceQbaf } from './evidenceQbaf.js';
import { checkClaimExclusionBoundary, EXCLUSION_RATIO_THRESHOLD } from './exclusionGuard.js';
import { midDebateGapPrompt, crossCuttingNodePrompt, entailmentRepairPrompt, cruxRefreshPrompt } from './prompts.js';
import {
  findUnengagedHighRelevanceNodes,
  shouldRunGapCheck,
  collectEngagedNodeIds,
  GAP_CHECK_INTERVAL,
  MAX_GAP_INJECTIONS,
} from './gapCheck.js';
import { computeTaxonomyGapAnalysis } from './taxonomyGapAnalysis.js';
import { extractSituationDebateRefs, type SituationDebateRef } from './situationRefs.js';
import { readCalibrationLog } from './calibrationLogger.js';
import { optimizeRelevanceThreshold, applyRelevanceThresholdAdaptation } from './calibrationOptimizer.js';
import { loadProvisionalWeights } from './phaseTransitions.js';
import { resolveRepoRoot, resolveSourcesDir } from './taxonomyLoader.js';
import { callByUsage } from '../ai-client/usageRegistry.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';
// Type-only import for DebateConfig to avoid circular dependency
import type { DebateConfig } from './debateEngine.js';

// ── Context interface (engine infrastructure) ───────────────

export interface ClaimExtractionContext {
  session: DebateSession;
  config: DebateConfig;
  adapter: ExtendedAIAdapter;
  taxonomy: LoadedTaxonomy;
  contextManifests: ContextManifestEntry[];

  generate: (prompt: string, label: string) => Promise<string>;
  generateViaUsage: (usageId: string, prompt: string, label: string) => Promise<string>;
  generateWithModel: (prompt: string, label: string, model: string) => Promise<string>;
  generateWithEvaluator: (prompt: string, label: string, timeoutMs?: number) => Promise<string>;
  resolveStageModel: (key: string) => string;
  addEntry: (entry: { type: string; speaker: string; content: string; taxonomy_refs: TaxonomyRef[]; metadata?: Record<string, unknown> }) => TranscriptEntry;
  recordDiagnostic: (entryId: string, data: Partial<EntryDiagnostics>) => void;
  progress: (phase: string, speaker: string | undefined, message: string) => void;
  warn: (operation: string, error: unknown, recovery: string) => void;
  incrementApiCallCount: () => void;
  getKnownNodeIds: () => Set<string>;
  getActivatedSituations: () => { id: string; text: string }[];
}

export class ClaimExtractionPipeline {
  private readonly ctx: ClaimExtractionContext;
  private _openingEmbeddings = new Map<string, number[]>();
  private _openingClaims = new Map<string, Array<{ id: string; text: string; embedding: number[] }>>();
  private _gapInjectionCount = 0;

  constructor(ctx: ClaimExtractionContext) {
    this.ctx = ctx;
  }

  // Getter for _openingClaims — needed by engine for C3 handoff
  get openingClaims(): Map<string, Array<{ id: string; text: string; embedding: number[] }>> {
    return this._openingClaims;
  }

  get gapInjectionCount(): number {
    return this._gapInjectionCount;
  }

  // ── Mid-debate gap injection ("fourth voice") ──────────────

  /**
   * Mid-debate pass: a fresh LLM with no persona surfaces 1-2 strong arguments
   * that no debater made — cross-cutting positions, compromises, blind spots.
   * Non-blocking — failure never aborts the debate.
   */
  async runGapInjection(
    round: number,
    trigger: 'scheduled' | 'responsive',
    focusNodes?: UnengagedNode[],
  ): Promise<void> {
    try {
      const label = trigger === 'responsive' ? 'Responsive gap check' : 'Analyzing debate gaps';
      this.ctx.progress('gap-injection', undefined, label);

      const transcriptText = formatRecentTranscript(this.ctx.session.transcript, 20, this.ctx.session.context_summaries);

      const summaryLines: string[] = [];
      for (const povKey of POV_KEYS) {
        const povData = this.ctx.taxonomy[povKey];
        if (!povData?.nodes) continue;
        for (const node of povData.nodes) {
          const cat = node.category ?? 'unknown';
          summaryLines.push(`[${node.id}] ${node.label} (${cat}) — ${povKey}`);
        }
      }
      const taxSummary = summaryLines.slice(0, 80).join('\n');

      const anTexts = (this.ctx.session.argument_network?.nodes || []).map(n => n.text);
      const focusForPrompt = focusNodes?.slice(0, 5);
      const gapPrompt = midDebateGapPrompt(this.ctx.session.topic.final, transcriptText, taxSummary, anTexts, focusForPrompt);

      const gapResult = await this.ctx.adapter.generateText(gapPrompt, this.ctx.config.model, {
        temperature: 0.5,
      });
      this.ctx.incrementApiCallCount();

      const parsed = parseJsonRobust(gapResult) as { gap_arguments?: GapArgument[] };
      const gapArgs: GapArgument[] = parsed?.gap_arguments ?? [];

      if (gapArgs.length > 0) {
        const headerLabel = trigger === 'responsive' ? 'Responsive Gap Analysis' : 'Mid-Debate Gap Analysis';
        const gapContent = gapArgs.map((g: GapArgument, i: number) =>
          `**Gap ${i + 1} (${g.gap_type}):** ${g.argument}\n*Why missing:* ${g.why_missing}`,
        ).join('\n\n');

        const entry = this.ctx.addEntry({
          type: 'system',
          speaker: 'system',
          content: `## ${headerLabel}\n\n${gapContent}`,
          taxonomy_refs: [],
        });

        this.ctx.recordDiagnostic(entry.id, {
          prompt: gapPrompt,
          raw_response: gapResult,
          model: this.ctx.config.model,
        });

        const injection: GapInjection = {
          round,
          arguments: gapArgs,
          transcript_entry_id: entry.id,
          responses: [],
          trigger,
          focus_nodes: focusNodes?.map(n => n.id),
        };

        if (!this.ctx.session.gap_injections) {
          this.ctx.session.gap_injections = [injection];
        } else {
          this.ctx.session.gap_injections.push(injection);
        }

        this._gapInjectionCount++;
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.ctx.session?.id, message: 'Mid-debate gap injection failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.ctx.warn('Mid-debate gap injection', err, 'Non-critical — debate continues without gap analysis');
    }
  }

  /**
   * Periodic responsive gap check — finds high-relevance taxonomy nodes
   * that no debater has engaged and triggers a focused gap injection.
   * Deterministic check; LLM called only if unengaged nodes found.
   */
  async runResponsiveGapCheck(round: number, initialGapRound: number): Promise<void> {
    const maxInjections = this.ctx.config.maxGapInjections ?? MAX_GAP_INJECTIONS;
    const checkInterval = this.ctx.config.gapCheckInterval ?? GAP_CHECK_INTERVAL;

    if (!shouldRunGapCheck(round, initialGapRound, this._gapInjectionCount, maxInjections, checkInterval)) {
      return;
    }

    const anNodes = this.ctx.session.argument_network?.nodes ?? [];
    const engagedIds = collectEngagedNodeIds(anNodes as unknown as ReadonlyArray<{ taxonomy_refs: ReadonlyArray<{ node_id: string }> }>, this.ctx.session.transcript);

    const allTaxNodes: Array<{ id: string; label: string; description: string }> = [];
    for (const povKey of POV_KEYS) {
      const povData = this.ctx.taxonomy[povKey];
      if (!povData?.nodes) continue;
      for (const node of povData.nodes) {
        allTaxNodes.push({ id: node.id, label: node.label, description: node.description });
      }
    }

    const recentText = formatRecentTranscript(this.ctx.session.transcript, 8, this.ctx.session.context_summaries);
    const query = `${this.ctx.session.topic.final}\n\n${recentText}`.slice(0, 500);
    const scores = scoreNodesLexical(query, allTaxNodes, []);

    const unengaged = findUnengagedHighRelevanceNodes(allTaxNodes, engagedIds, scores);

    if (unengaged.length > 0) {
      this.ctx.progress('gap-injection', undefined,
        `Found ${unengaged.length} unengaged high-relevance node(s) — triggering responsive gap injection`);
      await this.runGapInjection(round, 'responsive', unengaged);
    }
  }

  // ── Cross-cutting node promotion (post-synthesis) ──────────

  /**
   * Post-synthesis pass: when synthesis identifies areas of agreement across
   * all three POVs, propose new situation nodes or map to existing ones.
   * Non-blocking — failure never blocks debate results.
   */
  async runCrossCuttingProposalPass(): Promise<void> {
    try {
      const synthEntry = this.ctx.session.transcript.find(e => e.type === 'concluding');
      const concludingData = synthEntry?.metadata?.synthesis as Record<string, unknown> | undefined;
      if (!concludingData) return;

      const agreements = ((concludingData.areas_of_agreement ?? []) as { point: string; povers: string[] }[])
        .filter(a => (a.povers?.length ?? 0) >= 3);

      if (agreements.length === 0) return;

      this.ctx.progress('cross-cutting', undefined, 'Analyzing cross-cutting proposals');

      const sitLabels = (this.ctx.taxonomy.situations?.nodes || []).map(n => n.label);
      const ccPrompt = crossCuttingNodePrompt(agreements, sitLabels, this.ctx.session.topic.final);

      const ccResult = await this.ctx.adapter.generateText(ccPrompt, this.ctx.config.model, {
        temperature: 0.3,
      });
      this.ctx.incrementApiCallCount();

      const ccParsed = parseJsonRobust(ccResult) as { proposals?: CrossCuttingProposal[] };
      this.ctx.session.cross_cutting_proposals = ccParsed?.proposals ?? [];
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.ctx.session?.id, message: 'Cross-cutting proposal pass failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.ctx.warn('Cross-cutting proposal pass', err, 'Non-critical — debate results unaffected');
    }
  }

  // ── Taxonomy gap analysis (post-synthesis, deterministic) ──

  /**
   * Post-synthesis pass: compute deterministic taxonomy coverage analysis.
   * Identifies per-POV coverage, BDI balance, unmapped arguments, and cross-POV gaps.
   * No LLM calls — purely deterministic computation.
   * Non-blocking — failure never blocks debate results.
   */
  runTaxonomyGapAnalysisPass(): void {
    try {
      const taxonomyNodes: Record<string, { id: string; label: string; category: string; description?: string }[]> = {};
      for (const pov of POV_KEYS) {
        taxonomyNodes[pov] = (this.ctx.taxonomy[pov]?.nodes || []).map(n => ({
          id: n.id, label: n.label, category: n.category, description: n.description,
        }));
      }

      // Context manifests are accumulated during the debate via _contextManifests.
      // In the CLI engine path, manifests may be empty if computeInjectionManifest
      // results aren't captured per turn — pass what we have.
      this.ctx.session.taxonomy_gap_analysis = computeTaxonomyGapAnalysis(
        this.ctx.session.transcript,
        this.ctx.session.argument_network?.nodes || [],
        taxonomyNodes,
        this.ctx.contextManifests,
      );
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.ctx.session?.id, message: 'Taxonomy gap analysis failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.ctx.warn('Taxonomy gap analysis', err, 'Non-critical — debate results unaffected');
    }
  }

  // ── Situation debate_refs extraction (t/193) ────────────

  /**
   * Post-debate pass that identifies which situations were substantively
   * discussed and stores the references on the session for consumers
   * to write back to situation nodes in the taxonomy.
   */
  runSituationRefExtraction(): void {
    const situations = this.ctx.taxonomy.situations?.nodes;
    if (!situations || situations.length === 0) return;

    try {
      const result = extractSituationDebateRefs(
        this.ctx.session.id,
        this.ctx.session.transcript,
        situations,
      );

      // Store refs as a serializable object on the session
      // Consumers (taxonomy-editor) can read this to write debate_refs back to disk
      const refsObj: Record<string, SituationDebateRef> = {};
      for (const [sitId, ref] of result.refs) {
        refsObj[sitId] = ref;
      }

      this.ctx.session.situation_debate_refs = {
        refs: refsObj,
        stats: result.stats,
      };
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.ctx.session?.id, message: 'Situation ref extraction failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.ctx.warn('Situation ref extraction', err, 'Non-critical — debate results unaffected');
    }
  }

  // ── Position drift detection (sycophancy guard) ────────────

  /**
   * Cache opening statement embeddings for drift comparison.
   * Called once after all opening statements are generated.
   */
  async cacheOpeningEmbeddings(): Promise<void> {
    const adapter = this.ctx.adapter as ExtendedAIAdapter;
    if (!adapter.computeQueryEmbedding) return;

    for (const entry of this.ctx.session.transcript) {
      if (entry.type !== 'opening' || entry.speaker === 'system') continue;
      try {
        const result = await adapter.computeQueryEmbedding(entry.content.slice(0, 1000));
        this._openingEmbeddings.set(entry.speaker, result.vector);
      } catch { /* telemetry — silent by design: per-speaker opening embedding is best-effort */ }
    }
  }

  /**
   * Cache opening claim embeddings from the AN for per-claim drift tracking.
   * Called after opening statements + first AN extraction.
   */
  async cacheOpeningClaims(): Promise<void> {
    const adapter = this.ctx.adapter as ExtendedAIAdapter;
    if (!adapter.computeQueryEmbedding) return;
    const an = this.ctx.session.argument_network;
    if (!an) return;

    // Group opening AN nodes by speaker (turn_number 0..2 = opening round)
    const bySpeaker = new Map<string, Array<{ id: string; text: string }>>();
    const openingTurnMax = (this.ctx.config.activePovers?.length ?? 3) - 1;
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
        this._openingClaims.set(speaker, claims);
      }
    }
  }

  /**
   * Track per-claim drift: compare each opening claim embedding against
   * current-round claims to classify as maintained/refined/abandoned.
   */
  async trackPerClaimDrift(
    speaker: Exclude<SpeakerId, 'user'>,
    round: number,
  ): Promise<void> {
    const openingClaims = this._openingClaims.get(speaker);
    if (!openingClaims || openingClaims.length === 0) return;

    const adapter = this.ctx.adapter as ExtendedAIAdapter;
    if (!adapter.computeQueryEmbedding) return;

    const an = this.ctx.session.argument_network;
    if (!an) return;

    // Get current-round AN nodes for this speaker
    const currentTurnNumber = this.ctx.session.transcript
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
    const concessions = this.ctx.session.commitments?.[speaker]?.conceded ?? [];
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
    const entries: import('./types.js').ClaimDriftEntry[] = [];
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

    if (!this.ctx.session.per_claim_drift) this.ctx.session.per_claim_drift = [];
    this.ctx.session.per_claim_drift.push({ round, speaker, claims: entries, sycophancy_score: sycophancyScore });

    // Fire guard if >50% abandoned without concession after 3+ turns
    if (sycophancyScore > 0.5 && round >= 3) {
      const abandonedTexts = abandonedNoExcuse
        .map(e => openingClaims.find(c => c.id === e.claim_id)?.text)
        .filter(Boolean) as string[];
      const speakerLabel = POVER_INFO[speaker]?.label ?? speaker;
      const entry = this.ctx.addEntry({
        type: 'system',
        speaker: 'system',
        content: `[Sycophancy guard — per-claim] ${speakerLabel} has abandoned ${abandonedNoExcuse.length}/${entries.length} opening claims without concession (score: ${sycophancyScore.toFixed(2)}). Abandoned: ${abandonedTexts.slice(0, 3).map(t => `"${t.slice(0, 60)}…"`).join(', ')}`,
        taxonomy_refs: [],
      });
      this.ctx.recordDiagnostic(entry.id, {
        raw_response: JSON.stringify({ speaker, round, sycophancy_score: sycophancyScore, claims: entries }),
      });
    }
  }

  /**
   * Track position drift: compare current response embedding against
   * the speaker's opening and each opponent's opening.
   */
  async trackPositionDrift(
    speaker: Exclude<SpeakerId, 'user'>,
    responseText: string,
    round: number,
  ): Promise<void> {
    const adapter = this.ctx.adapter as ExtendedAIAdapter;
    if (!adapter.computeQueryEmbedding || this._openingEmbeddings.size === 0) return;

    const selfOpening = this._openingEmbeddings.get(speaker);
    if (!selfOpening) return;

    try {
      const responseEmbed = await adapter.computeQueryEmbedding(responseText.slice(0, 1000));

      const selfSim = cosineSimilarity(responseEmbed.vector, selfOpening);
      const opponentSims: Record<string, number> = {};
      for (const [pover, embed] of this._openingEmbeddings.entries()) {
        if (pover !== speaker) {
          opponentSims[pover] = cosineSimilarity(responseEmbed.vector, embed);
        }
      }

      if (!this.ctx.session.position_drift) this.ctx.session.position_drift = [];
      this.ctx.session.position_drift.push({
        round,
        speaker,
        self_similarity: selfSim,
        opponent_similarities: opponentSims,
      });

      // Check for sycophancy
      this.detectSycophancy(speaker, round);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.ctx.session?.id, message: 'Position drift tracking failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.ctx.warn('Position drift tracking', err, 'Non-critical — drift data unavailable this turn');
    }
  }

  // ── Post-debate calibration ──────────────────────────────────

  /**
   * After debate, run the relevance threshold optimizer and apply the
   * recommendation if safety rails pass. Non-critical — failures are logged
   * but never affect the completed debate.
   */
  runPostDebateCalibration(dataRoot: string): void {
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
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.ctx.session?.id, message: 'Post-debate calibration failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.ctx.warn('Post-debate calibration', err, 'Threshold adaptation skipped');
    }
  }

  // ── Steelman validation ────────────────────────────────────

  /**
   * After claim extraction, check if any claims are steelmans of opponents.
   * Uses NLI to compare steelman text against opponent's actual assertions.
   * If max entailment < 0.6, inserts a system warning.
   */
  async validateSteelmans(
    newNodes: ArgumentNetworkNode[],
    speaker: Exclude<SpeakerId, 'user'>,
  ): Promise<void> {
    const adapter = this.ctx.adapter as ExtendedAIAdapter;
    if (!adapter.nliClassify) return; // NLI not available in CLI adapter

    const steelmanNodes = newNodes.filter(n => n.steelman_of);
    if (steelmanNodes.length === 0) return;

    for (const node of steelmanNodes) {
      try {
        const targetPover = node.steelman_of!;
        const targetCommitments = this.ctx.session.commitments?.[targetPover];
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

          const steelEntry = this.ctx.addEntry({
            type: 'system',
            speaker: 'system',
            content: `[Steelman check] ${speakerLabel}'s steelman of ${targetLabel}'s position (max entailment: ${maxEntailment.toFixed(2)}) diverges from their actual assertions. ${targetLabel} actually asserted: ${topAssertions}`,
            taxonomy_refs: [],
          });
          this.ctx.recordDiagnostic(steelEntry.id, {
            raw_response: JSON.stringify({ steelman_text: node.text, target_pover: targetPover, max_entailment: maxEntailment, nli_results: result.results }),
            model: 'nli',
          });
        }
      } catch (err) {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.ctx.session?.id, message: `Steelman validation failed for ${POVER_INFO[speaker].label}`, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        this.ctx.warn(`Steelman validation for ${POVER_INFO[speaker].label}`, err, 'Non-critical — skipping validation');
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
  async verifyPreciseClaims(newNodes: ArgumentNetworkNode[]): Promise<void> {
    const adapter = this.ctx.adapter as ExtendedAIAdapter;
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
          const evidenceResult = await this.runEvidenceQbaf(node, sourcesDir);
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

        const result = await adapter.generateTextWithSearch(prompt, this.ctx.config.model);
        const parsed = parseJsonRobust(result.text) as { verdict?: ArgumentNetworkNode['verification_status']; evidence?: string; confidence?: number };

        if (parsed.verdict) {
          node.verification_status = parsed.verdict;
          node.verification_evidence = parsed.evidence;
          node.base_strength = factCheckToBaseStrength(parsed.verdict, parsed.confidence as unknown as string | undefined);
          node.scoring_method = 'fact_check';

          this.ctx.session.transcript.push({
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
        getGlobalRecorder()?.record({ type: 'ai.error', component: 'debate-engine', level: 'warn', debate_id: this.ctx.session?.id, message: `Inline verification failed for ${node.id}`, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        this.ctx.warn(`Inline verification for ${node.id}`, err, 'Non-critical — claim unverified');
        node.verification_status = 'pending';
        this.ctx.session.transcript.push({
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

  async extractClaims(
    statement: string,
    speaker: Exclude<SpeakerId, 'user'>,
    entryId: string,
    taxonomyRefIds: string[],
    debaterClaims?: { claim: string; targets: string[] }[],
  ): Promise<void> {
    const an = this.ctx.session.argument_network!;
    // Include all prior claims but cap at last 30 to keep the prompt manageable.
    // Earlier claims are still in the network but won't be offered as relationship targets.
    const allPriorClaims = an.nodes.map(n => ({
      id: n.id,
      text: n.text,
      speaker: POVER_INFO[n.speaker as Exclude<SpeakerId, 'user'>]?.label ?? n.speaker,
    }));
    const priorClaims = allPriorClaims.slice(-30);

    let prompt: string;
    if (debaterClaims && debaterClaims.length > 0) {
      prompt = classifyClaimsPrompt(statement, POVER_INFO[speaker].label, debaterClaims, priorClaims, this.ctx.session.audience);
    } else {
      prompt = extractClaimsPrompt(statement, POVER_INFO[speaker].label, priorClaims, this.ctx.session.audience, this.ctx.session.topic.final);
    }

    const anNodeCountBefore = an.nodes.length;
    const turnNumber = this.ctx.session.transcript.length;

    // Build the lifecycle trace as we go.
    const trace: ClaimExtractionTrace = {
      entry_id: entryId,
      round: turnNumber,
      speaker,
      status: 'ok',
      attempt_count: 1,
      prompt_chars: prompt.length,
      prompt_token_estimate: Math.round(prompt.length / 4),
      response_chars: 0,
      response_truncated: false,
      model: this.ctx.resolveStageModel('evaluator'),
      response_time_ms: 0,
      candidates_proposed: 0,
      candidates_accepted: 0,
      candidates_rejected: 0,
      rejection_reasons: {},
      rejected_overlap_pcts: [],
      max_overlap_vs_existing: 0,
      an_node_count_before: anNodeCountBefore,
      an_node_count_after: anNodeCountBefore,
      an_nodes_added_ids: [],
      prompt_hash: this.hashString(prompt),
      extraction_prompt_version: debaterClaims && debaterClaims.length > 0 ? 'classify-v2-nli' : 'extract-v2-nli',
    };

    let text: string;
    const extractStart = Date.now();
    try {
      text = await this.ctx.generateWithEvaluator(prompt, 'Claim extraction', 180_000);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'ai.error', component: 'debate-engine', level: 'error', debate_id: this.ctx.session?.id, message: `Claim extraction adapter error for ${POVER_INFO[speaker].label}`, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      trace.status = 'adapter_error';
      trace.error_message = err instanceof Error ? err.message : String(err);
      trace.response_time_ms = Date.now() - extractStart;
      this.ctx.recordDiagnostic(entryId, { extraction_trace: trace });
      this.updateExtractionSummary(trace);
      this.ctx.warn(`Claim extraction for ${POVER_INFO[speaker].label}`, err, 'Skipping — argument network will be incomplete for this turn');
      return;
    }
    const extractElapsed = Date.now() - extractStart;
    trace.response_time_ms = extractElapsed;
    trace.response_chars = text.length;
    trace.response_truncated = this.looksTruncated(text);

    let claims: RawExtractedClaim[] = [];
    try {
      const parsed = parseJsonRobust(text) as { claims?: RawExtractedClaim[] };
      claims = parsed.claims ?? [];
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'error', debate_id: this.ctx.session?.id, message: `Claim extraction parse error for ${POVER_INFO[speaker].label}`, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      trace.status = 'parse_error';
      trace.error_message = err instanceof Error ? err.message : String(err);
      this.ctx.recordDiagnostic(entryId, {
        extraction_trace: trace,
        claim_extraction: {
          prompt, raw_response: text, response_time_ms: extractElapsed,
          claims_parsed: 0, schemes_classified: [],
        },
      });
      this.updateExtractionSummary(trace);
      this.ctx.warn(`Parsing claim extraction response for ${POVER_INFO[speaker].label}`, err, 'Skipping — argument network will be incomplete for this turn');
      return;
    }

    trace.candidates_proposed = claims.length;
    if (claims.length === 0) {
      trace.status = trace.response_truncated ? 'truncated_response' : 'empty_response';
    }

    const overlapThreshold = (debaterClaims && debaterClaims.length > 0) ? 0.1 : 0.15;
    assertUniqueArgumentNodeIds(an.nodes, 'ClaimExtractionPipeline.extractClaims');
    const claimsResult = processExtractedClaims(
      {
        claims,
        statement,
        speaker,
        entryId,
        taxonomyRefIds,
        turnNumber,
        existingNodes: an.nodes,
        existingEdgeCount: an.edges.length,
        startNodeId: getNextArgumentNodeNumber(an.nodes),
        taxonomyEdges: this.ctx.taxonomy.edges?.edges,
        knownNodeIds: this.ctx.getKnownNodeIds(),
        activatedSituations: this.ctx.getActivatedSituations().length > 0 ? this.ctx.getActivatedSituations() : undefined,
        audience: this.ctx.session.audience,
      },
      {
        groundingOverlapThreshold: overlapThreshold,
        isClassifyPath: !!(debaterClaims && debaterClaims.length > 0),
        colloquialTerms: this.ctx.config.vocabulary?.colloquialTerms,
      },
    );

    an.nodes.push(...claimsResult.newNodes);
    assertUniqueArgumentNodeIds(an.nodes, 'ClaimExtractionPipeline.extractClaims.afterInsert');
    an.edges.push(...claimsResult.newEdges);

    // Entailment post-pass: BDI-category-aware sampling, detect-and-repair
    const entailmentRepairs: EntailmentRepairEvent[] = [];
    if (claimsResult.newNodes.length > 0) {
      const sampled = sampleNodesForEntailment(claimsResult.newNodes);
      for (const node of sampled) {
        try {
          const eprompt = entailmentRepairPrompt(statement, node.text);
          const eText = await this.ctx.generateWithEvaluator(eprompt, 'Entailment check');
          const eResult = parseJsonRobust(eText) as {
            verdict?: string;
            explanation?: string;
            repaired_claim?: string | null;
          };
          const verdict = eResult.verdict as EntailmentRepairEvent['verdict'] ?? 'entailed';
          const overlap = wordOverlap(node.text, statement);
          const event: EntailmentRepairEvent = {
            node_id: node.id,
            bdi_category: node.bdi_category ?? 'unknown',
            verdict,
            explanation: eResult.explanation ?? '',
            original_text: node.text,
            repaired_text: eResult.repaired_claim ?? null,
            overlap_pct: Math.round(overlap * 100),
          };
          entailmentRepairs.push(event);

          if ((verdict === 'partial' || verdict === 'not_entailed') && eResult.repaired_claim) {
            node.text = eResult.repaired_claim;
          }
        } catch (eErr) {
          getGlobalRecorder()?.record({ type: 'ai.error', component: 'debate-engine', level: 'warn', debate_id: this.ctx.session?.id, message: `Entailment check failed for ${node.id}`, error: { name: (eErr as Error).name ?? 'Error', message: String(eErr), stack: (eErr as Error).stack } });
          this.ctx.warn(`Entailment check for ${node.id}`, eErr, 'Skipping — claim text unchanged');
        }
      }
    }

    // Embed new AN nodes for AN-based taxonomy relevance scoring (non-blocking)
    const adapter = this.ctx.adapter as ExtendedAIAdapter;
    if (adapter.computeQueryEmbedding && claimsResult.newNodes.length > 0) {
      for (const node of claimsResult.newNodes) {
        try {
          const { vector } = await adapter.computeQueryEmbedding(node.text.slice(0, 300));
          if (vector && vector.length > 0) node.embedding = vector;
        } catch { /* telemetry — silent by design: per-node AN embedding is best-effort */ }
        if (node.attribution_text_genus) {
          try {
            const { vector } = await adapter.computeQueryEmbedding(node.attribution_text_genus.slice(0, 300));
            if (vector && vector.length > 0) node.attribution_embedding = vector;
          } catch { /* best-effort: falls back to node.embedding for attribution */ }
        }
      }
    }

    // Per-claim taxonomy attribution (t/110): compare AN embeddings against same-POV Belief nodes
    if (claimsResult.newNodes.length > 0) {
      const speakerPov = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.pov;
      if (speakerPov) {
        const povNodes = this.ctx.taxonomy[speakerPov as PovKey]?.nodes ?? [];
        const allPovNodeIds = new Set(povNodes.map(n => n.id));
        const attrResult = computeClaimTaxonomyAttribution(
          claimsResult.newNodes, speakerPov, this.ctx.taxonomy.embeddings, allPovNodeIds,
        );
        trace.attribution_attributed = attrResult.attributed;
        trace.attribution_unattributed = attrResult.unattributed;
        trace.attribution_missing_embedding = attrResult.missing_embedding;
        trace.attribution_novel_argument = attrResult.novel_argument;
        trace.attribution_decisions = attrResult.decisions;

        // Log warning if zero statement-level taxonomy_refs (injection may have failed upstream)
        if (taxonomyRefIds.length === 0 && claimsResult.newNodes.length > 0) {
          console.warn(`[attribution.no-statement-refs] speaker=${speaker} entry=${entryId} — no taxonomy_refs on parent statement`);
        }
      }
    }

    // Exclusion boundary guard (t/450): flag claims in a node's excluded scope
    const nodesWithEmbeddingAndRef = claimsResult.newNodes.filter(
      n => n.embedding && n.claim_taxonomy_attribution?.primary_ref,
    );
    const refsWithExclusionVec = new Set(
      nodesWithEmbeddingAndRef
        .map(n => n.claim_taxonomy_attribution!.primary_ref!)
        .filter(ref => (this.ctx.taxonomy.embeddings[ref] as { exclusion_vector?: number[] })?.exclusion_vector),
    ).size;
    const exclusionViolations = checkClaimExclusionBoundary(
      claimsResult.newNodes, this.ctx.taxonomy.embeddings,
    );
    trace.exclusion_guard = {
      checked: nodesWithEmbeddingAndRef.length,
      refs_with_exclusion_vector: refsWithExclusionVec,
      violations: exclusionViolations,
      threshold: EXCLUSION_RATIO_THRESHOLD,
    };
    if (exclusionViolations.length > 0) {
      trace.exclusion_violations = exclusionViolations;
      getGlobalRecorder()?.record({
        type: 'an.exclusion_violation', component: 'debate-engine', level: 'warn',
        speaker, debate_id: this.ctx.session?.id,
        message: `${exclusionViolations.length} claim(s) flagged in exclusion zone`,
        data: { violations: exclusionViolations },
      });
    }

    const commits = this.ctx.session.commitments![speaker];
    commits.asserted.push(...claimsResult.commitments.asserted);
    commits.conceded.push(...claimsResult.commitments.conceded);
    commits.challenged.push(...claimsResult.commitments.challenged);

    trace.candidates_accepted = claimsResult.accepted.length;
    trace.candidates_rejected = claimsResult.rejected.length;
    trace.rejection_reasons = claimsResult.rejectionReasons;
    trace.rejected_overlap_pcts = claimsResult.rejectedOverlapPcts;
    trace.max_overlap_vs_existing = claimsResult.maxOverlapVsExisting;

    const accepted = claimsResult.accepted;
    const rejected = claimsResult.rejected;

    this.ctx.session.diagnostics!.overview.claims_accepted += accepted.length;
    this.ctx.session.diagnostics!.overview.claims_rejected += rejected.length;

    // QBAF: recompute strengths after each extraction
    if (an.nodes.some(n => n.base_strength != null)) {
      const qbafNodes = an.nodes
        .filter(n => n.base_strength != null)
        .map(n => ({ id: n.id, base_strength: n.base_strength! }));
      const qbafEdges = an.edges.map(e => ({
        source: e.source,
        target: e.target,
        type: e.type,
        weight: e.weight ?? 0.5,
        attack_type: e.attack_type,
      }));
      const result = computeQbafStrengths(qbafNodes, qbafEdges);
      this.ctx.session.last_qbaf_result = { iterations: result.iterations, converged: result.converged, oscillationDetected: result.oscillationDetected, dampingLevel: result.dampingLevel };
      this.ctx.session.max_qbaf_damping_level = Math.max(this.ctx.session.max_qbaf_damping_level ?? 0, result.dampingLevel ?? 0);
      this.ctx.session.qbaf_runs_total = (this.ctx.session.qbaf_runs_total ?? 0) + 1;
      if ((result.dampingLevel ?? 0) > 0) this.ctx.session.qbaf_runs_oscillated = (this.ctx.session.qbaf_runs_oscillated ?? 0) + 1;
      if (!result.converged) {
        console.warn(`[qbaf-non-convergence] iterations=${result.iterations} oscillation=${result.oscillationDetected} damping=${result.dampingLevel} nodes=${qbafNodes.length} edges=${qbafEdges.length}`);
        getGlobalRecorder()?.record({
          type: 'qbaf.non_convergence', component: 'debate-engine', level: 'warn',
          debate_id: this.ctx.session?.id,
          message: `QBAF non-convergence: ${result.iterations} iterations, damping level ${result.dampingLevel}`,
          data: { iterations: result.iterations, oscillationDetected: result.oscillationDetected, dampingLevel: result.dampingLevel, nodes: qbafNodes.length, edges: qbafEdges.length },
        });
      }
      for (const node of an.nodes) {
        const strength = result.strengths.get(node.id);
        if (strength !== undefined && Number.isFinite(strength)) node.computed_strength = strength;
      }

      // Update convergence tracker with QBAF strengths (t/284: also update
      // the heuristic `convergence` field so it doesn't stay at default 0.5)
      if (this.ctx.session.convergence_tracker) {
        for (const issue of this.ctx.session.convergence_tracker.issues) {
          const qbafConv = computeQbafConvergence(issue.claim_ids, result.strengths);
          if (qbafConv !== undefined) {
            issue.qbaf_strength = qbafConv;
            issue.convergence = qbafConv;
            issue.history.push({ turn: turnNumber, value: qbafConv });
          }
        }
        this.ctx.session.convergence_tracker.last_updated_turn = turnNumber;
      }

      // Snapshot timeline: capture all computed_strengths at this turn
      if (!this.ctx.session.qbaf_timeline) this.ctx.session.qbaf_timeline = [];
      const strengths: Record<string, number> = {};
      const bdiBd: Record<string, import('./types.js').BdiSubScores> = {};
      for (const node of an.nodes) {
        if (node.computed_strength != null) strengths[node.id] = node.computed_strength;
        if (node.bdi_sub_scores) bdiBd[node.id] = node.bdi_sub_scores;
      }
      this.ctx.session.qbaf_timeline.push({
        turn: turnNumber,
        strengths,
        bdi_breakdown: Object.keys(bdiBd).length > 0 ? bdiBd : undefined,
      });

      // Compute per-entry net delta: sum of strength changes caused by this turn's claims
      const prevSnapshot = this.ctx.session.qbaf_timeline.length >= 2
        ? this.ctx.session.qbaf_timeline[this.ctx.session.qbaf_timeline.length - 2].strengths
        : {};
      let netDelta = 0;
      for (const [id, strength] of Object.entries(strengths)) {
        netDelta += strength - (prevSnapshot[id] ?? 0);
      }
      // Store on the transcript entry metadata
      const entry = this.ctx.session.transcript.find(e => e.id === entryId);
      if (entry) {
        if (!entry.metadata) entry.metadata = {};
        entry.metadata.qbaf_net_delta = netDelta;
      }
    }

    // Convergence signals + process rewards (t/282, t/283)
    try {
      // Build turn embeddings map from cached session data + current turn
      let turnEmbeddings: Map<string, number[]> | undefined;
      const cached = this.ctx.session.turn_embeddings ?? {};
      const adapter = this.ctx.adapter as ExtendedAIAdapter;
      if (adapter.computeQueryEmbedding) {
        const currentEntry = this.ctx.session.transcript.find(e => e.id === entryId);
        if (currentEntry && !cached[entryId]) {
          try {
            const { vector } = await adapter.computeQueryEmbedding(currentEntry.content.slice(0, 1000));
            if (vector && vector.length > 0) cached[entryId] = vector;
          } catch { /* telemetry — silent by design: turn embedding is best-effort */ }
        }
        // Prune stale entries — keep most recent 30
        const recentIds = new Set(this.ctx.session.transcript.slice(-30).map(e => e.id));
        for (const key of Object.keys(cached)) {
          if (!recentIds.has(key)) delete cached[key];
        }
        this.ctx.session.turn_embeddings = cached;
        if (Object.keys(cached).length > 0) {
          turnEmbeddings = new Map(Object.entries(cached));
        }
      }

      // Precomputed QBAF strengths map (available from the QBAF block above)
      const precomputedStrengths = new Map<string, number>();
      for (const node of an.nodes) {
        if (node.computed_strength != null) precomputedStrengths.set(node.id, node.computed_strength);
      }

      const sig = computeConvergenceSignals(
        entryId,
        speaker,
        this.ctx.session.transcript,
        an.nodes,
        an.edges,
        this.ctx.session.convergence_signals ?? [],
        turnEmbeddings,
        precomputedStrengths,
        this.ctx.session.topic?.embedding,
        this.ctx.session.topic?.clause_embeddings,
        this.ctx.session.crux_tracker,
      );
      if (!this.ctx.session.convergence_signals) this.ctx.session.convergence_signals = [];
      this.ctx.session.convergence_signals.push(sig);

      if (sig.concession_opportunity.outcome === 'taken' && this.ctx.session.convergence_tracker) {
        const cruxIds = this.ctx.session.crux_tracker
          ? new Set(this.ctx.session.crux_tracker.flatMap(c => c.attacking_claim_ids))
          : undefined;
        const boostedIds = boostConvergenceOnConcession(
          this.ctx.session.convergence_tracker,
          sig,
          entryId,
          speaker,
          an.nodes,
          an.edges,
          turnNumber,
          cruxIds,
        );
        if (boostedIds.length > 0) {
          getGlobalRecorder()?.record({
            type: 'debate.signal', component: 'debate-engine', level: 'info',
            debate_id: this.ctx.session?.id,
            message: `Concession convergence boost: ${boostedIds.length} issue(s) boosted for ${speaker}`,
            data: { boosted_issue_ids: boostedIds, speaker },
          });
        }
      }

      // Taxonomy CONVERGES_WITH edge boost
      if (this.ctx.session.convergence_tracker && this.ctx.taxonomy.edges?.edges) {
        const taxBoostedIds = boostConvergenceFromTaxonomyEdges(
          this.ctx.session.convergence_tracker,
          this.ctx.taxonomy.edges.edges,
          an.nodes,
          turnNumber,
        );
        if (taxBoostedIds.length > 0) {
          getGlobalRecorder()?.record({
            type: 'debate.signal', component: 'debate-engine', level: 'info',
            debate_id: this.ctx.session?.id,
            message: `Taxonomy CONVERGES_WITH boost: ${taxBoostedIds.length} issue(s) boosted`,
            data: { boosted_issue_ids: taxBoostedIds },
          });
        }
      }

      // Crux refresh after concession cascade
      if (this.ctx.session.convergence_signals && this.ctx.session.crux_tracker) {
        const activeCruxes = this.ctx.session.crux_tracker.filter(c => c.state !== 'resolved' && c.state !== 'irreducible');
        if (activeCruxes.length > 0) {
          const cascade = detectConcessionCascade(this.ctx.session.convergence_signals);
          if (cascade.detected) {
            const recentConcessions = cascade.concessions.map(c => {
              const entry = this.ctx.session.transcript.find(e => e.id === c.entry_id);
              return { speaker: c.speaker, conceded_text: entry?.content?.slice(0, 300) ?? '' };
            });
            const recentTranscript = this.ctx.session.transcript
              .slice(-6)
              .map(e => `[${e.speaker}]: ${e.content?.slice(0, 200) ?? ''}`)
              .join('\n');
            const refreshPrompt = cruxRefreshPrompt(
              activeCruxes.map(c => ({ id: c.id, description: c.description, polarity: c.support_polarity, disagreement_type: c.disagreement_type })),
              recentConcessions,
              recentTranscript,
              (this.ctx.session.topic as { text?: string })?.text ?? '',
            );
            try {
              const cruxModel = this.ctx.resolveStageModel('crux');
              const refreshRaw = this.ctx.config.usageDeps
                ? (await callByUsage('debate.crux-refresh', { prompt: refreshPrompt }, this.ctx.config.usageDeps, { model: cruxModel })).text
                : await this.ctx.adapter.generateText(refreshPrompt, cruxModel, { timeoutMs: 15_000 });
              const refreshData = parseJsonRobust(refreshRaw) as {
                crux_verdicts?: { id: string; verdict: string; reason: string }[];
                emerging_cruxes?: { description: string; speakers_involved: string[]; disagreement_type: string; reason: string }[];
              };
              let transitioned = 0;
              if (refreshData?.crux_verdicts) {
                for (const v of refreshData.crux_verdicts) {
                  if (v.verdict === 'resolved' || v.verdict === 'superseded') {
                    const idx = this.ctx.session.crux_tracker!.findIndex(c => c.id === v.id);
                    if (idx >= 0) {
                      this.ctx.session.crux_tracker![idx] = transitionCrux(
                        this.ctx.session.crux_tracker![idx], 'resolved', turnNumber,
                        `${v.verdict} by concession cascade: ${v.reason}`,
                      );
                      transitioned++;
                    }
                  }
                }
              }
              getGlobalRecorder()?.record({
                type: 'debate.crux_refresh', component: 'debate-engine', level: 'info',
                debate_id: this.ctx.session?.id,
                message: `Crux refresh after cascade: ${transitioned} transitioned, ${refreshData?.emerging_cruxes?.length ?? 0} emerging`,
                data: {
                  cascade_concessions: cascade.concessions.length,
                  verdicts: refreshData?.crux_verdicts ?? [],
                  emerging: refreshData?.emerging_cruxes ?? [],
                  transitioned,
                },
              });
            } catch (err) {
              getGlobalRecorder()?.record({
                type: 'system.error', component: 'debate-engine', level: 'warn',
                debate_id: this.ctx.session?.id,
                message: `Crux refresh failed: ${String(err)}`,
                error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
              });
            }
          }
        }
      }

      // Process reward — requires turn validation from this entry
      const turnTrail = this.ctx.session.turn_validations?.[entryId];
      const turnValidation = turnTrail?.final;
      if (turnValidation) {
        const currentEntry = this.ctx.session.transcript.find(e => e.id === entryId);
        const entryMeta = currentEntry?.metadata as Record<string, unknown> | undefined;
        const moveTypes = (entryMeta?.move_types as (string | import('./helpers.js').MoveAnnotation)[]) ?? [];
        const phase = ((entryMeta?.debate_phase as string) ?? 'argumentation') as DebatePhase;

        const priorSpeakerEntry = this.ctx.session.transcript
          .filter(e => e.speaker === speaker && e.type === 'statement')
          .slice(-2)[0];
        const priorMeta = priorSpeakerEntry?.metadata as Record<string, unknown> | undefined;
        const priorMoves = (priorMeta?.move_types as (string | import('./helpers.js').MoveAnnotation)[]) ?? [];

        const pr = computeProcessReward({
          convergenceSignals: sig,
          turnValidation,
          phase,
          moveCount: moveTypes.length,
          priorMoveCount: priorMoves.length > 0 ? priorMoves.length : undefined,
          taxonomyRefCount: currentEntry?.taxonomy_refs?.length ?? 0,
          activeCruxCount: this.ctx.session.crux_tracker
            ? this.ctx.session.crux_tracker.filter(c => c.state !== 'resolved' && c.state !== 'irreducible').length
            : 0,
        });

        const prEntry: ProcessRewardEntry = {
          entry_id: entryId,
          round: sig.round,
          speaker,
          phase,
          score: pr.score,
          components: pr.components,
        };
        if (!this.ctx.session.process_rewards) this.ctx.session.process_rewards = [];
        this.ctx.session.process_rewards.push(prEntry);
      }
    } catch (convErr) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.ctx.session?.id, message: 'Convergence signal/process-reward computation failed', error: { name: (convErr as Error).name ?? 'Error', message: String(convErr), stack: (convErr as Error).stack } });
      console.warn('[Convergence] Signal/process-reward computation failed (non-blocking):', convErr);
    }

    // Finalize trace
    trace.candidates_accepted = accepted.length;
    trace.candidates_rejected = rejected.length;
    trace.an_node_count_after = an.nodes.length;
    trace.an_nodes_added_ids = accepted.map(a => a.id);
    if (accepted.length === 0 && trace.status === 'ok') {
      trace.status = 'no_new_nodes';
    }

    this.ctx.recordDiagnostic(entryId, {
      extracted_claims: { accepted, rejected },
      claim_extraction: {
        prompt,
        raw_response: text,
        response_time_ms: extractElapsed,
        claims_parsed: claims.length,
        schemes_classified: claims.flatMap(c => c.responds_to ?? [])
          .filter(r => r.argumentation_scheme)
          .map(r => r.argumentation_scheme!),
      },
      extraction_trace: trace,
      entailment_repairs: entailmentRepairs.length > 0 ? entailmentRepairs : undefined,
    });

    this.updateExtractionSummary(trace);

    // Update unanswered claims ledger
    this.ctx.session.unanswered_claims_ledger = updateUnansweredLedger(
      this.ctx.session.unanswered_claims_ledger ?? [],
      an.nodes,
      an.edges,
      turnNumber,
    );

    // Update crux resolution tracker
    this.ctx.session.crux_tracker = updateCruxTracker(
      this.ctx.session.crux_tracker,
      an.nodes,
      an.edges,
      this.ctx.session.commitments ?? {},
      turnNumber,
    );
  }

  // ── Private helpers ────────────────────────────────────────

  /**
   * Detect sycophancy: if self_similarity decreased monotonically for 3+ turns
   * AND opponent_similarity increased monotonically for any opponent for 3+ turns
   * AND no concessions were made during those turns.
   */
  private detectSycophancy(speaker: Exclude<SpeakerId, 'user'>, round: number): void {
    // Per-claim tracking handles sycophancy detection when active
    if (this._openingClaims.size > 0) return;

    const drift = this.ctx.session.position_drift ?? [];
    const speakerDrift = drift.filter(d => d.speaker === speaker);
    if (speakerDrift.length < 3) return;

    const recent = speakerDrift.slice(-3);

    // Check monotonic self_similarity decrease
    const selfDecreasing = recent.every((d, i) =>
      i === 0 || d.self_similarity < recent[i - 1].self_similarity,
    );
    if (!selfDecreasing) return;

    // Check if any opponent similarity is monotonically increasing
    const opponents = Object.keys(recent[0].opponent_similarities);
    const driftingToward = opponents.find(opp =>
      recent.every((d, i) =>
        i === 0 || (d.opponent_similarities[opp] ?? 0) > (recent[i - 1].opponent_similarities[opp] ?? 0),
      ),
    );
    if (!driftingToward) return;

    // Check no concessions in those turns
    const concessions = this.ctx.session.commitments?.[speaker]?.conceded ?? [];
    // If recent concessions exist, this might be genuine agreement
    if (concessions.length > 0) {
      // Check if any concessions were made in the drift window (heuristic: recent concessions)
      const recentRounds = new Set(recent.map(d => d.round));
      // Can't precisely match concession to round, so skip flag if ANY concessions exist recently
      return;
    }

    const speakerLabel = POVER_INFO[speaker]?.label ?? speaker;
    const opponentLabel = POVER_INFO[driftingToward as Exclude<SpeakerId, 'user'>]?.label ?? driftingToward;

    const sycEntry = this.ctx.addEntry({
      type: 'system',
      speaker: 'system',
      content: `[Sycophancy guard] ${speakerLabel} appears to be drifting toward ${opponentLabel}'s position over the last 3 turns without explicit concession. Self-similarity: ${recent.map(d => d.self_similarity.toFixed(2)).join(' → ')}. Consider whether this represents genuine agreement or accommodation.`,
      taxonomy_refs: [],
    });
    this.ctx.recordDiagnostic(sycEntry.id, {
      raw_response: JSON.stringify({ speaker, drifting_toward: driftingToward, recent_drift: recent }),
    });
  }

  /**
   * Run evidence QBAF pipeline for a single Belief claim:
   * 1. Retrieve top-K evidence from source corpus
   * 2. LLM classifies as support/contradict/irrelevant
   * 3. Build QBAF sub-graph and compute strength
   * Returns true if evidence was found and claim was scored.
   */
  private async runEvidenceQbaf(
    node: ArgumentNetworkNode,
    sourcesDir: string,
  ): Promise<boolean> {
    const evidenceItems = retrieveEvidence(node.text, sourcesDir, {
      topK: 10,
      nodeEmbeddings: this.ctx.taxonomy.embeddings,
    });

    if (evidenceItems.length === 0) return false;

    const evalModel = this.ctx.resolveStageModel('evaluator');
    const result = await buildEvidenceQbaf(
      node.text,
      evidenceItems,
      this.ctx.adapter,
      evalModel,
      {
        standardizedTerms: this.ctx.config.vocabulary?.standardizedTerms,
        claimBaseStrength: 0.5,
      },
    );

    if (result.evidence_items.length === 0) return false;

    // Update node with evidence QBAF results
    node.base_strength = factCheckToBaseStrength('evidence_qbaf', undefined, result.computed_strength);
    node.scoring_method = 'fact_check';
    node.verification_status = result.computed_strength >= 0.6 ? 'verified'
      : result.computed_strength <= 0.4 ? 'disputed' : 'unverifiable';
    node.evidence_graph = {
      evidence_items: result.evidence_items,
      computed_strength: result.computed_strength,
      qbaf_iterations: result.qbaf_iterations,
    };

    // Log to transcript
    const supportCount = result.evidence_items.filter(e => e.relation === 'support').length;
    const contradictCount = result.evidence_items.filter(e => e.relation === 'contradict').length;
    this.ctx.session.transcript.push({
      id: generateId(),
      timestamp: nowISO(),
      type: 'fact-check',
      speaker: 'system',
      content: `Claim ${node.id} — evidence QBAF: strength=${result.computed_strength.toFixed(2)} (${supportCount} support, ${contradictCount} contradict, ${result.qbaf_iterations} iterations)`,
      taxonomy_refs: [],
      metadata: {
        source: 'evidence_qbaf',
        claim_id: node.id,
        claim_text: node.text,
        evidence_count: result.evidence_items.length,
        support_count: supportCount,
        contradict_count: contradictCount,
        computed_strength: result.computed_strength,
        qbaf_iterations: result.qbaf_iterations,
      },
    });

    return true;
  }

  // ── Claim extraction ───────────────────────────────────────

  /** Lightweight string hash (djb2) — for detecting prompt drift across runs. */
  private hashString(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }

  /** Heuristic: response looks truncated if it ends mid-JSON or has unbalanced braces. */
  private looksTruncated(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    const last = trimmed[trimmed.length - 1];
    if (last !== '}' && last !== ']' && last !== '`') return true;
    let opens = 0, closes = 0;
    for (const ch of trimmed) {
      if (ch === '{') opens++;
      else if (ch === '}') closes++;
    }
    return opens !== closes;
  }

  /** Recompute the session-level extraction summary + fire plateau system entry on first detection. */
  private updateExtractionSummary(trace: ClaimExtractionTrace): void {
    const diag = this.ctx.session.diagnostics!;
    const traces: ClaimExtractionTrace[] = [];
    for (const entryDiag of Object.values(diag.entries)) {
      if (entryDiag.extraction_trace) traces.push(entryDiag.extraction_trace);
    }

    let totalProposed = 0, totalAccepted = 0, totalRejected = 0;
    const reasonTotals: Record<string, number> = {};
    const growth: { round: number; cumulative_count: number }[] = [];
    for (const t of traces) {
      totalProposed += t.candidates_proposed;
      totalAccepted += t.candidates_accepted;
      totalRejected += t.candidates_rejected;
      for (const [reason, count] of Object.entries(t.rejection_reasons)) {
        reasonTotals[reason] = (reasonTotals[reason] ?? 0) + count;
      }
      growth.push({ round: t.round, cumulative_count: t.an_node_count_after });
    }

    // Plateau: 2+ consecutive recent turns with zero AN nodes added.
    let plateauDetected = false;
    let plateauStartedAt: number | undefined;
    let plateauLastId: string | undefined;
    const ordered = [...traces].sort((a, b) => a.round - b.round);
    let zeroRun = 0;
    let zeroRunStart: number | undefined;
    for (const t of ordered) {
      if (t.an_nodes_added_ids.length === 0) {
        if (zeroRun === 0) zeroRunStart = t.round;
        zeroRun++;
        if (zeroRun >= 2 && !plateauDetected) {
          plateauDetected = true;
          plateauStartedAt = zeroRunStart;
          plateauLastId = `AN-${t.an_node_count_before}`;
        }
      } else {
        zeroRun = 0;
        zeroRunStart = undefined;
      }
    }

    const wasDetected = this.ctx.session.extraction_summary?.plateau_detected === true;
    // Compute unattributed claim ratio from attribution traces
    let totalAttributed = 0, totalUnattributed = 0;
    for (const t of traces) {
      totalAttributed += t.attribution_attributed ?? 0;
      totalUnattributed += t.attribution_unattributed ?? 0;
    }
    const totalAttrClaims = totalAttributed + totalUnattributed;
    const unattributedRatio = totalAttrClaims > 0 ? totalUnattributed / totalAttrClaims : undefined;

    if (unattributedRatio !== undefined && unattributedRatio > 0.50) {
      console.warn(`[attribution.high-unattributed] ${(unattributedRatio * 100).toFixed(0)}% of claims unattributed (${totalUnattributed}/${totalAttrClaims}) — may indicate stale taxonomy or broken injection`);
    }

    const summary: ExtractionSummary = {
      total_turns: traces.length,
      total_proposed: totalProposed,
      total_accepted: totalAccepted,
      total_rejected: totalRejected,
      acceptance_rate: totalProposed > 0 ? totalAccepted / totalProposed : 0,
      an_growth_series: growth,
      plateau_detected: plateauDetected,
      plateau_started_at_turn: plateauStartedAt,
      plateau_last_an_id: plateauLastId,
      rejection_reason_totals: reasonTotals,
      unattributed_claim_ratio: unattributedRatio,
    };
    this.ctx.session.extraction_summary = summary;

    // Emit a one-shot [Extraction plateau] system entry when plateau is first detected.
    if (plateauDetected && !wasDetected) {
      const reasonCluster = Object.entries(trace.rejection_reasons)
        .map(([r, c]) => `${r}×${c}`).join(', ') || 'empty_response';
      const lastId = plateauLastId ?? 'AN-?';
      const plateauEntry = this.ctx.addEntry({
        type: 'system',
        speaker: 'system',
        content:
          `[Extraction plateau] No new AN nodes since ${lastId} (turn ${plateauStartedAt}). ` +
          `Reason cluster: ${reasonCluster}. See Diagnostics → Extraction Timeline.`,
        taxonomy_refs: [],
      });
      this.ctx.recordDiagnostic(plateauEntry.id, {
        raw_response: JSON.stringify(summary),
      });
    }
  }
}
