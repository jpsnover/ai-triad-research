// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Pure debate orchestration engine — no UI, Zustand, or Electron dependencies.
 * Runs a full structured debate using the AIAdapter interface.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AIAdapter, ExtendedAIAdapter } from './aiAdapter.js';
import type { LoadedTaxonomy } from './taxonomyLoader.js';
import type {
  DebateSession,
  DebateSourceType,
  SpeakerId,
  TranscriptEntry,
  TaxonomyRef,
  ContextSummary,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  CommitmentStore,
  EntryDiagnostics,
  DebateDiagnostics,
  DebatePhase,
  ClaimExtractionTrace,
  ExtractionSummary,
  GapArgument,
  CrossCuttingProposal,
  PhaseTransitionConfig,
  PhaseState,
  PhaseContext,
  SignalContext,
  Signal,
  PredicateResult,
  AdaptiveStagingDiagnostics,
  DebatePacing,
  ConvergenceSignals as ConvergenceSignalsType,
  ProcessRewardEntry,
  TopicScope,
  TopicScopeRiskLevel,
  EntailmentRepairEvent,
} from './types.js';
import { POVER_INFO, getDebatePhase, POV_KEYS, type PovKey } from './types.js';
import {
  loadProvisionalWeights,
  initPhaseState,
  buildSignalRegistry,
  evaluatePhaseTransition,
  applyTransition,
  advanceRound,
  buildPhaseContext,
  buildSignalTelemetry,
  initAdaptiveDiagnostics,
  detectCruxNodes,
  computeSaturationScore,
  computeConvergenceScore,
} from './phaseTransitions.js';
import { updateConfidenceState } from './signalConfidence.js';
import { pruneArgumentNetwork, needsGc } from './networkGc.js';
import type { PovNode, SituationNode } from './taxonomyTypes.js';
import type { TaxonomyContext } from './taxonomyContext.js';
import {
  clarificationPrompt,
  documentClarificationPrompt,
  situationClarificationPrompt,
  concludingPrompt,
  crossRespondSelectionPrompt,
  formatCriticalQuestions,
  selectReframingMetaphor,
  probingQuestionsPrompt,
  entrySummarizationPrompt,
  missingArgumentsPrompt,
  taxonomyRefinementPrompt,
  midDebateGapPrompt,
  crossCuttingNodePrompt,
  moderatorSelectionPrompt,
  moderatorInterventionPrompt,
  decomposeResolutionPrompt,
  topicScopeExtractionPrompt,
  setPromptCompact,
  isCompactModel,
  setTopicScope,
  extractSpeakerVocabulary,
  formatVocabularyExclusion,
  entailmentRepairPrompt,
  cruxRefreshPrompt,
} from './prompts.js';
import { extractClaimsPrompt, classifyClaimsPrompt, formatArgumentNetworkContext, formatCommitments, formatEstablishedPoints, updateUnansweredLedger, formatUnansweredClaimsHint, formatSpecifyHint, formatConcessionCandidatesHint, processExtractedClaims, factCheckToBaseStrength, computeClaimTaxonomyAttribution, sampleNodesForEntailment, type RawExtractedClaim } from './argumentNetwork.js';
import { embedDoctrinalBoundaries, computeDoctrinalAnchoring, checkThresholdAnomalies } from './doctrinalAnchoring.js';
import type { BoundaryEmbeddings, DoctrinalAnchoringConfig } from './doctrinalAnchoring.js';
import { extractCalibrationData, appendCalibrationLog, readCalibrationLog, computeExtractionCoverage } from './calibrationLogger.js';
import { computeStrategicHints } from './strategicHints.js';
import { evaluateLookahead } from './lookaheadGate.js';
import type { LookaheadDiagnostics } from './lookaheadGate.js';
import { computeStructuralScore, critiqueTopicPrompt, formatStructuralContext, formatLineageContext, parseTopicCritique, computeLineageDistribution } from './topicCritique.js';
import { classifyTopicComplexity, extractTopicStructure } from './topicStructure.js';
import type { LineageFrameEntry } from './topicCritique.js';
import {
  optimizeRelevanceThreshold,
  applyRelevanceThresholdAdaptation,
} from './calibrationOptimizer.js';
import { resolveRepoRoot, resolveDataRoot, resolveSourcesDir } from './taxonomyLoader.js';
import { retrieveEvidence } from './evidenceRetriever.js';
import { buildEvidenceQbaf } from './evidenceQbaf.js';
import { updateCruxTracker, formatCruxResolutionContext, detectConcessionCascade, transitionCrux } from './cruxResolution.js';
import { persistDebateCruxes, loadRegistry, findRelevantPriorCruxes, formatPriorCruxContext } from './cruxRegistry.js';
import { findAndEnrichPromotionCandidates } from './cruxTaxonomyFeedback.js';
import { computeConvergenceSignals, boostConvergenceOnConcession, boostConvergenceFromTaxonomyEdges } from './convergenceSignals.js';
import { computeProcessReward } from './processReward.js';
import { runSynthesisPhases } from './synthesisPhases.js';
import { buildMediumTierSummary, buildDistantTierSummary } from './tieredCompression.js';
import { formatTaxonomyContext, computeInjectionManifest } from './taxonomyContext.js';
import { formatVocabularyContext } from './vocabularyContext.js';
import { disambiguateTerms } from './vocabularyDisambiguation.js';
import type { CampOrigin } from '../dictionary/types.js';
import type { ContextInjectionManifest } from './taxonomyContext.js';
import { documentAnalysisPrompt, buildTaxonomySample } from './documentAnalysis.js';
import type { DocumentAnalysis } from './types.js';
import { runNeutralEvaluation, buildSpeakerMapping } from './neutralEvaluator.js';
import type { SpeakerMapping, NeutralEvaluation } from './neutralEvaluator.js';
import {
  cosineSimilarity,
  scoreNodeRelevance,
  scoreNodesLexical,
  scoreNodesViaAN,
  selectRelevantNodes,
  selectRelevantSituationNodes,
  buildRelevanceQuery,
  computePolicymakerRelevanceBoost,
  type RelevanceOptions,
  type ANClaimEmbedding,
  reScoreSituationsForCruxes,
  filterByTopicConstraints,
} from './taxonomyRelevance.js';
import {
  generateId,
  nowISO,
  parseJsonRobust,
  formatRecentTranscript,
  parsePoverResponse,
  getMoveName,
  wordOverlap,
} from './helpers.js';
import { computeQbafStrengths, computeQbafConvergence } from './qbaf.js';
import { computeCoverageMap, computeStrengthWeightedCoverage } from './coverageTracker.js';
import { generateDialecticTraces } from './dialecticTrace.js';
import { computeTaxonomyGapAnalysis } from './taxonomyGapAnalysis.js';
import { extractSituationDebateRefs } from './situationRefs.js';
import { checkClaimExclusionBoundary, checkDraftScopeBoundary, filterByExclusionAbsolute, EXCLUSION_RATIO_THRESHOLD, SCOPE_BOUNDARY_THRESHOLD } from './exclusionGuard.js';
import { ActionableError } from './errors.js';
import { computeCampInsularityRate, isInsularityCritical, selectCrossCampNode, type InsularityInjection } from './schemeStagnation.js';
import { nodePovFromId } from './nodeIdUtils.js';
import type { ContextManifestEntry } from './taxonomyGapAnalysis.js';
import { resolveTurnValidationConfig, classifyHintKey } from './turnValidator.js';
import type { TurnValidation, ModeratorState, ModeratorIntervention, SelectionResult, InterventionMove } from './types.js';
import { MOVE_TO_FAMILY, FAMILY_BURDEN_WEIGHT, MOVE_TO_FORCE, HINT_SUPPRESSION_THRESHOLD } from './types.js';
import {
  initModeratorState,
  validateRecommendation,
  updateModeratorState,
  computeDebateHealthScore,
  updateSliBreaches,
  computeTriggerEvaluationContext,
  formatTriggerContext,
  buildIntervention,
  buildInterventionBriefInjection,
  checkInterventionCompliance,
  getConcludingResponder,
  MOVE_RESPONSE_CONFIG,
  DIRECT_RESPONSE_PATTERNS,
  updateCruxEngagement,
} from './moderator.js';
import { runModeratorSelection, executeTurnWithRetry } from './orchestration.js';
import type { ModeratorSelectionCallbacks, ModeratorSelectionInput, TurnRetryCallbacks, TurnRetryInput } from './orchestration.js';
import { pruneSessionData, pruneModeratorState } from './sessionPruning.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';
import { callByUsage } from '../ai-client/usageRegistry.js';
import { runTurnPipeline, assemblePipelineResult, runOpeningPipeline, assembleOpeningPipelineResult, getOpeningRepairHints } from './turnPipeline.js';
import type { TurnPipelineInput, OpeningPipelineInput } from './turnPipeline.js';
import {
  findUnengagedHighRelevanceNodes,
  shouldRunGapCheck,
  collectEngagedNodeIds,
  GAP_CHECK_INTERVAL,
  MAX_GAP_INJECTIONS,
} from './gapCheck.js';
import type { UnengagedNode } from './gapCheck.js';

// ── Model tier ranking (for maxModelId cap filtering) ────

export function modelTierRank(model: string): number {
  const m = model.toLowerCase();
  if (isCompactModel(m)) return 1;
  if (m.includes('flash')) return 2;
  if (m.includes('haiku') || m.includes('deepseek')) return 3;
  if (m.includes('sonnet') || m.includes('llama')) return 3;
  if (m.includes('opus') || m.includes('pro')) return 4;
  return 3;
}

// ── Lifecycle stages (for stopAfterStage on resume) ─────

export type LifecycleStage =
  | 'synthesis-p1' | 'synthesis-p2' | 'synthesis-p3'
  | 'missing-arguments' | 'taxonomy-refinement'
  | 'extraction-coverage' | 'finalization';

// ── Config ───────────────────────────────────────────────

export interface DebateConfig {
  topic: string;
  /** Optional supporting context provided by the user — separate from the debate question. */
  background?: string;
  name?: string;
  sourceType: DebateSourceType;
  sourceRef?: string;
  sourceContent?: string;
  activePovers: Exclude<SpeakerId, 'user'>[];
  protocolId?: string;
  model: string;
  /** @deprecated Use `stageModels.evaluator` instead. Mapped automatically with deprecation warning. */
  evaluatorModel?: string;
  modelTier?: import('./types').ModelTier;
  speakerModels?: Record<string, string>;
  /** Fallback model chain for per-speaker failover. On hard failure (403, 500, empty), the engine tries each model in order, then falls back to the base `model`. Provided by the caller (server or Electron main). */
  fallbackChain?: string[];
  rounds: number;
  responseLength: 'brief' | 'medium' | 'detailed';
  enableClarification?: boolean;
  enableProbing?: boolean;
  probingInterval?: number;
  temperature?: number;
  /** Per-turn validation settings. Default: enabled, maxRetries=2. */
  turnValidation?: import('./types').TurnValidationConfig;
  /** App version string to stamp on the session. */
  appVersion?: string;
  /** Target audience for tone, language, and concern prioritization. */
  audience?: import('./types').DebateAudience;
  /** Round at which to inject gap arguments (0 = disabled, default = ceil(totalRounds/2)+1). */
  gapInjectionRound?: number;
  /** How often (in rounds) to run the responsive gap check after the initial injection. Default: 3. */
  gapCheckInterval?: number;
  /** Maximum total gap injections per debate (initial + responsive). Default: 3. */
  maxGapInjections?: number;
  /** Vocabulary terms for standardized term enforcement in persona prompts. */
  vocabulary?: {
    standardizedTerms: import('../dictionary/types').StandardizedTerm[];
    colloquialTerms: import('../dictionary/types').ColloquialTerm[];
  };
  /** Enable adaptive phase transitions instead of fixed round counts. */
  useAdaptiveStaging?: boolean;
  /** Pacing preset — controls max rounds and exit thresholds. Default: 'moderate'. */
  pacing?: DebatePacing;
  /** Override max total rounds (otherwise derived from pacing preset). */
  maxTotalRounds?: number;
  /** Override exploration exit threshold (otherwise derived from pacing preset). */
  argumentationExitThreshold?: number;
  /** Override synthesis exit threshold (otherwise derived from pacing preset). */
  concludingExitThreshold?: number;
  /** Allow early termination on health collapse. Default: true when adaptive staging is on. */
  allowEarlyTermination?: boolean;
  /** AbortSignal for external cancellation. When aborted, the engine stops at the next checkpoint. */
  signal?: AbortSignal;
  /** Model cost-tier ceiling for the failover chain. When set, `buildFailoverChain` filters out models with a higher tier rank than this model. Prevents cheap-run cost escalation via fallback. */
  maxModelId?: string;
  /** When set, `resume()` exits cleanly after the named lifecycle stage completes, returning the partial session. Used by the fault-injection harness to test individual pipeline stages. */
  stopAfterStage?: LifecycleStage;
  /** Minimum delay (ms) between consecutive API calls. 0 = no throttle (default). Recommended: 500-1000 for free-tier APIs. */
  throttleMs?: number;
  /** Perturbation testing config — inject adversarial prompt at a specific turn for resilience evaluation. Evaluation/benchmark only. */
  perturbation?: import('./types').PerturbationConfig;
  /** Run topic wisdom scoring at setup. Default: true. */
  enableWisdomEvaluation?: boolean;
  /** Composite score (0-20) below which topic reframing triggers. Default: 10. */
  wisdomReframeThreshold?: number;
  /** Auto-apply rewritten topic when below threshold. Default: true. When false, score is computed but topic is not reframed. */
  wisdomAutoReframe?: boolean;
  /** Embedding callback for crux registry dedup and seeding. When provided, enables cross-debate crux persistence. */
  embedFn?: (text: string) => Promise<number[]>;
  /** Enable salience beacon in draft prompts to reduce scope drift (experiment). */
  salienceBeacon?: boolean;
  /** Enable cross-camp node injection when camp insularity is critical (BEA RUE). Default: false. */
  enableInsularityIntervention?: boolean;
  /** Enable stagnation-gated diversity-injection round (t/1280). Off by default — experiment flag. */
  enableDiversityRound?: boolean;
  /** Exploration summary from a prior cheap-engine run — seeds cruxes, situations, AN priming, and config overrides. */
  explorationSummary?: import('./explorationSummary.js').ExplorationSummary;
  /** Use restructured BRIEF prompt (YOUR TASK → REFERENCE → CURRENT STATE) instead of inline context. Experiment flag (t/1029). */
  useBackgroundPrompt?: boolean;
  /** Per-stage model overrides. Omitting a key falls back to `model`. */
  stageModels?: {
    brief?: string;
    plan?: string;
    draft?: string;
    cite?: string;
    evaluator?: string;
    scope?: string;
    summary?: string;
    moderator?: string;
    crux?: string;
  };
  /** @deprecated Use `stageModels` instead. Mapped automatically with deprecation warning. */
  utilityModels?: {
    summary?: string;
    scope?: string;
    moderator?: string;
    crux?: string;
  };
  /** Snapshot callback for incremental persistence. Fired after each completed round and before rethrowing on fatal errors. Callers use this to write crash-recovery files. */
  onSnapshot?: (session: DebateSession, trigger: 'round_complete' | 'error') => void;
  /** UsageID call dependencies. When present, eligible call sites use `callByUsage()` from the usage registry instead of direct adapter calls. */
  usageDeps?: import('../ai-client/usageRegistry.js').UsageCallDeps;
}

export interface DebateProgress {
  phase: string;
  speaker?: string;
  round?: number;
  totalRounds?: number;
  message: string;
  /** Present when phase is 'retry' — retry attempt details. */
  retry?: { attempt: number; maxRetries: number; backoffSeconds: number };
}

// ── Engine ────────────────────────────────────────────────

export class DebateEngine {
  private config: DebateConfig;
  private adapter: AIAdapter;
  private taxonomy: LoadedTaxonomy;
  private session!: DebateSession;
  private onProgress?: (p: DebateProgress) => void;
  private apiCallCount = 0;
  private totalResponseTimeMs = 0;
  private lastApiCallTime = 0;
  /** Last computed injection manifest — stored on transcript entries for usage analysis. */
  private _lastInjectionManifest: ContextInjectionManifest | null = null;
  /** Full relevance score map (POV + situation nodes) from last context build. */
  private _lastRelevanceScores: Map<string, number> | null = null;
  /** Activated situation nodes from last context injection — for AN situation grounding (t/243). */
  private _activatedSituations: { id: string; text: string }[] = [];
  /** Speaker mapping for neutral evaluator — built once, reused across checkpoints. */
  private _neutralMapping: SpeakerMapping | null = null;
  /** Whether the midpoint neutral evaluation has already run this debate. */
  private _midpointEvalDone = false;
  /** Cached opening statement embeddings for position drift detection. */
  private _openingEmbeddings = new Map<string, number[]>();
  /** Cached opening claim embeddings for per-claim drift tracking. */
  private _openingClaims = new Map<string, Array<{ id: string; text: string; embedding: number[] }>>();
  /** How many gap injections have fired so far (initial + responsive). */
  private _gapInjectionCount = 0;
  /** Perturbation injection transcript entry ID — set when perturbation fires. */
  private _perturbationEntryId: string | null = null;
  /** Accumulated context manifests across turns — for taxonomy gap analysis. */
  private _contextManifests: ContextManifestEntry[] = [];
  /** Adaptive situation score adjustments from crux re-scoring at phase transitions. */
  private _situationScoreAdjustments: Map<string, number> | null = null;
  /** Lazy-built set of every taxonomy node id in the loaded taxonomy. */
  private _knownNodeIds: Set<string> | null = null;
  /** Lazy-built set of every policy id in the loaded policy registry. */
  private _policyIds: Set<string> | null = null;
  /** Active moderator state — tracks budget, cooldown, burden, and intervention history. */
  private _moderatorState: ModeratorState | null = null;
  /** Adaptive staging: phase transition config. */
  private _adaptiveConfig: PhaseTransitionConfig | null = null;
  /** Adaptive staging: mutable phase state. */
  private _phaseState: PhaseState | null = null;
  /** Adaptive staging: signal registry. */
  private _signalRegistry: Signal[] | null = null;
  /** Adaptive staging: diagnostics accumulator. */
  private _adaptiveDiagnostics: AdaptiveStagingDiagnostics | null = null;
  /** Cached doctrinal boundary embeddings (computed once at debate setup). */
  private _boundaryEmbeddings: BoundaryEmbeddings | null = null;
  /** Adaptive staging: per-signal historical values for moving averages. */
  private _signalHistory: Map<string, { round: number; value: number }[]> = new Map();
  /** Adaptive staging: peak tracker for engagement ratio and claims per round. */
  private _peakTrackers: Map<string, number> = new Map();
  /** Debate-wide hint failure streaks for hopeless hint suppression.
   *  Tracked globally (not per-speaker) because hint suppressibility is a model
   *  capability — if the model can't produce specific claims for one speaker,
   *  it can't for any of them. */
  private _hintStreaks = new Map<string, import('./types').HintStreak>();
  /** Cached prior crux context string — seeded from registry at debate start, injected into Brief stage. */
  private _priorCruxContext: string = '';
  /** Situation score adjustments from exploration summary (effective → boost, ineffective → penalty). */
  private _explorationBoosts: Map<string, number> = new Map();
  /** Formatted exploration priming text (AN sketch + convergence areas) for Brief prompt injection. */
  private _explorationPriming: string = '';
  /** Insularity interventions fired during this debate (for calibration logging). */
  private _insularityInterventions: { speaker: string; round: number; injected_node_id: string; target_camp: string }[] = [];
  /** Last relevance scores from getRelevantTaxonomyContext — used by insularity injection. */
  private _lastRelevanceScores: Map<string, number> | null = null;
  /** Adaptive backoff (ms) imposed after a 429 rate-limit error is detected. */
  private _rateLimitBackoffMs = 0;
  /** Timestamp of the last 429 detection — used with _rateLimitBackoffMs in throttle(). */
  private _lastRateLimitTime = 0;

  /** Get the set of hint keys currently suppressed for this debate. */
  private getSuppressedHints(): Set<string> {
    const suppressed = new Set<string>();
    for (const [key, streak] of this._hintStreaks) {
      if (streak.suppressed) suppressed.add(key);
    }
    return suppressed;
  }

  /** Re-score situations against emerging cruxes at phase transitions. */
  private _rescoreSituations(): void {
    if (!this.session.crux_tracker?.length) return;

    const sitNodes = (this.taxonomy as Record<string, { nodes?: SituationNode[] }>).situations?.nodes ?? [];
    const anForRescore = this.session.argument_network;
    if (!sitNodes.length || !anForRescore) return;

    const injectedSitIds = new Set(
      this._contextManifests.flatMap(m => m.injected_node_ids).filter(id => id.startsWith('sit-') || id.startsWith('cc-')),
    );
    const referencedSitIds = new Set(
      this.session.transcript.flatMap(e => e.taxonomy_refs).map(r => r.node_id).filter(id => id.startsWith('sit-') || id.startsWith('cc-')),
    );

    this._situationScoreAdjustments = reScoreSituationsForCruxes({
      situationNodes: sitNodes,
      cruxes: this.session.crux_tracker,
      anNodes: anForRescore.nodes,
      nodeEmbeddings: this.taxonomy.embeddings,
      injectedSitIds,
      referencedSitIds,
      edges: this.taxonomy.edges?.edges,
    });
  }

  private seedExplorationSummary(summary: import('./explorationSummary.js').ExplorationSummary): void {
    if (summary.topic.final !== this.session.topic.final &&
        summary.topic.original !== this.config.topic) {
      getGlobalRecorder()?.record({
        type: 'exploration_seeding', component: 'debate-engine', level: 'warn',
        debate_id: this.session?.id,
        message: 'Exploration summary topic mismatch — skipping seeding',
        data: { summary_topic: summary.topic.final, debate_topic: this.session.topic.final },
      });
      return;
    }

    // Step 1: Crux seeding — merge exploration cruxes into _priorCruxContext
    const unresolvedCruxes = summary.cruxes.filter(c => c.state !== 'resolved');
    if (unresolvedCruxes.length > 0) {
      const cruxLines = unresolvedCruxes.map(
        c => `- [${c.disagreement_type}] "${c.description}" (${c.state})`,
      );
      const explorationCruxBlock = `\n=== EXPLORATION CRUXES ===\n${cruxLines.join('\n')}`;
      this._priorCruxContext += explorationCruxBlock;
      getGlobalRecorder()?.record({
        type: 'exploration_seeding', component: 'debate-engine', level: 'info',
        debate_id: this.session?.id,
        message: `Seeded ${unresolvedCruxes.length} exploration cruxes`,
        data: { step: 'crux_seeding', count: unresolvedCruxes.length },
      });
    }

    // Step 2: Situation pre-filtering — store boost/penalty factors
    for (const sit of summary.effective_situations) {
      this._explorationBoosts.set(sit.id, 0.15);
    }
    for (const sit of summary.ineffective_situations) {
      this._explorationBoosts.set(sit.id, -0.10);
    }
    if (this._explorationBoosts.size > 0) {
      getGlobalRecorder()?.record({
        type: 'exploration_seeding', component: 'debate-engine', level: 'info',
        debate_id: this.session?.id,
        message: `Seeded ${summary.effective_situations.length} boosts, ${summary.ineffective_situations.length} penalties`,
        data: {
          step: 'situation_filtering',
          boosted: summary.effective_situations.length,
          penalized: summary.ineffective_situations.length,
        },
      });
    }

    // Step 3: AN priming — format argument sketch for Brief prompt injection
    const topNodes = [...summary.argument_sketch.nodes]
      .sort((a, b) => b.computed_strength - a.computed_strength)
      .slice(0, 10);
    const primingParts: string[] = [];
    if (topNodes.length > 0) {
      const nodeLines = topNodes.map(
        n => `- [${n.speaker}] (strength: ${n.computed_strength.toFixed(2)}, refs: ${n.taxonomy_refs.join(', ') || 'none'}): "${n.text}"`,
      );
      const edgeLines = summary.argument_sketch.edges
        .filter(e => {
          const topIds = new Set(topNodes.map(n => n.id));
          return topIds.has(e.source) && topIds.has(e.target);
        })
        .map(e => `  ${e.source} → ${e.type} → ${e.target}${e.attack_type ? ` (${e.attack_type})` : ''}`);
      primingParts.push(
        `=== PRIOR ANALYSIS ===\nThe following argument structure was identified in a prior exploration:\n${nodeLines.join('\n')}` +
        (edgeLines.length > 0 ? `\nKey tensions:\n${edgeLines.join('\n')}` : ''),
      );
      getGlobalRecorder()?.record({
        type: 'exploration_seeding', component: 'debate-engine', level: 'info',
        debate_id: this.session?.id,
        message: `AN priming: ${topNodes.length} nodes, ${edgeLines.length} edges`,
        data: { step: 'an_priming', nodes: topNodes.length, edges: edgeLines.length },
      });
    }

    // Step 5: Convergence priming — inject agreement/disagreement areas
    const cp = summary.convergence_profile;
    const convergenceLines: string[] = [];
    if (cp.areas_of_agreement.length > 0) {
      convergenceLines.push(`Prior analysis established agreement on:\n${cp.areas_of_agreement.map(a => `- ${a}`).join('\n')}`);
    }
    if (cp.areas_of_disagreement.length > 0) {
      convergenceLines.push(`Disagreement remains on:\n${cp.areas_of_disagreement.map(d => `- ${d}`).join('\n')}`);
    }
    if (cp.unresolved_questions.length > 0) {
      convergenceLines.push(`Open questions to address:\n${cp.unresolved_questions.map(q => `- ${q}`).join('\n')}`);
    }
    if (convergenceLines.length > 0) {
      primingParts.push(
        `=== ESTABLISHED CONTEXT ===\n${convergenceLines.join('\n')}\nDo not re-derive these — build from them.`,
      );
      getGlobalRecorder()?.record({
        type: 'exploration_seeding', component: 'debate-engine', level: 'info',
        debate_id: this.session?.id,
        message: `Convergence priming: ${cp.areas_of_agreement.length} agreements, ${cp.areas_of_disagreement.length} disagreements, ${cp.unresolved_questions.length} open questions`,
        data: {
          step: 'convergence_priming',
          agreements: cp.areas_of_agreement.length,
          disagreements: cp.areas_of_disagreement.length,
          unresolved: cp.unresolved_questions.length,
        },
      });
    }

    this._explorationPriming = primingParts.join('\n\n');
  }

  /** Update hint streaks after a turn completes. Hints that fired increment; hints that didn't reset. */
  private updateHintStreaks(speaker: string, firedHints: string[]): void {
    const firedKeys = new Set(firedHints.map(h => classifyHintKey(h)));

    // Increment streaks for fired hints
    for (const key of firedKeys) {
      if (key === 'other') continue; // don't track unclassified hints
      const existing = this._hintStreaks.get(key);
      if (existing) {
        existing.consecutive_failures++;
        if (!existing.suppressed && existing.consecutive_failures >= HINT_SUPPRESSION_THRESHOLD) {
          existing.suppressed = true;
          getGlobalRecorder()?.record({
            type: 'turn.hint-suppressed', component: 'debate-engine', level: 'warn',
            speaker,
            message: `Suppressed hint "${key}" after ${existing.consecutive_failures} consecutive failures`,
            data: { hint_key: key, consecutive_failures: existing.consecutive_failures },
          });
        }
      } else {
        this._hintStreaks.set(key, { hint_key: key, consecutive_failures: 1, suppressed: false });
      }
    }

    // Reset streaks for hints that didn't fire this turn
    for (const [key, streak] of this._hintStreaks) {
      if (!firedKeys.has(key)) {
        streak.consecutive_failures = 0;
        streak.suppressed = false;
      }
    }
  }

  private getKnownNodeIds(): Set<string> {
    if (this._knownNodeIds) return this._knownNodeIds;
    const s = new Set<string>();
    for (const pov of POV_KEYS) {
      for (const n of this.taxonomy[pov]?.nodes ?? []) s.add(n.id);
    }
    for (const n of this.taxonomy.situations?.nodes ?? []) s.add(n.id);
    this._knownNodeIds = s;
    return s;
  }

  private getPolicyIds(): Set<string> {
    if (this._policyIds) return this._policyIds;
    const s = new Set<string>();
    for (const p of this.taxonomy.policyRegistry ?? []) s.add(p.id);
    this._policyIds = s;
    return s;
  }

  private async generateWithModel(
    prompt: string, label: string, model: string, timeoutMs?: number, temperature?: number,
  ): Promise<string> {
    await this.throttle();
    this.progress('generating', undefined, label);
    const start = Date.now();
    try {
      const text = await this.adapter.generateText(prompt, model, {
        temperature: temperature ?? 0,
        timeoutMs: timeoutMs ?? 120_000,
        signal: this.config.signal,
      });
      this.lastApiCallTime = Date.now();
      this.apiCallCount++;
      this.totalResponseTimeMs += Date.now() - start;
      this.clearRateLimitBackoff();
      return text;
    } catch (err) {
      this.lastApiCallTime = Date.now();
      if (this.isRateLimitError(err)) this.recordRateLimit();
      throw err;
    }
  }

  constructor(config: DebateConfig, adapter: AIAdapter | ExtendedAIAdapter, taxonomy: LoadedTaxonomy) {
    const merged: DebateConfig['stageModels'] = { ...config.stageModels };

    if (config.evaluatorModel && !merged.evaluator) {
      merged.evaluator = config.evaluatorModel;
      console.warn('[debate-engine] evaluatorModel is deprecated — use stageModels.evaluator instead');
    }
    if (config.utilityModels) {
      const uMap: Record<string, keyof NonNullable<DebateConfig['stageModels']>> = {
        summary: 'summary', scope: 'scope', moderator: 'moderator', crux: 'crux',
      };
      for (const [uKey, sKey] of Object.entries(uMap)) {
        const val = config.utilityModels[uKey as keyof typeof config.utilityModels];
        if (val && !merged[sKey]) {
          merged[sKey] = val;
          console.warn(`[debate-engine] utilityModels.${uKey} is deprecated — use stageModels.${sKey} instead`);
        }
      }
    }

    this.config = { ...config, stageModels: merged };
    this.adapter = adapter;
    this.taxonomy = taxonomy;
    this.applyExplorationConfigDefaults();
  }

  private resolveStageModel(key: keyof NonNullable<DebateConfig['stageModels']>): string {
    return this.config.stageModels?.[key] ?? this.config.model;
  }

  private applyExplorationConfigDefaults(): void {
    if (!this.config.explorationSummary) return;
    const rc = this.config.explorationSummary.recommended_config;
    if (this.config.explorationSummary.topic.final !== this.config.topic &&
        this.config.explorationSummary.topic.original !== this.config.topic) {
      return;
    }
    if (this.config.maxTotalRounds == null) {
      this.config.maxTotalRounds = Math.min(20, Math.max(6, rc.max_rounds));
    }
    if (this.config.argumentationExitThreshold == null) {
      this.config.argumentationExitThreshold = Math.min(0.9, Math.max(0.4, rc.argumentation_exit_threshold));
    }
    if (this.config.concludingExitThreshold == null) {
      this.config.concludingExitThreshold = Math.min(0.9, Math.max(0.4, rc.concluding_exit_threshold));
    }
    if (this.config.temperature == null) {
      this.config.temperature = Math.min(1.0, Math.max(0.3, rc.temperature));
    }
    if (this.config.pacing == null) {
      this.config.pacing = rc.pacing;
    }
    if (this.config.enableClarification == null && rc.skip_clarification) {
      this.config.enableClarification = false;
    }
    getGlobalRecorder()?.record({
      type: 'exploration_seeding', component: 'debate-engine', level: 'info',
      debate_id: this.session?.id,
      message: 'Applied exploration config overrides',
      data: {
        step: 'config_overrides',
        applied: {
          maxTotalRounds: this.config.maxTotalRounds,
          argumentationExitThreshold: this.config.argumentationExitThreshold,
          concludingExitThreshold: this.config.concludingExitThreshold,
          temperature: this.config.temperature,
          pacing: this.config.pacing,
          enableClarification: this.config.enableClarification,
        },
      },
    });
  }

  async run(onProgress?: (p: DebateProgress) => void): Promise<DebateSession> {
    this.onProgress = onProgress;
    if (this.adapter.onRetryProgress === undefined) {
      this.adapter.onRetryProgress = (info) => {
        this.onProgress?.({
          phase: 'retry',
          message: `Retry attempt ${info.attempt}/${info.maxRetries}, waiting ${info.backoffSeconds}s...`,
          retry: { attempt: info.attempt, maxRetries: info.maxRetries, backoffSeconds: info.backoffSeconds },
        });
      };
    }
    this.initSession();

    // Route prompt directives based on model capability (t/331)
    setPromptCompact(isCompactModel(this.config.model));

    // Embed doctrinal boundaries + compute anchoring (t/114)
    await this.setupDoctrinalAnchoring();

    try {
      // Phase 0.5: Topic critique (free-form topics only, before clarification)
      if (this.config.enableWisdomEvaluation !== false &&
          this.config.sourceType !== 'document' && this.config.sourceType !== 'url' && this.config.sourceType !== 'situations') {
        await this.runTopicCritique();
      }

      // Phase 0.75: Topic scope extraction (t/336 — foundation for topic-alignment enforcement)
      await this.extractTopicScope();
      setTopicScope(this.session.topic.scope ?? null);

      // Phase 0.76: Topic structure extraction for structured topics (t/1050)
      if (!this.session.topic_structure && classifyTopicComplexity(this.session.topic.final) === 'structured') {
        this.progress('setup', undefined, 'Extracting topic structure');
        try {
          const structureModel = this.resolveStageModel('scope');
          this.session.topic_structure = await extractTopicStructure(
            this.session.topic.final,
            (prompt, label) => this.generateWithModel(prompt, label, structureModel),
          );
          const premises = this.session.topic_structure.structural_premises.length;
          const constraints = this.session.topic_structure.scope_constraints?.length ?? 0;
          this.progress('setup', undefined, `Topic structure extracted (${premises} premises, ${constraints} constraints)`);
          getGlobalRecorder()?.record({
            type: 'topic_structure_extracted', component: 'debate-engine', level: 'info',
            message: `Topic structure extracted (${premises} premises, ${constraints} constraints)`,
            data: { complexity: 'structured', premises, constraints },
          });
        } catch (err) {
          getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Topic structure extraction failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
          this.warn('Topic structure extraction', err, 'Structure extraction skipped — debate continues without decomposition');
        }
      }

      // Phase 0.8: Seed prior crux context from registry (t/367)
      if (this.config.embedFn) {
        try {
          const __engineDir = path.dirname(fileURLToPath(import.meta.url));
          const repoRoot = resolveRepoRoot(__engineDir);
          const dataRoot = resolveDataRoot(repoRoot);
          const registry = loadRegistry(dataRoot);
          if (registry.entries.length > 0) {
            const topicEmbedding = await this.config.embedFn(this.session.topic.final);
            const relevant = findRelevantPriorCruxes(topicEmbedding, registry);
            this._priorCruxContext = formatPriorCruxContext(relevant);
          }
        } catch (err) {
          getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Crux registry seeding failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        }
      }

      // Phase 0.9: Exploration summary seeding (t/986)
      if (this.config.explorationSummary) {
        this.seedExplorationSummary(this.config.explorationSummary);
      }

      // Phase 1: Clarification (optional)
      if (this.config.enableClarification) {
        await this.runClarification();
      }

      // Phase 1.5: Document pre-analysis
      if (this.config.sourceType === 'document' || this.config.sourceType === 'url') {
        await this.runDocumentAnalysis();
      }

      // Phase 2: Opening statements
      await this.runOpeningStatements();

      // Cache opening embeddings for position drift detection
      await this.cacheOpeningEmbeddings();
      await this.cacheOpeningClaims();

      // Neutral evaluator: baseline checkpoint (after openings, before cross-respond)
      await this.runNeutralCheckpoint('baseline');

      // Ensure phase transitions to 'debate' even if openings were partial
      if (this.session.phase === 'opening') {
        this.session.phase = 'debate';
      }

      // Phase 3: Cross-respond rounds
      if (this.config.useAdaptiveStaging && this._adaptiveConfig && this._phaseState) {
        await this.runAdaptiveCrossRespond();
      } else {
        await this.runFixedCrossRespond();
      }

      // Phase 4: Synthesis + final neutral evaluation in parallel
      await Promise.all([
        this.runSynthesis(),
        this.runNeutralCheckpoint('final'),
      ]);

      // Phase 4b: Missing arguments pass (needs synthesis output, so runs after)
      await this.runMissingArgumentsPass();

      // Phase 4c: Taxonomy refinement suggestions (needs synthesis + argument network)
      await this.runTaxonomyRefinementPass();

      // Phase 4d: Dialectic trace generation (needs synthesis preferences + argument network)
      this.runDialecticTracePass();

      // Phase 4e: Cross-cutting node promotion (needs synthesis areas_of_agreement)
      await this.runCrossCuttingProposalPass();

      // Phase 4f: Taxonomy gap analysis (deterministic — needs transcript, AN, taxonomy, manifests)
      this.runTaxonomyGapAnalysisPass();

      // Phase 4g: Situation debate_refs extraction (t/193 — deterministic, needs transcript + situations)
      this.runSituationRefExtraction();

      // Phase 4h: Perturbation result computation (evaluation/benchmark only)
      this.computePerturbationResult();
    } catch (err) {
      // If the debate was cancelled via AbortSignal, set phase to cancelled and return partial session
      if (this.config.signal?.aborted) {
        this.session.phase = 'cancelled';
        this.session.updated_at = nowISO();
        this.session.diagnostics!.overview.total_ai_calls = this.apiCallCount;
        this.session.diagnostics!.overview.total_response_time_ms = this.totalResponseTimeMs;
        getGlobalRecorder()?.record({ type: 'lifecycle', component: 'debate-engine', level: 'info', debate_id: this.session.id, message: 'Debate cancelled via AbortSignal' });
        return this.session;
      }
      this.emitSnapshot('error');
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'error', debate_id: this.session?.id, message: 'Debate run failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      throw err;
    }

    // Finalize
    this.session.updated_at = nowISO();
    this.session.diagnostics!.overview.total_ai_calls = this.apiCallCount;
    this.session.diagnostics!.overview.total_response_time_ms = this.totalResponseTimeMs;

    // Compute cumulative context-rot retention
    if (this.session.context_rot && this.session.context_rot.stages.length > 0) {
      this.session.context_rot.measured_at = nowISO();
      this.session.context_rot.cumulative_retention = this.session.context_rot.stages
        .filter(s => s.in_units === s.out_units)
        .reduce((acc, s) => acc * (s.ratio > 0 && s.ratio <= 1 ? s.ratio : 1), 1);
      this.session.context_rot.cumulative_retention = Math.round(this.session.context_rot.cumulative_retention * 10000) / 10000;
    }

    // Compute extraction coverage on sampled turns (t/391)
    await this.runExtractionCoverage();

    // Log calibration data point (non-blocking, never fails the debate)
    try {
      const weights = loadProvisionalWeights();
      const dataPoint = extractCalibrationData(this.session, 'local', {
        argumentationExitThreshold: weights.thresholds.argumentation_exit,
        relevanceThreshold: 0.45, // TODO: read from config when externalized
        draftTemperature: 0.7,
        attackWeights: [1.0, 1.1, 1.2],
        argumentativeSaturationWeights: weights.argumentative_saturation,
        explorationSummary: this.config.explorationSummary,
        docMeta: this.docTitles,
        insularityInterventions: this._insularityInterventions.length > 0 ? this._insularityInterventions : undefined,
      });
      // Resolve data root — env var or .aitriad.json fallback
      const __engineDir = path.dirname(fileURLToPath(import.meta.url));
      const repoRoot = resolveRepoRoot(__engineDir);
      const dataRoot = resolveDataRoot(repoRoot);
      appendCalibrationLog(dataPoint, dataRoot);

      // Post-debate adaptive threshold write-back
      this.runPostDebateCalibration(dataRoot);

      // Persist unresolved cruxes to cross-debate registry (t/367)
      if (this.config.embedFn && this.session.crux_tracker?.length) {
        try {
          const generateFn = (prompt: string) => this.generateWithEvaluator(prompt, 'Crux decontextualization');
          const cruxResult = await persistDebateCruxes(this.session, dataRoot, this.config.embedFn, generateFn);

          if ((cruxResult.merged > 0 || cruxResult.created > 0) && this.config.usageDeps) {
            try {
              const registry = loadRegistry(dataRoot);
              const enrichFn = async (values: Record<string, string>) => {
                const result = await callByUsage('enrichment.situation-bdi-decomposition', values, this.config.usageDeps!);
                return result.text;
              };
              const candidates = await findAndEnrichPromotionCandidates(registry, enrichFn);
              if (candidates.length > 0) {
                this.session.promotion_candidates = candidates.map(c => ({
                  crux_id: c.entry.id,
                  draft: c.draft_situation,
                  irreducible_count: c.irreducible_count,
                }));
              }
            } catch (enrichErr) {
              getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Crux promotion enrichment failed', error: { name: (enrichErr as Error).name ?? 'Error', message: String(enrichErr), stack: (enrichErr as Error).stack } });
            }
          }
        } catch (err) {
          getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Crux registry persistence failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        }
      }
    } catch (calErr) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Calibration logging failed', error: { name: (calErr as Error).name ?? 'Error', message: String(calErr), stack: (calErr as Error).stack } });
      this.warn('Calibration logging', calErr, 'Non-critical — debate results unaffected');
    }

    return this.session;
  }

  // ── Resume from checkpoint ──────────────────────────────

  /**
   * Resume a debate from a crash-recovery checkpoint. Runs only the
   * missing tail: synthesis (if not already present) and all post-synthesis
   * passes. Returns a complete session ready for output.
   */
  static async resume(
    checkpoint: DebateSession,
    config: DebateConfig,
    adapter: AIAdapter | ExtendedAIAdapter,
    taxonomy: LoadedTaxonomy,
    onProgress?: (p: DebateProgress) => void,
  ): Promise<DebateSession> {
    const engine = new DebateEngine(config, adapter, taxonomy);
    engine.session = checkpoint;
    engine.onProgress = onProgress;
    if (adapter.onRetryProgress === undefined) {
      adapter.onRetryProgress = (info) => {
        engine.onProgress?.({
          phase: 'retry',
          message: `Retry attempt ${info.attempt}/${info.maxRetries}, waiting ${info.backoffSeconds}s...`,
          retry: { attempt: info.attempt, maxRetries: info.maxRetries, backoffSeconds: info.backoffSeconds },
        });
      };
    }

    // Restore API call counts from the checkpoint diagnostics
    engine.apiCallCount = checkpoint.diagnostics?.overview.total_ai_calls ?? 0;
    engine.totalResponseTimeMs = checkpoint.diagnostics?.overview.total_response_time_ms ?? 0;

    // Stamp a new run_id so resumed sessions are distinguishable
    engine.session.run_id = generateId();

    setPromptCompact(isCompactModel(config.model));

    const hasSynthesis = checkpoint.transcript.some(
      e => e.type === 'concluding' && (e.metadata as Record<string, unknown>)?.synthesis,
    );

    const stop = config.stopAfterStage;
    const isSynthesisStop = stop === 'synthesis-p1' || stop === 'synthesis-p2' || stop === 'synthesis-p3';
    const maxPhase = stop === 'synthesis-p1' ? 1
      : stop === 'synthesis-p2' ? 2 : undefined;

    getGlobalRecorder()?.record({
      type: 'lifecycle', component: 'debate-engine', level: 'info',
      debate_id: checkpoint.id,
      message: `Resuming debate from checkpoint (hasSynthesis=${hasSynthesis}${stop ? `, stopAfterStage=${stop}` : ''})`,
    });

    const resumeStart = Date.now();

    try {
      if (!hasSynthesis) {
        if (isSynthesisStop) {
          await engine.runSynthesis(maxPhase);
        } else {
          await Promise.all([
            engine.runSynthesis(),
            engine.runNeutralCheckpoint('final'),
          ]);
        }
        if (isSynthesisStop) return engine.earlyReturn(resumeStart);
      } else if (isSynthesisStop) {
        return engine.earlyReturn(resumeStart);
      }

      await engine.runMissingArgumentsPass();
      if (stop === 'missing-arguments') return engine.earlyReturn(resumeStart);

      await engine.runTaxonomyRefinementPass();
      if (stop === 'taxonomy-refinement') return engine.earlyReturn(resumeStart);

      engine.runDialecticTracePass();
      await engine.runCrossCuttingProposalPass();
      engine.runTaxonomyGapAnalysisPass();
      engine.runSituationRefExtraction();
      engine.computePerturbationResult();

      await engine.runExtractionCoverage();
      if (stop === 'extraction-coverage') return engine.earlyReturn(resumeStart);
    } catch (err) {
      if (config.signal?.aborted) {
        engine.session.phase = 'cancelled';
        engine.session.updated_at = nowISO();
        engine.session.diagnostics!.overview.total_ai_calls = engine.apiCallCount;
        engine.session.diagnostics!.overview.total_response_time_ms = engine.totalResponseTimeMs;
        getGlobalRecorder()?.record({ type: 'lifecycle', component: 'debate-engine', level: 'info', debate_id: engine.session.id, message: 'Resume cancelled via AbortSignal' });
        return engine.session;
      }
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'error', debate_id: engine.session?.id, message: 'Debate resume failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      throw err;
    }

    // Finalize
    engine.session.updated_at = nowISO();
    engine.session.diagnostics!.overview.total_ai_calls = engine.apiCallCount;
    engine.session.diagnostics!.overview.total_response_time_ms = engine.totalResponseTimeMs;
    engine.session.diagnostics!.overview.total_elapsed_ms = Date.now() - resumeStart;

    return engine.session;
  }

  // ── Initialization ───────────────────────────────────────

  private initSession(): void {
    const id = generateId();
    const now = nowISO();
    const title = this.config.name ??
      (this.config.topic.length > 60 ? this.config.topic.slice(0, 57) + '...' : this.config.topic);

    this.session = {
      id,
      title,
      created_at: now,
      updated_at: now,
      app_version: this.config.appVersion,
      audience: this.config.audience,
      phase: 'setup',
      topic: {
        original: this.config.topic,
        refined: null,
        final: this.config.topic,
        background: this.config.background || undefined,
      },
      source_type: this.config.sourceType,
      source_ref: this.config.sourceRef ?? '',
      source_content: this.config.sourceContent ?? '',
      active_povers: [...this.config.activePovers],
      user_is_pover: false,
      transcript: [],
      context_summaries: [],
      generated_with_prompt_version: 'cli-l2',
      debate_model: this.config.model,
      evaluator_model: this.config.evaluatorModel,
      speaker_models: this.config.speakerModels,
      stage_models: {
        brief: this.resolveStageModel('brief'),
        plan: this.resolveStageModel('plan'),
        draft: this.resolveStageModel('draft'),
        cite: this.resolveStageModel('cite'),
        evaluator: this.resolveStageModel('evaluator'),
        scope: this.resolveStageModel('scope'),
        summary: this.resolveStageModel('summary'),
        moderator: this.resolveStageModel('moderator'),
        crux: this.resolveStageModel('crux'),
      },
      model_tier: this.config.modelTier,
      protocol_id: this.config.protocolId ?? 'structured',
      diagnostics: {
        enabled: true,
        entries: {},
        overview: {
          total_ai_calls: 0,
          total_response_time_ms: 0,
          claims_accepted: 0,
          claims_rejected: 0,
          move_type_counts: {},
          disagreement_type_counts: {},
        },
      },
      argument_network: { nodes: [], edges: [] },
      commitments: {},
    };

    // Initialize commitment stores
    for (const pover of this.config.activePovers) {
      this.session.commitments![pover] = { asserted: [], conceded: [], challenged: [] };
    }

    // Initialize active moderator state
    this._moderatorState = initModeratorState(this.config.rounds, this.config.activePovers);
    this.session.moderator_state = this._moderatorState;

    if (this.resolveStageModel('evaluator') === this.config.model) {
      this.recordDiagnostic('session_init', {
        evaluator_warning: 'Evaluator model matches debate model — self-preference bias is unmitigated. Cross-vendor split recommended.',
      });
    }

    if (this.config.speakerModels) {
      getGlobalRecorder()?.record({
        type: 'debate.config', component: 'debate-engine', level: 'info',
        debate_id: id,
        message: 'Multi-provider mode enabled',
        data: { tier: this.config.modelTier, speakerModels: this.config.speakerModels },
      });
    }

    // Initialize adaptive staging (if enabled)
    if (this.config.useAdaptiveStaging) {
      const w = loadProvisionalWeights();
      const pacing = this.config.pacing ?? 'moderate';
      const preset = w.pacing_presets[pacing] ?? w.pacing_presets.moderate;

      this._adaptiveConfig = {
        useAdaptiveStaging: true,
        maxTotalRounds: this.config.maxTotalRounds ?? preset.maxTotalRounds,
        pacing,
        dialecticalStyle: 'adversarial',
        argumentationExitThreshold: this.config.argumentationExitThreshold ?? preset.argumentationExit,
        concludingExitThreshold: this.config.concludingExitThreshold ?? preset.concludingExit,
        allowEarlyTermination: this.config.allowEarlyTermination ?? true,
      };
      this._phaseState = initPhaseState(this._adaptiveConfig);
      this._signalRegistry = buildSignalRegistry();
      this._adaptiveDiagnostics = initAdaptiveDiagnostics();
    }
  }

  // ── Doctrinal boundary embedding + anchoring (t/114) ─────

  private async setupDoctrinalAnchoring(): Promise<void> {
    const adapter = this.adapter as ExtendedAIAdapter;
    if (!adapter.computeQueryEmbedding) return;

    // Collect boundary strings per active POV, separated by type
    const boundaries: Record<string, string[]> = {};
    const boundaryWeights: Record<string, number[]> = {};
    const HARDCODED_WEIGHT = 1.0;
    const SOFTCODED_WEIGHT = 0.7;
    for (const pover of this.config.activePovers) {
      const info = POVER_INFO[pover];
      if (!info?.boundaries) continue;
      const { hardcoded, softcoded } = info.boundaries;
      const allBoundaries = [...hardcoded, ...softcoded];
      if (allBoundaries.length === 0) continue;
      boundaries[info.pov] = allBoundaries;
      boundaryWeights[info.pov] = [
        ...hardcoded.map(() => HARDCODED_WEIGHT),
        ...softcoded.map(() => SOFTCODED_WEIGHT),
      ];
    }
    if (Object.keys(boundaries).length === 0) return;

    try {
      this._boundaryEmbeddings = await embedDoctrinalBoundaries(
        boundaries,
        async (text: string) => {
          const { vector } = await adapter.computeQueryEmbedding!(text);
          return vector;
        },
      );
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Boundary embedding failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      return;
    }

    // Run anchoring against each POV's Belief nodes
    for (const [pov, vectors] of Object.entries(this._boundaryEmbeddings)) {
      if (vectors.length === 0) continue;
      const povNodes = this.taxonomy[pov as PovKey]?.nodes ?? [];
      const beliefs = povNodes.filter(n => n.category === 'Beliefs');
      if (beliefs.length === 0) continue;

      const weights = boundaryWeights[pov];
      const results = computeDoctrinalAnchoring(
        beliefs, vectors, this.taxonomy.embeddings, weights,
      );

      // Check for threshold anomalies
      const anomaly = checkThresholdAnomalies(results, beliefs.length);
      if (anomaly) console.warn(anomaly.warning);

      const anchoredCount = results.filter(r => r.anchored).length;
      const floorCount = results.filter(r => r.floorApplied).length;
      if (anchoredCount > 0) {
        console.log(`[doctrinal] ${pov}: ${anchoredCount}/${beliefs.length} Beliefs anchored, ${floorCount} floor-applied`);
      }
    }
  }

  // ── AI call wrapper ────────────────────────────────────────

  private async throttle(): Promise<void> {
    if (this._rateLimitBackoffMs > 0 && this._lastRateLimitTime > 0) {
      const sinceRateLimit = Date.now() - this._lastRateLimitTime;
      if (sinceRateLimit < this._rateLimitBackoffMs) {
        const waitMs = this._rateLimitBackoffMs - sinceRateLimit;
        this.progress('generating', undefined, `Rate-limited — waiting ${Math.ceil(waitMs / 1000)}s`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
    const delay = this.config.throttleMs ?? 0;
    if (delay > 0 && this.lastApiCallTime > 0) {
      const elapsed = Date.now() - this.lastApiCallTime;
      if (elapsed < delay) {
        await new Promise(r => setTimeout(r, delay - elapsed));
      }
    }
  }

  private recordRateLimit(): void {
    this._lastRateLimitTime = Date.now();
    this._rateLimitBackoffMs = Math.min(
      Math.max(this._rateLimitBackoffMs * 2, 15_000),
      120_000,
    );
  }

  private clearRateLimitBackoff(): void {
    if (this._rateLimitBackoffMs > 0) {
      this._rateLimitBackoffMs = Math.floor(this._rateLimitBackoffMs / 2);
      if (this._rateLimitBackoffMs < 2_000) {
        this._rateLimitBackoffMs = 0;
        this._lastRateLimitTime = 0;
      }
    }
  }

  private isRateLimitError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('429') || /rate[_ -]?limit/i.test(msg);
  }

  private async stageGenerate(prompt: string, model: string, options: { temperature?: number; timeoutMs?: number }, label: string): Promise<string> {
    await this.throttle();
    this.progress('generating', undefined, label);
    const start = Date.now();
    try {
      const text = await this.adapter.generateText(prompt, model, { ...options, timeoutMs: options.timeoutMs ?? 120_000 });
      this.lastApiCallTime = Date.now();
      this.apiCallCount++;
      this.totalResponseTimeMs += Date.now() - start;
      this.clearRateLimitBackoff();
      return text;
    } catch (err) {
      this.lastApiCallTime = Date.now();
      if (this.isRateLimitError(err)) this.recordRateLimit();
      throw err;
    }
  }

  private async generate(prompt: string, label: string, timeoutMs?: number): Promise<string> {
    await this.throttle();
    this.progress('generating', undefined, label);
    const start = Date.now();
    try {
      const text = await this.adapter.generateText(prompt, this.config.model, {
        temperature: this.config.temperature ?? 0.7,
        timeoutMs: timeoutMs ?? 120_000,
        signal: this.config.signal,
      });
      const elapsed = Date.now() - start;
      this.lastApiCallTime = Date.now();
      this.apiCallCount++;
      this.totalResponseTimeMs += elapsed;
      this.clearRateLimitBackoff();
      return text;
    } catch (err) {
      this.lastApiCallTime = Date.now();
      if (this.isRateLimitError(err)) this.recordRateLimit();
      throw err;
    }
  }

  private async generateViaUsage(usageId: string, prompt: string, label: string): Promise<string> {
    const deps = this.config.usageDeps;
    if (!deps) return this.generate(prompt, label);
    await this.throttle();
    this.progress('generating', undefined, label);
    const start = Date.now();
    try {
      const result = await callByUsage(usageId, { prompt }, deps);
      const elapsed = Date.now() - start;
      this.lastApiCallTime = Date.now();
      this.apiCallCount++;
      this.totalResponseTimeMs += elapsed;
      this.clearRateLimitBackoff();
      return result.text;
    } catch (err) {
      this.lastApiCallTime = Date.now();
      if (this.isRateLimitError(err)) this.recordRateLimit();
      throw err;
    }
  }

  private resolveModelForSpeaker(speaker: string): string {
    return this.config.speakerModels?.[speaker] ?? this.config.model;
  }

  private buildFailoverChain(primaryModel: string): string[] {
    const chain = [primaryModel];
    if (this.config.fallbackChain) {
      for (const m of this.config.fallbackChain) {
        if (!chain.includes(m)) chain.push(m);
      }
    }
    if (!chain.includes(this.config.model)) chain.push(this.config.model);
    if (this.config.maxModelId) {
      const maxRank = modelTierRank(this.config.maxModelId);
      return chain.filter(m => modelTierRank(m) <= maxRank);
    }
    return chain;
  }

  private async executeWithModelFailover<T>(
    speaker: string,
    execute: (model: string) => Promise<T>,
  ): Promise<T> {
    const primaryModel = this.resolveModelForSpeaker(speaker);
    const chain = this.buildFailoverChain(primaryModel);
    if (chain.length <= 1) return execute(primaryModel);

    let lastFailureReason = '';
    for (let i = 0; i < chain.length; i++) {
      try {
        const result = await execute(chain[i]);
        if (i > 0) {
          if (!this.config.speakerModels) this.config.speakerModels = {};
          this.config.speakerModels[speaker] = chain[i];
          if (this.session) {
            if (!this.session.speaker_models) this.session.speaker_models = {};
            this.session.speaker_models[speaker] = chain[i];
          }
          getGlobalRecorder()?.record({
            type: 'ai.fallback',
            component: 'debateEngine',
            level: 'warn',
            debate_id: this.session?.id,
            message: `Speaker ${speaker} failover: ${primaryModel} → ${chain[i]}`,
            data: { characterId: speaker, originalModel: primaryModel, failureReason: lastFailureReason, newModel: chain[i], attemptedChain: chain.slice(0, i + 1) },
          });
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const lower = msg.toLowerCase();
        const isHardFailure =
          lower.includes('403') || lower.includes('401') ||
          lower.includes('500') || lower.includes('empty') ||
          lower.includes('failed after') || lower.includes('permission') ||
          lower.includes('unauthorized') || lower.includes('forbidden');

        if (isHardFailure && i < chain.length - 1) {
          lastFailureReason = msg.slice(0, 300);
          getGlobalRecorder()?.record({
            type: 'system.error',
            component: 'debateEngine',
            level: 'warn',
            debate_id: this.session?.id,
            message: `Speaker ${speaker} model ${chain[i]} hard failure, trying ${chain[i + 1]}`,
            error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
          });
          this.warn(`Speaker ${speaker} model ${chain[i]}`, err, `Trying fallback ${chain[i + 1]}`);
          continue;
        }
        getGlobalRecorder()?.record({
            type: 'system.error',
            component: 'debateEngine',
            level: 'error',
            debate_id: this.session?.id,
            message: `Speaker ${speaker} model ${chain[i]} failed (no more fallbacks)`,
            error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
          });
          throw err;
      }
    }
    throw new Error(`All models failed for speaker ${speaker}`);
  }

  private async generateWithEvaluator(prompt: string, label: string, timeoutMs?: number): Promise<string> {
    await this.throttle();
    const evalModel = this.resolveStageModel('evaluator');
    this.progress('generating', undefined, label);
    const start = Date.now();
    try {
      const text = await this.adapter.generateText(prompt, evalModel, {
        temperature: 0,
        timeoutMs: timeoutMs ?? 120_000,
        signal: this.config.signal,
      });
      const elapsed = Date.now() - start;
      this.lastApiCallTime = Date.now();
      this.apiCallCount++;
      this.totalResponseTimeMs += elapsed;
      this.clearRateLimitBackoff();
      return text;
    } catch (err) {
      this.lastApiCallTime = Date.now();
      if (this.isRateLimitError(err)) this.recordRateLimit();
      throw err;
    }
  }

  private progress(phase: string, speaker?: string, message?: string, round?: number): void {
    this.onProgress?.({
      phase,
      speaker,
      round,
      totalRounds: this.config.rounds,
      message: message ?? phase,
    });
  }

  private emitSnapshot(trigger: 'round_complete' | 'error'): void {
    try {
      this.config.onSnapshot?.(this.session, trigger);
    } catch (snapshotErr) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'debate-engine', level: 'warn',
        debate_id: this.session?.id,
        message: `Snapshot callback failed (trigger=${trigger})`,
        error: { name: (snapshotErr as Error).name ?? 'Error', message: String(snapshotErr), stack: (snapshotErr as Error).stack },
      });
    }
  }

  /** Log a non-fatal warning — records in diagnostics, flight recorder, and emits progress */
  private warn(operation: string, error: unknown, recovery: string): void {
    const msg = error instanceof Error ? error.message : String(error);
    const warning = `[WARNING] ${operation}: ${msg}. Recovery: ${recovery}`;
    process.stderr.write(`[debate-engine] ${warning}\n`);
    this.onProgress?.({ phase: 'warning', message: warning });
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'debate-engine', level: 'warn',
      debate_id: this.session?.id,
      message: `${operation}: ${msg}`,
      error: { name: error instanceof Error ? error.name : 'Warning', message: msg, stack: error instanceof Error ? error.stack : undefined },
    });
  }

  /** Check if the debate has been cancelled via AbortSignal. Throws ActionableError if aborted. */
  private checkAborted(): void {
    if (this.config.signal?.aborted) {
      throw new ActionableError({
        goal: 'Continue debate execution',
        problem: 'Debate was cancelled by user',
        location: 'DebateEngine.checkAborted',
        nextSteps: ['Start a new debate if desired'],
      });
    }
  }

  /** Enrich taxonomy refs with relevance scores and primary flags from the last injection manifest. */
  private _nodeLabelMap?: Map<string, string>;

  /** Pre-loaded source evidence index (lazy). */
  private _sourceEvidenceIndex?: import('./evidenceFromSummaries.js').SourceEvidenceIndex;
  private _docTitles?: import('./evidenceFromSummaries.js').DocMetaMap;

  private get sourceEvidenceIndex(): import('./evidenceFromSummaries.js').SourceEvidenceIndex | undefined {
    if (this._sourceEvidenceIndex !== undefined) return this._sourceEvidenceIndex;
    try {
      const __dir = path.dirname(fileURLToPath(import.meta.url));
      const root = resolveRepoRoot(__dir);
      const dataRoot = resolveDataRoot(root);
      const indexPath = path.join(dataRoot, 'taxonomy', 'source_evidence_index.json');
      if (fs.existsSync(indexPath)) {
        this._sourceEvidenceIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        return this._sourceEvidenceIndex;
      }
    } catch (err) { getGlobalRecorder()?.record({ type: 'state.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Source evidence index unavailable', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); }
    this._sourceEvidenceIndex = undefined as unknown as import('./evidenceFromSummaries.js').SourceEvidenceIndex;
    return undefined;
  }

  /** Map of doc_id → source metadata with title, URL, provenance (lazy). */
  private get docTitles(): import('./evidenceFromSummaries.js').DocMetaMap | undefined {
    if (this._docTitles !== undefined) return this._docTitles;
    try {
      const __dir = path.dirname(fileURLToPath(import.meta.url));
      const root = resolveRepoRoot(__dir);
      const configPath = path.join(root, '.aitriad.json');
      if (!fs.existsSync(configPath)) return undefined;
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const sourcesRoot = config.sources_root ? path.resolve(root, config.sources_root) : null;
      if (!sourcesRoot || !fs.existsSync(sourcesRoot)) return undefined;
      const metaMap: Record<string, { title: string; resolved_url?: string; provenance_label?: string }> = {};
      for (const entry of fs.readdirSync(sourcesRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const metaPath = path.join(sourcesRoot, entry.name, 'metadata.json');
        if (!fs.existsSync(metaPath)) continue;
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          if (meta.title) {
            const docMeta: { title: string; resolved_url?: string; provenance_label?: string } = { title: meta.title };
            if (meta.resolved_url) docMeta.resolved_url = meta.resolved_url;
            if (meta.provenance?.length > 0 && meta.provenance[0].id) docMeta.provenance_label = meta.provenance[0].id;
            if (!docMeta.resolved_url && meta.url) docMeta.resolved_url = meta.url;
            metaMap[entry.name] = docMeta;
          }
        } catch { /* telemetry — silent by design: per-file meta parse is best-effort */ }
      }
      this._docTitles = Object.keys(metaMap).length > 0 ? metaMap : undefined;
      return this._docTitles;
    } catch (err) { getGlobalRecorder()?.record({ type: 'state.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Doc titles loading failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); return undefined; }
  }

  private getNodeLabelMap(): Map<string, string> {
    if (this._nodeLabelMap) return this._nodeLabelMap;
    const m = new Map<string, string>();
    for (const pov of [this.taxonomy.accelerationist, this.taxonomy.safetyist, this.taxonomy.skeptic]) {
      for (const n of pov.nodes) m.set(n.id, n.label);
    }
    for (const n of this.taxonomy.situations?.nodes ?? []) m.set(n.id, n.label);
    this._nodeLabelMap = m;
    return m;
  }

  private enrichTaxonomyRefs(refs: TaxonomyRef[]): void {
    const manifest = this._lastInjectionManifest;
    if (!manifest) return;

    // Use the full relevance scores map (covers POV + situation nodes).
    // Falls back to manifest's POV-only array for backwards compatibility.
    const scoreMap = this._lastRelevanceScores ?? new Map<string, number>();
    if (scoreMap.size === 0 && manifest.nodeScores && manifest.povNodeIds) {
      for (let i = 0; i < manifest.povNodeIds.length; i++) {
        if (i < manifest.nodeScores.length) {
          scoreMap.set(manifest.povNodeIds[i], manifest.nodeScores[i]);
        }
      }
    }
    const primarySet = new Set(manifest.povPrimaryIds);
    const labelMap = this.getNodeLabelMap();

    for (const ref of refs) {
      const score = scoreMap.get(ref.node_id);
      if (score != null) ref.relevance_score = score;
      if (primarySet.has(ref.node_id)) ref.primary = true;
      const label = labelMap.get(ref.node_id);
      if (label) ref.label = label;
    }
  }

  // ── Perturbation testing (HDE B2) ─────────────────────

  /** Inject an adversarial perturbation prompt as a system entry. */
  private injectPerturbation(round: number): void {
    const perturbation = this.config.perturbation!;
    this.progress('debate', undefined, `Perturbation injection at round ${round}`);
    const entry = this.addEntry({
      type: 'system',
      speaker: 'system',
      content: perturbation.prompt,
      taxonomy_refs: [],
      metadata: { perturbation: true, round },
    });
    this._perturbationEntryId = entry.id;
  }

  /** Compute SysAR from ArCo signals before and after perturbation injection. */
  private computePerturbationResult(): void {
    const perturbation = this.config.perturbation;
    if (!perturbation || !this._perturbationEntryId) return;

    const signals = this.session.convergence_signals ?? [];
    const injectionRound = perturbation.inject_at_turn;
    const window = perturbation.measure_recovery_window ?? 3;

    // Split signals into pre and post injection
    const preSignals = signals.filter(s => s.round <= injectionRound && s.arco);
    const postSignals = signals.filter(s => s.round > injectionRound && s.round <= injectionRound + window && s.arco);

    const preArco = preSignals.length > 0
      ? preSignals.reduce((sum, s) => sum + s.arco!.turn_similarity, 0) / preSignals.length
      : 0.5; // Default baseline if no pre-injection ArCo available
    const postArco = postSignals.length > 0
      ? postSignals.reduce((sum, s) => sum + s.arco!.turn_similarity, 0) / postSignals.length
      : 0;
    const sysar = preArco > 0 ? postArco / preArco : 0;

    this.session.perturbation_result = {
      prompt: perturbation.prompt,
      injected_at_round: injectionRound,
      injection_entry_id: this._perturbationEntryId,
      pre_arco: preArco,
      post_arco: postArco,
      sysar,
      recovery_window: postSignals.length,
      resilient: sysar >= 0.8,
    };
  }

  /** Post-turn summarization (DT-2): generate brief + medium summaries. Non-blocking — failure is logged, not thrown. */
  private async summarizeEntry(entry: TranscriptEntry): Promise<void> {
    // Only summarize substantive entries (openings, statements, fact-checks)
    if (!['opening', 'statement', 'fact-check'].includes(entry.type)) return;
    // Skip if already summarized
    if (entry.summaries) return;

    try {
      const speaker = POVER_INFO[entry.speaker as SpeakerId]?.label ?? entry.speaker;
      const prompt = entrySummarizationPrompt(entry.content, speaker);
      const raw = await this.adapter.generateText(prompt, this.resolveStageModel('summary'), {
        temperature: 0.3, // Low temp for faithful summarization
        maxTokens: 500,
        timeoutMs: 15000,
      });
      this.apiCallCount++;

      // Parse JSON response
      const cleaned = raw.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned) as { brief?: string; medium?: string };
      if (parsed.brief && parsed.medium) {
        entry.summaries = { brief: parsed.brief, medium: parsed.medium };
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'ai.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Entry summarization failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('summarizeEntry', err, 'Entry will display at full detail only');
    }
  }

  private addEntry(entry: Omit<TranscriptEntry, 'id' | 'timestamp'>): TranscriptEntry {
    // Guard: reject duplicate opening statements per speaker (defense-in-depth for t/919)
    if (entry.type === 'opening' && entry.speaker !== 'system') {
      const existing = this.session.transcript.find(
        e => e.type === 'opening' && e.speaker === entry.speaker,
      );
      if (existing) {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'debate-engine', level: 'warn',
          debate_id: this.session?.id,
          message: `Duplicate opening blocked for ${entry.speaker} — already has opening ${existing.id}`,
        });
        return existing;
      }
    }

    const full: TranscriptEntry = { id: generateId(), timestamp: nowISO(), ...entry };
    this.session.transcript.push(full);

    // Post-hoc vocabulary disambiguation for debater statements
    if (this.config.vocabulary?.colloquialTerms &&
        (full.type === 'opening' || full.type === 'statement') &&
        full.speaker !== 'system' && full.speaker !== 'moderator' && full.speaker !== 'user') {
      const result = disambiguateTerms(
        full.content,
        full.speaker as CampOrigin,
        this.config.vocabulary.colloquialTerms,
      );
      if (result.terms.length > 0) {
        full.metadata = full.metadata ?? {};
        full.metadata.vocabulary_resolutions = result.terms
          .filter(t => !t.ambiguous)
          .map(t => ({ colloquial: t.bare, canonical: t.canonical, confidence: t.confidence, offset: t.offset }));
        if (result.ambiguousCount > 0) {
          full.metadata.vocabulary_ambiguities = result.terms
            .filter(t => t.ambiguous)
            .map(t => ({ colloquial: t.bare, offset: t.offset }));
        }
      }
    }

    return full;
  }

  private recordDiagnostic(entryId: string, data: Partial<EntryDiagnostics>): void {
    const diag = this.session.diagnostics!;
    diag.entries[entryId] = { ...diag.entries[entryId], ...data };

    // Aggregate per-stage token counts into entry-level totals
    const stages = data.stage_diagnostics;
    if (stages && stages.length > 0) {
      let entryInput = 0;
      let entryOutput = 0;
      let hasTokens = false;
      for (const s of stages) {
        if (s.input_tokens != null) { entryInput += s.input_tokens; hasTokens = true; }
        if (s.output_tokens != null) { entryOutput += s.output_tokens; hasTokens = true; }
      }
      if (hasTokens) {
        diag.entries[entryId].input_tokens = entryInput;
        diag.entries[entryId].output_tokens = entryOutput;
        // Accumulate into overview totals
        diag.overview.total_input_tokens = (diag.overview.total_input_tokens ?? 0) + entryInput;
        diag.overview.total_output_tokens = (diag.overview.total_output_tokens ?? 0) + entryOutput;
      }
    }
  }

  /** Update situation citation tracking (t/192). Recomputes from full transcript each turn. */
  private updateSituationCitations(currentRefs: TaxonomyRef[]): void {
    const overview = this.session.diagnostics?.overview;
    if (!overview) return;

    // Recompute from transcript for accuracy (cheap — just string prefix checks)
    const uniqueSitIds = new Set<string>();
    let turnsWithSit = 0;
    let totalDebateTurns = 0;

    for (const entry of this.session.transcript) {
      if (entry.type !== 'statement' && entry.type !== 'opening') continue;
      totalDebateTurns++;
      const hasSit = entry.taxonomy_refs.some(r => r.node_id.startsWith('sit-') || r.node_id.startsWith('cc-'));
      if (hasSit) {
        turnsWithSit++;
        for (const r of entry.taxonomy_refs) {
          if (r.node_id.startsWith('sit-') || r.node_id.startsWith('cc-')) uniqueSitIds.add(r.node_id);
        }
      }
    }

    overview.situation_citations = {
      turns_with_sit_refs: turnsWithSit,
      total_debate_turns: totalDebateTurns,
      citation_rate: totalDebateTurns > 0 ? turnsWithSit / totalDebateTurns : 0,
      unique_sit_ids_cited: [...uniqueSitIds].sort(),
    };
  }

  // ── Adaptive staging helpers ─────────────────────────────

  private buildSignalContext(round: number): SignalContext {
    const an = this.session.argument_network!;
    const transcript = this.session.transcript;
    const recentConvSignals = (this.session.convergence_signals ?? []);
    const state = this._phaseState!;
    const signalHistory = this._signalHistory;

    const lastConvSignal = recentConvSignals.length > 0
      ? recentConvSignals[recentConvSignals.length - 1]
      : null;

    // Build transcript accessor
    const allStatements = transcript
      .filter(e => e.type === 'statement' || e.type === 'opening')
      .map(e => {
        const meta = e.metadata as Record<string, unknown> | undefined;
        const round = (meta?.round as number) ?? 0;
        const trace = this.session.turn_validations?.[e.id];
        const lastAttempt = trace?.attempts?.[trace.attempts.length - 1];
        return {
          round,
          speaker: e.speaker,
          text: e.content,
          extraction_status: lastAttempt?.validation?.outcome ?? 'unknown',
          claims_accepted: (meta?.extracted_claims_accepted as number) ?? 0,
          claims_rejected: (meta?.extracted_claims_rejected as number) ?? 0,
          category_validity_ratio: 1.0,
        };
      });

    const lastRoundStatements = allStatements.filter(s => s.round === round);
    const lastStatus = lastRoundStatements.length > 0
      ? lastRoundStatements[lastRoundStatements.length - 1].extraction_status
      : 'ok';
    const lastClaimsAccepted = lastRoundStatements.reduce((sum, s) => sum + s.claims_accepted, 0);

    return {
      network: {
        nodes: an.nodes.map(n => ({
          id: n.id,
          speaker: n.speaker,
          computed_strength: n.computed_strength ?? 0.5,
          base_strength: n.base_strength,
          base_strength_category: n.bdi_category,
          argumentation_scheme: (an.edges.find(e => e.source === n.id) as ArgumentNetworkEdge | undefined)?.argumentation_scheme,
          taxonomy_refs: n.taxonomy_refs.map(id => ({
            node_id: typeof id === 'string' ? id : (id as unknown as { node_id: string }).node_id,
            relevance: 'medium',
          })),
          turn_number: n.turn_number,
        })),
        edges: an.edges.map(e => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.type,
          attack_type: e.attack_type,
          weight: e.weight ?? 0.5,
          scheme: e.scheme,
          argumentation_scheme: e.argumentation_scheme,
        })),
        nodeCount: an.nodes.length,
      },

      transcript: {
        currentRound: round,
        roundsInPhase: state.rounds_in_phase,
        activePovsCount: this.config.activePovers.length,
        lastNRounds: (n: number) => {
          const maxRound = round;
          const minRound = Math.max(1, maxRound - n + 1);
          return allStatements.filter(s => s.round >= minRound && s.round <= maxRound);
        },
      },

      priorSignals: {
        get: (signalId: string, roundsBack: number): number | null => {
          const history = signalHistory.get(signalId);
          if (!history || history.length === 0) return null;
          const idx = history.length - 1 - roundsBack;
          return idx >= 0 ? history[idx].value : null;
        },
        movingAverage: (signalId: string, window: number): number | null => {
          const history = signalHistory.get(signalId);
          if (!history || history.length === 0) return null;
          const recent = history.slice(-window);
          return recent.reduce((sum, h) => sum + h.value, 0) / recent.length;
        },
      },

      convergenceSignals: {
        argument_redundancy: { avg_self_overlap: lastConvSignal?.argument_redundancy?.avg_self_overlap ?? 0, semantic_max_similarity: lastConvSignal?.argument_redundancy?.semantic_max_similarity },
        dialectical_engagement: { ratio: lastConvSignal?.dialectical_engagement?.ratio ?? 1 },
        position_drift: { drift: lastConvSignal?.position_drift?.drift ?? 0 },
        concession_opportunity: {
          outcome: lastConvSignal?.concession_opportunity?.outcome ?? 'none',
          strong_attacks_faced: lastConvSignal?.concession_opportunity?.strong_attacks_faced ?? 0,
        },
      },

      processRewards: (this.session.process_rewards ?? []).slice(-12).map(pr => ({
        round: pr.round, score: pr.score,
      })),

      phase: {
        current: state.current_phase,
        allPovsResponded: this.allPovsRespondedThisRound(round),
        cruxNodes: detectCruxNodes(
          an.nodes.map(n => ({
            id: n.id, speaker: n.speaker, computed_strength: n.computed_strength ?? 0.5,
            base_strength: n.base_strength, taxonomy_refs: [], turn_number: n.turn_number,
          })),
          an.edges.map(e => ({
            id: e.id, source: e.source, target: e.target,
            type: e.type, weight: e.weight ?? 0.5,
          })),
        ),
        cruxResolution: (this.session.crux_tracker ?? []).map(c => ({
          id: c.id, state: c.state, support_polarity: c.support_polarity,
        })),
        priorCruxClusters: state.prior_crux_clusters,
        regressionCount: state.regression_count,
        argumentationExitThreshold: state.argumentation_exit_threshold,
        concludingExitThreshold: state.concluding_exit_threshold,
      },

      extraction: {
        lastRoundStatus: lastStatus,
        lastRoundClaimsAccepted: lastClaimsAccepted,
        lastRoundCategoryValidityRatio: 1.0,
      },
    };
  }

  private allPovsRespondedThisRound(round: number): boolean {
    const respondedThisRound = new Set(
      this.session.transcript
        .filter(e => e.type === 'statement' && (e.metadata as Record<string, unknown>)?.round === round)
        .map(e => e.speaker),
    );
    return this.config.activePovers.every(p => respondedThisRound.has(p));
  }

  private recordSignalHistory(signalId: string, round: number, value: number): void {
    if (!this._signalHistory.has(signalId)) {
      this._signalHistory.set(signalId, []);
    }
    this._signalHistory.get(signalId)!.push({ round, value });
  }

  private updatePeakTracker(key: string, value: number): void {
    const current = this._peakTrackers.get(key) ?? 0;
    if (value > current) {
      this._peakTrackers.set(key, value);
    }
  }

  /**
   * Record a context manifest entry for taxonomy gap analysis.
   * Translates the last injection manifest (if any) into the format expected by
   * computeTaxonomyGapAnalysis, accumulating entries across the debate.
   */
  private accumulateContextManifest(
    round: number,
    speaker: string,
    pov: string,
    referencedNodeIds: string[],
  ): void {
    const manifest = this._lastInjectionManifest;
    if (!manifest) return;
    this._contextManifests.push({
      round,
      speaker,
      pov,
      injected_node_ids: [...manifest.povNodeIds, ...manifest.situationNodeIds],
      primary_node_ids: manifest.povPrimaryIds,
      referenced_node_ids: referencedNodeIds,
    });
  }

  /** Find node label + pov from the loaded taxonomy, or undefined if not present. */
  private findNodeMeta(nodeId: string): { label: string; pov: string; description: string } | undefined {
    for (const pov of POV_KEYS) {
      const n = this.taxonomy[pov]?.nodes.find(x => x.id === nodeId);
      if (n) return { label: n.label, pov, description: n.description };
    }
    const sit = this.taxonomy.situations?.nodes.find(x => x.id === nodeId);
    if (sit) return { label: sit.label, pov: 'situations', description: sit.description };
    return undefined;
  }

  /** Convert TurnValidation.clarifies_taxonomy hints into TaxonomySuggestion entries,
   *  append to session, dedupe by (node_id, suggestion_type, source). */
  private routeTurnValidatorHints(validation: TurnValidation, entryId: string): void {
    const HINT_TO_SUGGESTION = {
      narrow: 'narrow',
      broaden: 'broaden',
      split: 'split',
      merge: 'merge',
      qualify: 'qualify',
      retire: 'retire',
      new_node: 'new_node',
    } as const;

    this.session.taxonomy_suggestions ||= [];
    const existing = this.session.taxonomy_suggestions;

    for (const hint of validation.clarifies_taxonomy) {
      const type = HINT_TO_SUGGESTION[hint.action];
      if (!type) continue;

      // New-node hints reference a label, not a node_id.
      if (type === 'new_node') {
        const duplicate = existing.some(
          s => s.source === 'turn-validator' && s.suggestion_type === 'new_node' &&
            (s.node_label ?? '') === (hint.label ?? ''),
        );
        if (duplicate || !hint.label) continue;
        existing.push({
          node_id: `pending:${hint.label}`,
          node_label: hint.label,
          node_pov: 'unknown',
          suggestion_type: 'new_node',
          rationale: hint.rationale || 'Proposed mid-debate by the turn validator.',
          evidence_claim_ids: hint.evidence_claim_id ? [hint.evidence_claim_id] : undefined,
          source: 'turn-validator',
          origin_entry_id: entryId,
        });
        continue;
      }

      if (!hint.node_id) continue;
      const duplicate = existing.some(
        s => s.source === 'turn-validator' &&
          s.node_id === hint.node_id &&
          s.suggestion_type === type,
      );
      if (duplicate) continue;

      const meta = this.findNodeMeta(hint.node_id);
      existing.push({
        node_id: hint.node_id,
        node_label: meta?.label ?? hint.node_id,
        node_pov: meta?.pov ?? 'unknown',
        suggestion_type: type,
        current_description: meta?.description,
        rationale: hint.rationale || 'Surfaced mid-debate by the turn validator.',
        evidence_claim_ids: hint.evidence_claim_id ? [hint.evidence_claim_id] : undefined,
        source: 'turn-validator',
        origin_entry_id: entryId,
        merge_with_node_ids: type === 'merge' ? hint.node_ids : undefined,
      });
    }
  }

  // ── Taxonomy context ───────────────────────────────────────

  private getTaxonomyContext(pov: string): TaxonomyContext {
    const povFile = this.taxonomy[pov as PovKey];
    return {
      povNodes: povFile?.nodes ?? [],
      situationNodes: this.taxonomy.situations.nodes,
      policyRegistry: this.taxonomy.policyRegistry,
    };
  }

  private async getRelevantTaxonomyContext(pov: string, priorRefs: string[] = []): Promise<string> {
    const ctx = this.getTaxonomyContext(pov);

    // Build the per-turn query from topic + recent transcript
    const recentTranscript = formatRecentTranscript(this.session.transcript, 8, this.session.context_summaries);
    const query = buildRelevanceQuery(this.session.topic.final, recentTranscript);

    let scores: Map<string, number> | null = null;
    let scoringMode: 'embedding' | 'lexical' = 'embedding';
    let roundFocusVector: number[] | null = null;

    const adapter = this.adapter as ExtendedAIAdapter;
    const hasEmbeddings = Object.keys(this.taxonomy.embeddings).length > 0;

    // ── Hybrid AN + topic scoring ──
    // AN-based: score taxonomy nodes by max similarity to any active AN claim
    // Topic-based: score by similarity to topic query (floor at 0.5×)
    // Final: max(AN_score, topic_score × 0.5)
    const an = this.session.argument_network;
    const claimEmbeddings: ANClaimEmbedding[] = (an?.nodes ?? [])
      .filter(n => n.embedding && n.embedding.length > 0)
      .map(n => ({ id: n.id, vector: n.embedding!, strength: n.computed_strength }));

    if (hasEmbeddings && claimEmbeddings.length > 0) {
      // Topic score as floor
      let topicScores: Map<string, number> | null = null;
      if (adapter.computeQueryEmbedding) {
        try {
          const { vector } = await adapter.computeQueryEmbedding(query);
          if (vector && vector.length > 0) {
            topicScores = scoreNodeRelevance(vector, this.taxonomy.embeddings);
            roundFocusVector = vector;
          }
        } catch (err) {
          getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Topic embedding for relevance floor failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
          this.warn('Topic embedding for relevance floor', err, 'Using AN-only scoring');
        }
      }

      // AN score via cached claim embeddings
      const anScores = scoreNodesViaAN(claimEmbeddings, this.taxonomy.embeddings, undefined, true);

      // Hybrid: max(AN_score, topic_score × 0.5)
      scores = new Map<string, number>();
      const allIds = new Set([...anScores.keys(), ...(topicScores?.keys() ?? [])]);
      for (const id of allIds) {
        const anScore = anScores.get(id) ?? 0;
        const topicFloor = (topicScores?.get(id) ?? 0) * 0.5;
        scores.set(id, Math.max(anScore, topicFloor));
      }
    } else if (hasEmbeddings && adapter.computeQueryEmbedding) {
      // First-mover fallback: no AN claims yet — topic-only scoring
      try {
        const { vector } = await adapter.computeQueryEmbedding(query);
        if (vector && vector.length > 0) {
          scores = scoreNodeRelevance(vector, this.taxonomy.embeddings);
          roundFocusVector = vector;
        }
      } catch (err) {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Query embedding for relevance filter failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        this.warn('Query embedding for relevance filter', err, 'Falling back to lexical scoring');
      }
    }

    // Fallback: lexical overlap (no adapter embedding available)
    if (!scores) {
      scores = scoreNodesLexical(query, ctx.povNodes, ctx.situationNodes);
      scoringMode = 'lexical';
      console.warn('[relevance] Embedding adapter unavailable — using lexical fallback (reduced precision)');
    }

    // Diversification: down-weight nodes the speaker recently cited so fresh-but-relevant
    // nodes rise into the shortlist. Multiplicative penalty keeps strong-relevance recent
    // nodes in the mix when they still dominate other candidates.
    if (priorRefs.length > 0) {
      const recent = new Set(priorRefs);
      for (const [id, score] of scores) {
        if (recent.has(id)) scores.set(id, score * 0.55);
      }
    }

    // Apply adaptive situation score adjustments from crux re-scoring (t/23)
    if (this._situationScoreAdjustments) {
      for (const [id, adj] of this._situationScoreAdjustments) {
        const base = scores.get(id) ?? 0;
        scores.set(id, Math.max(0, base + adj));
      }
    }

    const relevanceOpts: RelevanceOptions = {
      scoringMode,
      embeddingThreshold: 0.48,
      lexicalThreshold: 0.22,
      minPerCategory: parseInt(process.env.TAXONOMY_MIN_PER_BDI || '') || 3,
      maxTotal: parseInt(process.env.TAXONOMY_MAX_NODES || '') || 12,
      nodeEmbeddings: roundFocusVector ? this.taxonomy.embeddings as Record<string, { pov: string; vector: number[]; exclusion_vector?: number[] }> : undefined,
      queryVector: roundFocusVector ?? undefined,
    };

    // Apply lineage boost when lineage_frame is available
    const lineageFrame = this.session.topic.critique?.lineage_frame;
    const lc = this.taxonomy.lineageCategories;
    if (lineageFrame && lineageFrame.length > 0 && lc) {
      const lineageByNode: Record<string, string[]> = {};
      for (const povKey of ['accelerationist', 'safetyist', 'skeptic'] as const) {
        for (const node of this.taxonomy[povKey]?.nodes ?? []) {
          const ga = (node as { graph_attributes?: { intellectual_lineage?: (string | { name: string })[] } }).graph_attributes;
          const lineage = ga?.intellectual_lineage;
          if (lineage && lineage.length > 0) {
            lineageByNode[node.id] = lineage.map(v => typeof v === 'string' ? v : v.name);
          }
        }
      }
      const nameToCluster: Record<string, string> = {};
      for (const [name, val] of Object.entries(lc.mapping)) {
        nameToCluster[name] = val.l2;
      }
      relevanceOpts.lineageBoost = {
        traditions: lineageFrame.map(f => f.cluster_id),
        boost: 0.08,
        lineageByNode,
        nameToCluster,
      };
    }

    const scoredPovRaw = selectRelevantNodes(ctx.povNodes, scores, relevanceOpts);
    const constraintFilter = filterByTopicConstraints(scoredPovRaw, this.session.topic.scope);
    const scoredPov = constraintFilter.nodes;

    if (constraintFilter.demoted.length > 0 || constraintFilter.boosted.length > 0) {
      getGlobalRecorder()?.record({
        type: 'turn.taxonomy_inject', component: 'debate-engine', level: 'info',
        message: `Topic constraint filter: ${constraintFilter.demoted.length} demoted, ${constraintFilter.boosted.length} boosted, ${constraintFilter.restorations.length} restored`,
        data: {
          demoted: constraintFilter.demoted,
          boosted: constraintFilter.boosted,
          restorations: constraintFilter.restorations,
        },
      });
    }

    // Apply policymaker situation relevance boost before selection
    const sitScores = new Map(scores);
    const policyBoostedSitIds: string[] = [];
    if (this.session.audience === 'policymakers') {
      for (const sit of ctx.situationNodes) {
        const boost = computePolicymakerRelevanceBoost(sit, this.session.audience);
        if (boost > 0) {
          sitScores.set(sit.id, (sitScores.get(sit.id) ?? 0) + boost);
          policyBoostedSitIds.push(sit.id);
        }
      }
    }

    // Apply exploration summary situation boosts/penalties (Phase 0.9 Step 2)
    if (this._explorationBoosts.size > 0) {
      for (const [sitId, adjustment] of this._explorationBoosts) {
        if (sitScores.has(sitId)) {
          sitScores.set(sitId, (sitScores.get(sitId) ?? 0) + adjustment);
        }
      }
    }

    let filteredSit = selectRelevantSituationNodes(ctx.situationNodes, sitScores, { ...relevanceOpts, maxTotal: undefined }, 3, 8);

    // Situation exclusion filter (t/490): skip situations whose exclusion zone matches the round focus
    let situationExclusionSkipped: { node_id: string; similarity_exclusion: number }[] = [];
    if (roundFocusVector) {
      const sitIds = filteredSit.map(s => s.node.id);
      const sitExclResult = filterByExclusionAbsolute(sitIds, roundFocusVector, this.taxonomy.embeddings as Record<string, { pov: string; vector: number[]; exclusion_vector?: number[] }>);
      if (sitExclResult.skipped.length > 0) {
        const passedSet = new Set(sitExclResult.passed);
        filteredSit = filteredSit.filter(s => passedSet.has(s.node.id));
        situationExclusionSkipped = sitExclResult.skipped;
      }
    }

    const filteredCtx = {
      povNodes: scoredPov.map(s => s.node),
      situationNodes: filteredSit.map(s => s.node),
      policyRegistry: ctx.policyRegistry,
      nodeScores: scores,
    };
    // Cache activated situations for AN claim grounding (t/243)
    this._activatedSituations = filteredSit.map(s => ({
      id: s.node.id,
      text: `${s.node.label} ${s.node.description}`,
    }));
    this._lastInjectionManifest = computeInjectionManifest(filteredCtx, pov);
    this._lastInjectionManifest.scoring_mode = scoringMode;
    this._lastRelevanceScores = scores;

    // Flight recorder: taxonomy injection details
    getGlobalRecorder()?.record({
      type: 'turn.taxonomy_inject', component: 'debate-engine', level: 'info',
      message: `Taxonomy inject: ${scoredPov.length} POV nodes selected`,
      data: {
        pov_nodes: scoredPov.length,
        avg_relevance: scoredPov.length > 0 ? +(scoredPov.reduce((s, n) => s + n.score, 0) / scoredPov.length).toFixed(3) : 0,
        min_relevance: scoredPov.length > 0 ? +Math.min(...scoredPov.map(n => n.score)).toFixed(3) : 0,
        filtered_out: ctx.povNodes.length - scoredPov.length,
        scoring_mode: scoringMode,
      },
    });
    getGlobalRecorder()?.record({
      type: 'turn.situation_inject', component: 'debate-engine', level: 'info',
      message: `Situation inject: ${filteredSit.length} nodes selected${situationExclusionSkipped.length > 0 ? `, ${situationExclusionSkipped.length} excluded` : ''}`,
      data: {
        injected_ids: filteredSit.map(s => s.node.id),
        count: filteredSit.length,
        primary_count: filteredSit.filter(s => s.score > 0.5).length,
        divergence_adjusted: policyBoostedSitIds.length,
        exclusion_skipped: situationExclusionSkipped.length > 0 ? situationExclusionSkipped : undefined,
      },
    });

    // Log lineage boost diagnostics
    const lbResult = (scoredPov as ScoredPovNode[] & { _lineageBoost?: import('./taxonomyRelevance.js').LineageBoostResult })._lineageBoost;
    if (lbResult && lbResult.boostedNodeIds.length > 0) {
      (this._lastInjectionManifest as Record<string, unknown>).lineage_boost = {
        boosted: lbResult.boostedNodeIds.length,
        promoted: lbResult.promotedCount,
        boostedNodeIds: lbResult.boostedNodeIds.slice(0, 20),
        promotedNodeIds: lbResult.promotedNodeIds.slice(0, 20),
      };
    }

    // Log scope filter trace for diagnostics UI (10.5)
    if (constraintFilter.demoted.length > 0 || constraintFilter.boosted.length > 0 || constraintFilter.restorations.length > 0) {
      (this._lastInjectionManifest as Record<string, unknown>).scope_filter_trace = {
        demoted: constraintFilter.demoted,
        boosted: constraintFilter.boosted,
        restorations: constraintFilter.restorations,
      };
    }

    // Log policymaker situation boost diagnostics
    if (policyBoostedSitIds.length > 0) {
      (this._lastInjectionManifest as Record<string, unknown>).policymaker_situation_boost = {
        boosted: policyBoostedSitIds.length,
        situations: policyBoostedSitIds.slice(0, 20),
      };
    }

    // Log situation exclusion filter diagnostics (t/490)
    if (situationExclusionSkipped.length > 0) {
      (this._lastInjectionManifest as Record<string, unknown>).situation_exclusion_filter = {
        skipped: situationExclusionSkipped,
        threshold: SCOPE_BOUNDARY_THRESHOLD,
      };
    }

    this._lastRelevanceScores = scores;
    return formatTaxonomyContext(filteredCtx, pov);
  }

  private formatDebaterEdgeContext(debaterPov: string): { text: string; edges_used: { source: string; target: string; type: string; confidence: number }[] } {
    if (!this.taxonomy.edges?.edges) return { text: '', edges_used: [] };

    const povPrefixes: Record<string, string> = {
      accelerationist: 'acc-', safetyist: 'saf-', skeptic: 'skp-',
    };
    const myPrefix = povPrefixes[debaterPov];
    if (!myPrefix) return { text: '', edges_used: [] };

    const otherPrefixes = Object.entries(povPrefixes)
      .filter(([pov]) => pov !== debaterPov)
      .map(([, prefix]) => prefix);

    const signalTypes = new Set(['CONTRADICTS', 'TENSION_WITH', 'WEAKENS']);

    const relevantEdges = this.taxonomy.edges.edges.filter(e => {
      if (!signalTypes.has(e.type)) return false;
      if (e.status !== 'approved' && e.confidence < 0.75) return false;
      const srcIsMine = e.source.startsWith(myPrefix);
      const tgtIsMine = e.target.startsWith(myPrefix);
      const srcIsOther = otherPrefixes.some(p => e.source.startsWith(p));
      const tgtIsOther = otherPrefixes.some(p => e.target.startsWith(p));
      return (srcIsMine && tgtIsOther) || (tgtIsMine && srcIsOther);
    });

    if (relevantEdges.length === 0) return { text: '', edges_used: [] };

    const top = relevantEdges.sort((a, b) => b.confidence - a.confidence).slice(0, 15);
    const lines = [
      '',
      '=== KNOWN TENSIONS WITH OPPOSING POSITIONS ===',
      'These are documented structural disagreements between your position and other perspectives.',
      'Use these to target your arguments at real fault lines rather than talking past opponents.',
    ];
    for (const e of top) {
      lines.push(`${e.source} ${e.type} ${e.target}`);
      if (e.rationale) lines.push(`  ${e.rationale.slice(0, 150)}`);
    }
    const edges_used = top.map(e => ({ source: e.source, target: e.target, type: e.type, confidence: e.confidence }));
    return { text: lines.join('\n'), edges_used };
  }

  private formatModeratorEdgeContext(): { text: string; edges_used: { source: string; target: string; type: string; confidence: number }[] } {
    if (!this.taxonomy.edges?.edges) return { text: '', edges_used: [] };

    const povPrefixes: Record<string, string> = {
      accelerationist: 'acc-', safetyist: 'saf-', skeptic: 'skp-',
    };
    const signalTypes = new Set(['CONTRADICTS', 'TENSION_WITH', 'WEAKENS', 'RESPONDS_TO']);
    const activePovs = this.config.activePovers.map(p => POVER_INFO[p].pov);
    const activePrefixes = activePovs.map(p => povPrefixes[p]).filter(Boolean);

    const relevantEdges = this.taxonomy.edges.edges.filter(e => {
      if (!signalTypes.has(e.type)) return false;
      if (e.status !== 'approved' && e.confidence < 0.75) return false;
      const srcPrefix = activePrefixes.find(p => e.source.startsWith(p));
      const tgtPrefix = activePrefixes.find(p => e.target.startsWith(p));
      return srcPrefix && tgtPrefix && srcPrefix !== tgtPrefix;
    });

    if (relevantEdges.length === 0) return { text: '', edges_used: [] };

    const top = relevantEdges.sort((a, b) => b.confidence - a.confidence).slice(0, 15);
    const lines = ['', '=== KNOWN TENSIONS BETWEEN POSITIONS ==='];
    for (const e of top) {
      lines.push(`${e.source} ${e.type} ${e.target} (confidence: ${e.confidence.toFixed(2)})`);
    }
    const edges_used = top.map(e => ({ source: e.source, target: e.target, type: e.type, confidence: e.confidence }));
    return { text: lines.join('\n'), edges_used };
  }

  // ── Commitment context ─────────────────────────────────────

  private getCommitmentContext(poverId: Exclude<SpeakerId, 'user'>): string {
    const commitments = this.session.commitments?.[poverId];
    if (!commitments) return '';

    const an = this.session.argument_network;
    const priorClaims = an?.nodes
      .filter(n => n.speaker === poverId)
      .map(n => ({ text: n.text }));

    return formatCommitments(commitments, priorClaims);
  }

  /** Get recent claims from other debaters so the current speaker doesn't echo them */
  private getEstablishedPointsContext(poverId: Exclude<SpeakerId, 'user'>): string {
    const an = this.session.argument_network;
    if (!an || an.nodes.length === 0) return '';

    const allNodes = an.nodes.map(n => ({
      id: n.id,
      text: n.canonical_proposition || n.text,
      speaker: POVER_INFO[n.speaker as Exclude<SpeakerId, 'user'>]?.label ?? n.speaker,
    }));

    return formatEstablishedPoints(allNodes, POVER_INFO[poverId].label, 14, an.edges);
  }

  // ── Phase: Topic Critique ──────────────────────────────────

  private async runTopicCritique(): Promise<void> {
    // Skip if already computed (run-once guard)
    if (this.session.topic.critique) return;

    this.progress('setup', undefined, 'Evaluating topic quality');

    try {
      // Phase A: Structural scoring (deterministic)
      const adapter = this.adapter;
      let topicEmbedding: number[] | undefined;
      if (adapter.computeQueryEmbedding) {
        try {
          const { vector } = await adapter.computeQueryEmbedding(this.session.topic.final);
          topicEmbedding = vector;
        } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Topic embedding for structural scoring failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); }
      }

      // Collect POV nodes for structural analysis
      const povNodes: { id: string; pov: string; category: import('./taxonomyTypes.js').Category }[] = [];
      for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
        for (const node of this.taxonomy[pov]?.nodes ?? []) {
          povNodes.push({ id: node.id, pov, category: node.category });
        }
      }

      let structuralScore;
      if (topicEmbedding && topicEmbedding.length > 0) {
        structuralScore = computeStructuralScore({
          topicEmbedding,
          povNodes,
          situationNodes: this.taxonomy.situations?.nodes ?? [],
          embeddings: this.taxonomy.embeddings,
          evidenceIndex: this.sourceEvidenceIndex ?? undefined,
        });
      } else {
        // No embedding available — return zeroed structural score
        structuralScore = computeStructuralScore({
          topicEmbedding: [],
          povNodes,
          situationNodes: this.taxonomy.situations?.nodes ?? [],
          embeddings: {},
        });
      }

      // Lineage distribution (deterministic — from activated nodes' intellectual_lineage)
      let lineageFrame: LineageFrameEntry[] = [];
      const lc = this.taxonomy.lineageCategories;
      if (lc && structuralScore.activated_nodes.length > 0) {
        // Build per-node lineage lookup from taxonomy nodes
        const lineageByNode: Record<string, string[]> = {};
        for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
          for (const node of this.taxonomy[pov]?.nodes ?? []) {
            const ga = (node as { graph_attributes?: { intellectual_lineage?: (string | { name: string })[] } }).graph_attributes;
            const lineage = ga?.intellectual_lineage;
            if (lineage && lineage.length > 0) {
              lineageByNode[node.id] = lineage.map(v => typeof v === 'string' ? v : v.name);
            }
          }
        }

        // Build name→cluster and cluster→label lookups from lineage categories
        const nameToCluster: Record<string, string> = {};
        for (const [name, val] of Object.entries(lc.mapping)) {
          nameToCluster[name] = val.l2;
        }
        const clusterLabels: Record<string, string> = {};
        for (const cat of lc.level2_categories) {
          clusterLabels[cat.id] = cat.label;
        }

        lineageFrame = computeLineageDistribution({
          activatedNodeIds: structuralScore.activated_nodes.map(n => n.id),
          lineageByNode,
          nameToCluster,
          clusterLabels,
        });
      }

      // Phase B: Frame analysis (single LLM call)
      let structuralContext = formatStructuralContext(structuralScore);
      if (lineageFrame.length > 0) {
        structuralContext += '\n' + formatLineageContext(lineageFrame);
      }
      const prompt = critiqueTopicPrompt(this.session.topic.final, structuralContext, this.session.audience);
      const text = await this.generateViaUsage('debate.topic-critique', prompt, 'Topic critique');
      const critique = parseTopicCritique(text, structuralScore);

      // Store lineage frame on the critique
      if (lineageFrame.length > 0) {
        critique.lineage_frame = lineageFrame;
      }

      this.session.topic.critique = critique;
      this.progress('setup', undefined, `Topic quality: ${critique.rating} (${critique.composite_score}/20)`);

      // Reframing: apply rewritten topic when below threshold
      const threshold = this.config.wisdomReframeThreshold ?? 10;
      const autoReframe = this.config.wisdomAutoReframe !== false;

      if (critique.composite_score < threshold && critique.rewritten_topic && autoReframe) {
        this.progress('setup', undefined, 'Reframing topic for productive disagreement');

        // Preserve original in refined, apply rewritten topic
        this.session.topic.refined = this.session.topic.final;
        this.session.topic.final = critique.rewritten_topic;
        critique.reframe_applied = true;

        // Post-reframe re-score (deterministic only) to validate structural improvement
        if (topicEmbedding && adapter.computeQueryEmbedding) {
          try {
            const { vector: reframedEmbedding } = await adapter.computeQueryEmbedding(critique.rewritten_topic);
            const reframedStructural = computeStructuralScore({
              topicEmbedding: reframedEmbedding,
              povNodes,
              situationNodes: this.taxonomy.situations?.nodes ?? [],
              embeddings: this.taxonomy.embeddings,
              evidenceIndex: this.sourceEvidenceIndex ?? undefined,
            });
            // Only keep the reframe if structural score didn't regress
            if (reframedStructural.total < structuralScore.total) {
              // Revert — reframing made structural coverage worse
              this.session.topic.final = this.session.topic.refined!;
              this.session.topic.refined = null;
              critique.reframe_applied = false;
              critique.reframe_changes = 'Reverted: structural score regressed after reframing';
              this.addEntry({
                type: 'system', speaker: 'system',
                content: `Topic wisdom score: ${critique.composite_score}/20 (below ${threshold}). Reframing reverted: structural score regressed (${reframedStructural.total} < ${structuralScore.total}).`,
                taxonomy_refs: [], metadata: {},
              });
            } else {
              critique.reframe_changes = `Reframed topic applied (structural: ${structuralScore.total} → ${reframedStructural.total})`;
              this.addEntry({
                type: 'system', speaker: 'system',
                content: `Topic wisdom score: ${critique.composite_score}/20 (below ${threshold}). Reframed: ${critique.reframe_changes}`,
                taxonomy_refs: [], metadata: {},
              });
            }
          } catch (err) {
            getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Topic re-score after reframe failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
            critique.reframe_changes = 'Reframed topic applied (post-reframe re-score unavailable)';
            this.addEntry({
              type: 'system', speaker: 'system',
              content: `Topic wisdom score: ${critique.composite_score}/20 (below ${threshold}). Reframed (re-score skipped).`,
              taxonomy_refs: [], metadata: {},
            });
          }
        } else {
          critique.reframe_changes = 'Reframed topic applied (no embedding available for re-score)';
          this.addEntry({
            type: 'system', speaker: 'system',
            content: `Topic wisdom score: ${critique.composite_score}/20 (below ${threshold}). Reframed (no re-score).`,
            taxonomy_refs: [], metadata: {},
          });
        }

        this.progress('setup', undefined, `Topic reframed: ${critique.reframe_changes}`);
      } else if (critique.composite_score < threshold && !autoReframe) {
        // Score-only mode: log but don't reframe
        this.addEntry({
          type: 'system', speaker: 'system',
          content: `Topic wisdom score: ${critique.composite_score}/20 (below ${threshold}). Auto-reframe disabled — topic unchanged.`,
          taxonomy_refs: [], metadata: {},
        });
      } else {
        // Score above threshold — log for diagnostics
        const exploratoryNote = critique.exploratory ? ' [exploratory — low evidence coverage]' : '';
        this.addEntry({
          type: 'system', speaker: 'system',
          content: `Topic wisdom score: ${critique.composite_score}/20. No reframing needed.${exploratoryNote}`,
          taxonomy_refs: [], metadata: {},
        });
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Topic critique failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Topic critique', err, 'Topic quality evaluation skipped — does not affect debate flow');
    }
  }

  // ── Phase: Topic Scope Extraction (t/336) ──────────────────
  private async extractTopicScope(): Promise<void> {
    if (this.session.topic.scope) return;

    this.progress('setup', undefined, 'Extracting topic scope');

    try {
      const scopeAdditions = this.session.topic.critique?.scope_additions;
      const prompt = topicScopeExtractionPrompt(this.session.topic.final, scopeAdditions);
      const scopeModel = this.resolveStageModel('scope');
      const text = await this.generateWithModel(prompt, 'Topic scope extraction', scopeModel);
      const parsed = parseJsonRobust(text) as Record<string, unknown> | null;
      if (!parsed || typeof parsed !== 'object') {
        this.warn('Topic scope extraction', 'LLM returned unparseable response', 'Scope extraction skipped — debate continues without scope enforcement');
        return;
      }

      const validRiskLevels: TopicScopeRiskLevel[] = ['low', 'medium', 'high', 'catastrophic', 'unspecified'];
      const riskLevel = validRiskLevels.includes(parsed.risk_level as TopicScopeRiskLevel)
        ? parsed.risk_level as TopicScopeRiskLevel
        : 'unspecified';

      const toStringArray = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];

      const scope: TopicScope = {
        core_proposition: typeof parsed.core_proposition === 'string' ? parsed.core_proposition : this.session.topic.final,
        relevant_disciplines: toStringArray(parsed.relevant_disciplines),
        on_scope_evidence: toStringArray(parsed.on_scope_evidence),
        key_tensions: toStringArray(parsed.key_tensions),
        off_scope_topics: toStringArray(parsed.off_scope_topics),
        drift_signatures: toStringArray(parsed.drift_signatures),
        example_ceiling: typeof parsed.example_ceiling === 'string' ? parsed.example_ceiling : '',
        risk_level: riskLevel,
        domain: typeof parsed.domain === 'string' ? parsed.domain : '',
        product_type: typeof parsed.product_type === 'string' ? parsed.product_type : null,
        time_horizon: typeof parsed.time_horizon === 'string' ? parsed.time_horizon : null,
        excluded_scenarios: toStringArray(parsed.excluded_scenarios),
        explicit_qualifiers: toStringArray(parsed.explicit_qualifiers),
        constraint_confidence: parsed.constraint_confidence === 'explicit' ? 'explicit' : 'inferred',
      };

      if (scope.off_scope_topics.length < 3 || scope.drift_signatures.length < 2) {
        this.warn('Topic scope extraction', `Sparse output: ${scope.off_scope_topics.length} off_scope_topics, ${scope.drift_signatures.length} drift_signatures`, 'Scope stored but enforcement may be weak');
      }

      this.session.topic.scope = scope;
      this.progress('setup', undefined, `Topic scope extracted (${scope.constraint_confidence}, ${scope.off_scope_topics.length} off-scope, ${scope.drift_signatures.length} drift sigs)`);
      getGlobalRecorder()?.record({
        type: 'topic_scope_extracted', component: 'debate-engine', level: 'info',
        message: `Topic scope extracted (${scope.constraint_confidence})`,
        data: {
          core_proposition: scope.core_proposition,
          risk_level: scope.risk_level,
          off_scope_count: scope.off_scope_topics.length,
          drift_sig_count: scope.drift_signatures.length,
          constraint_confidence: scope.constraint_confidence,
        },
      });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'topic_scope_extraction_failed', component: 'debate-engine', level: 'warn',
        debate_id: this.session?.id,
        message: `Topic scope extraction failed: ${err instanceof Error ? err.message : String(err)}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      this.warn('Topic scope extraction', err, 'Scope extraction skipped — debate continues without scope enforcement');
    }
  }

  // ── Lineage context for topic framing ────────────────────

  private buildLineageContext(): string | undefined {
    // Prefer pre-computed lineage frame from topic critique (free-form debates)
    const lineageFrame = this.session.topic.critique?.lineage_frame;
    if (lineageFrame && lineageFrame.length > 0) {
      return formatLineageContext(lineageFrame);
    }

    // Fallback: compute from all taxonomy nodes (document/situation debates)
    const lc = this.taxonomy.lineageCategories;
    if (!lc) return undefined;

    const allNodeIds: string[] = [];
    const lineageByNode: Record<string, string[]> = {};
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      for (const node of this.taxonomy[pov]?.nodes ?? []) {
        allNodeIds.push(node.id);
        const ga = (node as { graph_attributes?: { intellectual_lineage?: (string | { name: string })[] } }).graph_attributes;
        const lineage = ga?.intellectual_lineage;
        if (lineage && lineage.length > 0) {
          lineageByNode[node.id] = lineage.map(v => typeof v === 'string' ? v : v.name);
        }
      }
    }

    const nameToCluster: Record<string, string> = {};
    for (const [name, val] of Object.entries(lc.mapping)) {
      nameToCluster[name] = val.l2;
    }
    const clusterLabels: Record<string, string> = {};
    for (const cat of lc.level2_categories) {
      clusterLabels[cat.id] = cat.label;
    }

    const frame = computeLineageDistribution({
      activatedNodeIds: allNodeIds,
      lineageByNode,
      nameToCluster,
      clusterLabels,
    });
    if (frame.length === 0) return undefined;
    return formatLineageContext(frame);
  }

  // ── Phase: Clarification ───────────────────────────────────

  private async runClarification(): Promise<void> {
    this.progress('clarification', undefined, 'Generating clarifying questions');
    this.session.phase = 'clarification';

    const lineageCtx = this.buildLineageContext();

    let prompt: string;
    if (this.config.sourceType === 'document' || this.config.sourceType === 'url') {
      prompt = documentClarificationPrompt(this.config.topic, this.config.sourceContent ?? '', this.config.audience, lineageCtx);
    } else if (this.config.sourceType === 'situations') {
      prompt = situationClarificationPrompt(this.config.topic, this.config.sourceContent ?? '', this.config.audience, lineageCtx);
    } else {
      prompt = clarificationPrompt(this.config.topic, this.config.sourceContent, this.config.audience, lineageCtx);
    }

    const text = await this.generateViaUsage('debate.clarification-questions', prompt, 'Clarification questions');
    let structuredQuestions: { question: string; options: string[] }[] = [];
    try {
      const parsed = parseJsonRobust(text) as { questions?: unknown[] };
      const raw = parsed.questions ?? [];
      // Handle both old format (string[]) and new format ({question, options}[])
      structuredQuestions = raw.map((q: string | { question: string; options?: string[] }) =>
        typeof q === 'string' ? { question: q, options: [] } : { question: q.question, options: q.options ?? [] }
      );
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Parsing clarification questions failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Parsing clarification questions', err, 'Using raw AI response as a single question');
      structuredQuestions = [{ question: text, options: [] }];
    }

    const questionTexts = structuredQuestions.map(q =>
      typeof q.question === 'string' ? q.question : JSON.stringify(q.question)
    );

    const clarEntry = this.addEntry({
      type: 'clarification',
      speaker: 'system',
      content: questionTexts.join('\n'),
      taxonomy_refs: [],
      metadata: { questions: structuredQuestions },
    });
    this.recordDiagnostic(clarEntry.id, { prompt, raw_response: text });

    // Auto-generate answers and synthesize refined topic
    this.progress('clarification', undefined, 'Synthesizing refined topic');
    const qaPairs = questionTexts.map(q => `Q: ${q}\nA: [Automated: The debate should explore this from all three perspectives.]`).join('\n\n');
    const concludingPromptText = concludingPrompt(this.config.topic, qaPairs, this.config.audience, undefined, lineageCtx);
    const synthText = await this.generateViaUsage('debate.topic-synthesis', concludingPromptText, 'Topic synthesis');

    try {
      const parsed = parseJsonRobust(synthText) as { refined_topic?: string };
      if (parsed.refined_topic) {
        this.session.topic.refined = parsed.refined_topic;
        this.session.topic.final = parsed.refined_topic;
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Parsing refined topic failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Parsing refined topic from clarification', err, 'Keeping original topic unchanged');
    }

    this.addEntry({
      type: 'answer',
      speaker: 'user',
      content: `[Automated clarification] Refined topic: ${this.session.topic.final}`,
      taxonomy_refs: [],
    });

    await this.decomposeResolutionIntoClauses();
    await this.embedResolutionAnchors();
  }

  /** Decomposes `topic.final` into atomic clauses and persists them on
   *  `topic.clauses`. Used by the moderator prompt to keep interventions
   *  anchored. Non-fatal: if decomposition fails, clauses remain undefined
   *  and the moderator falls back to resolution-only anchoring. */
  private async decomposeResolutionIntoClauses(): Promise<void> {
    const resolution = this.session.topic.final;
    if (!resolution || resolution.trim().length === 0) return;

    try {
      const prompt = decomposeResolutionPrompt(resolution);
      const text = await this.generate(prompt, 'Resolution clause decomposition');
      const parsed = parseJsonRobust(text) as { clauses?: unknown };
      if (Array.isArray(parsed.clauses)) {
        const clauses = parsed.clauses
          .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
          .map(c => c.trim());
        if (clauses.length > 0) {
          this.session.topic.clauses = clauses;
        }
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Resolution clause decomposition failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Resolution clause decomposition', err, 'Moderator will anchor to resolution text only');
    }
  }

  /** Embeds the resolution and each clause for per-turn ArCo and
   *  clause-coverage signals. Persists to `topic.embedding` and
   *  `topic.clause_embeddings`. Non-fatal — if the adapter doesn't expose
   *  computeQueryEmbedding or the call fails, drift signals downgrade to
   *  the deterministic fallbacks. */
  private async embedResolutionAnchors(): Promise<void> {
    const adapter = this.adapter as ExtendedAIAdapter;
    if (!adapter.computeQueryEmbedding) return;
    const resolution = this.session.topic.final;
    if (!resolution || resolution.trim().length === 0) return;

    try {
      const { vector } = await adapter.computeQueryEmbedding(resolution.slice(0, 1000));
      if (vector && vector.length > 0) {
        this.session.topic.embedding = vector;
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Resolution embedding failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Resolution embedding', err, 'ArCo drift signal will be unavailable');
    }

    const clauses = this.session.topic.clauses;
    if (!clauses || clauses.length === 0) return;
    const clauseVectors: number[][] = [];
    for (const clause of clauses) {
      try {
        const { vector } = await adapter.computeQueryEmbedding(clause.slice(0, 500));
        if (vector && vector.length > 0) clauseVectors.push(vector);
      } catch (err) {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Clause embedding failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      }
    }
    if (clauseVectors.length === clauses.length) {
      this.session.topic.clause_embeddings = clauseVectors;
    }
  }

  /** Aggregate recent convergence_signals into the topic-drift summary
   *  consumed by the moderator's selection prompt. Returns undefined when
   *  no signals yet exist (e.g., before the first turn). */
  private computeTopicDriftState(): ModeratorSelectionInput['topicDriftState'] {
    const signals = this.session.convergence_signals ?? [];
    if (signals.length === 0) return undefined;

    const RECENT_WINDOW = 6;
    const recent = signals.slice(-RECENT_WINDOW);
    const latest = signals[signals.length - 1];

    const totalClauses = this.session.topic.clauses?.length ?? 0;
    const coveredSet = new Set<number>();
    let consecutiveOffClause = 0;
    for (let i = signals.length - 1; i >= 0; i--) {
      const c = signals[i].clause_coverage;
      if (!c) break;
      if (c.no_clause_engaged) consecutiveOffClause++;
      else break;
    }
    for (const s of recent) {
      const c = s.clause_coverage;
      if (c && c.best_clause_id != null) coveredSet.add(c.best_clause_id + 1);
    }
    const covered = Array.from(coveredSet).sort((a, b) => a - b);
    const uncovered: number[] = [];
    for (let i = 1; i <= totalClauses; i++) {
      if (!coveredSet.has(i)) uncovered.push(i);
    }

    return {
      phaseMeanSimilarity: latest.arco?.phase_mean,
      driftWarning: latest.arco?.drift_warning ?? false,
      coveredClauses: covered,
      uncoveredClauses: uncovered,
      consecutiveOffClause,
    };
  }

  // ── Phase: Document pre-analysis ───────────────────────────

  private async runDocumentAnalysis(): Promise<void> {
    this.progress('analysis', undefined, 'Analyzing document claims');

    const taxonomySample = buildTaxonomySample(this.taxonomy);
    const activePovers = this.config.activePovers.map(
      p => POVER_INFO[p].pov,
    );
    const { prompt, truncationMetrics } = documentAnalysisPrompt(
      this.config.sourceContent ?? '',
      this.session.topic.final,
      activePovers,
      taxonomySample,
    );

    // Record document truncation context-rot metrics
    if (!this.session.context_rot) {
      this.session.context_rot = {
        schema_version: 1,
        pipeline: 'debate',
        doc_id: this.session.id,
        measured_at: new Date().toISOString(),
        stages: [],
        cumulative_retention: 1,
      };
    }
    this.session.context_rot.stages.push(truncationMetrics);

    const text = await this.generate(prompt, 'Document analysis', 90_000);

    let analysis: DocumentAnalysis | null = null;
    try {
      analysis = parseJsonRobust(text) as DocumentAnalysis;
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Parsing document analysis failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Parsing document analysis', err, 'Proceeding without document pre-analysis');
    }

    if (analysis && analysis.i_nodes && analysis.i_nodes.length > 0) {
      this.session.document_analysis = analysis;

      // Add transcript entry recording the analysis
      const entry = this.addEntry({
        type: 'system',
        speaker: 'system',
        content: `Document analysis complete: ${analysis.i_nodes.length} claims extracted, ${analysis.tension_points.length} tension points identified.\n\n${analysis.claims_summary}`,
        taxonomy_refs: [],
      });

      // Seed argument network with document i-nodes
      const an = this.session.argument_network!;
      const adapter = this.adapter as ExtendedAIAdapter;
      for (const inode of analysis.i_nodes) {
        const node: import('./types.js').ArgumentNetworkNode = {
          id: inode.id,
          text: inode.text,
          attribution_text_genus: inode.attribution_text || undefined,
          speaker: 'document',
          source_entry_id: entry.id,
          taxonomy_refs: inode.taxonomy_refs,
          turn_number: 0,
          extraction_confidence: inode.extraction_confidence,
        };
        // Embed doc i-nodes for AN-based taxonomy relevance scoring
        if (adapter.computeQueryEmbedding) {
          try {
            const { vector } = await adapter.computeQueryEmbedding(inode.text.slice(0, 300));
            if (vector && vector.length > 0) node.embedding = vector;
          } catch { /* telemetry — silent by design: doc i-node embedding is best-effort */ }
          if (inode.attribution_text) {
            try {
              const { vector } = await adapter.computeQueryEmbedding(inode.attribution_text.slice(0, 300));
              if (vector && vector.length > 0) node.attribution_embedding = vector;
            } catch { /* best-effort: falls back to node.embedding for attribution */ }
          }
        }
        an.nodes.push(node);
      }

      this.recordDiagnostic(entry.id, { prompt, raw_response: text });
    }
  }

  // ── Phase: Opening statements ──────────────────────────────

  private async runOpeningStatements(): Promise<void> {
    this.session.phase = 'opening';

    // Shuffle opening order (Fisher-Yates)
    const order = [...this.config.activePovers];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    const priorStatements: { speaker: string; pov: string; poverId: string; statement: string; summary: string }[] = [];

    for (const poverId of order) {
      // Per-iteration idempotency: skip speakers who already have an opening (t/919)
      if (this.session.transcript.some(e => e.type === 'opening' && e.speaker === poverId)) {
        continue;
      }

      const info = POVER_INFO[poverId];
      this.progress('opening', poverId, `${info.label} preparing opening statement`);

      const taxonomyContext = await this.getRelevantTaxonomyContext(info.pov);
      const commitmentContext = this.getCommitmentContext(poverId);
      const establishedPoints = this.getEstablishedPointsContext(poverId);
      const { text: edgeContext, edges_used: openingEdgesUsed } = this.formatDebaterEdgeContext(info.pov);

      let priorBlock = '';
      if (priorStatements.length > 0) {
        priorBlock = '\n\n=== PRIOR OPENING POSITIONS (structured) ===\n';
        const an = this.session.argument_network;
        for (const ps of priorStatements) {
          priorBlock += `\n--- ${ps.speaker} (${ps.pov}) ---\n`;
          priorBlock += `Summary: ${ps.summary}\n\n`;

          // Get AN nodes from this speaker's opening
          const speakerNodes = (an?.nodes ?? []).filter(n =>
            n.speaker === ps.poverId &&
            (n as any).source_round === 0
          );

          if (speakerNodes.length > 0) {
            priorBlock += 'Claims extracted:\n';
            for (const node of speakerNodes) {
              const bdi = node.bdi_category ?? 'unknown';
              const strength = node.scoring_method === 'bdi_composite' ? 'composite'
                : node.scoring_method === 'unscored' ? 'unscored' : 'bdi_criteria';
              const refs = (node as any).taxonomy_refs?.slice(0, 2).join(', ') ?? '';
              const refsLabel = refs ? ` → grounded in ${refs}` : '';
              priorBlock += `- [${node.id}] (${bdi}, ${strength}) "${node.text.slice(0, 120)}"${refsLabel}\n`;
            }
          } else {
            priorBlock += `(No structured claims extracted yet)\n`;
          }
          priorBlock += '\n';
        }
      }

      const vocabContext = this.config.vocabulary
        ? '\n' + formatVocabularyContext({ pov: info.pov, ...this.config.vocabulary })
        : '';
      const fullContext = taxonomyContext + vocabContext + commitmentContext + establishedPoints + edgeContext;

      // ── 4-stage pipeline: BRIEF → PLAN → DRAFT → CITE ──
      const userSeeds = (this.session.argument_network?.nodes || [])
        .filter(n => n.speaker === 'user' && n.id.startsWith('user-seed-'))
        .map(n => ({ id: n.id, text: n.text, bdi_category: n.bdi_category }));

      const pipelineInput: OpeningPipelineInput = {
        label: info.label,
        pov: info.pov,
        personality: info.personality,
        topic: this.session.topic.final,
        background: this.session.topic.background || undefined,
        taxonomyContext: fullContext,
        priorStatements: priorBlock,
        isFirst: priorStatements.length === 0,
        sourceContent: this.session.document_analysis ? undefined : this.config.sourceContent,
        documentAnalysis: this.session.document_analysis,
        audience: this.config.audience,
        model: this.resolveModelForSpeaker(poverId),
        briefModel: this.config.stageModels?.brief,
        planModel: this.config.stageModels?.plan,
        draftModel: this.config.stageModels?.draft,
        citeModel: this.config.stageModels?.cite,
        userSeedClaims: userSeeds.length > 0 ? userSeeds : undefined,
        availablePovNodeIds: [...this.getKnownNodeIds()],
        ...(this.config.temperature != null ? {
          stageTemperatures: {
            brief_temperature: this.config.temperature,
            plan_temperature: this.config.temperature,
            draft_temperature: this.config.temperature,
            cite_temperature: this.config.temperature,
          },
        } : {}),
      };

      getGlobalRecorder()?.setEventContext({
        debate_id: this.session.id,
        run_id: this.session.run_id,
        speaker: poverId,
        phase: 'opening',
        round: 0,
        turn_index: this.session.transcript.length,
      });
      let pipelineResult = await this.executeWithModelFailover(poverId, async (model) => {
        const input = { ...pipelineInput, model };
        let result = await runOpeningPipeline(
          input,
          this.stageGenerate.bind(this),
          (_stage, label) => this.progress('opening', poverId, label),
        );

        const repairHints = getOpeningRepairHints(result);
        if (repairHints.length > 0) {
          this.progress('opening', poverId, `${info.label} retrying (${repairHints.length} issue${repairHints.length > 1 ? 's' : ''})`);
          try {
            result = await runOpeningPipeline(
              { ...input, repairHints },
              this.stageGenerate.bind(this),
              (_stage, label) => this.progress('opening', poverId, label),
            );
          } catch (err) {
            getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Opening retry failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
            this.warn('Opening retry', err, 'Using first attempt');
          }
        }
        return result;
      });

      const { statement, taxonomyRefs, meta } = assembleOpeningPipelineResult(pipelineResult, this.getKnownNodeIds());
      this.enrichTaxonomyRefs(taxonomyRefs);

      const speakerModel = this.resolveModelForSpeaker(poverId);
      const entry = this.addEntry({
        type: 'opening',
        speaker: poverId,
        content: statement,
        taxonomy_refs: taxonomyRefs,
        policy_refs: meta.policy_refs,
        model: this.config.speakerModels ? speakerModel : undefined,
        metadata: {
          key_assumptions: meta.key_assumptions,
          my_claims: meta.my_claims,
          turn_symbols: meta.turn_symbols,
          injection_manifest: this._lastInjectionManifest ?? undefined,
        },
      });

      // Accumulate context manifest for taxonomy gap analysis
      this.accumulateContextManifest(0, poverId, info.pov, taxonomyRefs.map(r => r.node_id));

      const draftDiag = pipelineResult.stage_diagnostics.find(s => s.stage === 'draft');
      this.recordDiagnostic(entry.id, {
        prompt: draftDiag?.prompt ?? '',
        raw_response: draftDiag?.raw_response ?? '',
        model: speakerModel,
        response_time_ms: pipelineResult.total_time_ms,
        taxonomy_context: taxonomyContext,
        commitment_context: commitmentContext,
        stage_diagnostics: pipelineResult.stage_diagnostics,
        edges_used: openingEdgesUsed,
      });

      // Extract claims synchronously
      const anNodesBefore2 = this.session.argument_network!.nodes.length;
      await this.extractClaims(statement, poverId, entry.id, taxonomyRefs.map(r => r.node_id), meta.my_claims);
      const newNodes2 = this.session.argument_network!.nodes.slice(anNodesBefore2);

      // Post-extraction interventions (non-blocking)
      if (newNodes2.length > 0) {
        this.validateSteelmans(newNodes2, poverId).catch(err => this.warn('Steelman validation', String(err), 'Opening steelman check skipped'));
        this.verifyPreciseClaims(newNodes2).catch(err => this.warn('Precise claims', String(err), 'Opening precision check skipped'));
      }

      // Post-turn summarization (DT-2)
      await this.summarizeEntry(entry);

      priorStatements.push({
        speaker: info.label,
        pov: info.pov,
        poverId,
        statement,
        summary: statement.split('\n')[0].slice(0, 150) + '...',
      });
    }

    this.session.phase = 'debate';
  }

  // ── Phase: Cross-respond round ─────────────────────────────

  private async runFixedCrossRespond(): Promise<void> {
    const midpointRound = Math.min(3, Math.ceil(this.config.rounds / 2));
    const w = loadProvisionalWeights();
    let gcRan = false;

    for (let round = 1; round <= this.config.rounds; round++) {
      this.checkAborted();
      const phase = getDebatePhase(round, this.config.rounds);
      this.progress('debate', undefined, `Cross-respond round ${round}/${this.config.rounds} [${phase}]`, round);
      await this.runCrossRespondRound(round, phase);

      // Perturbation injection (evaluation/benchmark only)
      if (this.config.perturbation && round === this.config.perturbation.inject_at_turn) {
        this.injectPerturbation(round);
      }

      // Network GC — same topology-aware pruning as adaptive mode
      const an = this.session.argument_network;
      if (an && !gcRan && needsGc(an.nodes.length, w.network.gc_trigger)) {
        const gcResult = pruneArgumentNetwork(an.nodes, an.edges, w.network.gc_target);
        an.nodes = gcResult.nodes;
        an.edges = gcResult.edges;
        gcRan = true;
        this.progress('debate', undefined,
          `Network GC: ${gcResult.before} → ${gcResult.after} nodes`);
      }

      this.checkAborted();
      const gapRound = this.config.gapInjectionRound ?? Math.ceil(this.config.rounds / 2) + 1;
      if (gapRound > 0 && round === gapRound && this._gapInjectionCount === 0) {
        await this.runGapInjection(round, 'scheduled');
      } else if (gapRound > 0) {
        await this.runResponsiveGapCheck(round, gapRound);
      }

      if (round === midpointRound && !this._midpointEvalDone) {
        await this.runNeutralCheckpoint('midpoint');
        this._midpointEvalDone = true;
      }

      if (this.config.enableProbing && this.config.probingInterval &&
          round % this.config.probingInterval === 0 && round < this.config.rounds) {
        await this.runProbingQuestions(round);
      }

      if (this.session.transcript.length >= 12) {
        await this.compressContext();
      }

      this.emitSnapshot('round_complete');

      if (this.shouldTriggerDiversityRound(round, phase)) {
        await this.runDiversityRound(round + 1);
      }
    }
  }

  private async runAdaptiveCrossRespond(): Promise<void> {
    const config = this._adaptiveConfig!;
    const signals = this._signalRegistry!;
    const diag = this._adaptiveDiagnostics!;
    const w = loadProvisionalWeights();
    let state = this._phaseState!;

    let round = 0;
    let terminated = false;
    let currentPhaseStartRound = 1;
    let currentPhaseExitReason = '';

    const midpointRound = Math.min(3, Math.ceil(config.maxTotalRounds / 2));

    while (!terminated) {
      this.checkAborted();
      round++;
      state = advanceRound(state);
      state.api_calls_used = this.apiCallCount;
      this._phaseState = state;

      const phase = state.current_phase;
      this.progress('debate', undefined,
        `Round ${round} [${phase}] (adaptive)`, round);

      // Run the cross-respond round
      await this.runCrossRespondRound(round, phase);

      // Perturbation injection (evaluation/benchmark only)
      if (this.config.perturbation && round === this.config.perturbation.inject_at_turn) {
        this.injectPerturbation(round);
      }

      // Update peak trackers after claims extraction
      const thisRoundStatements = this.session.transcript
        .filter(e => e.type === 'statement' && (e.metadata as Record<string, unknown>)?.round === round);
      const claimsThisRound = thisRoundStatements.reduce((sum, e) => {
        const meta = e.metadata as Record<string, unknown> | undefined;
        return sum + ((meta?.extracted_claims_accepted as number) ?? 0);
      }, 0);
      this.updatePeakTracker('_peak_claims_per_round', claimsThisRound);

      const lastConvSignal = (this.session.convergence_signals ?? []).slice(-1)[0];
      if (lastConvSignal) {
        this.updatePeakTracker('_peak_engagement_ratio', lastConvSignal.dialectical_engagement.ratio);
      }

      // Record peak trackers into signal history so priorSignals.get() works
      for (const [key, val] of this._peakTrackers) {
        this.recordSignalHistory(key, round, val);
      }

      // Build signal context and evaluate phase transition
      const predicateStart = Date.now();
      const ctx = this.buildSignalContext(round);

      // Compute scores for telemetry
      const coldStart = state.rounds_in_phase < (
        state.current_phase === 'confrontation' ? w.phase_bounds.min_confrontation_rounds
        : state.current_phase === 'argumentation' ? w.phase_bounds.min_argumentation_rounds
        : w.phase_bounds.min_concluding_rounds
      );
      const satScore = computeSaturationScore(signals, ctx, coldStart);
      const convScore = computeConvergenceScore(ctx, coldStart);

      // Record composite scores in signal history
      this.recordSignalHistory('_argumentative_saturation_score', round, satScore);
      this.recordSignalHistory('_convergence_score', round, convScore);

      // Record individual signal values
      for (const signal of signals) {
        if (!signal.enabled) continue;
        try {
          const val = Math.max(0, Math.min(1, signal.compute(ctx)));
          this.recordSignalHistory(signal.id, round, val);
        } catch { /* telemetry — silent by design: individual signal computation is best-effort */ }
      }

      // Health score for early termination
      const recentHealthSignals = (this.session.convergence_signals ?? []).slice(-3);
      const turnCounts: Record<string, number> = {};
      for (const p of this.config.activePovers) turnCounts[p] = 0;
      for (const e of this.session.transcript) {
        if (e.type === 'statement' && e.speaker !== 'system' && e.speaker !== 'moderator') {
          turnCounts[e.speaker] = (turnCounts[e.speaker] ?? 0) + 1;
        }
      }
      const referencedIds = new Set<string>();
      for (const e of this.session.transcript.slice(-6)) {
        for (const ref of e.taxonomy_refs) referencedIds.add(ref.node_id);
      }
      const relevantNodeCount = Math.max(1, (this.taxonomy.accelerationist?.nodes?.length ?? 0) +
        (this.taxonomy.safetyist?.nodes?.length ?? 0) +
        (this.taxonomy.skeptic?.nodes?.length ?? 0));
      const healthScore = computeDebateHealthScore(recentHealthSignals, turnCounts, referencedIds.size, relevantNodeCount);

      // Evaluate phase transition predicate
      const result = evaluatePhaseTransition(state, ctx, signals, config, healthScore);
      const predicateMs = Date.now() - predicateStart;

      // Record telemetry
      diag.total_predicate_evaluations++;
      if (result.confidence_deferred) diag.confidence_deferrals++;
      if (result.veto_active) diag.vetoes_fired++;
      if (result.force_active) diag.forces_fired++;
      diag.network_size_peak = Math.max(diag.network_size_peak, ctx.network.nodeCount);

      const phaseCtx = buildPhaseContext(state, config, satScore, convScore);
      const telemetry = buildSignalTelemetry(state, ctx, signals, result, phaseCtx.phase_progress, predicateMs);
      diag.signal_telemetry.push(telemetry);

      // Update confidence escalation state
      state.confidence_state = updateConfidenceState(
        state.confidence_state ?? { consecutiveDeferrals: 0, effectiveFloor: 0.40 },
        result.confidence_deferred,
      );

      // Apply transition
      const prevPhase = state.current_phase;
      state = applyTransition(state, result);
      state.api_calls_used = this.apiCallCount;
      this._phaseState = state;

      if (result.action === 'transition' || result.action === 'force_transition') {
        diag.phases.push({
          phase: prevPhase,
          rounds: Array.from({ length: round - currentPhaseStartRound + 1 }, (_, i) => currentPhaseStartRound + i),
          exit_reason: result.reason,
        });
        currentPhaseStartRound = round + 1;
        currentPhaseExitReason = result.reason;

        this.progress('debate', undefined,
          `Phase transition: ${prevPhase} → ${state.current_phase} (${result.reason})`);

        // Add system entry for transition
        this.addEntry({
          type: 'system', speaker: 'system',
          content: `[Phase transition] ${prevPhase} → ${state.current_phase}: ${result.reason}`,
          taxonomy_refs: [],
          metadata: { adaptive_transition: true, from_phase: prevPhase, to_phase: state.current_phase, reason: result.reason },
        });

        // Adaptive situation re-scoring: re-score situations against emerging cruxes
        this._rescoreSituations();
      }

      if (result.action === 'regress') {
        const cruxId = Object.keys(result.components).find(k => k.startsWith('crux_')) ?? 'unknown';
        diag.regressions.push({
          from_round: round,
          crux_id: cruxId,
          threshold_after: state.argumentation_exit_threshold,
        });

        this.progress('debate', undefined,
          `Regression: synthesis → exploration (${result.reason})`);

        this.addEntry({
          type: 'system', speaker: 'system',
          content: `[Phase regression] synthesis → exploration: ${result.reason}. Threshold ratcheted to ${(state.argumentation_exit_threshold * 100).toFixed(0)}%.`,
          taxonomy_refs: [],
          metadata: { adaptive_regression: true, reason: result.reason, new_threshold: state.argumentation_exit_threshold },
        });
        currentPhaseStartRound = round + 1;
      }

      if (result.action === 'terminate') {
        terminated = true;
        diag.phases.push({
          phase: state.current_phase,
          rounds: Array.from({ length: round - currentPhaseStartRound + 1 }, (_, i) => currentPhaseStartRound + i),
          exit_reason: result.reason,
        });

        this.addEntry({
          type: 'system', speaker: 'system',
          content: `[Debate terminated] ${result.reason}`,
          taxonomy_refs: [],
          metadata: { adaptive_termination: true, reason: result.reason },
        });
      }

      // Network GC check
      const an = this.session.argument_network!;
      if (needsGc(an.nodes.length, w.network.gc_trigger) && !state.gc_ran_this_phase) {
        const gcResult = pruneArgumentNetwork(an.nodes, an.edges, w.network.gc_target);
        an.nodes = gcResult.nodes;
        an.edges = gcResult.edges;
        state.gc_ran_this_phase = true;
        diag.gc_events.push({
          round, before: gcResult.before,
          after: gcResult.after, pruned: gcResult.before - gcResult.after,
        });
        this.progress('debate', undefined,
          `Network GC: ${gcResult.before} → ${gcResult.after} nodes`);
      }

      // Mid-round hooks (gap injection, neutral eval, probing, compression)
      this.checkAborted();
      const gapRound = this.config.gapInjectionRound ?? Math.ceil(config.maxTotalRounds / 2) + 1;
      if (gapRound > 0 && round === gapRound && this._gapInjectionCount === 0) {
        await this.runGapInjection(round, 'scheduled');
      } else if (gapRound > 0) {
        await this.runResponsiveGapCheck(round, gapRound);
      }

      if (round === midpointRound && !this._midpointEvalDone) {
        await this.runNeutralCheckpoint('midpoint');
        this._midpointEvalDone = true;
      }

      if (this.config.enableProbing && this.config.probingInterval &&
          round % this.config.probingInterval === 0 && !terminated) {
        await this.runProbingQuestions(round);
      }

      if (this.session.transcript.length >= 12) {
        await this.compressContext();
      }

      this.emitSnapshot('round_complete');

      if (!terminated && this.shouldTriggerDiversityRound(round, state.current_phase)) {
        await this.runDiversityRound(round + 1);
      }
    }

    // Store adaptive diagnostics on session
    this.session.adaptive_staging_diagnostics = diag;
  }

  private async runCrossRespondRound(round: number, phase: DebatePhase = 'argumentation'): Promise<void> {
    this.checkAborted();

    const sourceDocSummary = this.session.document_analysis?.claims_summary
      ?? (this.session.source_content ? this.session.source_content.slice(0, 2000) : undefined);

    const moderatorModel = this.resolveStageModel('moderator');
    const selectionCallbacks: ModeratorSelectionCallbacks = {
      generate: async (prompt, _model, options, label) => this.generateWithModel(prompt, label, moderatorModel, options?.timeoutMs, this.config.temperature ?? 0.7),
      addEntry: (entry) => this.addEntry(entry).id,
      progress: (ph, speaker, message) => this.progress(ph, speaker, message),
      warn: (context, err, recovery) => this.warn(context, err, recovery),
      formatEdgeContext: () => {
        const result = this.formatModeratorEdgeContext();
        return { text: result.text, edges_used: result.edges_used };
      },
      computeEmbedding: this.adapter.computeQueryEmbedding
        ? async (text: string) => {
          const { vector } = await this.adapter.computeQueryEmbedding!(text);
          return vector;
        }
        : undefined,
    };

    const selectionInput: ModeratorSelectionInput = {
      round,
      phase,
      activePovers: this.config.activePovers,
      totalRounds: this.config.rounds,
      model: moderatorModel,
      audience: this.config.audience,
      sourceDocSummary,
      resolution: this.session.topic.final,
      resolutionClauses: this.session.topic.clauses,
      topicDriftState: this.computeTopicDriftState(),
      transcript: this.session.transcript,
      contextSummaries: this.session.context_summaries,
      argumentNetwork: this.session.argument_network ?? undefined,
      convergenceSignals: this.session.convergence_signals,
      unansweredLedger: this.session.unanswered_claims_ledger,
      gapInjections: this.session.gap_injections,
      commitments: this.session.commitments,
      existingModState: this._moderatorState,
      poverInfo: POVER_INFO as Record<string, { label: string; pov: string; personality?: string }>,
      cruxTracker: this.session.crux_tracker,
      claimTexts: this.session.argument_network
        ? Object.fromEntries(this.session.argument_network.nodes.map(n => [n.id, n.text]))
        : undefined,
      nodeEmbeddings: this.taxonomy.embeddings as Record<string, { vector: number[] }> | undefined,
    };

    const modResult = await runModeratorSelection(selectionInput, selectionCallbacks);
    this._moderatorState = modResult.modState;

    const { responder, focusPoint, addressing, agreementDetected, selectionResult,
      intervention: activeIntervention, interventionBriefInjection, healthScore, diagnostics } = modResult;

    // Record moderator deliberation as a system entry with full diagnostics
    const an = this.session.argument_network;
    const modEntry = this.addEntry({
      type: 'system',
      speaker: 'system',
      content: `[Round ${round}] Moderator: ${POVER_INFO[responder]?.label ?? responder} → ${addressing} on: ${focusPoint}${activeIntervention ? ` [${activeIntervention.move}]` : ''}`,
      taxonomy_refs: [],
      metadata: {
        moderator_trace: {
          selected: responder,
          focus_point: focusPoint,
          addressing,
          debate_phase: phase,
          agreement_detected: agreementDetected,
          recent_scheme: diagnostics.recentScheme ?? null,
          critical_questions: diagnostics.recentScheme ? (formatCriticalQuestions(diagnostics.recentScheme) || null) : null,
          metaphor_reframe_offered: diagnostics.metaphorReframeOffered ?? null,
          metaphor_reframe_used: false,
          drift_detected: selectionResult.drift_detected ?? false,
          drift_reasoning: selectionResult.trigger_reasoning ?? null,
          intervention_recommended: selectionResult.intervene ?? false,
          intervention_move: activeIntervention?.move ?? modResult.engineValidation?.validated_move ?? null,
          intervention_validated: !!activeIntervention,
          suppressed_reason: modResult.engineValidation?.suppressed_reason ?? null,
          suppression_explanation: modResult.engineValidation?.suppression_explanation ?? null,
          health_score: healthScore.value,
          budget_remaining: modResult.modState.budget_remaining,
          argument_network_snapshot: an ? {
            total_claims: an.nodes.length,
            total_edges: an.edges.length,
            unaddressed_claims: an.nodes.filter(n => !an.edges.some(e => e.target === n.id)).length,
            strongest_unaddressed: an.nodes
              .filter(n => n.computed_strength != null && !an.edges.some(e => e.target === n.id))
              .sort((a, b) => (b.computed_strength ?? 0) - (a.computed_strength ?? 0))
              .slice(0, 3)
              .map(n => ({ id: n.id, speaker: n.speaker, strength: n.computed_strength, text: n.text.slice(0, 100) })),
          } : null,
          edge_context_length: diagnostics.edgeContextLength,
          an_context_length: diagnostics.anContextLength,
          qbaf_context_length: diagnostics.qbafContextLength,
        },
      },
    });
    this.recordDiagnostic(modEntry.id, {
      prompt: diagnostics.selectionPrompt,
      raw_response: diagnostics.selectionResponse,
      model: this.config.model,
      response_time_ms: diagnostics.selectionElapsed,
      edges_used: diagnostics.edgesUsed as { source: string; target: string; type: string; confidence: number }[] | undefined,
    });

    if ((selectionResult.intervene ?? false) && !activeIntervention && !modResult.engineValidation?.suppressed_reason) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'debate-engine', level: 'error',
        debate_id: this.session?.id,
        message: 'Intervention recommended but neither executed nor suppressed — missing suppression reason',
        data: { round, selectionResult },
      });
    }

    // Generate response
    const info = POVER_INFO[responder];
    this.progress('debate', responder, `${info.label} responding (round ${round})`);

    // priorRefs is also fed to the prompt below; computing it here lets
    // retrieval diversify AGAINST recently-cited nodes as well.
    const priorRefsEarly = this.session.transcript
      .filter(e => e.speaker === responder && e.type !== 'opening')
      .slice(-2)
      .flatMap(e => (e.taxonomy_refs ?? []).map(r => r.node_id));

    const taxonomyContext = await this.getRelevantTaxonomyContext(info.pov, priorRefsEarly);
    const commitmentContext = this.getCommitmentContext(responder);
    const establishedPoints = this.getEstablishedPointsContext(responder);
    const { text: debaterEdgeContext, edges_used: responderEdgesUsed } = this.formatDebaterEdgeContext(info.pov);

    // QBAF-grounded concession hint: surface strong opposing claims this debater
    // hasn't attacked or already conceded. Counterbalances the rotation rule
    // that blocks consecutive CONCEDE openings.
    const concessionAN = this.session.argument_network;
    const priorConceded = this.session.commitments?.[responder]?.conceded ?? [];
    const concessionHint = concessionAN
      ? formatConcessionCandidatesHint(concessionAN.nodes, concessionAN.edges, responder, priorConceded)
      : '';
    const concessionCandidateIds = concessionHint
      ? (concessionAN!.nodes
          .filter(n => n.speaker !== responder)
          .filter(n => (n.computed_strength ?? n.base_strength ?? 0) >= 0.65)
          .filter(n => !concessionAN!.edges.some(e => e.type === 'attacks' && e.source && concessionAN!.nodes.find(x => x.id === e.source)?.speaker === responder && e.target === n.id))
          .filter(n => !priorConceded.includes(n.id) && !priorConceded.includes(n.text))
          .sort((a, b) => (b.computed_strength ?? 0) - (a.computed_strength ?? 0))
          .slice(0, 2)
          .map(n => n.id))
      : [];
    const updatedTranscript = formatRecentTranscript(this.session.transcript, 8, this.session.context_summaries);

    // Collect this debater's prior move_types for diversity enforcement
    const debaterTurns = this.session.transcript
      .filter(e => e.speaker === responder && (e.type === 'opening' || e.type === 'statement'));
    const priorMoves = debaterTurns
      .filter(e => e.metadata)
      .flatMap(e => ((e.metadata as Record<string, unknown>)?.move_types as (string | import('./helpers').MoveAnnotation)[]) ?? [])
      .map(m => getMoveName(m))
      .slice(-6); // Last 3 turns × ~2 moves each

    // Count turns since this debater last used a CONCEDE move
    let turnsSinceLastConcession = debaterTurns.length; // default: never conceded
    for (let i = debaterTurns.length - 1; i >= 0; i--) {
      const moves = ((debaterTurns[i].metadata as Record<string, unknown>)?.move_types as (string | import('./helpers').MoveAnnotation)[]) ?? [];
      if (moves.some(m => getMoveName(m).includes('CONCEDE'))) {
        turnsSinceLastConcession = debaterTurns.length - 1 - i;
        break;
      }
    }

    // Reuse priorRefsEarly (computed before retrieval) for prompt-side rotation guidance.
    const priorRefs = priorRefsEarly;
    const taxMap = this.taxonomy as unknown as Record<string, { nodes?: { id: string }[] } | undefined>;
    const povFile = taxMap[info.pov];
    const availablePovNodeIds = [
      ...(povFile?.nodes?.map(n => n.id) ?? []),
      ...(taxMap.situations?.nodes?.map(n => n.id) ?? []),
    ];

    // Gather cross-POV node IDs for late-round citation diversity (Rec 3)
    const crossPovNodeIds = round >= 4
      ? Object.entries(taxMap)
          .filter(([key]) => key !== info.pov && key !== 'policyRegistry')
          .flatMap(([, file]) => file?.nodes?.map(n => n.id) ?? [])
          .filter(id => !priorRefsEarly.includes(id))
          .sort(() => Math.random() - 0.5)
          .slice(0, 8)
      : undefined;

    // ── Insularity intervention (BEA RUE, t/1130) ──
    let insularityInjection = '';
    if (this.config.enableInsularityIntervention) {
      const allSpeakerRefs = this.session.transcript
        .filter(e => e.speaker === responder && e.type !== 'opening')
        .flatMap(e => (e.taxonomy_refs ?? []).map(r => r.node_id));

      const insRate = computeCampInsularityRate(allSpeakerRefs, info.pov);
      const campSpecificCount = allSpeakerRefs.filter(id => {
        const p = nodePovFromId(id);
        return p && p !== 'situations' && p !== 'conflicts';
      }).length;

      if (insRate != null && isInsularityCritical(insRate, campSpecificCount)) {
        const speakerInterventions = this._insularityInterventions.filter(i => i.speaker === responder);
        const lastRoundForSpeaker = speakerInterventions.length > 0
          ? Math.max(...speakerInterventions.map(i => i.round))
          : -Infinity;
        const cooldownOk = round - lastRoundForSpeaker >= 2;
        const capOk = speakerInterventions.length < 2;

        if (cooldownOk && capOk) {
          const allCampNodes = Object.entries(
            this.taxonomy as unknown as Record<string, { nodes?: { id: string; label: string; description?: string }[] } | undefined>,
          )
            .filter(([key]) => key !== info.pov && key !== 'policyRegistry' && key !== 'situations' && key !== 'embeddings' && key !== 'lineageCategories')
            .flatMap(([, file]) => file?.nodes ?? []);

          const injection = selectCrossCampNode(info.pov, allSpeakerRefs, allCampNodes, this._lastRelevanceScores ?? undefined);
          if (injection) {
            insularityInjection = `\n\n=== CROSS-CAMP PERSPECTIVE ===\nThe following perspective from the ${injection.target_camp} camp may offer a productive contrast to your current line of reasoning. Consider engaging with it:\n- [${injection.node_id}] ${injection.node_label}`;
            this._insularityInterventions.push({
              speaker: responder,
              round,
              injected_node_id: injection.node_id,
              target_camp: injection.target_camp,
            });
            availablePovNodeIds.push(injection.node_id);
            getGlobalRecorder()?.record({
              type: 'turn.insularity_intervention', component: 'debate-engine', level: 'info',
              debate_id: this.session?.id,
              message: `Insularity intervention: injected ${injection.node_id} (${injection.target_camp}) for ${responder}`,
              data: { speaker: responder, round, ...injection },
            });
          }
        }
      }
    }

    // Rec 6: Carry forward repair hints from prior accept_with_flag turns
    let priorFlaggedHints: string[] | undefined;
    if (this.session.turn_validations) {
      const priorSpeakerEntries = this.session.transcript
        .filter(e => e.speaker === responder && e.type !== 'opening');
      const lastEntry = priorSpeakerEntries[priorSpeakerEntries.length - 1];
      if (lastEntry) {
        const trail = this.session.turn_validations[lastEntry.id];
        if (trail?.final?.outcome === 'accept_with_flag' && trail.final.repairHints?.length) {
          priorFlaggedHints = trail.final.repairHints;
        }
      }
    }

    // ── 4-stage pipeline: BRIEF → PLAN → DRAFT → CITE ──
    const turnVocabContext = this.config.vocabulary
      ? '\n' + formatVocabularyContext({ pov: info.pov, ...this.config.vocabulary })
      : '';
    // Inject moderator intervention context into the debater's BRIEF stage
    const interventionInjection = activeIntervention
      ? buildInterventionBriefInjection(activeIntervention)
      : '';

    // Extract last opponent statement for the draft quality pre-check
    const lastOpponentEntry = this.session.transcript
      .filter(e => e.speaker !== responder && e.speaker !== 'system' && e.speaker !== 'user' && e.type !== 'opening')
      .slice(-1)[0];
    const lastOpponentStatement = lastOpponentEntry
      ? (typeof lastOpponentEntry.content === 'string' ? lastOpponentEntry.content : JSON.stringify(lastOpponentEntry.content))
      : undefined;

    // Opponent-aware strategic hints (t/20): computed from AN + commitments, no LLM calls
    const anForHints = this.session.argument_network;
    const hintsResult = anForHints && this.session.commitments
      ? computeStrategicHints(
          responder,
          anForHints.nodes,
          anForHints.edges,
          this.session.commitments,
          round,
        )
      : undefined;
    const strategicHints = hintsResult?.hints;
    if (hintsResult && hintsResult.dropped > 0) {
      console.log(`[strategic-hints] Dropped ${hintsResult.dropped} hint(s) due to char budget`);
    }

    // Read prior turn's ignored evidence so the pipeline can penalise those docs
    const priorSamePoV = this.session.transcript
      .filter(e => e.speaker === responder && e.type === 'statement')
      .slice(-1)[0];
    const priorIgnoredDocIds = (priorSamePoV?.metadata as Record<string, unknown> | undefined)
      ?.ignored_evidence_doc_ids as string[] | undefined;

    const vocabTerms = extractSpeakerVocabulary(this.session.transcript, responder);
    const vocabularyExclusion = formatVocabularyExclusion(vocabTerms);

    const pipelineInput: TurnPipelineInput = {
      label: info.label,
      pov: info.pov,
      personality: info.personality,
      topic: this.session.topic.final,
      background: this.session.topic.background || undefined,
      taxonomyContext: taxonomyContext + turnVocabContext + interventionInjection + insularityInjection,
      commitmentContext,
      establishedPoints,
      edgeContext: debaterEdgeContext,
      concessionHint,
      recentTranscript: updatedTranscript,
      focusPoint,
      addressing,
      phase,
      priorMoves,
      turnsSinceLastConcession,
      priorRefs,
      availablePovNodeIds,
      availablePolicyIds: [...this.getPolicyIds()],
      crossPovNodeIds,
      priorFlaggedHints,
      vocabularyExclusion,
      priorCruxContext: this._priorCruxContext || undefined,
      currentCruxContext: this.session.crux_tracker?.length
        ? formatCruxResolutionContext(this.session.crux_tracker)
        : undefined,
      explorationPriming: this._explorationPriming || undefined,
      useBackgroundPrompt: this.config.useBackgroundPrompt,
      topicScope: this.session.topic.scope ?? undefined,
      topicStructure: this.session.topic_structure ?? undefined,
      salienceBeacon: this.config.salienceBeacon ?? false,
      sourceContent: this.session.document_analysis ? undefined : this.config.sourceContent,
      documentAnalysis: this.session.document_analysis,
      audience: this.config.audience,
      model: this.resolveModelForSpeaker(responder),
      briefModel: this.config.stageModels?.brief,
      planModel: this.config.stageModels?.plan,
      draftModel: this.config.stageModels?.draft,
      citeModel: this.config.stageModels?.cite,
      ...(activeIntervention ? {
        pendingIntervention: {
          move: activeIntervention.move,
          family: activeIntervention.family,
          targetDebater: activeIntervention.target_debater,
          responseField: MOVE_RESPONSE_CONFIG[activeIntervention.move]?.field ?? undefined,
          responseSchema: MOVE_RESPONSE_CONFIG[activeIntervention.move]?.schema ?? undefined,
          directResponsePattern: DIRECT_RESPONSE_PATTERNS[activeIntervention.move] ?? undefined,
          isTargeted: activeIntervention.target_debater === responder,
        },
      } : {}),
      lastOpponentStatement,
      strategicHints: strategicHints?.length ? strategicHints : undefined,
      sourceEvidenceIndex: this.sourceEvidenceIndex,
      docTitles: this.docTitles,
      ignoredEvidenceDocIds: priorIgnoredDocIds,
      suppressedHints: this.getSuppressedHints(),
      ...(this.config.temperature != null ? {
        stageTemperatures: {
          brief_temperature: this.config.temperature,
          plan_temperature: this.config.temperature,
          draft_temperature: this.config.temperature,
          cite_temperature: this.config.temperature,
        },
      } : {}),
      ...(this._phaseState && this._adaptiveConfig ? {
        phaseContext: (() => {
          const w = loadProvisionalWeights();
          const coldStart = this._phaseState!.rounds_in_phase < (
            this._phaseState!.current_phase === 'confrontation' ? w.phase_bounds.min_confrontation_rounds
            : this._phaseState!.current_phase === 'argumentation' ? w.phase_bounds.min_argumentation_rounds
            : w.phase_bounds.min_concluding_rounds
          );
          const satScore = this._signalRegistry
            ? computeSaturationScore(this._signalRegistry, this.buildSignalContext(round), coldStart) : 0;
          const convScore = this._signalRegistry
            ? computeConvergenceScore(this.buildSignalContext(round), coldStart) : 0;
          const pc = buildPhaseContext(this._phaseState!, this._adaptiveConfig!, satScore, convScore);
          return { rationale: pc.rationale, phase_progress: pc.phase_progress, approaching_transition: pc.approaching_transition };
        })(),
      } : {}),
    };

    const envelopeGenerate = this.adapter.generate
      ? async (request: import('./cacheTypes').GenerateRequest, label: string) => {
          await this.throttle();
          this.progress('generating', undefined, label);
          const start = Date.now();
          try {
            const resp = await this.adapter.generate!(request);
            this.lastApiCallTime = Date.now();
            this.apiCallCount++;
            this.totalResponseTimeMs += Date.now() - start;
            this.clearRateLimitBackoff();
            return resp;
          } catch (err) {
            this.lastApiCallTime = Date.now();
            if (this.isRateLimitError(err)) this.recordRateLimit();
            throw err;
          }
        }
      : undefined;

    // ── Cross-respond with per-turn validation + retry loop ──
    const knownIds = this.getKnownNodeIds();
    const vConfig = resolveTurnValidationConfig(this.config.turnValidation);

    // Pre-check generate uses the same adapter but with the pre-check model
    const boundStageGenerate = this.stageGenerate.bind(this);
    const preCheckGenerate = !vConfig.skipPreCheck
      ? boundStageGenerate
      : undefined;

    // Inject pre-check config into pipeline input
    pipelineInput.preCheckModel = vConfig.preCheckModel;
    pipelineInput.skipPreCheck = vConfig.skipPreCheck;

    const retryCallbacks: TurnRetryCallbacks = {
      runPipeline: (input) => runTurnPipeline(
        input, boundStageGenerate,
        (_stage, label) => this.progress('generating', responder, label),
        envelopeGenerate,
        preCheckGenerate,
      ),
      assembleResult: (result) => assemblePipelineResult(result, knownIds),
      callJudge: (p, l) => this.generateWithModel(p, l, vConfig.judgeModel, 20000),
      callJudgeFallback: this.config.model !== vConfig.judgeModel
        ? (p, l) => this.generateWithModel(p, l, this.config.model, 20000)
        : undefined,
    };

    const retryInput: TurnRetryInput = {
      pipelineInput,
      validationConfig: this.config.turnValidation,
      model: this.resolveModelForSpeaker(responder),
      speaker: responder,
      round,
      priorTurns: this.session.transcript
        .filter(e => e.speaker === responder && e.type !== 'opening')
        .slice(-2),
      recentTurns: this.session.transcript
        .filter(e => e.speaker !== 'system' && e.speaker !== 'user')
        .slice(-2),
      knownNodeIds: this.getKnownNodeIds(),
      policyIds: this.getPolicyIds(),
      audience: this.config.audience,
      pendingIntervention: activeIntervention,
    };

    this.checkAborted();
    getGlobalRecorder()?.setEventContext({
      debate_id: this.session.id,
      run_id: this.session.run_id,
      speaker: responder,
      phase,
      round,
      turn_index: this.session.transcript.length,
    });
    const turnResult = await this.executeWithModelFailover(responder, async (model) => {
      pipelineInput.model = model;
      retryInput.model = model;
      return executeTurnWithRetry(retryInput, retryCallbacks);
    });
    const { statement, taxonomyRefs, meta, validation, attempts, pipelineResult } = turnResult;
    this.enrichTaxonomyRefs(taxonomyRefs);

    // Update per-speaker hint streaks for hopeless hint suppression.
    // Uses the final validation's repairHints — these are the hints that persisted
    // through all retry attempts (i.e., the model couldn't fix them).
    this.updateHintStreaks(responder, validation.repairHints ?? []);

    // Extract caveats: all validation hints + ungrounded claims.
    // Surfaced to readers as "Caveats" alongside the statement.
    const caveats = [...(validation.repairHints ?? [])];

    // Add ungrounded claims from the evidence work product
    const evidenceDiagForCaveats = pipelineResult.stage_diagnostics.find(s => s.stage === 'evidence');
    const ungroundedClaims = (evidenceDiagForCaveats?.work_product as Record<string, unknown>)?.ungrounded_claims as
      Array<{ claim: string; reason: string }> | undefined;
    if (ungroundedClaims?.length) {
      for (const uc of ungroundedClaims) {
        caveats.push(`[Ungrounded] ${uc.claim}`);
      }
    }

    // Draft scope boundary check (t/451): flag when draft drifts into excluded scope
    let scopeDriftWarnings: { debater: string; node_id: string; similarity: number; draft_excerpt: string }[] | undefined;
    let scopeDriftCheck: EntryDiagnostics['scope_drift_check'] | undefined;
    const adapterForScope = this.adapter as ExtendedAIAdapter;
    if (adapterForScope.computeQueryEmbedding && statement) {
      try {
        const { vector: draftVec } = await adapterForScope.computeQueryEmbedding(statement.slice(0, 500));
        if (draftVec?.length) {
          const refIds = taxonomyRefs.map(r => r.node_id);
          const refsWithExclusionVector = refIds.filter(id => (this.taxonomy.embeddings[id] as { exclusion_vector?: number[] })?.exclusion_vector).length;
          const warnings = checkDraftScopeBoundary(
            draftVec, refIds, this.taxonomy.embeddings, responder, statement,
          );
          scopeDriftCheck = {
            checked: true,
            refs_checked: refIds.length,
            refs_with_exclusion_vector: refsWithExclusionVector,
            warnings: warnings,
            threshold: SCOPE_BOUNDARY_THRESHOLD,
          };
          if (warnings.length > 0) {
            scopeDriftWarnings = warnings;
            for (const w of warnings) {
              caveats.push(`[Scope drift] Draft may overlap excluded scope of ${w.node_id} (similarity=${w.similarity.toFixed(2)})`);
            }
            getGlobalRecorder()?.record({
              type: 'turn.scope_drift', component: 'debate-engine', level: 'warn',
              speaker: responder, debate_id: this.session?.id,
              message: `${warnings.length} scope drift warning(s)`,
              data: { warnings },
            });
          }
        }
      } catch { /* scope check is advisory — never block turn commit */ }
    }

    const entry = this.addEntry({
      type: 'statement',
      speaker: responder,
      content: statement,
      taxonomy_refs: taxonomyRefs,
      policy_refs: meta.policy_refs,
      addressing: addressing as SpeakerId | 'all',
      caveats: caveats.length > 0 ? caveats : undefined,
      model: this.config.speakerModels ? this.resolveModelForSpeaker(responder) : undefined,
      metadata: {
        cross_respond: true,
        round,
        focus_point: focusPoint,
        addressing_label: addressing,
        move_types: meta.move_types,
        disagreement_type: meta.disagreement_type,
        my_claims: meta.my_claims,
        key_assumptions: meta.key_assumptions?.length ? meta.key_assumptions : undefined,
        turn_symbols: meta.turn_symbols,
        injection_manifest: this._lastInjectionManifest ?? undefined,
        debate_phase: phase,
        position_update: meta.position_update,
        turn_validation_outcome: validation.outcome,
        turn_validation_score: validation.process_reward,
        turn_validation_attempts: attempts.length,
        turn_validation_flagged: validation.outcome === 'accept_with_flag' ? true : undefined,
        concession_candidates_offered: concessionCandidateIds.length > 0 ? concessionCandidateIds : undefined,
        concession_considered: (meta as Record<string, unknown>)?.concession_considered as string | undefined,
        anticipated_responses: pipelineResult.plan.anticipated_responses?.length
          ? pipelineResult.plan.anticipated_responses : undefined,
        ignored_evidence_doc_ids: pipelineResult.ignoredEvidenceDocIds,
      },
    });

    // Accumulate context manifest for taxonomy gap analysis
    this.accumulateContextManifest(round, responder, info.pov, taxonomyRefs.map(r => r.node_id));

    this.session.turn_validations ||= {};
    this.session.turn_validations[entry.id] = { attempts, final: validation };

    if (validation.clarifies_taxonomy.length > 0) {
      this.routeTurnValidatorHints(validation, entry.id);
    }

    const draftDiag = pipelineResult.stage_diagnostics.find(s => s.stage === 'draft');
    this.recordDiagnostic(entry.id, {
      prompt: draftDiag?.prompt ?? '',
      raw_response: draftDiag?.raw_response ?? '',
      model: this.resolveModelForSpeaker(responder),
      response_time_ms: pipelineResult.total_time_ms,
      taxonomy_context: taxonomyContext,
      commitment_context: commitmentContext,
      stage_diagnostics: pipelineResult.stage_diagnostics,
      edges_used: responderEdgesUsed,
      topic_alignment: pipelineResult.topicAlignmentResult
        ? {
            topic_aligned: pipelineResult.topicAlignmentResult.topic_aligned,
            repaired: pipelineResult.topicAlignmentResult.repaired || undefined,
            draft_attempt: pipelineResult.topicAlignmentResult.draft_attempt,
            scope_used: this.session.topic.scope ?? null,
          }
        : undefined,
      quality_gate: pipelineResult.qualityGateResult,
      scope_drift_warnings: scopeDriftWarnings,
      scope_drift_check: scopeDriftCheck,
    });

    // Track move types and disagreement types
    if (meta.move_types) {
      for (const m of meta.move_types) {
        const name = getMoveName(m);
        this.session.diagnostics!.overview.move_type_counts[name] = (this.session.diagnostics!.overview.move_type_counts[name] ?? 0) + 1;
      }
    }
    if (meta.disagreement_type) {
      this.session.diagnostics!.overview.disagreement_type_counts[meta.disagreement_type] =
        (this.session.diagnostics!.overview.disagreement_type_counts[meta.disagreement_type] ?? 0) + 1;
    }

    // Track situation citation rate (t/192)
    this.updateSituationCitations(taxonomyRefs);

    // Extract claims
    this.checkAborted();
    const anNodesBefore = this.session.argument_network!.nodes.length;
    await this.extractClaims(statement, responder, entry.id, taxonomyRefs.map(r => r.node_id), meta.my_claims);
    const newNodes = this.session.argument_network!.nodes.slice(anNodesBefore);

    // Conditional AN linkage: if debater confirmed a REVOICE, add the
    // revoiced text as a linked node with a revoice_of edge.
    if (activeIntervention?.move === 'REVOICE' || activeIntervention?.move === 'CHECK') {
      const revoiceResp = (meta as Record<string, unknown>).revoice_response as { accurate?: boolean } | undefined;
      if (revoiceResp?.accurate === true && activeIntervention.original_claim_text && activeIntervention.text) {
        const an = this.session.argument_network!;
        const revoiceNodeId = `revoice-${an.nodes.length}`;
        const revoiceNode: import('./types.js').ArgumentNetworkNode = {
          id: revoiceNodeId,
          text: activeIntervention.text,
          speaker: 'system' as import('./types.js').SpeakerId,
          source_entry_id: entry.id,
          taxonomy_refs: [],
          turn_number: round,
        };
        const originalNodeId = an.nodes.find(n => n.text === activeIntervention!.original_claim_text)?.id;
        if (originalNodeId) {
          an.nodes.push(revoiceNode);
          an.edges.push({
            source: revoiceNodeId,
            target: originalNodeId,
            type: 'revoice_of',
            weight: 1.0,
            confidence: 1.0,
          });
          getGlobalRecorder()?.record({
            type: 'debate.moderate', component: 'revoice-linkage', level: 'info',
            message: `REVOICE confirmed: linked ${revoiceNodeId} → ${originalNodeId}`,
          });
        }
      }
    }

    // Lookahead gate: evaluate move quality of extracted claims (t/21)
    if (newNodes.length > 0) {
      const lookaheadStart = Date.now();
      try {
        const anNow = this.session.argument_network!;
        const existingNodes = anNow.nodes.slice(0, anNodesBefore);
        const existingEdges = anNow.edges.filter(e => {
          const newIds = new Set(newNodes.map(n => n.id));
          return !newIds.has(e.source) && !newIds.has(e.target);
        });
        const tentativeEdges = anNow.edges.filter(e => {
          const newIds = new Set(newNodes.map(n => n.id));
          return newIds.has(e.source) || newIds.has(e.target);
        });
        const gateResult = evaluateLookahead({
          speaker: responder,
          existingNodes,
          existingEdges,
          tentativeClaims: newNodes.map(n => ({ text: n.text, base_strength: n.base_strength ?? 0.5 })),
          tentativeEdges,
          cruxes: this.session.crux_tracker,
        });
        const lookaheadDiag: LookaheadDiagnostics = {
          stage: 'lookahead',
          first_attempt: gateResult,
          regen_triggered: false,
          final_pass: gateResult.pass,
          elapsed_ms: Date.now() - lookaheadStart,
        };
        this.recordDiagnostic(entry.id, { lookahead: lookaheadDiag });
      } catch (err) {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Lookahead gate failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        this.warn('Lookahead gate', err, 'Lookahead evaluation skipped — does not affect debate flow');
      }
    }

    // Post-extraction interventions (non-blocking)
    if (newNodes.length > 0) {
      this.validateSteelmans(newNodes, responder).catch(err => this.warn('Steelman validation', String(err), 'Steelman check skipped'));
      this.verifyPreciseClaims(newNodes).catch(err => this.warn('Precise claims', String(err), 'Precision check skipped'));
    }

    // Position drift detection (non-blocking)
    this.trackPositionDrift(responder, statement, round).catch(err => this.warn('Position drift', String(err), 'Drift tracking skipped'));
    this.trackPerClaimDrift(responder, round).catch(err => this.warn('Per-claim drift', String(err), 'Per-claim drift tracking skipped'));

    // Post-turn summarization (DT-2)
    this.summarizeEntry(entry).catch(err => this.warn('Summarization', String(err), 'Entry summarization skipped'));

    // ── Update active moderator state for next round ──
    if (this.session.crux_tracker && this.session.crux_tracker.length > 0) {
      updateCruxEngagement(this._moderatorState!, this.session.crux_tracker, this.config.activePovers, an.nodes);
    }
    const validationResult = activeIntervention
      ? { proceed: true, validated_move: activeIntervention.move, validated_family: activeIntervention.family, validated_target: activeIntervention.target_debater } as import('./types').EngineValidationResult
      : { proceed: false, validated_move: 'PIN' as InterventionMove, validated_family: 'elicitation' as import('./types').InterventionFamily, validated_target: responder } as import('./types').EngineValidationResult;
    updateModeratorState(this._moderatorState!, activeIntervention, validationResult, round, phase);
    this.session.moderator_state = this._moderatorState!;

    pruneSessionData(this.session);
    pruneModeratorState(this._moderatorState!);
  }

  // ── Diversity-injection round (t/1280) ─────────────────────

  private shouldTriggerDiversityRound(round: number, phase: string): boolean {
    if (!this.config.enableDiversityRound) return false;
    if (phase !== 'argumentation') return false;
    if (this.session.diversity_round_fired != null) return false;
    if (round < 3) return false;

    const signals = this.session.convergence_signals ?? [];
    const recentSignals = signals.filter(s => s.round >= round - 1);
    if (recentSignals.length < 2) return false;
    const recycledCount = recentSignals.filter(
      s => s.argument_redundancy?.semantically_recycled === true,
    ).length;
    const repetitionRate = recycledCount / recentSignals.length;
    if (repetitionRate < 0.5) return false;

    const diag = this.session.diagnostics;
    if (!diag) return false;
    const traces: { round: number; an_nodes_added_ids: string[] }[] = [];
    for (const entryDiag of Object.values(diag.entries)) {
      if (entryDiag.extraction_trace) {
        traces.push({
          round: entryDiag.extraction_trace.round,
          an_nodes_added_ids: entryDiag.extraction_trace.an_nodes_added_ids,
        });
      }
    }
    const recentTraces = traces
      .filter(t => t.round >= round - 1)
      .sort((a, b) => b.round - a.round);
    if (recentTraces.length < 2) return false;
    const noNewAN = recentTraces.slice(0, 2).every(t => t.an_nodes_added_ids.length === 0);
    if (!noNewAN) return false;

    return true;
  }

  private async runDiversityRound(round: number): Promise<void> {
    this.session.diversity_round_fired = round;
    const phase: DebatePhase = 'argumentation';

    this.addEntry({
      type: 'system',
      speaker: 'system',
      content: `[Diversity round] Stagnation detected — running independent generation (round ${round}). Each POV generates without peer context to surface suppressed arguments.`,
      taxonomy_refs: [],
      metadata: { diversity_round: true, trigger_round: round },
    });
    this.progress('debate', undefined, `Diversity-injection round ${round} (independent generation)`);

    for (const pov of this.config.activePovers) {
      if (pov === 'user') continue;
      this.checkAborted();

      const info = POVER_INFO[pov];
      this.progress('debate', pov, `${info.label} — independent exploration (diversity round)`);

      const priorRefs = this.session.transcript
        .filter(e => e.speaker === pov && e.type !== 'opening')
        .slice(-2)
        .flatMap(e => (e.taxonomy_refs ?? []).map(r => r.node_id));

      const taxonomyContext = await this.getRelevantTaxonomyContext(info.pov, priorRefs);
      const commitmentContext = this.getCommitmentContext(pov);
      const establishedPoints = this.getEstablishedPointsContext(pov);
      const { text: edgeContext } = this.formatDebaterEdgeContext(info.pov);

      const selfTranscript = this.session.transcript.filter(
        e => e.speaker === pov || e.speaker === 'system' || e.speaker === 'user' || e.type === 'opening',
      );
      const recentTranscript = formatRecentTranscript(selfTranscript, 8, this.session.context_summaries);

      const debaterTurns = this.session.transcript
        .filter(e => e.speaker === pov && (e.type === 'opening' || e.type === 'statement'));
      const priorMoves = debaterTurns
        .filter(e => e.metadata)
        .flatMap(e => ((e.metadata as Record<string, unknown>)?.move_types as (string | import('./helpers').MoveAnnotation)[]) ?? [])
        .map(m => getMoveName(m))
        .slice(-6);
      let turnsSinceLastConcession = debaterTurns.length;
      for (let i = debaterTurns.length - 1; i >= 0; i--) {
        const moves = ((debaterTurns[i].metadata as Record<string, unknown>)?.move_types as (string | import('./helpers').MoveAnnotation)[]) ?? [];
        if (moves.some(m => getMoveName(m).includes('CONCEDE'))) {
          turnsSinceLastConcession = debaterTurns.length - 1 - i;
          break;
        }
      }

      const taxMap = this.taxonomy as unknown as Record<string, { nodes?: { id: string }[] } | undefined>;
      const povFile = taxMap[info.pov];
      const availablePovNodeIds = [
        ...(povFile?.nodes?.map(n => n.id) ?? []),
        ...(taxMap.situations?.nodes?.map(n => n.id) ?? []),
      ];

      const pipelineInput: TurnPipelineInput = {
        label: info.label,
        pov: info.pov,
        personality: info.personality,
        topic: this.session.topic.final,
        background: this.session.topic.background || undefined,
        taxonomyContext,
        commitmentContext,
        establishedPoints,
        edgeContext,
        concessionHint: '',
        recentTranscript,
        focusPoint: 'Explore fresh perspectives and under-represented arguments from your worldview that have not yet been raised in this debate.',
        addressing: 'general',
        phase,
        priorMoves,
        turnsSinceLastConcession,
        priorRefs,
        availablePovNodeIds,
        availablePolicyIds: [...this.getPolicyIds()],
        topicScope: this.session.topic.scope ?? undefined,
        topicStructure: this.session.topic_structure ?? undefined,
        salienceBeacon: this.config.salienceBeacon ?? false,
        sourceContent: this.session.document_analysis ? undefined : this.config.sourceContent,
        documentAnalysis: this.session.document_analysis,
        audience: this.config.audience,
        model: this.resolveModelForSpeaker(pov),
        briefModel: this.config.stageModels?.brief,
        planModel: this.config.stageModels?.plan,
        draftModel: this.config.stageModels?.draft,
        citeModel: this.config.stageModels?.cite,
        useBackgroundPrompt: this.config.useBackgroundPrompt,
        ...(this.config.temperature != null ? {
          stageTemperatures: {
            brief_temperature: this.config.temperature,
            plan_temperature: this.config.temperature,
            draft_temperature: this.config.temperature,
            cite_temperature: this.config.temperature,
          },
        } : {}),
      };

      const boundStageGenerate = this.stageGenerate.bind(this);
      const envelopeGenerate = this.adapter.generate
        ? async (request: import('./cacheTypes').GenerateRequest, label: string) => {
            await this.throttle();
            this.progress('generating', undefined, label);
            const start = Date.now();
            try {
              const resp = await this.adapter.generate!(request);
              this.lastApiCallTime = Date.now();
              this.apiCallCount++;
              this.totalResponseTimeMs += Date.now() - start;
              this.clearRateLimitBackoff();
              return resp;
            } catch (err) {
              this.lastApiCallTime = Date.now();
              if (this.isRateLimitError(err)) this.recordRateLimit();
              throw err;
            }
          }
        : undefined;

      const knownIds = this.getKnownNodeIds();
      const vConfig = resolveTurnValidationConfig(this.config.turnValidation);
      const preCheckGenerate = !vConfig.skipPreCheck ? boundStageGenerate : undefined;
      pipelineInput.preCheckModel = vConfig.preCheckModel;
      pipelineInput.skipPreCheck = vConfig.skipPreCheck;

      const retryCallbacks: TurnRetryCallbacks = {
        runPipeline: (input) => runTurnPipeline(
          input, boundStageGenerate,
          (_stage, label) => this.progress('generating', pov, label),
          envelopeGenerate,
          preCheckGenerate,
        ),
        assembleResult: (result) => assemblePipelineResult(result, knownIds),
        callJudge: (p, l) => this.generateWithModel(p, l, vConfig.judgeModel, 20000),
        callJudgeFallback: this.config.model !== vConfig.judgeModel
          ? (p, l) => this.generateWithModel(p, l, this.config.model, 20000)
          : undefined,
      };

      const retryInput: TurnRetryInput = {
        pipelineInput,
        validationConfig: this.config.turnValidation,
        model: this.resolveModelForSpeaker(pov),
        speaker: pov,
        round,
        priorTurns: this.session.transcript
          .filter(e => e.speaker === pov && e.type !== 'opening')
          .slice(-2),
        recentTurns: this.session.transcript
          .filter(e => e.speaker !== 'system' && e.speaker !== 'user')
          .slice(-2),
        knownNodeIds: this.getKnownNodeIds(),
        policyIds: this.getPolicyIds(),
        audience: this.config.audience,
      };

      this.checkAborted();
      getGlobalRecorder()?.setEventContext({
        debate_id: this.session.id,
        run_id: this.session.run_id,
        speaker: pov,
        phase,
        round,
        turn_index: this.session.transcript.length,
      });

      const turnResult = await this.executeWithModelFailover(pov, async (model) => {
        pipelineInput.model = model;
        retryInput.model = model;
        return executeTurnWithRetry(retryInput, retryCallbacks);
      });
      const { statement, taxonomyRefs, meta, validation, pipelineResult } = turnResult;
      this.enrichTaxonomyRefs(taxonomyRefs);
      this.updateHintStreaks(pov, validation.repairHints ?? []);

      const caveats = [...(validation.repairHints ?? [])];
      const evidenceDiag = pipelineResult.stage_diagnostics.find(s => s.stage === 'evidence');
      const ungrounded = (evidenceDiag?.work_product as Record<string, unknown>)?.ungrounded_claims as
        Array<{ claim: string; reason: string }> | undefined;
      if (ungrounded?.length) {
        for (const uc of ungrounded) caveats.push(`[Ungrounded] ${uc.claim}`);
      }

      const entry = this.addEntry({
        type: 'statement',
        speaker: pov,
        content: statement,
        taxonomy_refs: taxonomyRefs,
        policy_refs: meta.policy_refs,
        addressing: 'all',
        caveats: caveats.length > 0 ? caveats : undefined,
        model: this.config.speakerModels ? this.resolveModelForSpeaker(pov) : undefined,
        metadata: {
          round,
          debate_phase: phase,
          move_types: meta.move_types ?? [],
          diversity_round: true,
          extracted_claims_accepted: meta.extracted_claims_accepted ?? 0,
        },
      });

      this.checkAborted();
      await this.extractClaims(statement, pov, entry.id, taxonomyRefs.map(r => r.node_id), meta.my_claims);
    }

    this.emitSnapshot('round_complete');
  }

  // ── Probing questions ──────────────────────────────────────

  private async runProbingQuestions(round: number): Promise<void> {
    this.progress('probing', undefined, 'Generating probing questions');

    // Find unreferenced nodes
    const referencedIds = new Set<string>();
    for (const e of this.session.transcript) {
      for (const ref of e.taxonomy_refs) referencedIds.add(ref.node_id);
    }

    const unreferencedNodes: string[] = [];
    for (const pov of POV_KEYS) {
      const nodes = this.taxonomy[pov]?.nodes ?? [];
      for (const n of nodes) {
        if (!referencedIds.has(n.id) && unreferencedNodes.length < 20) {
          unreferencedNodes.push(`[${n.id}] ${n.label}: ${n.description.slice(0, 100)}`);
        }
      }
    }

    const transcript = formatRecentTranscript(this.session.transcript, 50, this.session.context_summaries);
    const hasSourceDoc = this.config.sourceType === 'document' || this.config.sourceType === 'url';

    // CT-4/CT-11: Compute uncovered document claims, sorted by QBAF strength weight (load-bearing first)
    let uncoveredClaims: string[] | undefined;
    if (this.session.document_analysis?.i_nodes?.length) {
      const anNodes = this.session.argument_network?.nodes ?? [];
      const anEdges = this.session.argument_network?.edges ?? [];
      if (anNodes.length > 0) {
        try {
          const documentClaims = this.session.document_analysis.i_nodes.map(n => ({ id: n.id, text: n.text, bdi_category: n.type }));
          const coverageMap = computeCoverageMap(anNodes, documentClaims);
          const sw = computeStrengthWeightedCoverage(coverageMap, anNodes, anEdges);
          const weightByClaimId = new Map(sw.claim_weights.map(w => [w.claimId, w.weight]));
          uncoveredClaims = coverageMap.coverage
            .filter(c => c.status === 'uncovered')
            .sort((a, b) => (weightByClaimId.get(b.claimId) ?? 0.5) - (weightByClaimId.get(a.claimId) ?? 0.5))
            .map(c => {
              const text = documentClaims.find(dc => dc.id === c.claimId)?.text ?? c.claimId;
              return `[${c.claimId}] ${text}`;
            })
            .slice(0, 10);
        } catch (err) {
          getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Probing coverage computation failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        }
      }
    }

    const prompt = probingQuestionsPrompt(this.session.topic.final, transcript, unreferencedNodes, hasSourceDoc, uncoveredClaims, this.config.audience);
    const text = await this.generate(prompt, 'Probing questions');

    let questions: { text: string; targets: string[] }[] = [];
    try {
      const parsed = parseJsonRobust(text) as { questions?: { text?: string; question?: string; targets?: string[]; options?: string[] }[] };
      questions = (parsed.questions ?? []).map(q => ({ text: q.text ?? q.question ?? '', targets: q.targets ?? q.options ?? [] }));
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Parsing probing questions failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Parsing probing questions', err, 'Skipping probing questions for this round');
    }

    if (questions.length > 0) {
      const content = questions.map((q, i) => {
        const qText = q.text || JSON.stringify(q);
        const targets = q.targets;
        const targetStr = Array.isArray(targets) ? targets.join(', ') : 'all';
        return `${i + 1}. ${qText} (targets: ${targetStr})`;
      }).join('\n');
      this.addEntry({
        type: 'probing',
        speaker: 'system',
        content,
        taxonomy_refs: [],
        metadata: { questions, round },
      });
    }
  }

  // ── Neutral evaluator ────────────────────────────────────

  /**
   * Run a persona-free neutral evaluation at the specified checkpoint.
   * Results are stored on the session — they never feed back into the debate.
   */
  private async runNeutralCheckpoint(checkpoint: 'baseline' | 'midpoint' | 'final'): Promise<NeutralEvaluation | null> {
    try {
      this.progress('evaluation', undefined, `Neutral evaluation: ${checkpoint}`);

      // Build speaker mapping once and reuse for consistency
      if (!this._neutralMapping) {
        this._neutralMapping = buildSpeakerMapping(
          this.config.activePovers as Exclude<SpeakerId, 'user'>[],
        );
        this.session.neutral_speaker_mapping = this._neutralMapping;
      }

      const evaluation = await runNeutralEvaluation(checkpoint, {
        adapter: this.adapter,
        topic: this.session.topic.final || this.session.topic.original,
        transcript: this.session.transcript,
        contextSummaries: this.session.context_summaries,
        activePovers: this.config.activePovers,
        model: this.config.model,
        speakerMapping: this._neutralMapping,
      });

      // Store on session
      if (!this.session.neutral_evaluations) {
        this.session.neutral_evaluations = [];
      }
      this.session.neutral_evaluations.push(evaluation);

      // Add a transcript entry so diagnostics are visible per-entry
      const cruxCount = evaluation.cruxes?.length ?? 0;
      const claimCount = evaluation.claims?.length ?? 0;
      const rawNotes = evaluation.overall_assessment?.notes ?? '';
      // De-anonymize Speaker A/B/C → display names so the transcript is readable
      let notes = rawNotes;
      if (this._neutralMapping) {
        for (const [label, povId] of Object.entries(this._neutralMapping.reverse)) {
          const displayName = POVER_INFO[povId as Exclude<SpeakerId, 'user'>]?.label ?? povId;
          notes = notes.replaceAll(label, displayName);
        }
      }
      const evalEntry = this.addEntry({
        type: 'system',
        speaker: 'system',
        content: `[Neutral evaluation: ${checkpoint}] ${cruxCount} cruxes, ${claimCount} claims evaluated. ${notes}`,
        taxonomy_refs: [],
        metadata: { neutral_checkpoint: checkpoint },
      });
      this.recordDiagnostic(evalEntry.id, {
        prompt: evaluation.diagnostics_prompt,
        raw_response: evaluation.diagnostics_raw_response,
        model: this.config.model,
        response_time_ms: evaluation.diagnostics_response_time_ms,
      });

      return evaluation;
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'ai.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: `Neutral evaluation (${checkpoint}) failed`, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.warn('Neutral evaluation', `Neutral evaluation (${checkpoint}) failed: ${errorMsg}`, 'Debate continues without neutral assessment');
      return null;
    }
  }

  // ── Context compression ────────────────────────────────────

  private async compressContext(): Promise<void> {
    const keepRecent = 8;
    const keepMedium = 8;
    const filteredEntries = this.session.transcript.filter(e => e.type !== 'system');
    if (filteredEntries.length < 12) return;

    // Find entries not yet compressed
    const lastSummaryIdx = this.session.context_summaries.length > 0
      ? this.session.transcript.findIndex(e => e.id === this.session.context_summaries[this.session.context_summaries.length - 1].up_to_entry_id)
      : -1;

    const compressibleStart = lastSummaryIdx + 1;
    const compressibleEnd = this.session.transcript.length - keepRecent;
    if (compressibleEnd <= compressibleStart + 3) return;

    const toCompress = this.session.transcript.slice(compressibleStart, compressibleEnd);
    if (toCompress.length < 4) return;

    this.progress('compression', undefined, 'Compressing debate history');

    const an = this.session.argument_network;

    // Tiered compression: split into medium (structural) and distant (LLM summary)
    const mediumEntries = toCompress.slice(-keepMedium);
    const distantEntries = toCompress.slice(0, -keepMedium);

    // Medium tier: deterministic structural summary from argument network
    if (mediumEntries.length > 0 && an) {
      const mediumSummary = buildMediumTierSummary(
        mediumEntries, an.nodes, an.edges, this.session.commitments ?? {},
      );
      this.session.context_summaries.push({
        up_to_entry_id: mediumEntries[mediumEntries.length - 1].id,
        summary: mediumSummary,
        tier: 'medium',
      });
    }

    // Distant tier: purely structural summary (no LLM call)
    // Avoids ambiguity collapse risk (Gur-Arieh et al., 2026) — LLM summarization
    // can flatten deliberative nuance, collapse hedged positions into confident ones,
    // and smuggle normative judgments into what appears neutral.
    if (distantEntries.length >= 4 && an) {
      const distantSummary = buildDistantTierSummary(
        an.nodes, an.edges, this.session.commitments ?? {}, this.session.crux_tracker,
        this.session.unanswered_claims_ledger, distantEntries,
      );

      this.session.context_summaries.push({
        up_to_entry_id: distantEntries[distantEntries.length - 1].id,
        summary: distantSummary,
        tier: 'distant',
      });

      // Context-rot metrics (structural compression)
      const inChars = distantEntries.reduce((s, e) => s + (typeof e.content === 'string' ? e.content.length : 0), 0);
      const outChars = distantSummary.length;
      if (this.session.context_rot) {
        this.session.context_rot.stages.push({
          stage: 'transcript_compression',
          in_units: 'chars', in_count: inChars,
          out_units: 'chars', out_count: outChars,
          ratio: inChars > 0 ? Math.round((outChars / inChars) * 10000) / 10000 : 1,
          flags: {
            entries_compressed: distantEntries.length,
            compression_ratio: inChars > 0 ? Math.round((outChars / inChars) * 10000) / 10000 : 1,
            window_size: keepRecent,
            tier: 'distant',
            method: 'structural',
          },
        });
      }
    } else if (toCompress.length >= 4 && an) {
      // Not enough entries for two tiers — use structural summary for all
      const summary = buildDistantTierSummary(
        an.nodes, an.edges, this.session.commitments ?? {}, this.session.crux_tracker,
        this.session.unanswered_claims_ledger, toCompress,
      );

      this.session.context_summaries.push({
        up_to_entry_id: toCompress[toCompress.length - 1].id,
        summary,
        tier: 'distant',
      });

      const inChars = toCompress.reduce((s, e) => s + (typeof e.content === 'string' ? e.content.length : 0), 0);
      const outChars = summary.length;
      if (this.session.context_rot) {
        this.session.context_rot.stages.push({
          stage: 'transcript_compression',
          in_units: 'chars', in_count: inChars,
          out_units: 'chars', out_count: outChars,
          ratio: inChars > 0 ? Math.round((outChars / inChars) * 10000) / 10000 : 1,
          flags: {
            entries_compressed: toCompress.length,
            compression_ratio: inChars > 0 ? Math.round((outChars / inChars) * 10000) / 10000 : 1,
            window_size: keepRecent,
            method: 'structural',
          },
        });
      }
    }
  }

  // ── Early return (stopAfterStage) ──────────────────────────

  private earlyReturn(startTime: number): DebateSession {
    this.session.updated_at = nowISO();
    if (this.session.diagnostics) {
      this.session.diagnostics.overview.total_ai_calls = this.apiCallCount;
      this.session.diagnostics.overview.total_response_time_ms = this.totalResponseTimeMs;
      this.session.diagnostics.overview.total_elapsed_ms = Date.now() - startTime;
    }
    return this.session;
  }

  // ── Extraction coverage ───────────────────────────────────

  private async runExtractionCoverage(): Promise<void> {
    try {
      const coverageGenFn = (prompt: string) => this.generateWithEvaluator(prompt, 'Extraction coverage');
      await computeExtractionCoverage(this.session, coverageGenFn);

      const recorder = getGlobalRecorder();
      if (!recorder || !this.session.diagnostics?.entries) return;

      for (const [entryId, entryDiag] of Object.entries(this.session.diagnostics.entries)) {
        const ec = (entryDiag as Record<string, unknown>).extraction_coverage as { coverage_rate: number } | undefined;
        if (ec && ec.coverage_rate < 0.70) {
          recorder.record({
            type: 'an.extraction_coverage_low',
            component: 'calibration',
            level: 'warn',
            debate_id: this.session.id,
            turn_id: entryId,
            message: `Extraction coverage ${Math.round(ec.coverage_rate * 100)}% < 70% threshold`,
            data: { coverage_rate: ec.coverage_rate },
          });
        }
      }
      const coverageSamples = Object.values(this.session.diagnostics.entries)
        .map(d => (d as Record<string, unknown>).extraction_coverage as { coverage_rate: number } | undefined)
        .filter((c): c is { coverage_rate: number } => c != null)
        .map(c => c.coverage_rate);
      if (coverageSamples.length > 0) {
        const aggCoverage = coverageSamples.reduce((a, b) => a + b, 0) / coverageSamples.length;
        if (aggCoverage < 0.70) {
          recorder.record({
            type: 'an.extraction_coverage_error',
            component: 'calibration',
            level: 'error',
            debate_id: this.session.id,
            message: `Debate-level extraction coverage ${Math.round(aggCoverage * 100)}% < 70% threshold`,
            data: { aggregate_coverage_rate: aggCoverage, samples: coverageSamples.length },
          });
        }
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Coverage computation failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
  }

  // ── Synthesis ──────────────────────────────────────────────

  private async runSynthesis(maxPhase?: number): Promise<void> {
    this.progress('concluding', undefined, 'Generating synthesis');

    const fullTranscript = formatRecentTranscript(this.session.transcript, 50, this.session.context_summaries);

    const policyLines = this.taxonomy.policyRegistry.length > 0
      ? this.taxonomy.policyRegistry.slice(0, 10).map(p => `${p.id}: ${p.action}`)
      : undefined;

    const result = await runSynthesisPhases(
      {
        topic: this.session.topic.final,
        transcript: fullTranscript,
        audience: this.config.audience,
        cruxTracker: this.session.crux_tracker,
        policyLines,
        hasSourceDoc: this.config.sourceType === 'document' || this.config.sourceType === 'url',
      },
      (prompt, label) => this.generate(prompt, label),
      (_phase, label) => this.progress('concluding', undefined, label),
      (context, problem, nextStep) => this.warn(context, problem, nextStep),
      () => this.checkAborted(),
      maxPhase,
      this.config.usageDeps,
    );

    const concludingData = result.data;
    const elapsed = result.elapsed_ms;

    // Format readable content
    const lines: string[] = [];

    const topicRes = concludingData.topic_resolution as { restated_question?: string; where_it_landed?: string; what_would_resolve_it?: string } | undefined;
    if (topicRes?.restated_question) {
      lines.push(`**${topicRes.restated_question}**`);
      lines.push('');
      if (topicRes.where_it_landed) {
        lines.push(topicRes.where_it_landed);
        lines.push('');
      }
      if (topicRes.what_would_resolve_it) {
        lines.push(`*Decisive crux: ${topicRes.what_would_resolve_it}*`);
        lines.push('');
      }
    }

    const agreements = concludingData.areas_of_agreement as { point: string; povers: string[] }[] | undefined;
    const disagreements = concludingData.areas_of_disagreement as { point: string; positions: { pover: string; stance: string }[] }[] | undefined;
    const cruxes = concludingData.cruxes as { question: string; type?: string }[] | undefined;

    if (agreements?.length) {
      lines.push('**Areas of Agreement:**');
      lines.push('');
      for (const a of agreements) {
        const povers = (a.povers ?? []).map(p => POVER_INFO[p as Exclude<SpeakerId, 'user'>]?.label ?? p).join(', ');
        lines.push(`- ${a.point} (${povers})`);
      }
      lines.push('');
    }
    if (disagreements?.length) {
      lines.push('**Areas of Disagreement:**');
      lines.push('');
      for (const d of disagreements) {
        const bdiTag = (d as Record<string, unknown>).bdi_layer ? ` [${(d as Record<string, unknown>).bdi_layer}]` : '';
        const typeTag = (d as Record<string, unknown>).type ? ` {${(d as Record<string, unknown>).type}}` : '';
        lines.push(`- ${d.point}${typeTag}${bdiTag}`);
        for (const pos of d.positions ?? []) {
          const label = POVER_INFO[pos.pover as Exclude<SpeakerId, 'user'>]?.label ?? pos.pover;
          lines.push(`    - ${label}: ${pos.stance}`);
        }
        const resolvability = (d as Record<string, unknown>).resolvability;
        if (typeof resolvability === 'string' && resolvability) {
          lines.push(`    - *Resolution path: ${resolvability.replace(/_/g, ' ')}*`);
        }
      }
      lines.push('');
    }
    if (cruxes?.length) {
      lines.push('**Cruxes:**');
      lines.push('');
      for (const c of cruxes) {
        const crux = c as { question: string; if_yes?: string; if_no?: string; type?: string };
        lines.push(`- ${crux.question}${crux.type ? ` [${crux.type}]` : ''}`);
        if (crux.if_yes) lines.push(`    - If yes, weakens: ${crux.if_yes}`);
        if (crux.if_no) lines.push(`    - If no, weakens: ${crux.if_no}`);
      }
      lines.push('');
    }

    const unresolvedQuestions = concludingData.unresolved_questions as string[] | undefined;
    if (unresolvedQuestions?.length) {
      lines.push('**Unresolved Questions:**');
      lines.push('');
      for (const q of unresolvedQuestions) lines.push(`- ${q}`);
      lines.push('');
    }

    const preferences = concludingData.preferences as { conflict: string; prevails: string; criterion: string; rationale: string; what_would_change_this?: string }[] | undefined;
    if (preferences?.length) {
      lines.push('**Resolution Analysis:**');
      lines.push('');
      for (const p of preferences) {
        if (p.prevails === 'undecidable') {
          lines.push(`- **${p.conflict}** — Undecidable`);
        } else {
          lines.push(`- **${p.conflict}** — Stronger: ${p.prevails} (${p.criterion?.replace(/_/g, ' ')})`);
        }
        lines.push(`    - *${p.rationale}*`);
        if (p.what_would_change_this) {
          lines.push(`    - Would change if: ${p.what_would_change_this}`);
        }
      }
      lines.push('');
    }

    // If we parsed synthesis data but lines are empty, try to extract statement-like content
    // Fall back to stripped text (without code fences/JSON wrapper) if parsing failed entirely
    let content: string;
    if (lines.length > 0) {
      content = lines.join('\n');
    } else if (typeof concludingData.summary === 'string') {
      content = concludingData.summary;
    } else {
      content = JSON.stringify(concludingData, null, 2);
    }

    const entry = this.addEntry({
      type: 'concluding',
      speaker: 'system',
      content,
      taxonomy_refs: [],
      metadata: { synthesis: concludingData },
    });

    this.recordDiagnostic(entry.id, {
      raw_response: JSON.stringify(result.rawResponses),
      model: this.config.model,
      response_time_ms: elapsed,
    });
  }

  // ── Missing arguments pass ─────────────────────────────────

  /**
   * Post-synthesis pass: a fresh LLM (no transcript context) identifies
   * the 3-5 strongest arguments that were never raised during the debate.
   * Failure never blocks synthesis.
   */
  private async runMissingArgumentsPass(): Promise<void> {
    try {
      // Wait briefly for synthesis to produce data we can reference
      const synthEntry = this.session.transcript.find(e => e.type === 'concluding');
      const concludingText = synthEntry?.content ?? '';
      if (!concludingText) return; // No synthesis yet — will be called after synthesis completes

      // Build compact taxonomy summary (labels + BDI categories)
      const summaryLines: string[] = [];
      for (const povKey of POV_KEYS) {
        const povData = this.taxonomy[povKey];
        if (!povData?.nodes) continue;
        for (const node of povData.nodes) {
          const cat = node.category ?? 'unknown';
          summaryLines.push(`[${node.id}] ${node.label} (${cat}) — ${povKey}`);
        }
      }
      const taxonomySummary = summaryLines.slice(0, 80).join('\n'); // Cap at ~80 nodes

      const prompt = missingArgumentsPrompt(
        this.session.topic.final,
        taxonomySummary,
        concludingText.slice(0, 4000), // Cap synthesis text
        this.config.audience,
      );

      const text = await this.generate(prompt, 'Missing arguments pass', 180_000);
      const parsed = parseJsonRobust(text) as { missing_arguments?: unknown[] };
      if (parsed.missing_arguments && Array.isArray(parsed.missing_arguments)) {
        this.session.missing_arguments = parsed.missing_arguments.slice(0, 5);
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Missing arguments pass failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Missing arguments pass', err, 'Non-critical — debate results unaffected');
    }
  }

  // ── Taxonomy refinement pass ───────────────────────────────

  /**
   * Post-debate pass: analyze debate outcomes against referenced taxonomy nodes
   * and suggest description revisions with before/after text.
   */
  private async runTaxonomyRefinementPass(): Promise<void> {
    try {
      const synthEntry = this.session.transcript.find(e => e.type === 'concluding');
      const concludingText = synthEntry?.content ?? '';
      if (!concludingText) return;

      // Collect all taxonomy node IDs referenced during the debate
      const refIds = new Set<string>();
      for (const entry of this.session.transcript) {
        for (const ref of entry.taxonomy_refs ?? []) {
          refIds.add(ref.node_id);
        }
      }
      if (refIds.size === 0) return;

      // Resolve referenced nodes to their full descriptions from loaded taxonomy
      const referencedNodes: { id: string; label: string; pov: string; category: string; description: string }[] = [];
      for (const povKey of POV_KEYS) {
        const povData = this.taxonomy[povKey];
        if (!povData?.nodes) continue;
        for (const node of povData.nodes) {
          if (refIds.has(node.id)) {
            referencedNodes.push({
              id: node.id,
              label: node.label,
              pov: povKey,
              category: node.category ?? 'unknown',
              description: node.description,
            });
          }
        }
      }
      if (referencedNodes.length === 0) return;

      // Build argument map summary from AN
      const an = this.session.argument_network;
      let anSummary = '(no argument network)';
      if (an && an.nodes.length > 0) {
        const lines = an.nodes.slice(0, 30).map(n => {
          const attacks = an.edges.filter(e => e.target === n.id && e.type === 'attacks');
          const supports = an.edges.filter(e => e.target === n.id && e.type === 'supports');
          let line = `${n.id} (${n.speaker}): "${n.text}"`;
          if (attacks.length) line += ` [attacked ${attacks.length}x]`;
          if (supports.length) line += ` [supported ${supports.length}x]`;
          return line;
        });
        anSummary = lines.join('\n');
      }

      const prompt = taxonomyRefinementPrompt(
        this.session.topic.final,
        concludingText.slice(0, 4000),
        referencedNodes.slice(0, 25), // Cap nodes sent to prompt
        anSummary,
        this.config.audience,
      );

      const text = await this.generate(prompt, 'Taxonomy refinement pass', 180_000);
      const parsed = parseJsonRobust(text) as { taxonomy_suggestions?: unknown[] };
      if (parsed.taxonomy_suggestions && Array.isArray(parsed.taxonomy_suggestions)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const postDebate = parsed.taxonomy_suggestions.slice(0, 10).map((s: any) => ({
          ...s,
          source: 'post-debate' as const,
        }));
        // Merge with any turn-validator hints already appended during the debate.
        const existing = this.session.taxonomy_suggestions ?? [];
        const turnValidator = existing.filter(s => s.source === 'turn-validator');
        this.session.taxonomy_suggestions = [...postDebate, ...turnValidator];
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Taxonomy refinement pass failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Taxonomy refinement pass', err, 'Non-critical — debate results unaffected');
    }
  }

  // ── Dialectic trace generation ──────────────────────────────

  /**
   * Post-synthesis pass: generate dialectic traces from the argument network
   * and synthesis preferences. Each trace is a minimal argument path explaining
   * why a position prevailed — the dialectic structure as explanation.
   *
   * Synchronous — no AI calls needed, just graph traversal.
   * Failure never blocks synthesis results.
   */
  private runDialecticTracePass(): void {
    try {
      const traces = generateDialecticTraces(this.session);
      if (traces.length > 0) {
        this.session.dialectic_traces = traces;
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Dialectic trace pass failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Dialectic trace pass', err, 'Non-critical — debate results unaffected');
    }
  }

  // ── Mid-debate gap injection ("fourth voice") ──────────────

  /**
   * Mid-debate pass: a fresh LLM with no persona surfaces 1-2 strong arguments
   * that no debater made — cross-cutting positions, compromises, blind spots.
   * Non-blocking — failure never aborts the debate.
   */
  private async runGapInjection(
    round: number,
    trigger: 'scheduled' | 'responsive',
    focusNodes?: UnengagedNode[],
  ): Promise<void> {
    try {
      const label = trigger === 'responsive' ? 'Responsive gap check' : 'Analyzing debate gaps';
      this.progress('gap-injection', undefined, label);

      const transcriptText = formatRecentTranscript(this.session.transcript, 20, this.session.context_summaries);

      const summaryLines: string[] = [];
      for (const povKey of POV_KEYS) {
        const povData = this.taxonomy[povKey];
        if (!povData?.nodes) continue;
        for (const node of povData.nodes) {
          const cat = node.category ?? 'unknown';
          summaryLines.push(`[${node.id}] ${node.label} (${cat}) — ${povKey}`);
        }
      }
      const taxSummary = summaryLines.slice(0, 80).join('\n');

      const anTexts = (this.session.argument_network?.nodes || []).map(n => n.text);
      const focusForPrompt = focusNodes?.slice(0, 5);
      const gapPrompt = midDebateGapPrompt(this.session.topic.final, transcriptText, taxSummary, anTexts, focusForPrompt);

      const gapResult = await this.adapter.generateText(gapPrompt, this.config.model, {
        temperature: 0.5,
      });
      this.apiCallCount++;

      const parsed = parseJsonRobust(gapResult) as { gap_arguments?: GapArgument[] };
      const gapArgs: GapArgument[] = parsed?.gap_arguments ?? [];

      if (gapArgs.length > 0) {
        const headerLabel = trigger === 'responsive' ? 'Responsive Gap Analysis' : 'Mid-Debate Gap Analysis';
        const gapContent = gapArgs.map((g: GapArgument, i: number) =>
          `**Gap ${i + 1} (${g.gap_type}):** ${g.argument}\n*Why missing:* ${g.why_missing}`,
        ).join('\n\n');

        const entry = this.addEntry({
          type: 'system',
          speaker: 'system',
          content: `## ${headerLabel}\n\n${gapContent}`,
          taxonomy_refs: [],
        });

        this.recordDiagnostic(entry.id, {
          prompt: gapPrompt,
          raw_response: gapResult,
          model: this.config.model,
        });

        const injection: GapInjection = {
          round,
          arguments: gapArgs,
          transcript_entry_id: entry.id,
          responses: [],
          trigger,
          focus_nodes: focusNodes?.map(n => n.id),
        };

        if (!this.session.gap_injections) {
          this.session.gap_injections = [injection];
        } else {
          this.session.gap_injections.push(injection);
        }

        this._gapInjectionCount++;
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Mid-debate gap injection failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Mid-debate gap injection', err, 'Non-critical — debate continues without gap analysis');
    }
  }

  /**
   * Periodic responsive gap check — finds high-relevance taxonomy nodes
   * that no debater has engaged and triggers a focused gap injection.
   * Deterministic check; LLM called only if unengaged nodes found.
   */
  private async runResponsiveGapCheck(round: number, initialGapRound: number): Promise<void> {
    const maxInjections = this.config.maxGapInjections ?? MAX_GAP_INJECTIONS;
    const checkInterval = this.config.gapCheckInterval ?? GAP_CHECK_INTERVAL;

    if (!shouldRunGapCheck(round, initialGapRound, this._gapInjectionCount, maxInjections, checkInterval)) {
      return;
    }

    const anNodes = this.session.argument_network?.nodes ?? [];
    const engagedIds = collectEngagedNodeIds(anNodes, this.session.transcript);

    const allTaxNodes: Array<{ id: string; label: string; description: string }> = [];
    for (const povKey of POV_KEYS) {
      const povData = this.taxonomy[povKey];
      if (!povData?.nodes) continue;
      for (const node of povData.nodes) {
        allTaxNodes.push({ id: node.id, label: node.label, description: node.description });
      }
    }

    const recentText = formatRecentTranscript(this.session.transcript, 8, this.session.context_summaries);
    const query = `${this.session.topic.final}\n\n${recentText}`.slice(0, 500);
    const scores = scoreNodesLexical(query, allTaxNodes, []);

    const unengaged = findUnengagedHighRelevanceNodes(allTaxNodes, engagedIds, scores);

    if (unengaged.length > 0) {
      this.progress('gap-injection', undefined,
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
  private async runCrossCuttingProposalPass(): Promise<void> {
    try {
      const synthEntry = this.session.transcript.find(e => e.type === 'concluding');
      const concludingData = synthEntry?.metadata?.synthesis as Record<string, unknown> | undefined;
      if (!concludingData) return;

      const agreements = ((concludingData.areas_of_agreement ?? []) as { point: string; povers: string[] }[])
        .filter(a => (a.povers?.length ?? 0) >= 3);

      if (agreements.length === 0) return;

      this.progress('cross-cutting', undefined, 'Analyzing cross-cutting proposals');

      const sitLabels = (this.taxonomy.situations?.nodes || []).map(n => n.label);
      const ccPrompt = crossCuttingNodePrompt(agreements, sitLabels, this.session.topic.final);

      const ccResult = await this.adapter.generateText(ccPrompt, this.config.model, {
        temperature: 0.3,
      });
      this.apiCallCount++;

      const ccParsed = parseJsonRobust(ccResult) as { proposals?: CrossCuttingProposal[] };
      this.session.cross_cutting_proposals = ccParsed?.proposals ?? [];
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Cross-cutting proposal pass failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Cross-cutting proposal pass', err, 'Non-critical — debate results unaffected');
    }
  }

  // ── Taxonomy gap analysis (post-synthesis, deterministic) ──

  /**
   * Post-synthesis pass: compute deterministic taxonomy coverage analysis.
   * Identifies per-POV coverage, BDI balance, unmapped arguments, and cross-POV gaps.
   * No LLM calls — purely deterministic computation.
   * Non-blocking — failure never blocks debate results.
   */
  private runTaxonomyGapAnalysisPass(): void {
    try {
      const taxonomyNodes: Record<string, { id: string; label: string; category: string; description?: string }[]> = {};
      for (const pov of POV_KEYS) {
        taxonomyNodes[pov] = (this.taxonomy[pov]?.nodes || []).map(n => ({
          id: n.id, label: n.label, category: n.category, description: n.description,
        }));
      }

      // Context manifests are accumulated during the debate via _contextManifests.
      // In the CLI engine path, manifests may be empty if computeInjectionManifest
      // results aren't captured per turn — pass what we have.
      this.session.taxonomy_gap_analysis = computeTaxonomyGapAnalysis(
        this.session.transcript,
        this.session.argument_network?.nodes || [],
        taxonomyNodes,
        this._contextManifests,
      );
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Taxonomy gap analysis failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Taxonomy gap analysis', err, 'Non-critical — debate results unaffected');
    }
  }

  // ── Situation debate_refs extraction (t/193) ────────────

  /**
   * Post-debate pass that identifies which situations were substantively
   * discussed and stores the references on the session for consumers
   * to write back to situation nodes in the taxonomy.
   */
  private runSituationRefExtraction(): void {
    const situations = this.taxonomy.situations?.nodes;
    if (!situations || situations.length === 0) return;

    try {
      const result = extractSituationDebateRefs(
        this.session.id,
        this.session.transcript,
        situations,
      );

      // Store refs as a serializable object on the session
      // Consumers (taxonomy-editor) can read this to write debate_refs back to disk
      const refsObj: Record<string, import('./situationRefs').SituationDebateRef> = {};
      for (const [sitId, ref] of result.refs) {
        refsObj[sitId] = ref;
      }

      this.session.situation_debate_refs = {
        refs: refsObj,
        stats: result.stats,
      };
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Situation ref extraction failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Situation ref extraction', err, 'Non-critical — debate results unaffected');
    }
  }

  // ── Position drift detection (sycophancy guard) ────────────

  /**
   * Cache opening statement embeddings for drift comparison.
   * Called once after all opening statements are generated.
   */
  private async cacheOpeningEmbeddings(): Promise<void> {
    const adapter = this.adapter as ExtendedAIAdapter;
    if (!adapter.computeQueryEmbedding) return;

    for (const entry of this.session.transcript) {
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
  private async cacheOpeningClaims(): Promise<void> {
    const adapter = this.adapter as ExtendedAIAdapter;
    if (!adapter.computeQueryEmbedding) return;
    const an = this.session.argument_network;
    if (!an) return;

    // Group opening AN nodes by speaker (turn_number 0..2 = opening round)
    const bySpeaker = new Map<string, Array<{ id: string; text: string }>>();
    const openingTurnMax = (this.config.activePovers?.length ?? 3) - 1;
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
  private async trackPerClaimDrift(
    speaker: Exclude<SpeakerId, 'user'>,
    round: number,
  ): Promise<void> {
    const openingClaims = this._openingClaims.get(speaker);
    if (!openingClaims || openingClaims.length === 0) return;

    const adapter = this.adapter as ExtendedAIAdapter;
    if (!adapter.computeQueryEmbedding) return;

    const an = this.session.argument_network;
    if (!an) return;

    // Get current-round AN nodes for this speaker
    const currentTurnNumber = this.session.transcript
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
    const concessions = this.session.commitments?.[speaker]?.conceded ?? [];
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

    if (!this.session.per_claim_drift) this.session.per_claim_drift = [];
    this.session.per_claim_drift.push({ round, speaker, claims: entries, sycophancy_score: sycophancyScore });

    // Fire guard if >50% abandoned without concession after 3+ turns
    if (sycophancyScore > 0.5 && round >= 3) {
      const abandonedTexts = abandonedNoExcuse
        .map(e => openingClaims.find(c => c.id === e.claim_id)?.text)
        .filter(Boolean) as string[];
      const speakerLabel = POVER_INFO[speaker]?.label ?? speaker;
      const entry = this.addEntry({
        type: 'system',
        speaker: 'system',
        content: `[Sycophancy guard — per-claim] ${speakerLabel} has abandoned ${abandonedNoExcuse.length}/${entries.length} opening claims without concession (score: ${sycophancyScore.toFixed(2)}). Abandoned: ${abandonedTexts.slice(0, 3).map(t => `"${t.slice(0, 60)}…"`).join(', ')}`,
        taxonomy_refs: [],
      });
      this.recordDiagnostic(entry.id, {
        raw_response: JSON.stringify({ speaker, round, sycophancy_score: sycophancyScore, claims: entries }),
      });
    }
  }

  /**
   * Track position drift: compare current response embedding against
   * the speaker's opening and each opponent's opening.
   */
  private async trackPositionDrift(
    speaker: Exclude<SpeakerId, 'user'>,
    responseText: string,
    round: number,
  ): Promise<void> {
    const adapter = this.adapter as ExtendedAIAdapter;
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

      if (!this.session.position_drift) this.session.position_drift = [];
      this.session.position_drift.push({
        round,
        speaker,
        self_similarity: selfSim,
        opponent_similarities: opponentSims,
      });

      // Check for sycophancy
      this.detectSycophancy(speaker, round);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Position drift tracking failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Position drift tracking', err, 'Non-critical — drift data unavailable this turn');
    }
  }

  /**
   * Detect sycophancy: if self_similarity decreased monotonically for 3+ turns
   * AND opponent_similarity increased monotonically for any opponent for 3+ turns
   * AND no concessions were made during those turns.
   */
  private detectSycophancy(speaker: Exclude<SpeakerId, 'user'>, round: number): void {
    // Per-claim tracking handles sycophancy detection when active
    if (this._openingClaims.size > 0) return;

    const drift = this.session.position_drift ?? [];
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
    const concessions = this.session.commitments?.[speaker]?.conceded ?? [];
    // If recent concessions exist, this might be genuine agreement
    if (concessions.length > 0) {
      // Check if any concessions were made in the drift window (heuristic: recent concessions)
      const recentRounds = new Set(recent.map(d => d.round));
      // Can't precisely match concession to round, so skip flag if ANY concessions exist recently
      return;
    }

    const speakerLabel = POVER_INFO[speaker]?.label ?? speaker;
    const opponentLabel = POVER_INFO[driftingToward as Exclude<SpeakerId, 'user'>]?.label ?? driftingToward;

    const sycEntry = this.addEntry({
      type: 'system',
      speaker: 'system',
      content: `[Sycophancy guard] ${speakerLabel} appears to be drifting toward ${opponentLabel}'s position over the last 3 turns without explicit concession. Self-similarity: ${recent.map(d => d.self_similarity.toFixed(2)).join(' → ')}. Consider whether this represents genuine agreement or accommodation.`,
      taxonomy_refs: [],
    });
    this.recordDiagnostic(sycEntry.id, {
      raw_response: JSON.stringify({ speaker, drifting_toward: driftingToward, recent_drift: recent }),
    });
  }

  // ── Post-debate calibration ──────────────────────────────────

  /**
   * After debate, run the relevance threshold optimizer and apply the
   * recommendation if safety rails pass. Non-critical — failures are logged
   * but never affect the completed debate.
   */
  private runPostDebateCalibration(dataRoot: string): void {
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
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Post-debate calibration failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.warn('Post-debate calibration', err, 'Threshold adaptation skipped');
    }
  }

  // ── Steelman validation ────────────────────────────────────

  /**
   * After claim extraction, check if any claims are steelmans of opponents.
   * Uses NLI to compare steelman text against opponent's actual assertions.
   * If max entailment < 0.6, inserts a system warning.
   */
  private async validateSteelmans(
    newNodes: ArgumentNetworkNode[],
    speaker: Exclude<SpeakerId, 'user'>,
  ): Promise<void> {
    const adapter = this.adapter as ExtendedAIAdapter;
    if (!adapter.nliClassify) return; // NLI not available in CLI adapter

    const steelmanNodes = newNodes.filter(n => n.steelman_of);
    if (steelmanNodes.length === 0) return;

    for (const node of steelmanNodes) {
      try {
        const targetPover = node.steelman_of!;
        const targetCommitments = this.session.commitments?.[targetPover];
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

          const steelEntry = this.addEntry({
            type: 'system',
            speaker: 'system',
            content: `[Steelman check] ${speakerLabel}'s steelman of ${targetLabel}'s position (max entailment: ${maxEntailment.toFixed(2)}) diverges from their actual assertions. ${targetLabel} actually asserted: ${topAssertions}`,
            taxonomy_refs: [],
          });
          this.recordDiagnostic(steelEntry.id, {
            raw_response: JSON.stringify({ steelman_text: node.text, target_pover: targetPover, max_entailment: maxEntailment, nli_results: result.results }),
            model: 'nli',
          });
        }
      } catch (err) {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: `Steelman validation failed for ${POVER_INFO[speaker].label}`, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        this.warn(`Steelman validation for ${POVER_INFO[speaker].label}`, err, 'Non-critical — skipping validation');
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
  private async verifyPreciseClaims(newNodes: ArgumentNetworkNode[]): Promise<void> {
    const adapter = this.adapter as ExtendedAIAdapter;
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

        const result = await adapter.generateTextWithSearch(prompt, this.config.model);
        const parsed = parseJsonRobust(result.text) as { verdict?: ArgumentNetworkNode['verification_status']; evidence?: string; confidence?: number };

        if (parsed.verdict) {
          node.verification_status = parsed.verdict;
          node.verification_evidence = parsed.evidence;
          node.base_strength = factCheckToBaseStrength(parsed.verdict, parsed.confidence);
          node.scoring_method = 'fact_check';

          this.session.transcript.push({
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
            },
          });
        }
      } catch (err) {
        getGlobalRecorder()?.record({ type: 'ai.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: `Inline verification failed for ${node.id}`, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        this.warn(`Inline verification for ${node.id}`, err, 'Non-critical — claim unverified');
        node.verification_status = 'pending';
        this.session.transcript.push({
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
      nodeEmbeddings: this.taxonomy.embeddings,
    });

    if (evidenceItems.length === 0) return false;

    const evalModel = this.resolveStageModel('evaluator');
    const result = await buildEvidenceQbaf(
      node.text,
      evidenceItems,
      this.adapter,
      evalModel,
      {
        standardizedTerms: this.config.vocabulary?.standardizedTerms,
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
    this.session.transcript.push({
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
    const diag = this.session.diagnostics!;
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

    const wasDetected = this.session.extraction_summary?.plateau_detected === true;
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
    this.session.extraction_summary = summary;

    // Emit a one-shot [Extraction plateau] system entry when plateau is first detected.
    if (plateauDetected && !wasDetected) {
      const reasonCluster = Object.entries(trace.rejection_reasons)
        .map(([r, c]) => `${r}×${c}`).join(', ') || 'empty_response';
      const lastId = plateauLastId ?? 'AN-?';
      const plateauEntry = this.addEntry({
        type: 'system',
        speaker: 'system',
        content:
          `[Extraction plateau] No new AN nodes since ${lastId} (turn ${plateauStartedAt}). ` +
          `Reason cluster: ${reasonCluster}. See Diagnostics → Extraction Timeline.`,
        taxonomy_refs: [],
      });
      this.recordDiagnostic(plateauEntry.id, {
        raw_response: JSON.stringify(summary),
      });
    }
  }

  private async extractClaims(
    statement: string,
    speaker: Exclude<SpeakerId, 'user'>,
    entryId: string,
    taxonomyRefIds: string[],
    debaterClaims?: { claim: string; targets: string[] }[],
  ): Promise<void> {
    const an = this.session.argument_network!;
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
      prompt = classifyClaimsPrompt(statement, POVER_INFO[speaker].label, debaterClaims, priorClaims, this.session.audience);
    } else {
      prompt = extractClaimsPrompt(statement, POVER_INFO[speaker].label, priorClaims, this.session.audience, this.session.topic.final);
    }

    const anNodeCountBefore = an.nodes.length;
    const turnNumber = this.session.transcript.length;

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
      model: this.resolveStageModel('evaluator'),
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
      text = await this.generateWithEvaluator(prompt, 'Claim extraction', 180_000);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'ai.error', component: 'debate-engine', level: 'error', debate_id: this.session?.id, message: `Claim extraction adapter error for ${POVER_INFO[speaker].label}`, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      trace.status = 'adapter_error';
      trace.error_message = err instanceof Error ? err.message : String(err);
      trace.response_time_ms = Date.now() - extractStart;
      this.recordDiagnostic(entryId, { extraction_trace: trace });
      this.updateExtractionSummary(trace);
      this.warn(`Claim extraction for ${POVER_INFO[speaker].label}`, err, 'Skipping — argument network will be incomplete for this turn');
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
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'error', debate_id: this.session?.id, message: `Claim extraction parse error for ${POVER_INFO[speaker].label}`, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      trace.status = 'parse_error';
      trace.error_message = err instanceof Error ? err.message : String(err);
      this.recordDiagnostic(entryId, {
        extraction_trace: trace,
        claim_extraction: {
          prompt, raw_response: text, response_time_ms: extractElapsed,
          claims_parsed: 0, schemes_classified: [],
        },
      });
      this.updateExtractionSummary(trace);
      this.warn(`Parsing claim extraction response for ${POVER_INFO[speaker].label}`, err, 'Skipping — argument network will be incomplete for this turn');
      return;
    }

    trace.candidates_proposed = claims.length;
    if (claims.length === 0) {
      trace.status = trace.response_truncated ? 'truncated_response' : 'empty_response';
    }

    const overlapThreshold = (debaterClaims && debaterClaims.length > 0) ? 0.1 : 0.15;
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
        startNodeId: an.nodes.length + 1,
        taxonomyEdges: this.taxonomy.edges?.edges,
        knownNodeIds: this.getKnownNodeIds(),
        activatedSituations: this._activatedSituations.length > 0 ? this._activatedSituations : undefined,
        audience: this.session.audience,
      },
      {
        groundingOverlapThreshold: overlapThreshold,
        isClassifyPath: !!(debaterClaims && debaterClaims.length > 0),
        colloquialTerms: this.config.vocabulary?.colloquialTerms,
      },
    );

    an.nodes.push(...claimsResult.newNodes);
    an.edges.push(...claimsResult.newEdges);

    // Entailment post-pass: BDI-category-aware sampling, detect-and-repair
    const entailmentRepairs: EntailmentRepairEvent[] = [];
    if (claimsResult.newNodes.length > 0) {
      const sampled = sampleNodesForEntailment(claimsResult.newNodes);
      for (const node of sampled) {
        try {
          const eprompt = entailmentRepairPrompt(statement, node.text);
          const eText = await this.generateWithEvaluator(eprompt, 'Entailment check');
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
          getGlobalRecorder()?.record({ type: 'ai.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: `Entailment check failed for ${node.id}`, error: { name: (eErr as Error).name ?? 'Error', message: String(eErr), stack: (eErr as Error).stack } });
          this.warn(`Entailment check for ${node.id}`, eErr, 'Skipping — claim text unchanged');
        }
      }
    }

    // Embed new AN nodes for AN-based taxonomy relevance scoring (non-blocking)
    const adapter = this.adapter as ExtendedAIAdapter;
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
        const povNodes = this.taxonomy[speakerPov as PovKey]?.nodes ?? [];
        const allPovNodeIds = new Set(povNodes.map(n => n.id));
        const attrResult = computeClaimTaxonomyAttribution(
          claimsResult.newNodes, speakerPov, this.taxonomy.embeddings, allPovNodeIds,
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
        .filter(ref => (this.taxonomy.embeddings[ref] as { exclusion_vector?: number[] })?.exclusion_vector),
    ).size;
    const exclusionViolations = checkClaimExclusionBoundary(
      claimsResult.newNodes, this.taxonomy.embeddings,
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
        speaker, debate_id: this.session?.id,
        message: `${exclusionViolations.length} claim(s) flagged in exclusion zone`,
        data: { violations: exclusionViolations },
      });
    }

    const commits = this.session.commitments![speaker];
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

    this.session.diagnostics!.overview.claims_accepted += accepted.length;
    this.session.diagnostics!.overview.claims_rejected += rejected.length;

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
      this.session.last_qbaf_result = { iterations: result.iterations, converged: result.converged, oscillationDetected: result.oscillationDetected, dampingLevel: result.dampingLevel };
      this.session.max_qbaf_damping_level = Math.max(this.session.max_qbaf_damping_level ?? 0, result.dampingLevel ?? 0);
      this.session.qbaf_runs_total = (this.session.qbaf_runs_total ?? 0) + 1;
      if ((result.dampingLevel ?? 0) > 0) this.session.qbaf_runs_oscillated = (this.session.qbaf_runs_oscillated ?? 0) + 1;
      if (!result.converged) {
        console.warn(`[qbaf-non-convergence] iterations=${result.iterations} oscillation=${result.oscillationDetected} damping=${result.dampingLevel} nodes=${qbafNodes.length} edges=${qbafEdges.length}`);
        getGlobalRecorder()?.record({
          type: 'qbaf.non_convergence', component: 'debate-engine', level: 'warn',
          debate_id: this.session?.id,
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
      if (this.session.convergence_tracker) {
        for (const issue of this.session.convergence_tracker.issues) {
          const qbafConv = computeQbafConvergence(issue.claim_ids, result.strengths);
          if (qbafConv !== undefined) {
            issue.qbaf_strength = qbafConv;
            issue.convergence = qbafConv;
            issue.history.push({ turn: turnNumber, value: qbafConv });
          }
        }
        this.session.convergence_tracker.last_updated_turn = turnNumber;
      }

      // Snapshot timeline: capture all computed_strengths at this turn
      if (!this.session.qbaf_timeline) this.session.qbaf_timeline = [];
      const strengths: Record<string, number> = {};
      const bdiBd: Record<string, import('./types').BdiSubScores> = {};
      for (const node of an.nodes) {
        if (node.computed_strength != null) strengths[node.id] = node.computed_strength;
        if (node.bdi_sub_scores) bdiBd[node.id] = node.bdi_sub_scores;
      }
      this.session.qbaf_timeline.push({
        turn: turnNumber,
        strengths,
        bdi_breakdown: Object.keys(bdiBd).length > 0 ? bdiBd : undefined,
      });

      // Compute per-entry net delta: sum of strength changes caused by this turn's claims
      const prevSnapshot = this.session.qbaf_timeline.length >= 2
        ? this.session.qbaf_timeline[this.session.qbaf_timeline.length - 2].strengths
        : {};
      let netDelta = 0;
      for (const [id, strength] of Object.entries(strengths)) {
        netDelta += strength - (prevSnapshot[id] ?? 0);
      }
      // Store on the transcript entry metadata
      const entry = this.session.transcript.find(e => e.id === entryId);
      if (entry) {
        if (!entry.metadata) entry.metadata = {};
        entry.metadata.qbaf_net_delta = netDelta;
      }
    }

    // Convergence signals + process rewards (t/282, t/283)
    try {
      // Build turn embeddings map from cached session data + current turn
      let turnEmbeddings: Map<string, number[]> | undefined;
      const cached = this.session.turn_embeddings ?? {};
      const adapter = this.adapter as ExtendedAIAdapter;
      if (adapter.computeQueryEmbedding) {
        const currentEntry = this.session.transcript.find(e => e.id === entryId);
        if (currentEntry && !cached[entryId]) {
          try {
            const { vector } = await adapter.computeQueryEmbedding(currentEntry.content.slice(0, 1000));
            if (vector && vector.length > 0) cached[entryId] = vector;
          } catch { /* telemetry — silent by design: turn embedding is best-effort */ }
        }
        // Prune stale entries — keep most recent 30
        const recentIds = new Set(this.session.transcript.slice(-30).map(e => e.id));
        for (const key of Object.keys(cached)) {
          if (!recentIds.has(key)) delete cached[key];
        }
        this.session.turn_embeddings = cached;
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
        this.session.transcript,
        an.nodes,
        an.edges,
        this.session.convergence_signals ?? [],
        turnEmbeddings,
        precomputedStrengths,
        this.session.topic?.embedding,
        this.session.topic?.clause_embeddings,
        this.session.crux_tracker,
      );
      if (!this.session.convergence_signals) this.session.convergence_signals = [];
      this.session.convergence_signals.push(sig);

      if (sig.concession_opportunity.outcome === 'taken' && this.session.convergence_tracker) {
        const cruxIds = this.session.crux_tracker
          ? new Set(this.session.crux_tracker.flatMap(c => c.attacking_claim_ids))
          : undefined;
        const boostedIds = boostConvergenceOnConcession(
          this.session.convergence_tracker,
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
            debate_id: this.session?.id,
            message: `Concession convergence boost: ${boostedIds.length} issue(s) boosted for ${speaker}`,
            data: { boosted_issue_ids: boostedIds, speaker },
          });
        }
      }

      // Taxonomy CONVERGES_WITH edge boost
      if (this.session.convergence_tracker && this.taxonomy.edges?.edges) {
        const taxBoostedIds = boostConvergenceFromTaxonomyEdges(
          this.session.convergence_tracker,
          this.taxonomy.edges.edges,
          an.nodes,
          turnNumber,
        );
        if (taxBoostedIds.length > 0) {
          getGlobalRecorder()?.record({
            type: 'debate.signal', component: 'debate-engine', level: 'info',
            debate_id: this.session?.id,
            message: `Taxonomy CONVERGES_WITH boost: ${taxBoostedIds.length} issue(s) boosted`,
            data: { boosted_issue_ids: taxBoostedIds },
          });
        }
      }

      // Crux refresh after concession cascade
      if (this.session.convergence_signals && this.session.crux_tracker) {
        const activeCruxes = this.session.crux_tracker.filter(c => c.state !== 'resolved' && c.state !== 'irreducible');
        if (activeCruxes.length > 0) {
          const cascade = detectConcessionCascade(this.session.convergence_signals);
          if (cascade.detected) {
            const recentConcessions = cascade.concessions.map(c => {
              const entry = this.session.transcript.find(e => e.id === c.entry_id);
              return { speaker: c.speaker, conceded_text: entry?.content?.slice(0, 300) ?? '' };
            });
            const recentTranscript = this.session.transcript
              .slice(-6)
              .map(e => `[${e.speaker}]: ${e.content?.slice(0, 200) ?? ''}`)
              .join('\n');
            const refreshPrompt = cruxRefreshPrompt(
              activeCruxes.map(c => ({ id: c.id, description: c.description, polarity: c.support_polarity, disagreement_type: c.disagreement_type })),
              recentConcessions,
              recentTranscript,
              this.session.topic?.text ?? '',
            );
            try {
              const cruxModel = this.resolveStageModel('crux');
              const refreshRaw = this.config.usageDeps
                ? (await callByUsage('debate.crux-refresh', { prompt: refreshPrompt }, this.config.usageDeps, { model: cruxModel })).text
                : await this.adapter.generateText(refreshPrompt, cruxModel, { timeoutMs: 15_000 });
              const refreshData = parseJsonRobust(refreshRaw) as {
                crux_verdicts?: { id: string; verdict: string; reason: string }[];
                emerging_cruxes?: { description: string; speakers_involved: string[]; disagreement_type: string; reason: string }[];
              };
              let transitioned = 0;
              if (refreshData?.crux_verdicts) {
                for (const v of refreshData.crux_verdicts) {
                  if (v.verdict === 'resolved' || v.verdict === 'superseded') {
                    const idx = this.session.crux_tracker!.findIndex(c => c.id === v.id);
                    if (idx >= 0) {
                      this.session.crux_tracker![idx] = transitionCrux(
                        this.session.crux_tracker![idx], 'resolved', turnNumber,
                        `${v.verdict} by concession cascade: ${v.reason}`,
                      );
                      transitioned++;
                    }
                  }
                }
              }
              getGlobalRecorder()?.record({
                type: 'debate.crux_refresh', component: 'debate-engine', level: 'info',
                debate_id: this.session?.id,
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
                debate_id: this.session?.id,
                message: `Crux refresh failed: ${String(err)}`,
                error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
              });
            }
          }
        }
      }

      // Process reward — requires turn validation from this entry
      const turnTrail = this.session.turn_validations?.[entryId];
      const turnValidation = turnTrail?.final;
      if (turnValidation) {
        const currentEntry = this.session.transcript.find(e => e.id === entryId);
        const entryMeta = currentEntry?.metadata as Record<string, unknown> | undefined;
        const moveTypes = (entryMeta?.move_types as (string | import('./helpers').MoveAnnotation)[]) ?? [];
        const phase = ((entryMeta?.debate_phase as string) ?? 'argumentation') as DebatePhase;

        const priorSpeakerEntry = this.session.transcript
          .filter(e => e.speaker === speaker && e.type === 'statement')
          .slice(-2)[0];
        const priorMeta = priorSpeakerEntry?.metadata as Record<string, unknown> | undefined;
        const priorMoves = (priorMeta?.move_types as (string | import('./helpers').MoveAnnotation)[]) ?? [];

        const pr = computeProcessReward({
          convergenceSignals: sig,
          turnValidation,
          phase,
          moveCount: moveTypes.length,
          priorMoveCount: priorMoves.length > 0 ? priorMoves.length : undefined,
          taxonomyRefCount: currentEntry?.taxonomy_refs?.length ?? 0,
          activeCruxCount: this.session.crux_tracker
            ? this.session.crux_tracker.filter(c => c.state !== 'resolved' && c.state !== 'irreducible').length
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
        if (!this.session.process_rewards) this.session.process_rewards = [];
        this.session.process_rewards.push(prEntry);
      }
    } catch (convErr) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.session?.id, message: 'Convergence signal/process-reward computation failed', error: { name: (convErr as Error).name ?? 'Error', message: String(convErr), stack: (convErr as Error).stack } });
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

    this.recordDiagnostic(entryId, {
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
    this.session.unanswered_claims_ledger = updateUnansweredLedger(
      this.session.unanswered_claims_ledger ?? [],
      an.nodes,
      an.edges,
      turnNumber,
    );

    // Update crux resolution tracker
    this.session.crux_tracker = updateCruxTracker(
      this.session.crux_tracker,
      an.nodes,
      an.edges,
      this.session.commitments ?? {},
      turnNumber,
    );
  }
}
