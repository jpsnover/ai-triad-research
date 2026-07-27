// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { type DebateSession, type DebateSourceType, type SpeakerId, type DebatePacing } from '../types.js';

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
  modelTier?: import('../types.js').ModelTier;
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
  turnValidation?: import('../types.js').TurnValidationConfig;
  /** App version string to stamp on the session. */
  appVersion?: string;
  /** Target audience for tone, language, and concern prioritization. */
  audience?: import('../types.js').DebateAudience;
  /** Round at which to inject gap arguments (0 = disabled, default = ceil(totalRounds/2)+1). */
  gapInjectionRound?: number;
  /** How often (in rounds) to run the responsive gap check after the initial injection. Default: 3. */
  gapCheckInterval?: number;
  /** Maximum total gap injections per debate (initial + responsive). Default: 3. */
  maxGapInjections?: number;
  /** Vocabulary terms for standardized term enforcement in persona prompts. */
  vocabulary?: {
    standardizedTerms: import('../../dictionary/types.js').StandardizedTerm[];
    colloquialTerms: import('../../dictionary/types.js').ColloquialTerm[];
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
  perturbation?: import('../types.js').PerturbationConfig;
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
  /** Enable corpus-coverage anti-recurrence: downweight retread nodes, boost underexplored tail (t/1438). */
  enableCorpusCoverage?: boolean;
  /** Inject comp-linguist per-POV, per-BDI situation register-statements at setup (t/1450 experiment). Off by default. */
  enableSituationStatements?: boolean;
  /** Enable over-generate/select/rewrite pipeline: N=3 drafts, dedup, greedy top-K, rewrite, coherence gate (t/1581). */
  experiment_overgen_select_rewrite?: boolean;
  /** Exploration summary from a prior cheap-engine run — seeds cruxes, situations, AN priming, and config overrides. */
  explorationSummary?: import('../explorationSummary.js').ExplorationSummary;
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
  usageDeps?: import('../../ai-client/usageRegistry.js').UsageCallDeps;
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

/**
 * Narrow internal contract exposed by `DebateEngine._internal` (ADR-007 split, t/1778).
 *
 * The extracted phase/helper modules under `debateEngine/` receive the engine instance
 * typed as this interface. It enumerates exactly the private state fields and helper
 * methods those modules read/write — the deliberate, minimal "widening" of the class's
 * internals. It is NOT re-exported from `debateEngine.ts` and is NOT part of the public API.
 */
export interface DebateEngineInternals {
  // ── core state ──
  config: DebateConfig;
  session: DebateSession;
  taxonomy: import('../taxonomyLoader.js').LoadedTaxonomy;
  adapter: import('../aiAdapter.js').AIAdapter;
  apiCallCount: number;
  totalResponseTimeMs: number;
  lastApiCallTime: number;

  // ── context / injection state ──
  _lastInjectionManifest: import('../taxonomyContext.js').ContextInjectionManifest | null;
  _lastRelevanceScores: Map<string, number> | null;
  _activatedSituations: { id: string; text: string }[];
  _contextManifests: import('../taxonomyGapAnalysis.js').ContextManifestEntry[];
  _situationScoreAdjustments: Map<string, number> | null;
  _nodeLabelMap?: Map<string, string>;

  // ── moderator / adaptive-staging state ──
  _midpointEvalDone: boolean;
  _perturbationEntryId: string | null;
  _moderatorState: import('../types.js').ModeratorState | null;
  _adaptiveConfig: import('../types.js').PhaseTransitionConfig | null;
  _phaseState: import('../types.js').PhaseState | null;
  _signalRegistry: import('../types.js').Signal[] | null;
  _adaptiveDiagnostics: import('../types.js').AdaptiveStagingDiagnostics | null;
  _boundaryEmbeddings: import('../doctrinalAnchoring.js').BoundaryEmbeddings | null;
  _signalHistory: Map<string, { round: number; value: number }[]>;
  _peakTrackers: Map<string, number>;

  // ── exploration / crux / insularity state ──
  _priorCruxContext: string;
  _explorationBoosts: Map<string, number>;
  _explorationPriming: string;
  _insularityInterventions: { speaker: string; round: number; injected_node_id: string; target_camp: string }[];
  _overgenCoherenceGateMiss: boolean;

  // ── rate-limit state ──
  _rateLimitBackoffMs: number;
  _lastRateLimitTime: number;

  // ── collaborator pipelines ──
  _topicPipeline: import('../topicPipeline.js').TopicPipeline;
  _claimPipeline: import('../claimExtractionPipeline.js').ClaimExtractionPipeline;
  _synthesisPipeline: import('../synthesisPipeline.js').SynthesisPipeline;

  // ── t/1781 settle-gate: pending non-blocking claim verifications ──
  _pendingClaimVerifications: Promise<void>[];

  // ── lazy evidence indices (getters) ──
  readonly sourceEvidenceIndex: import('../evidenceFromSummaries.js').SourceEvidenceIndex | undefined;
  readonly docTitles: import('../evidenceFromSummaries.js').DocMetaMap | undefined;

  // ── helper methods that remain on the orchestrator ──
  progress(phase: string, speaker?: string, message?: string, round?: number): void;
  warn(operation: string, error: unknown, recovery: string): void;
  checkAborted(): void;
  emitSnapshot(trigger: 'round_complete' | 'error'): void;
  throttle(): Promise<void>;
  addEntry(entry: Omit<import('../types.js').TranscriptEntry, 'id' | 'timestamp'>): import('../types.js').TranscriptEntry;
  recordDiagnostic(entryId: string, data: Partial<import('../types.js').EntryDiagnostics>): void;
  summarizeEntry(entry: import('../types.js').TranscriptEntry): Promise<void>;
  generate(prompt: string, label: string, timeoutMs?: number): Promise<string>;
  generateWithModel(prompt: string, label: string, model: string, timeoutMs?: number, temperature?: number): Promise<string>;
  stageGenerate(prompt: string, model: string, options: { temperature?: number; timeoutMs?: number }, label: string): Promise<string>;
  executeWithModelFailover<T>(speaker: string, execute: (model: string) => Promise<T>): Promise<T>;
  getKnownNodeIds(): Set<string>;
  getPolicyIds(): Set<string>;
  getSuppressedHints(): Set<string>;
  updateHintStreaks(speaker: string, firedHints: string[]): void;
  updateSituationCitations(currentRefs: import('../types.js').TaxonomyRef[]): void;
}
