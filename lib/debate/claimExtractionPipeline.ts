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

import type {
  SpeakerId,
  ArgumentNetworkNode,
} from './types.js';
import type { UnengagedNode } from './gapCheck.js';

import type { ClaimExtractionContext } from './claimExtractionPipeline/context.js';
import { extractClaims } from './claimExtractionPipeline/extract.js';
import {
  runGapInjection,
  computeResponsiveGap,
  runCrossCuttingProposalPass,
  runTaxonomyGapAnalysisPass,
  runSituationRefExtraction,
  cacheOpeningEmbeddings,
  cacheOpeningClaims,
  trackPerClaimDrift,
  trackPositionDrift,
  runPostDebateCalibration,
  validateSteelmans,
  verifyPreciseClaims,
} from './claimExtractionPipeline/gapAndDrift.js';

// Re-export the context type so consumers keep importing it from this path.
export type { ClaimExtractionContext } from './claimExtractionPipeline/context.js';

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
    const injected = await runGapInjection(this.ctx, round, trigger, focusNodes);
    if (injected) this._gapInjectionCount++;
  }

  /**
   * Periodic responsive gap check — finds high-relevance taxonomy nodes
   * that no debater has engaged and triggers a focused gap injection.
   * Deterministic check; LLM called only if unengaged nodes found.
   */
  async runResponsiveGapCheck(round: number, initialGapRound: number): Promise<void> {
    const unengaged = computeResponsiveGap(this.ctx, round, initialGapRound, this._gapInjectionCount);

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
    await runCrossCuttingProposalPass(this.ctx);
  }

  // ── Taxonomy gap analysis (post-synthesis, deterministic) ──

  /**
   * Post-synthesis pass: compute deterministic taxonomy coverage analysis.
   * Identifies per-POV coverage, BDI balance, unmapped arguments, and cross-POV gaps.
   * No LLM calls — purely deterministic computation.
   * Non-blocking — failure never blocks debate results.
   */
  runTaxonomyGapAnalysisPass(): void {
    runTaxonomyGapAnalysisPass(this.ctx);
  }

  // ── Situation debate_refs extraction (t/193) ────────────

  /**
   * Post-debate pass that identifies which situations were substantively
   * discussed and stores the references on the session for consumers
   * to write back to situation nodes in the taxonomy.
   */
  runSituationRefExtraction(): void {
    runSituationRefExtraction(this.ctx);
  }

  // ── Position drift detection (sycophancy guard) ────────────

  /**
   * Cache opening statement embeddings for drift comparison.
   * Called once after all opening statements are generated.
   */
  async cacheOpeningEmbeddings(): Promise<void> {
    await cacheOpeningEmbeddings(this.ctx, this._openingEmbeddings);
  }

  /**
   * Cache opening claim embeddings from the AN for per-claim drift tracking.
   * Called after opening statements + first AN extraction.
   */
  async cacheOpeningClaims(): Promise<void> {
    await cacheOpeningClaims(this.ctx, this._openingClaims);
  }

  /**
   * Track per-claim drift: compare each opening claim embedding against
   * current-round claims to classify as maintained/refined/abandoned.
   */
  async trackPerClaimDrift(
    speaker: Exclude<SpeakerId, 'user'>,
    round: number,
  ): Promise<void> {
    await trackPerClaimDrift(this.ctx, this._openingClaims, speaker, round);
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
    await trackPositionDrift(this.ctx, this._openingEmbeddings, this._openingClaims, speaker, responseText, round);
  }

  // ── Post-debate calibration ──────────────────────────────────

  /**
   * After debate, run the relevance threshold optimizer and apply the
   * recommendation if safety rails pass. Non-critical — failures are logged
   * but never affect the completed debate.
   */
  runPostDebateCalibration(dataRoot: string): void {
    runPostDebateCalibration(this.ctx, dataRoot);
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
    await validateSteelmans(this.ctx, newNodes, speaker);
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
    await verifyPreciseClaims(this.ctx, newNodes);
  }

  // ── Claim extraction ───────────────────────────────────────

  async extractClaims(
    statement: string,
    speaker: Exclude<SpeakerId, 'user'>,
    entryId: string,
    taxonomyRefIds: string[],
    debaterClaims?: { claim: string; targets: string[] }[],
  ): Promise<void> {
    await extractClaims(this.ctx, statement, speaker, entryId, taxonomyRefIds, debaterClaims);
  }
}
