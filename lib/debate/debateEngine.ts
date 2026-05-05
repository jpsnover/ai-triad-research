// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Pure debate orchestration engine — no UI, Zustand, or Electron dependencies.
 * Runs a full structured debate using the AIAdapter interface.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type { AIAdapter, ExtendedAIAdapter } from './aiAdapter.js';
import type { LoadedTaxonomy } from './taxonomyLoader.js';
import type {
  DebateSession,
  DebateSourceType,
  PoverId,
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
  synthesisPrompt,
  crossRespondSelectionPrompt,
  formatCriticalQuestions,
  selectReframingMetaphor,
  crossRespondPrompt,
  debateSynthesisPrompt,
  synthExtractPrompt,
  synthMapPrompt,
  synthEvaluatePrompt,
  probingQuestionsPrompt,
  contextCompressionPrompt,
  entrySummarizationPrompt,
  missingArgumentsPrompt,
  taxonomyRefinementPrompt,
  midDebateGapPrompt,
  crossCuttingNodePrompt,
  moderatorSelectionPrompt,
  moderatorInterventionPrompt,
} from './prompts.js';
import { extractClaimsPrompt, classifyClaimsPrompt, formatArgumentNetworkContext, formatCommitments, formatEstablishedPoints, updateUnansweredLedger, formatUnansweredClaimsHint, formatSpecifyHint, formatConcessionCandidatesHint, processExtractedClaims, factCheckToBaseStrength } from './argumentNetwork.js';
import { extractCalibrationData, appendCalibrationLog } from './calibrationLogger.js';
import { resolveRepoRoot, resolveDataRoot } from './taxonomyLoader.js';
import { updateCruxTracker, formatCruxResolutionContext } from './cruxResolution.js';
import { buildMediumTierSummary, buildDistantTierSummary } from './tieredCompression.js';
import { formatTaxonomyContext, computeInjectionManifest } from './taxonomyContext.js';
import { formatVocabularyContext } from './vocabularyContext.js';
import type { ContextInjectionManifest } from './taxonomyContext.js';
import { documentAnalysisPrompt, buildTaxonomySample } from './documentAnalysis.js';
import type { DocumentAnalysis } from './types.js';
import { runNeutralEvaluation, buildSpeakerMapping } from './neutralEvaluator.js';
import type { SpeakerMapping, NeutralEvaluation } from './neutralEvaluator.js';
import {
  cosineSimilarity,
  scoreNodeRelevance,
  scoreNodesLexical,
  selectRelevantNodes,
  selectRelevantSituationNodes,
  buildRelevanceQuery,
  type RelevanceOptions,
} from './taxonomyRelevance.js';
import {
  generateId,
  nowISO,
  stripCodeFences,
  parseJsonRobust,
  extractArraysFromPartialJson,
  formatRecentTranscript,
  parsePoverResponse,
  getMoveName,
} from './helpers.js';
import { computeQbafStrengths, computeQbafConvergence } from './qbaf.js';
import { computeCoverageMap, computeStrengthWeightedCoverage } from './coverageTracker.js';
import { generateDialecticTraces } from './dialecticTrace.js';
import { computeTaxonomyGapAnalysis } from './taxonomyGapAnalysis.js';
import { extractSituationDebateRefs } from './situationRefs.js';
import { ActionableError } from './errors.js';
import type { ContextManifestEntry } from './taxonomyGapAnalysis.js';
import { resolveTurnValidationConfig } from './turnValidator.js';
import type { TurnValidation, ModeratorState, ModeratorIntervention, SelectionResult, InterventionMove } from './types.js';
import { MOVE_TO_FAMILY, FAMILY_BURDEN_WEIGHT, MOVE_TO_FORCE } from './types.js';
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
  getSynthesisResponder,
} from './moderator.js';
import { runModeratorSelection, executeTurnWithRetry } from './orchestration.js';
import type { ModeratorSelectionCallbacks, ModeratorSelectionInput, TurnRetryCallbacks, TurnRetryInput } from './orchestration.js';
import { pruneSessionData, pruneModeratorState } from './sessionPruning.js';
import { runTurnPipeline, assemblePipelineResult, runOpeningPipeline, assembleOpeningPipelineResult } from './turnPipeline.js';
import type { TurnPipelineInput, OpeningPipelineInput } from './turnPipeline.js';
import {
  findUnengagedHighRelevanceNodes,
  shouldRunGapCheck,
  collectEngagedNodeIds,
  GAP_CHECK_INTERVAL,
  MAX_GAP_INJECTIONS,
} from './gapCheck.js';
import type { UnengagedNode } from './gapCheck.js';

// ── Config ───────────────────────────────────────────────

export interface DebateConfig {
  topic: string;
  name?: string;
  sourceType: DebateSourceType;
  sourceRef?: string;
  sourceContent?: string;
  activePovers: Exclude<PoverId, 'user'>[];
  protocolId?: string;
  model: string;
  /** Separate model for claim extraction/classification (evaluator role). Cross-vendor recommended. Defaults to `model` if unset. */
  evaluatorModel?: string;
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
  explorationExitThreshold?: number;
  /** Override synthesis exit threshold (otherwise derived from pacing preset). */
  synthesisExitThreshold?: number;
  /** Allow early termination on health collapse. Default: true when adaptive staging is on. */
  allowEarlyTermination?: boolean;
  /** AbortSignal for external cancellation. When aborted, the engine stops at the next checkpoint. */
  signal?: AbortSignal;
}

export interface DebateProgress {
  phase: string;
  speaker?: string;
  round?: number;
  totalRounds?: number;
  message: string;
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
  /** Last computed injection manifest — stored on transcript entries for usage analysis. */
  private _lastInjectionManifest: ContextInjectionManifest | null = null;
  /** Speaker mapping for neutral evaluator — built once, reused across checkpoints. */
  private _neutralMapping: SpeakerMapping | null = null;
  /** Whether the midpoint neutral evaluation has already run this debate. */
  private _midpointEvalDone = false;
  /** Cached opening statement embeddings for position drift detection. */
  private _openingEmbeddings = new Map<string, number[]>();
  /** How many gap injections have fired so far (initial + responsive). */
  private _gapInjectionCount = 0;
  /** Accumulated context manifests across turns — for taxonomy gap analysis. */
  private _contextManifests: ContextManifestEntry[] = [];
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
  /** Adaptive staging: per-signal historical values for moving averages. */
  private _signalHistory: Map<string, { round: number; value: number }[]> = new Map();
  /** Adaptive staging: peak tracker for engagement ratio and claims per round. */
  private _peakTrackers: Map<string, number> = new Map();

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
    prompt: string, label: string, model: string, timeoutMs?: number,
  ): Promise<string> {
    this.progress('generating', undefined, label);
    const start = Date.now();
    const text = await this.adapter.generateText(prompt, model, {
      temperature: 0,
      timeoutMs: timeoutMs ?? 120_000,
      signal: this.config.signal,
    });
    this.apiCallCount++;
    this.totalResponseTimeMs += Date.now() - start;
    return text;
  }

  constructor(config: DebateConfig, adapter: AIAdapter | ExtendedAIAdapter, taxonomy: LoadedTaxonomy) {
    this.config = config;
    this.adapter = adapter;
    this.taxonomy = taxonomy;
  }

  async run(onProgress?: (p: DebateProgress) => void): Promise<DebateSession> {
    this.onProgress = onProgress;
    this.initSession();

    try {
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

      // Neutral evaluator: baseline checkpoint (after openings, before cross-respond)
      await this.runNeutralCheckpoint('baseline');

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
    } catch (err) {
      // If the debate was cancelled via AbortSignal, set phase to cancelled and return partial session
      if (this.config.signal?.aborted) {
        this.session.phase = 'cancelled';
        this.session.updated_at = nowISO();
        this.session.diagnostics!.overview.total_ai_calls = this.apiCallCount;
        this.session.diagnostics!.overview.total_response_time_ms = this.totalResponseTimeMs;
        return this.session;
      }
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

    // Log calibration data point (non-blocking, never fails the debate)
    try {
      const weights = loadProvisionalWeights();
      const dataPoint = extractCalibrationData(this.session, 'local', {
        explorationExitThreshold: weights.thresholds.exploration_exit,
        relevanceThreshold: 0.45, // TODO: read from config when externalized
        draftTemperature: 0.7,
        attackWeights: [1.0, 1.1, 1.2],
        saturationWeights: weights.saturation,
      });
      // Resolve data root — env var or .aitriad.json fallback
      const __engineDir = path.dirname(fileURLToPath(import.meta.url));
      const repoRoot = resolveRepoRoot(__engineDir);
      const dataRoot = resolveDataRoot(repoRoot);
      appendCalibrationLog(dataPoint, dataRoot);
    } catch (calErr) {
      // Calibration logging failure never blocks debate completion
      this.warn('Calibration logging', calErr, 'Non-critical — debate results unaffected');
    }

    return this.session;
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

    if (!this.config.evaluatorModel || this.config.evaluatorModel === this.config.model) {
      this.recordDiagnostic('session_init', {
        evaluator_warning: 'Evaluator model matches debate model — self-preference bias is unmitigated. Cross-vendor split recommended.',
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
        explorationExitThreshold: this.config.explorationExitThreshold ?? preset.explorationExit,
        synthesisExitThreshold: this.config.synthesisExitThreshold ?? preset.synthesisExit,
        allowEarlyTermination: this.config.allowEarlyTermination ?? true,
      };
      this._phaseState = initPhaseState(this._adaptiveConfig);
      this._signalRegistry = buildSignalRegistry();
      this._adaptiveDiagnostics = initAdaptiveDiagnostics();
    }
  }

  // ── AI call wrapper ────────────────────────────────────────

  private async generate(prompt: string, label: string, timeoutMs?: number): Promise<string> {
    this.progress('generating', undefined, label);
    const start = Date.now();
    const text = await this.adapter.generateText(prompt, this.config.model, {
      temperature: this.config.temperature ?? 0.7,
      timeoutMs: timeoutMs ?? 120_000,
      signal: this.config.signal,
    });
    const elapsed = Date.now() - start;
    this.apiCallCount++;
    this.totalResponseTimeMs += elapsed;
    return text;
  }

  private async generateWithEvaluator(prompt: string, label: string, timeoutMs?: number): Promise<string> {
    const evalModel = this.config.evaluatorModel ?? this.config.model;
    this.progress('generating', undefined, label);
    const start = Date.now();
    const text = await this.adapter.generateText(prompt, evalModel, {
      temperature: 0,
      timeoutMs: timeoutMs ?? 120_000,
      signal: this.config.signal,
    });
    const elapsed = Date.now() - start;
    this.apiCallCount++;
    this.totalResponseTimeMs += elapsed;
    return text;
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

  /** Log a non-fatal warning — records in diagnostics and emits progress */
  private warn(operation: string, error: unknown, recovery: string): void {
    const msg = error instanceof Error ? error.message : String(error);
    const warning = `[WARNING] ${operation}: ${msg}. Recovery: ${recovery}`;
    process.stderr.write(`[debate-engine] ${warning}\n`);
    this.onProgress?.({ phase: 'warning', message: warning });
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

  /** Post-turn summarization (DT-2): generate brief + medium summaries. Non-blocking — failure is logged, not thrown. */
  private async summarizeEntry(entry: TranscriptEntry): Promise<void> {
    // Only summarize substantive entries (openings, statements, fact-checks)
    if (!['opening', 'statement', 'fact-check'].includes(entry.type)) return;
    // Skip if already summarized
    if (entry.summaries) return;

    try {
      const speaker = POVER_INFO[entry.speaker as PoverId]?.label ?? entry.speaker;
      const prompt = entrySummarizationPrompt(entry.content, speaker);
      const raw = await this.adapter.generateText(prompt, this.config.model, {
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
      this.warn('summarizeEntry', err, 'Entry will display at full detail only');
    }
  }

  private addEntry(entry: Omit<TranscriptEntry, 'id' | 'timestamp'>): TranscriptEntry {
    const full: TranscriptEntry = { id: generateId(), timestamp: nowISO(), ...entry };
    this.session.transcript.push(full);
    return full;
  }

  private recordDiagnostic(entryId: string, data: Partial<EntryDiagnostics>): void {
    const diag = this.session.diagnostics!;
    diag.entries[entryId] = { ...diag.entries[entryId], ...data };
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
      const hasSit = entry.taxonomy_refs.some(r => r.node_id.startsWith('sit-'));
      if (hasSit) {
        turnsWithSit++;
        for (const r of entry.taxonomy_refs) {
          if (r.node_id.startsWith('sit-')) uniqueSitIds.add(r.node_id);
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
        recycling_rate: { avg_self_overlap: lastConvSignal?.recycling_rate?.avg_self_overlap ?? 0, semantic_max_similarity: lastConvSignal?.recycling_rate?.semantic_max_similarity },
        engagement_depth: { ratio: lastConvSignal?.engagement_depth?.ratio ?? 1 },
        position_delta: { drift: lastConvSignal?.position_delta?.drift ?? 0 },
        concession_opportunity: {
          outcome: lastConvSignal?.concession_opportunity?.outcome ?? 'none',
          strong_attacks_faced: lastConvSignal?.concession_opportunity?.strong_attacks_faced ?? 0,
        },
      },

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
        explorationExitThreshold: state.exploration_exit_threshold,
        synthesisExitThreshold: state.synthesis_exit_threshold,
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

    // Preferred path: real per-turn query embedding via adapter (same model as embeddings.json)
    const adapter = this.adapter as ExtendedAIAdapter;
    const hasEmbeddings = Object.keys(this.taxonomy.embeddings).length > 0;
    if (hasEmbeddings && adapter.computeQueryEmbedding) {
      try {
        const { vector } = await adapter.computeQueryEmbedding(query);
        if (vector && vector.length > 0) {
          scores = scoreNodeRelevance(vector, this.taxonomy.embeddings);
        }
      } catch (err) {
        this.warn('Query embedding for relevance filter', err, 'Falling back to lexical scoring');
      }
    }

    // Fallback: lexical overlap against node label + description (no adapter embedding).
    // This at least varies turn-to-turn with the query text, unlike the old "first vector" hack.
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

    const relevanceOpts: RelevanceOptions = {
      scoringMode,
      embeddingThreshold: 0.48,
      lexicalThreshold: 0.22,
      minPerCategory: 3,
      maxTotal: 35,
    };
    const scoredPov = selectRelevantNodes(ctx.povNodes, scores, relevanceOpts);
    const filteredSit = selectRelevantSituationNodes(ctx.situationNodes, scores, { ...relevanceOpts, maxTotal: undefined }, 3, 15);
    const filteredCtx = {
      povNodes: scoredPov.map(s => s.node),
      situationNodes: filteredSit.map(s => s.node),
      policyRegistry: ctx.policyRegistry,
      nodeScores: scores,
    };
    this._lastInjectionManifest = computeInjectionManifest(filteredCtx, pov);
    this._lastInjectionManifest.scoring_mode = scoringMode;
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

  private getCommitmentContext(poverId: Exclude<PoverId, 'user'>): string {
    const commitments = this.session.commitments?.[poverId];
    if (!commitments) return '';

    const an = this.session.argument_network;
    const priorClaims = an?.nodes
      .filter(n => n.speaker === poverId)
      .map(n => ({ text: n.text }));

    return formatCommitments(commitments, priorClaims);
  }

  /** Get recent claims from other debaters so the current speaker doesn't echo them */
  private getEstablishedPointsContext(poverId: Exclude<PoverId, 'user'>): string {
    const an = this.session.argument_network;
    if (!an || an.nodes.length === 0) return '';

    const allNodes = an.nodes.map(n => ({
      id: n.id,
      text: n.text,
      speaker: POVER_INFO[n.speaker as Exclude<PoverId, 'user'>]?.label ?? n.speaker,
    }));

    return formatEstablishedPoints(allNodes, POVER_INFO[poverId].label, 10, an.edges);
  }

  // ── Phase: Clarification ───────────────────────────────────

  private async runClarification(): Promise<void> {
    this.progress('clarification', undefined, 'Generating clarifying questions');
    this.session.phase = 'clarification';

    let prompt: string;
    if (this.config.sourceType === 'document' || this.config.sourceType === 'url') {
      prompt = documentClarificationPrompt(this.config.topic, this.config.sourceContent ?? '', this.config.audience);
    } else if (this.config.sourceType === 'situations') {
      prompt = situationClarificationPrompt(this.config.topic, this.config.sourceContent ?? '', this.config.audience);
    } else {
      prompt = clarificationPrompt(this.config.topic, this.config.sourceContent, this.config.audience);
    }

    const text = await this.generate(prompt, 'Clarification questions', 30_000);
    let structuredQuestions: { question: string; options: string[] }[] = [];
    try {
      const parsed = parseJsonRobust(text) as { questions?: unknown[] };
      const raw = parsed.questions ?? [];
      // Handle both old format (string[]) and new format ({question, options}[])
      structuredQuestions = raw.map((q: string | { question: string; options?: string[] }) =>
        typeof q === 'string' ? { question: q, options: [] } : { question: q.question, options: q.options ?? [] }
      );
    } catch (err) {
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
    const synthPrompt = synthesisPrompt(this.config.topic, qaPairs, this.config.audience);
    const synthText = await this.generate(synthPrompt, 'Topic synthesis', 60_000);

    try {
      const parsed = parseJsonRobust(synthText) as { refined_topic?: string };
      if (parsed.refined_topic) {
        this.session.topic.refined = parsed.refined_topic;
        this.session.topic.final = parsed.refined_topic;
      }
    } catch (err) {
      this.warn('Parsing refined topic from clarification', err, 'Keeping original topic unchanged');
    }

    this.addEntry({
      type: 'answer',
      speaker: 'user',
      content: `[Automated clarification] Refined topic: ${this.session.topic.final}`,
      taxonomy_refs: [],
    });
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
      for (const inode of analysis.i_nodes) {
        an.nodes.push({
          id: inode.id,
          text: inode.text,
          speaker: 'document',
          source_entry_id: entry.id,
          taxonomy_refs: inode.taxonomy_refs,
          turn_number: 0,
        });
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

    const priorStatements: { speaker: string; statement: string }[] = [];

    const stageGenerate = async (prompt: string, model: string, options: { temperature?: number; timeoutMs?: number }, label: string) => {
      this.progress('generating', undefined, label);
      const start = Date.now();
      const text = await this.adapter.generateText(prompt, model, options);
      this.apiCallCount++;
      this.totalResponseTimeMs += Date.now() - start;
      return text;
    };

    for (const poverId of order) {
      const info = POVER_INFO[poverId];
      this.progress('opening', poverId, `${info.label} preparing opening statement`);

      const taxonomyContext = await this.getRelevantTaxonomyContext(info.pov);
      const commitmentContext = this.getCommitmentContext(poverId);
      const establishedPoints = this.getEstablishedPointsContext(poverId);
      const { text: edgeContext, edges_used: openingEdgesUsed } = this.formatDebaterEdgeContext(info.pov);

      let priorBlock = '';
      if (priorStatements.length > 0) {
        priorBlock = '\n\n=== PRIOR OPENING STATEMENTS ===\n';
        for (const ps of priorStatements) {
          priorBlock += `\n${ps.speaker}:\n${ps.statement}\n`;
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
        taxonomyContext: fullContext,
        priorStatements: priorBlock,
        isFirst: priorStatements.length === 0,
        sourceContent: this.session.document_analysis ? undefined : this.config.sourceContent,
        documentAnalysis: this.session.document_analysis,
        audience: this.config.audience,
        model: this.config.model,
        userSeedClaims: userSeeds.length > 0 ? userSeeds : undefined,
        ...(this.config.temperature != null ? {
          stageTemperatures: {
            brief_temperature: this.config.temperature,
            plan_temperature: this.config.temperature,
            draft_temperature: this.config.temperature,
            cite_temperature: this.config.temperature,
          },
        } : {}),
      };

      const pipelineResult = await runOpeningPipeline(
        pipelineInput,
        stageGenerate,
        (_stage, label) => this.progress('opening', poverId, label),
      );
      const { statement, taxonomyRefs, meta } = assembleOpeningPipelineResult(pipelineResult, this.getKnownNodeIds());

      const entry = this.addEntry({
        type: 'opening',
        speaker: poverId,
        content: statement,
        taxonomy_refs: taxonomyRefs,
        policy_refs: meta.policy_refs,
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
        model: this.config.model,
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

      priorStatements.push({ speaker: info.label, statement });
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
        `Round ${round}/${config.maxTotalRounds} [${phase}] (adaptive)`, round);

      // Run the cross-respond round
      await this.runCrossRespondRound(round, phase);

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
        this.updatePeakTracker('_peak_engagement_ratio', lastConvSignal.engagement_depth.ratio);
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
        state.current_phase === 'thesis-antithesis' ? w.phase_bounds.min_thesis_rounds
        : state.current_phase === 'exploration' ? w.phase_bounds.min_exploration_rounds
        : w.phase_bounds.min_synthesis_rounds
      );
      const satScore = computeSaturationScore(signals, ctx, coldStart);
      const convScore = computeConvergenceScore(ctx, coldStart);

      // Record composite scores in signal history
      this.recordSignalHistory('_saturation_score', round, satScore);
      this.recordSignalHistory('_convergence_score', round, convScore);

      // Record individual signal values
      for (const signal of signals) {
        if (!signal.enabled) continue;
        try {
          const val = Math.max(0, Math.min(1, signal.compute(ctx)));
          this.recordSignalHistory(signal.id, round, val);
        } catch { /* signal computation failed — skip */ }
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
      }

      if (result.action === 'regress') {
        const cruxId = Object.keys(result.components).find(k => k.startsWith('crux_')) ?? 'unknown';
        diag.regressions.push({
          from_round: round,
          crux_id: cruxId,
          threshold_after: state.exploration_exit_threshold,
        });

        this.progress('debate', undefined,
          `Regression: synthesis → exploration (${result.reason})`);

        this.addEntry({
          type: 'system', speaker: 'system',
          content: `[Phase regression] synthesis → exploration: ${result.reason}. Threshold ratcheted to ${(state.exploration_exit_threshold * 100).toFixed(0)}%.`,
          taxonomy_refs: [],
          metadata: { adaptive_regression: true, reason: result.reason, new_threshold: state.exploration_exit_threshold },
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
    }

    // Store adaptive diagnostics on session
    this.session.adaptive_staging_diagnostics = diag;
  }

  private async runCrossRespondRound(round: number, phase: DebatePhase = 'exploration'): Promise<void> {
    this.checkAborted();

    const sourceDocSummary = this.session.document_analysis?.claims_summary
      ?? (this.session.source_content ? this.session.source_content.slice(0, 2000) : undefined);

    const selectionCallbacks: ModeratorSelectionCallbacks = {
      generate: async (prompt, _model, options, label) => this.generate(prompt, label, options?.timeoutMs),
      addEntry: (entry) => this.addEntry(entry).id,
      progress: (ph, speaker, message) => this.progress(ph, speaker, message),
      warn: (context, err, recovery) => this.warn(context, err, recovery),
      formatEdgeContext: () => {
        const result = this.formatModeratorEdgeContext();
        return { text: result.text, edges_used: result.edges_used };
      },
    };

    const selectionInput: ModeratorSelectionInput = {
      round,
      phase,
      activePovers: this.config.activePovers,
      totalRounds: this.config.rounds,
      model: this.config.model,
      audience: this.config.audience,
      sourceDocSummary,
      transcript: this.session.transcript,
      contextSummaries: this.session.context_summaries,
      argumentNetwork: this.session.argument_network ?? undefined,
      convergenceSignals: this.session.convergence_signals,
      unansweredLedger: this.session.unanswered_claims_ledger,
      gapInjections: this.session.gap_injections,
      commitments: this.session.commitments,
      existingModState: this._moderatorState,
      poverInfo: POVER_INFO as Record<string, { label: string; pov: string; personality?: string }>,
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
          intervention_recommended: selectionResult.intervene ?? false,
          intervention_move: activeIntervention?.move ?? null,
          intervention_validated: !!activeIntervention,
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
    const availablePovNodeIds = povFile?.nodes?.map(n => n.id) ?? [];

    // Gather cross-POV node IDs for late-round citation diversity (Rec 3)
    const crossPovNodeIds = round >= 4
      ? Object.entries(taxMap)
          .filter(([key]) => key !== info.pov && key !== 'policyRegistry')
          .flatMap(([, file]) => file?.nodes?.map(n => n.id) ?? [])
          .filter(id => !priorRefsEarly.includes(id))
          .sort(() => Math.random() - 0.5)
          .slice(0, 8)
      : undefined;

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
    const pipelineInput: TurnPipelineInput = {
      label: info.label,
      pov: info.pov,
      personality: info.personality,
      topic: this.session.topic.final,
      taxonomyContext: taxonomyContext + turnVocabContext + interventionInjection,
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
      crossPovNodeIds,
      priorFlaggedHints,
      sourceContent: this.session.document_analysis ? undefined : this.config.sourceContent,
      documentAnalysis: this.session.document_analysis,
      audience: this.config.audience,
      model: this.config.model,
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
            this._phaseState!.current_phase === 'thesis-antithesis' ? w.phase_bounds.min_thesis_rounds
            : this._phaseState!.current_phase === 'exploration' ? w.phase_bounds.min_exploration_rounds
            : w.phase_bounds.min_synthesis_rounds
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

    const stageGenerate = async (prompt: string, model: string, options: { temperature?: number; timeoutMs?: number }, label: string) => {
      this.progress('generating', undefined, label);
      const start = Date.now();
      const text = await this.adapter.generateText(prompt, model, options);
      this.apiCallCount++;
      this.totalResponseTimeMs += Date.now() - start;
      return text;
    };

    const envelopeGenerate = this.adapter.generate
      ? async (request: import('./cacheTypes').GenerateRequest, label: string) => {
          this.progress('generating', undefined, label);
          const start = Date.now();
          const resp = await this.adapter.generate!(request);
          this.apiCallCount++;
          this.totalResponseTimeMs += Date.now() - start;
          return resp;
        }
      : undefined;

    // ── Cross-respond with per-turn validation + retry loop ──
    const knownIds = this.getKnownNodeIds();
    const vConfig = resolveTurnValidationConfig(this.config.turnValidation);

    const retryCallbacks: TurnRetryCallbacks = {
      runPipeline: (input) => runTurnPipeline(
        input, stageGenerate,
        (_stage, label) => this.progress('generating', responder, label),
        envelopeGenerate,
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
      model: this.config.model,
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
    const turnResult = await executeTurnWithRetry(retryInput, retryCallbacks);
    const { statement, taxonomyRefs, meta, validation, attempts, pipelineResult } = turnResult;

    const entry = this.addEntry({
      type: 'statement',
      speaker: responder,
      content: statement,
      taxonomy_refs: taxonomyRefs,
      policy_refs: meta.policy_refs,
      addressing: addressing as PoverId | 'all',
      metadata: {
        cross_respond: true,
        round,
        focus_point: focusPoint,
        addressing_label: addressing,
        move_types: meta.move_types,
        disagreement_type: meta.disagreement_type,
        my_claims: meta.my_claims,
        turn_symbols: meta.turn_symbols,
        injection_manifest: this._lastInjectionManifest ?? undefined,
        debate_phase: phase,
        position_update: meta.position_update,
        turn_validation_outcome: validation.outcome,
        turn_validation_score: validation.score,
        turn_validation_attempts: attempts.length,
        turn_validation_flagged: validation.outcome === 'accept_with_flag' ? true : undefined,
        concession_candidates_offered: concessionCandidateIds.length > 0 ? concessionCandidateIds : undefined,
        concession_considered: (meta as Record<string, unknown>)?.concession_considered as string | undefined,
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
      model: this.config.model,
      response_time_ms: pipelineResult.total_time_ms,
      taxonomy_context: taxonomyContext,
      commitment_context: commitmentContext,
      stage_diagnostics: pipelineResult.stage_diagnostics,
      edges_used: responderEdgesUsed,
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

    // Post-extraction interventions (non-blocking)
    if (newNodes.length > 0) {
      this.validateSteelmans(newNodes, responder).catch(err => this.warn('Steelman validation', String(err), 'Steelman check skipped'));
      this.verifyPreciseClaims(newNodes).catch(err => this.warn('Precise claims', String(err), 'Precision check skipped'));
    }

    // Position drift detection (non-blocking)
    this.trackPositionDrift(responder, statement, round).catch(err => this.warn('Position drift', String(err), 'Drift tracking skipped'));

    // Post-turn summarization (DT-2)
    this.summarizeEntry(entry).catch(err => this.warn('Summarization', String(err), 'Entry summarization skipped'));

    // ── Update active moderator state for next round ──
    const validationResult = activeIntervention
      ? { proceed: true, validated_move: activeIntervention.move, validated_family: activeIntervention.family, validated_target: activeIntervention.target_debater } as import('./types').EngineValidationResult
      : { proceed: false, validated_move: 'PIN' as InterventionMove, validated_family: 'elicitation' as import('./types').InterventionFamily, validated_target: responder } as import('./types').EngineValidationResult;
    updateModeratorState(this._moderatorState!, activeIntervention, validationResult, round, phase);
    this.session.moderator_state = this._moderatorState!;

    pruneSessionData(this.session);
    pruneModeratorState(this._moderatorState!);
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
          const documentClaims = this.session.document_analysis.i_nodes.map(n => ({ id: n.id, text: n.text }));
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
        } catch {
          // Coverage computation failed — proceed without uncovered claims
        }
      }
    }

    const prompt = probingQuestionsPrompt(this.session.topic.final, transcript, unreferencedNodes, hasSourceDoc, uncoveredClaims, this.config.audience);
    const text = await this.generate(prompt, 'Probing questions', 30_000);

    let questions: { text: string; targets: string[] }[] = [];
    try {
      const parsed = parseJsonRobust(text) as { questions?: { text?: string; question?: string; targets?: string[]; options?: string[] }[] };
      questions = (parsed.questions ?? []).map(q => ({ text: q.text ?? q.question ?? '', targets: q.targets ?? q.options ?? [] }));
    } catch (err) {
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
          this.config.activePovers as Exclude<PoverId, 'user'>[],
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
      const notes = evaluation.overall_assessment?.notes ?? '';
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
      // Neutral evaluation failure should never abort the debate
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

    // Distant tier: LLM summary for oldest entries + structural overlay
    if (distantEntries.length >= 4) {
      const entries = distantEntries.map(e => {
        const label = e.speaker === 'user' ? 'Moderator'
          : POVER_INFO[e.speaker as Exclude<PoverId, 'user'>]?.label ?? e.speaker;
        return `${label}: ${e.content}`;
      }).join('\n\n');

      const prompt = contextCompressionPrompt(entries, this.config.audience);
      const text = await this.generate(prompt, 'Context compression', 60_000);

      try {
        const parsed = parseJsonRobust(text) as { summary?: string };
        if (parsed.summary) {
          // Append structural overlay to the LLM summary
          const structuralOverlay = an
            ? buildDistantTierSummary(an.nodes, an.edges, this.session.commitments ?? {}, this.session.crux_tracker)
            : '';
          const enrichedSummary = structuralOverlay
            ? `${parsed.summary}\n\n--- Structural context ---\n${structuralOverlay}`
            : parsed.summary;

          this.session.context_summaries.push({
            up_to_entry_id: distantEntries[distantEntries.length - 1].id,
            summary: enrichedSummary,
            tier: 'distant',
          });

          // Context-rot metrics
          const inChars = entries.length;
          const outChars = enrichedSummary.length;
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
              },
            });
          }
        }
      } catch (err) {
        this.warn('Context compression', err, 'Continuing without compression — prompts may be longer than optimal');
      }
    } else if (toCompress.length >= 4) {
      // Not enough entries for two tiers — fall back to single LLM summary
      const entries = toCompress.map(e => {
        const label = e.speaker === 'user' ? 'Moderator'
          : POVER_INFO[e.speaker as Exclude<PoverId, 'user'>]?.label ?? e.speaker;
        return `${label}: ${e.content}`;
      }).join('\n\n');

      const prompt = contextCompressionPrompt(entries, this.config.audience);
      const text = await this.generate(prompt, 'Context compression', 60_000);

      try {
        const parsed = parseJsonRobust(text) as { summary?: string };
        if (parsed.summary) {
          this.session.context_summaries.push({
            up_to_entry_id: toCompress[toCompress.length - 1].id,
            summary: parsed.summary,
          });

          const inChars = entries.length;
          const outChars = parsed.summary.length;
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
              },
            });
          }
        }
      } catch (err) {
        this.warn('Context compression', err, 'Continuing without compression — prompts may be longer than optimal');
      }
    }
  }

  // ── Synthesis ──────────────────────────────────────────────

  private async runSynthesis(): Promise<void> {
    this.progress('synthesis', undefined, 'Generating synthesis');

    const fullTranscript = formatRecentTranscript(this.session.transcript, 50, this.session.context_summaries);
    const hasSourceDoc = this.config.sourceType === 'document' || this.config.sourceType === 'url';

    // Policy context
    let policyContext = '';
    if (this.taxonomy.policyRegistry.length > 0) {
      const policyLines = this.taxonomy.policyRegistry.slice(0, 10).map(p => `${p.id}: ${p.action}`);
      policyContext = `\n\n=== POLICY REGISTRY (reference pol-NNN IDs for policy implications) ===\n${policyLines.join('\n')}`;
    }

    const start = Date.now();
    let synthesisData: Record<string, unknown> = {};

    // Phase 1: Extract core synthesis
    this.checkAborted();
    this.progress('synthesis', undefined, 'Phase 1/3: Extracting agreements and disagreements');
    const cruxContext = (this.session.crux_tracker?.length ?? 0) > 0
      ? formatCruxResolutionContext(this.session.crux_tracker!)
      : undefined;
    const extractText = await this.generate(
      synthExtractPrompt(this.session.topic.final, fullTranscript, this.config.audience, cruxContext),
      'Synthesis Phase 1: Extract', 60_000,
    );
    let extractData: Record<string, unknown> = {};
    try {
      extractData = parseJsonRobust(extractText) as Record<string, unknown>;
    } catch {
      extractData = extractArraysFromPartialJson(stripCodeFences(extractText));
      if (Object.keys(extractData).length === 0) {
        this.warn('Synthesis Phase 1 parse', 'Both JSON parsers returned empty — synthesis data will be incomplete', 'Proceeding with partial synthesis');
      } else {
        this.warn('Synthesis Phase 1 parse', 'Primary JSON parse failed, recovered partial data via fallback', 'Synthesis may be incomplete');
      }
    }
    if (Object.keys(extractData).length === 0) {
      this.warn('Synthesis Phase 1', 'AI returned empty or unparseable output — synthesis data will be incomplete', 'Proceeding with partial synthesis');
    }
    Object.assign(synthesisData, extractData);

    // Phase 2: Build argument map
    this.checkAborted();
    this.progress('synthesis', undefined, 'Phase 2/3: Building argument map');
    const disagreementsSummary = JSON.stringify(extractData.areas_of_disagreement ?? []);
    const mapText = await this.generate(
      synthMapPrompt(this.session.topic.final, fullTranscript, disagreementsSummary, hasSourceDoc, this.config.audience),
      'Synthesis Phase 2: Map', 60_000,
    );
    let mapData: Record<string, unknown> = {};
    try {
      mapData = parseJsonRobust(mapText) as Record<string, unknown>;
    } catch {
      mapData = extractArraysFromPartialJson(stripCodeFences(mapText));
      if (Object.keys(mapData).length === 0) {
        this.warn('Synthesis Phase 2 parse', 'Both JSON parsers returned empty — argument map data will be incomplete', 'Proceeding with partial synthesis');
      } else {
        this.warn('Synthesis Phase 2 parse', 'Primary JSON parse failed, recovered partial data via fallback', 'Synthesis may be incomplete');
      }
    }
    if (Object.keys(mapData).length === 0) {
      this.warn('Synthesis Phase 2', 'AI returned empty or unparseable output — argument map will be incomplete', 'Proceeding with partial synthesis');
    }
    Object.assign(synthesisData, mapData);

    // Phase 3: Evaluate preferences + policy implications
    this.checkAborted();
    this.progress('synthesis', undefined, 'Phase 3/3: Evaluating preferences');
    const argMapSummary = JSON.stringify(mapData.argument_map ?? []);
    const evalText = await this.generate(
      synthEvaluatePrompt(this.session.topic.final, disagreementsSummary, argMapSummary, policyContext, this.config.audience),
      'Synthesis Phase 3: Evaluate', 60_000,
    );
    let evalData: Record<string, unknown> = {};
    try {
      evalData = parseJsonRobust(evalText) as Record<string, unknown>;
    } catch {
      evalData = extractArraysFromPartialJson(stripCodeFences(evalText));
      if (Object.keys(evalData).length === 0) {
        this.warn('Synthesis Phase 3 parse', 'Both JSON parsers returned empty — evaluation data will be incomplete', 'Proceeding with partial synthesis');
      } else {
        this.warn('Synthesis Phase 3 parse', 'Primary JSON parse failed, recovered partial data via fallback', 'Synthesis may be incomplete');
      }
    }
    if (Object.keys(evalData).length === 0) {
      this.warn('Synthesis Phase 3', 'AI returned empty or unparseable output — evaluation data will be incomplete', 'Proceeding with partial synthesis');
    }
    Object.assign(synthesisData, evalData);

    const elapsed = Date.now() - start;

    // Format readable content
    const lines: string[] = [];
    const agreements = synthesisData.areas_of_agreement as { point: string; povers: string[] }[] | undefined;
    const disagreements = synthesisData.areas_of_disagreement as { point: string; positions: { pover: string; stance: string }[] }[] | undefined;
    const cruxes = synthesisData.cruxes as { question: string; type?: string }[] | undefined;

    if (agreements?.length) {
      lines.push('**Areas of Agreement:**');
      lines.push('');
      for (const a of agreements) {
        const povers = (a.povers ?? []).map(p => POVER_INFO[p as Exclude<PoverId, 'user'>]?.label ?? p).join(', ');
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
          const label = POVER_INFO[pos.pover as Exclude<PoverId, 'user'>]?.label ?? pos.pover;
          lines.push(`    - ${label}: ${pos.stance}`);
        }
        const resolvability = (d as Record<string, unknown>).resolvability as string | undefined;
        if (resolvability) {
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
        if (crux.if_yes) lines.push(`    - If yes: ${crux.if_yes}`);
        if (crux.if_no) lines.push(`    - If no: ${crux.if_no}`);
      }
      lines.push('');
    }

    const unresolvedQuestions = synthesisData.unresolved_questions as string[] | undefined;
    if (unresolvedQuestions?.length) {
      lines.push('**Unresolved Questions:**');
      lines.push('');
      for (const q of unresolvedQuestions) lines.push(`- ${q}`);
      lines.push('');
    }

    const preferences = synthesisData.preferences as { conflict: string; prevails: string; criterion: string; rationale: string; what_would_change_this?: string }[] | undefined;
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
    } else if (typeof synthesisData.summary === 'string') {
      content = synthesisData.summary;
    } else {
      content = JSON.stringify(synthesisData, null, 2);
    }

    const entry = this.addEntry({
      type: 'synthesis',
      speaker: 'system',
      content,
      taxonomy_refs: [],
      metadata: { synthesis: synthesisData },
    });

    this.recordDiagnostic(entry.id, {
      raw_response: JSON.stringify({ extractData, mapData, evalData }),
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
      const synthEntry = this.session.transcript.find(e => e.type === 'synthesis');
      const synthesisText = synthEntry?.content ?? '';
      if (!synthesisText) return; // No synthesis yet — will be called after synthesis completes

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
        synthesisText.slice(0, 4000), // Cap synthesis text
        this.config.audience,
      );

      const text = await this.generate(prompt, 'Missing arguments pass', 60_000);
      const parsed = parseJsonRobust(text) as { missing_arguments?: unknown[] };
      if (parsed.missing_arguments && Array.isArray(parsed.missing_arguments)) {
        this.session.missing_arguments = parsed.missing_arguments.slice(0, 5);
      }
    } catch (err) {
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
      const synthEntry = this.session.transcript.find(e => e.type === 'synthesis');
      const synthesisText = synthEntry?.content ?? '';
      if (!synthesisText) return;

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
        synthesisText.slice(0, 4000),
        referencedNodes.slice(0, 25), // Cap nodes sent to prompt
        anSummary,
        this.config.audience,
      );

      const text = await this.generate(prompt, 'Taxonomy refinement pass', 60_000);
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
        timeoutMs: 30_000,
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
      const synthEntry = this.session.transcript.find(e => e.type === 'synthesis');
      const synthesisData = synthEntry?.metadata?.synthesis as Record<string, unknown> | undefined;
      if (!synthesisData) return;

      const agreements = ((synthesisData.areas_of_agreement ?? []) as { point: string; povers: string[] }[])
        .filter(a => (a.povers?.length ?? 0) >= 3);

      if (agreements.length === 0) return;

      this.progress('cross-cutting', undefined, 'Analyzing cross-cutting proposals');

      const sitLabels = (this.taxonomy.situations?.nodes || []).map(n => n.label);
      const ccPrompt = crossCuttingNodePrompt(agreements, sitLabels, this.session.topic.final);

      const ccResult = await this.adapter.generateText(ccPrompt, this.config.model, {
        temperature: 0.3,
        timeoutMs: 30_000,
      });
      this.apiCallCount++;

      const ccParsed = parseJsonRobust(ccResult) as { proposals?: CrossCuttingProposal[] };
      this.session.cross_cutting_proposals = ccParsed?.proposals ?? [];
    } catch (err) {
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
      } catch {
        // Non-critical — drift detection will be unavailable for this speaker
      }
    }
  }

  /**
   * Track position drift: compare current response embedding against
   * the speaker's opening and each opponent's opening.
   */
  private async trackPositionDrift(
    speaker: Exclude<PoverId, 'user'>,
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
      this.warn('Position drift tracking', err, 'Non-critical — drift data unavailable this turn');
    }
  }

  /**
   * Detect sycophancy: if self_similarity decreased monotonically for 3+ turns
   * AND opponent_similarity increased monotonically for any opponent for 3+ turns
   * AND no concessions were made during those turns.
   */
  private detectSycophancy(speaker: Exclude<PoverId, 'user'>, round: number): void {
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
    const opponentLabel = POVER_INFO[driftingToward as Exclude<PoverId, 'user'>]?.label ?? driftingToward;

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

  // ── Steelman validation ────────────────────────────────────

  /**
   * After claim extraction, check if any claims are steelmans of opponents.
   * Uses NLI to compare steelman text against opponent's actual assertions.
   * If max entailment < 0.6, inserts a system warning.
   */
  private async validateSteelmans(
    newNodes: ArgumentNetworkNode[],
    speaker: Exclude<PoverId, 'user'>,
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
          const targetLabel = POVER_INFO[targetPover as Exclude<PoverId, 'user'>]?.label ?? targetPover;
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
        this.warn(`Steelman validation for ${POVER_INFO[speaker].label}`, err, 'Non-critical — skipping validation');
      }
    }
  }

  // ── Inline empirical verification ─────────────────────────

  /**
   * After claim extraction, auto-fact-check precise Belief claims via web search.
   * Cap at 2 per turn. Updates node verification_status and inserts system warning if disputed.
   */
  private async verifyPreciseClaims(newNodes: ArgumentNetworkNode[]): Promise<void> {
    const adapter = this.adapter as ExtendedAIAdapter;
    if (!adapter.generateTextWithSearch) return; // Search not available in CLI adapter

    const preciseBeliefs = newNodes.filter(
      n => n.bdi_category === 'belief' && n.specificity === 'precise',
    );
    if (preciseBeliefs.length === 0) return;

    for (const node of preciseBeliefs.slice(0, 2)) {
      try {
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
    speaker: Exclude<PoverId, 'user'>,
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
      speaker: POVER_INFO[n.speaker as Exclude<PoverId, 'user'>]?.label ?? n.speaker,
    }));
    const priorClaims = allPriorClaims.slice(-30);

    let prompt: string;
    if (debaterClaims && debaterClaims.length > 0) {
      prompt = classifyClaimsPrompt(statement, POVER_INFO[speaker].label, debaterClaims, priorClaims);
    } else {
      prompt = extractClaimsPrompt(statement, POVER_INFO[speaker].label, priorClaims);
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
      model: this.config.evaluatorModel ?? this.session.debate_model ?? '',
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
      text = await this.generateWithEvaluator(prompt, 'Claim extraction', 60_000);
    } catch (err) {
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

    let claims: { text: string; bdi_category?: string; base_strength?: number; specificity?: string; steelman_of?: string | null; responds_to?: { prior_claim_id: string; relationship: string; attack_type?: string; weight?: number; scheme?: string; argumentation_scheme?: string; warrant?: string }[] }[] = [];
    try {
      const parsed = parseJsonRobust(text) as { claims?: typeof claims };
      claims = parsed.claims ?? [];
    } catch (err) {
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
      },
      {
        groundingOverlapThreshold: overlapThreshold,
        isClassifyPath: !!(debaterClaims && debaterClaims.length > 0),
      },
    );

    an.nodes.push(...claimsResult.newNodes);
    an.edges.push(...claimsResult.newEdges);

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
      this.session.last_qbaf_result = { iterations: result.iterations, converged: result.converged, oscillationDetected: result.oscillationDetected };
      if (!result.converged) {
        console.warn(`[qbaf-non-convergence] iterations=${result.iterations} oscillation=${result.oscillationDetected} nodes=${qbafNodes.length} edges=${qbafEdges.length}`);
      }
      for (const node of an.nodes) {
        const strength = result.strengths.get(node.id);
        if (strength !== undefined) node.computed_strength = strength;
      }

      // Update convergence tracker with QBAF strengths
      if (this.session.convergence_tracker) {
        for (const issue of this.session.convergence_tracker.issues) {
          const qbafConv = computeQbafConvergence(issue.claim_ids, result.strengths);
          if (qbafConv !== undefined) issue.qbaf_strength = qbafConv;
        }
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
