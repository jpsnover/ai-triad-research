// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Pure debate orchestration engine — no UI, Zustand, or Electron dependencies.
 * Runs a full structured debate using the AIAdapter interface.
 */

import type { AIAdapter, ExtendedAIAdapter } from './aiAdapter';
import type { LoadedTaxonomy } from './taxonomyLoader';
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
} from './types';
import { POVER_INFO, getDebatePhase } from './types';
import type { PovNode, SituationNode } from './taxonomyTypes';
import type { TaxonomyContext } from './taxonomyContext';
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
} from './prompts';
import { extractClaimsPrompt, classifyClaimsPrompt, formatArgumentNetworkContext, formatCommitments, formatEstablishedPoints, updateUnansweredLedger, formatUnansweredClaimsHint, formatSpecifyHint, formatConcessionCandidatesHint, processExtractedClaims } from './argumentNetwork';
import { formatTaxonomyContext, computeInjectionManifest } from './taxonomyContext';
import { formatVocabularyContext } from './vocabularyContext';
import type { ContextInjectionManifest } from './taxonomyContext';
import { documentAnalysisPrompt, buildTaxonomySample } from './documentAnalysis';
import type { DocumentAnalysis } from './types';
import { runNeutralEvaluation, buildSpeakerMapping } from './neutralEvaluator';
import type { SpeakerMapping, NeutralEvaluation } from './neutralEvaluator';
import {
  cosineSimilarity,
  scoreNodeRelevance,
  scoreNodesLexical,
  selectRelevantNodes,
  selectRelevantSituationNodes,
  buildRelevanceQuery,
} from './taxonomyRelevance';
import {
  generateId,
  nowISO,
  stripCodeFences,
  parseJsonRobust,
  extractArraysFromPartialJson,
  formatRecentTranscript,
  parsePoverResponse,
  getMoveName,
} from './helpers';
import { computeQbafStrengths, computeQbafConvergence } from './qbaf';
import { computeCoverageMap, computeStrengthWeightedCoverage } from './coverageTracker';
import { generateDialecticTraces } from './dialecticTrace';
import { computeTaxonomyGapAnalysis } from './taxonomyGapAnalysis';
import type { ContextManifestEntry } from './taxonomyGapAnalysis';
import { validateTurn, buildRepairPrompt, resolveTurnValidationConfig } from './turnValidator';
import type { TurnAttempt, TurnValidation, ModeratorState, ModeratorIntervention, SelectionResult, InterventionMove } from './types';
import { MOVE_TO_FAMILY, FAMILY_BURDEN_WEIGHT, MOVE_TO_FORCE } from './types';
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
} from './moderator';
import { runTurnPipeline, assemblePipelineResult, runOpeningPipeline, assembleOpeningPipelineResult } from './turnPipeline';
import type { TurnPipelineInput, OpeningPipelineInput } from './turnPipeline';

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
  /** Vocabulary terms for standardized term enforcement in persona prompts. */
  vocabulary?: {
    standardizedTerms: import('../dictionary/types').StandardizedTerm[];
    colloquialTerms: import('../dictionary/types').ColloquialTerm[];
  };
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
  /** Whether mid-debate gap injection has already fired. */
  private _gapInjectionDone = false;
  /** Accumulated context manifests across turns — for taxonomy gap analysis. */
  private _contextManifests: ContextManifestEntry[] = [];
  /** Lazy-built set of every taxonomy node id in the loaded taxonomy. */
  private _knownNodeIds: Set<string> | null = null;
  /** Lazy-built set of every policy id in the loaded policy registry. */
  private _policyIds: Set<string> | null = null;
  /** Active moderator state — tracks budget, cooldown, burden, and intervention history. */
  private _moderatorState: ModeratorState | null = null;

  private getKnownNodeIds(): Set<string> {
    if (this._knownNodeIds) return this._knownNodeIds;
    const s = new Set<string>();
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
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
      timeoutMs,
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
    const midpointRound = Math.min(3, Math.ceil(this.config.rounds / 2));
    for (let round = 1; round <= this.config.rounds; round++) {
      const phase = getDebatePhase(round, this.config.rounds);
      this.progress('debate', undefined, `Cross-respond round ${round}/${this.config.rounds} [${phase}]`, round);
      await this.runCrossRespondRound(round, phase);

      // Mid-debate gap injection — "fourth voice" analysis at the configured round
      const gapRound = this.config.gapInjectionRound ?? Math.ceil(this.config.rounds / 2) + 1;
      if (gapRound > 0 && round === gapRound && !this._gapInjectionDone) {
        await this.runGapInjection(round);
        this._gapInjectionDone = true;
      }

      // Neutral evaluator: midpoint checkpoint
      if (round === midpointRound && !this._midpointEvalDone) {
        await this.runNeutralCheckpoint('midpoint');
        this._midpointEvalDone = true;
      }

      // Probing questions every N rounds
      if (this.config.enableProbing && this.config.probingInterval &&
          round % this.config.probingInterval === 0 && round < this.config.rounds) {
        await this.runProbingQuestions(round);
      }

      // Context compression if transcript is getting long
      if (this.session.transcript.length >= 12) {
        await this.compressContext();
      }
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
  }

  // ── AI call wrapper ────────────────────────────────────────

  private async generate(prompt: string, label: string, timeoutMs?: number): Promise<string> {
    this.progress('generating', undefined, label);
    const start = Date.now();
    const text = await this.adapter.generateText(prompt, this.config.model, {
      temperature: this.config.temperature ?? 0.7,
      timeoutMs,
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
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
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
    const povFile = this.taxonomy[pov as keyof Pick<LoadedTaxonomy, 'accelerationist' | 'safetyist' | 'skeptic'>];
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

    const scoredPov = selectRelevantNodes(ctx.povNodes, scores, 0.45, 3, 35);
    const filteredSit = selectRelevantSituationNodes(ctx.situationNodes, scores, 0.45, 3, 15);
    const filteredCtx = {
      povNodes: scoredPov.map(s => s.node),
      situationNodes: filteredSit.map(s => s.node),
      policyRegistry: ctx.policyRegistry,
      nodeScores: scores,
    };
    this._lastInjectionManifest = computeInjectionManifest(filteredCtx, pov);
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

    const text = await this.generate(prompt, 'Clarification questions');
    let structuredQuestions: { question: string; options: string[] }[] = [];
    try {
      const parsed = parseJsonRobust(text) as any;
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
    const synthText = await this.generate(synthPrompt, 'Topic synthesis');

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = parseJsonRobust(synthText) as any;
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

    const text = await this.generate(prompt, 'Document analysis');

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
        this.validateSteelmans(newNodes2, poverId).catch(() => {});
        this.verifyPreciseClaims(newNodes2).catch(() => {});
      }

      // Post-turn summarization (DT-2)
      await this.summarizeEntry(entry);

      priorStatements.push({ speaker: info.label, statement });
    }

    this.session.phase = 'debate';
  }

  // ── Phase: Cross-respond round ─────────────────────────────

  private async runCrossRespondRound(round: number, phase: DebatePhase = 'exploration'): Promise<void> {
    const recentTranscript = formatRecentTranscript(this.session.transcript, 8, this.session.context_summaries);
    const activeLabels = this.config.activePovers.map(p => POVER_INFO[p].label);

    // Moderator selects responder
    const { text: edgeContext, edges_used: moderatorEdgesUsed } = this.formatModeratorEdgeContext();
    const an = this.session.argument_network;
    const anContext = (an && an.nodes.length > 0)
      ? formatArgumentNetworkContext(
          an.nodes.map(n => ({ id: n.id, text: n.text, speaker: POVER_INFO[n.speaker as Exclude<PoverId, 'user'>]?.label || n.speaker })),
          an.edges,
        )
      : '';

    // QBAF: surface strongest unaddressed claims for moderator prioritization
    let qbafContext = '';
    if (an && an.nodes.some(n => n.computed_strength != null)) {
      const addressed = new Set(an.edges.map(e => e.target));
      const unaddressed = an.nodes
        .filter(n => n.computed_strength != null && !addressed.has(n.id))
        .sort((a, b) => (b.computed_strength ?? 0) - (a.computed_strength ?? 0))
        .slice(0, 5);
      if (unaddressed.length > 0) {
        qbafContext = '\n\n=== STRONGEST UNADDRESSED CLAIMS (by QBAF strength) ===\nPrioritize these — they are well-supported but no one has responded to them yet.\nClaims marked [unscored] have default strength (0.5) — their actual strength is unknown pending human review.\nClaims marked [low-confidence] are Belief claims where AI scoring reliability is poor — weight them carefully.\n'
          + unaddressed.map(n => {
            const unscoredTag = n.scoring_method === 'default_pending' ? ' [unscored]' : '';
            const bdiTag = n.bdi_category ? ` ${n.bdi_category[0].toUpperCase()}` : '';
            const confTag = n.bdi_confidence != null && n.bdi_confidence < 0.5 ? ' [low-confidence]' : '';
            return `- ${n.id} (${POVER_INFO[n.speaker as Exclude<PoverId, 'user'>]?.label ?? n.speaker},${bdiTag}, strength ${n.computed_strength!.toFixed(2)}${unscoredTag}${confTag}): ${n.text}`;
          }).join('\n');
      }
    }

    // Find the most recent argumentation scheme for critical question injection
    const recentScheme = an?.edges
      .filter(e => e.argumentation_scheme && e.argumentation_scheme !== 'OTHER')
      .slice(-1)[0]?.argumentation_scheme;

    // Metaphor reframing: trigger when debate shows signs of stalling
    // Conditions: round >= 4 AND (last 3 responses all used CONCEDE+DISTINGUISH, OR convergence detected)
    let metaphorReframe: ReturnType<typeof selectReframingMetaphor> = null;
    if (round >= 4) {
      const last3Moves = this.session.transcript
        .filter(e => e.speaker !== 'system' && e.speaker !== 'user')
        .slice(-3)
        .flatMap(e => ((e.metadata as Record<string, unknown>)?.move_types as (string | import('./helpers').MoveAnnotation)[]) ?? [])
        .map(m => getMoveName(m));
      const concedeDist = last3Moves.filter(m => m === 'CONCEDE').length;
      const distinguishDist = last3Moves.filter(m => m === 'DISTINGUISH').length;
      const isStalling = (concedeDist >= 2 && distinguishDist >= 2) || last3Moves.length === 0;

      // Also check if moderator previously detected agreement
      const recentAgreement = this.session.transcript
        .filter(e => e.speaker === 'system')
        .some(e => e.content.includes('agreement'));

      if (isStalling || recentAgreement) {
        // Collect metaphor sources already used in this debate
        const usedSources = (an?.edges ?? [])
          .filter(e => e.argumentation_scheme === 'ARGUMENT_FROM_METAPHOR')
          .map(e => e.warrant ?? '')
          .filter(Boolean);
        metaphorReframe = selectReframingMetaphor(usedSources, round);
      }
    }

    // Unanswered claims ledger hint (every 3 rounds)
    const ledgerHint = formatUnansweredClaimsHint(this.session.unanswered_claims_ledger ?? [], round);

    // SPECIFY hint — detect isolated high-strength claims that need falsifiability probing
    const specifyHint = an ? formatSpecifyHint(an.nodes, an.edges) : '';

    // ── Active moderator: compute trigger context ──
    const modState = this._moderatorState!;
    modState.phase = phase;
    modState.round = round;

    // Compute turn counts for health score and trigger context
    const turnCounts: Record<string, number> = {};
    for (const p of this.config.activePovers) turnCounts[p] = 0;
    for (const e of this.session.transcript) {
      if (e.type === 'statement' && e.speaker !== 'system' && e.speaker !== 'moderator') {
        turnCounts[e.speaker] = (turnCounts[e.speaker] ?? 0) + 1;
      }
    }

    // Compute debate health score from recent convergence signals
    const recentSignals = (this.session.convergence_signals ?? []).slice(-3);
    const referencedIds = new Set<string>();
    for (const e of this.session.transcript.slice(-6)) {
      for (const ref of e.taxonomy_refs) referencedIds.add(ref.node_id);
    }
    const relevantNodeCount = Math.max(1, (this.taxonomy.accelerationist?.nodes?.length ?? 0) +
      (this.taxonomy.safetyist?.nodes?.length ?? 0) +
      (this.taxonomy.skeptic?.nodes?.length ?? 0));
    const healthScore = computeDebateHealthScore(recentSignals, turnCounts, referencedIds.size, relevantNodeCount);
    if (modState.health_history.length > 0) {
      const prev = modState.health_history[modState.health_history.length - 1];
      healthScore.trend = healthScore.value - prev.value;
    }
    healthScore.consecutive_decline = modState.consecutive_decline;
    modState.health_history.push(healthScore);
    updateSliBreaches(healthScore, modState);

    const triggerCtx = computeTriggerEvaluationContext(modState, turnCounts);
    const triggerCtxText = formatTriggerContext(triggerCtx);

    // ── Synthesis COMMIT automation ──
    // In synthesis phase, COMMIT fires automatically per-debater in first-appearance order,
    // bypassing Stage 1 LLM selection.
    const synthesisTarget = phase === 'synthesis'
      ? getSynthesisResponder(modState, this.config.activePovers, this.session.transcript)
      : null;

    let responder: Exclude<PoverId, 'user'> | null = null;
    let focusPoint = 'Continue the discussion';
    let addressing = 'general';
    let agreementDetected = false;
    let selectionResult: Partial<SelectionResult> = {};
    let activeIntervention: ModeratorIntervention | undefined;
    let selectionPrompt = '';
    let selectionText = '';
    let selectionElapsed = 0;

    if (synthesisTarget) {
      // Deterministic synthesis — skip Stage 1 LLM, fire COMMIT directly
      responder = synthesisTarget as Exclude<PoverId, 'user'>;
      focusPoint = 'Provide your final commitment: concessions, conditions for change, and sharpest remaining disagreements';
      addressing = 'all';
      selectionResult = {
        responder: synthesisTarget,
        addressing: 'general',
        focus_point: focusPoint,
        agreement_detected: false,
        intervene: true,
        suggested_move: 'COMMIT',
        target_debater: synthesisTarget,
        trigger_reasoning: 'Automatic COMMIT in synthesis phase',
      };

      const validation = validateRecommendation(selectionResult as SelectionResult, modState);
      if (validation.proceed) {
        try {
          const stage2Prompt = moderatorInterventionPrompt(
            validation.validated_move,
            validation.validated_family,
            POVER_INFO[validation.validated_target as Exclude<PoverId, 'user'>]?.label ?? validation.validated_target,
            'Automatic synthesis-phase COMMIT',
            undefined,
            formatRecentTranscript(this.session.transcript, 4, this.session.context_summaries),
            this.config.audience,
          );
          const stage2Text = await this.generate(stage2Prompt, `Round ${round}: Moderator COMMIT → ${POVER_INFO[synthesisTarget as Exclude<PoverId, 'user'>]?.label}`);

          const stage2Parsed = parseJsonRobust(stage2Text) as Record<string, unknown>;
          const interventionText = stage2Parsed.text as string;

          if (interventionText && interventionText.trim().length > 0) {
            activeIntervention = buildIntervention(
              validation,
              interventionText,
              'Automatic synthesis-phase COMMIT',
              { signal: 'synthesis_phase', round },
            );

            this.addEntry({
              type: 'intervention',
              speaker: 'moderator',
              content: interventionText,
              taxonomy_refs: [],
              addressing: validation.validated_target,
              intervention_metadata: {
                family: activeIntervention.family,
                move: activeIntervention.move,
                force: activeIntervention.force,
                burden: activeIntervention.burden,
                target_debater: activeIntervention.target_debater,
                trigger_reason: activeIntervention.trigger_reason,
                source_evidence: activeIntervention.source_evidence,
              },
            });

            this.progress('debate', undefined, `Moderator: COMMIT → ${POVER_INFO[synthesisTarget as Exclude<PoverId, 'user'>]?.label}`);
          }
        } catch (stage2Err) {
          this.warn('Moderator synthesis COMMIT generation', stage2Err, 'Proceeding without COMMIT intervention');
        }
      }
    } else {
      // ── Stage 1: Enhanced moderator selection (replaces crossRespondSelectionPrompt) ──
      selectionPrompt = moderatorSelectionPrompt(
        recentTranscript, activeLabels,
        edgeContext + anContext + qbafContext + ledgerHint + specifyHint,
        triggerCtxText,
        recentScheme, metaphorReframe, phase, this.config.audience,
      );
      const selectionStart = Date.now();
      selectionText = await this.generate(selectionPrompt, `Round ${round}: Moderator selection`);
      selectionElapsed = Date.now() - selectionStart;

      try {
        const parsed = parseJsonRobust(selectionText) as Record<string, unknown>;
        const labelMap: Record<string, Exclude<PoverId, 'user'>> = {
          prometheus: 'prometheus', sentinel: 'sentinel', cassandra: 'cassandra',
          Prometheus: 'prometheus', Sentinel: 'sentinel', Cassandra: 'cassandra',
        };
        responder = labelMap[String(parsed.responder ?? '').toLowerCase()] ?? null;
        focusPoint = (parsed.focus_point as string) ?? focusPoint;
        addressing = (parsed.addressing as string) ?? 'general';
        agreementDetected = !!parsed.agreement_detected;

        // Parse intervention recommendation
        selectionResult = {
          responder: responder ?? 'prometheus',
          addressing: (addressing as PoverId | 'general') ?? 'general',
          focus_point: focusPoint,
          agreement_detected: agreementDetected,
          intervene: !!parsed.intervene,
          suggested_move: parsed.suggested_move as InterventionMove | undefined,
          target_debater: labelMap[String(parsed.target_debater ?? '').toLowerCase()] ?? undefined,
          trigger_reasoning: parsed.trigger_reasoning as string | undefined,
          trigger_evidence: parsed.trigger_evidence as SelectionResult['trigger_evidence'] | undefined,
        };

        if (agreementDetected) {
          const agreeEntry = this.addEntry({
            type: 'system',
            speaker: 'system',
            content: `[Round ${round}] Moderator detected broad agreement. Focus: ${focusPoint}`,
            taxonomy_refs: [],
          });
          this.recordDiagnostic(agreeEntry.id, {
            prompt: selectionPrompt,
            raw_response: selectionText,
            model: this.config.model,
            response_time_ms: selectionElapsed,
          });
        }

        // ── Engine validation (deterministic) ──
        if (selectionResult.intervene && selectionResult.suggested_move && selectionResult.target_debater) {
          const validation = validateRecommendation(
            selectionResult as SelectionResult,
            modState,
          );

          if (validation.proceed) {
            // ── Stage 2: Generate intervention text ──
            try {
              const stage2Prompt = moderatorInterventionPrompt(
                validation.validated_move,
                validation.validated_family,
                POVER_INFO[validation.validated_target as Exclude<PoverId, 'user'>]?.label ?? validation.validated_target,
                selectionResult.trigger_reasoning ?? '',
                selectionResult.trigger_evidence?.source_claim,
                formatRecentTranscript(this.session.transcript, 4, this.session.context_summaries),
                this.config.audience,
              );
              const stage2Start = Date.now();
              const stage2Text = await this.generate(stage2Prompt, `Round ${round}: Moderator intervention (${validation.validated_move})`);
              const stage2Elapsed = Date.now() - stage2Start;

              const stage2Parsed = parseJsonRobust(stage2Text) as Record<string, unknown>;
              const interventionText = stage2Parsed.text as string;

              if (interventionText && interventionText.trim().length > 0) {
                activeIntervention = buildIntervention(
                  validation,
                  interventionText,
                  selectionResult.trigger_reasoning ?? 'Engine-validated intervention',
                  {
                    signal: selectionResult.trigger_evidence?.signal_name,
                    claim: selectionResult.trigger_evidence?.source_claim,
                    round: selectionResult.trigger_evidence?.source_round ?? undefined,
                  },
                  stage2Parsed.original_claim_text as string | undefined,
                );

                // Add visible moderator intervention to transcript
                this.addEntry({
                  type: 'intervention',
                  speaker: 'moderator',
                  content: interventionText,
                  taxonomy_refs: [],
                  addressing: validation.validated_target,
                  intervention_metadata: {
                    family: activeIntervention.family,
                    move: activeIntervention.move,
                    force: activeIntervention.force,
                    burden: activeIntervention.burden,
                    target_debater: activeIntervention.target_debater,
                    trigger_reason: activeIntervention.trigger_reason,
                    source_evidence: activeIntervention.source_evidence,
                    prerequisite_applied: activeIntervention.prerequisite_applied,
                    original_claim_text: activeIntervention.original_claim_text,
                  },
                });

                this.progress('debate', undefined, `Moderator: ${activeIntervention.move} → ${POVER_INFO[validation.validated_target as Exclude<PoverId, 'user'>]?.label}`);

                // REVOICE forces the original speaker as next responder
                if (validation.validated_move === 'REVOICE') {
                  responder = validation.validated_target as Exclude<PoverId, 'user'>;
                }
              }
            } catch (stage2Err) {
              this.warn('Moderator Stage 2 generation', stage2Err, 'Proceeding without intervention');
            }
          }
        }
      } catch (err) {
        this.warn('Parsing moderator selection', err, 'Falling back to least-recently-spoken debater');
      }
    }

    // Record moderator deliberation as a system entry with full diagnostics
    const modEntry = this.addEntry({
      type: 'system',
      speaker: 'system',
      content: `[Round ${round}] Moderator: ${POVER_INFO[responder ?? 'prometheus']?.label ?? responder} → ${addressing} on: ${focusPoint}${activeIntervention ? ` [${activeIntervention.move}]` : ''}`,
      taxonomy_refs: [],
      metadata: {
        moderator_trace: {
          selected: responder,
          focus_point: focusPoint,
          addressing,
          debate_phase: phase,
          agreement_detected: agreementDetected,
          recent_scheme: recentScheme ?? null,
          critical_questions: recentScheme ? (formatCriticalQuestions(recentScheme) || null) : null,
          metaphor_reframe_offered: metaphorReframe ? metaphorReframe.source : null,
          metaphor_reframe_used: false,
          intervention_recommended: selectionResult.intervene ?? false,
          intervention_move: activeIntervention?.move ?? null,
          intervention_validated: !!activeIntervention,
          health_score: healthScore.value,
          budget_remaining: modState.budget_remaining,
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
          edge_context_length: edgeContext.length,
          an_context_length: anContext.length,
          qbaf_context_length: qbafContext.length,
        },
      },
    });
    this.recordDiagnostic(modEntry.id, {
      prompt: selectionPrompt,
      raw_response: selectionText,
      model: this.config.model,
      response_time_ms: selectionElapsed,
      edges_used: moderatorEdgesUsed,
    });

    // Fallback: pick pover who spoke least recently
    if (!responder || !this.config.activePovers.includes(responder)) {
      const lastSpoke = new Map<string, number>();
      this.session.transcript.forEach((e, i) => { if (e.speaker !== 'user' && e.speaker !== 'system' && e.speaker !== 'moderator') lastSpoke.set(e.speaker, i); });
      responder = this.config.activePovers.reduce((best, p) =>
        (lastSpoke.get(p) ?? -1) < (lastSpoke.get(best) ?? -1) ? p : best,
      );
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
    const priorMoves = this.session.transcript
      .filter(e => e.speaker === responder && e.metadata)
      .flatMap(e => ((e.metadata as Record<string, unknown>)?.move_types as (string | import('./helpers').MoveAnnotation)[]) ?? [])
      .map(m => getMoveName(m))
      .slice(-6); // Last 3 turns × ~2 moves each

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
    const vConfig = resolveTurnValidationConfig(this.config.turnValidation);
    const attempts: TurnAttempt[] = [];

    let attemptIdx = 0;
    let pipelineResult = await runTurnPipeline(
      pipelineInput,
      stageGenerate,
      (_stage, label) => this.progress('generating', responder, label),
      envelopeGenerate,
    );
    const knownIds = this.getKnownNodeIds();
    let assembled = assemblePipelineResult(pipelineResult, knownIds);
    let { statement, taxonomyRefs, meta } = assembled;
    let validation: TurnValidation;

    const priorSameAgent = this.session.transcript
      .filter(e => e.speaker === responder && e.type !== 'opening')
      .slice(-2);
    const recentTurnsForJudge = this.session.transcript
      .filter(e => e.speaker !== 'system' && e.speaker !== 'user')
      .slice(-2);

    for (;;) {
      validation = await validateTurn({
        statement,
        taxonomyRefs,
        meta,
        phase,
        speaker: responder,
        round,
        priorTurns: priorSameAgent,
        recentTurns: recentTurnsForJudge,
        knownNodeIds: this.getKnownNodeIds(),
        policyIds: this.getPolicyIds(),
        audience: this.config.audience,
        config: vConfig,
        callJudge: (p, l) => this.generateWithModel(p, l, vConfig.judgeModel, 20000),
        callJudgeFallback: this.config.model !== vConfig.judgeModel
          ? (p, l) => this.generateWithModel(p, l, this.config.model, 20000)
          : undefined,
        pendingIntervention: activeIntervention,
      });

      const draftDiag = pipelineResult.stage_diagnostics.find(s => s.stage === 'draft');
      attempts.push({
        attempt: attemptIdx,
        model: this.config.model,
        prompt_delta: '',
        raw_response: draftDiag?.raw_response ?? '',
        response_time_ms: pipelineResult.total_time_ms,
        validation,
      });

      if (validation.outcome !== 'retry' || attemptIdx >= vConfig.maxRetries) break;

      attemptIdx += 1;
      pipelineResult = await runTurnPipeline(
        { ...pipelineInput, repairHints: validation.repairHints },
        stageGenerate,
        (_stage, label) => this.progress('generating', responder, label),
        envelopeGenerate,
      );
      assembled = assemblePipelineResult(pipelineResult, knownIds);
      ({ statement, taxonomyRefs, meta } = assembled);
    }

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

    // Extract claims
    const anNodesBefore = this.session.argument_network!.nodes.length;
    await this.extractClaims(statement, responder, entry.id, taxonomyRefs.map(r => r.node_id), meta.my_claims);
    const newNodes = this.session.argument_network!.nodes.slice(anNodesBefore);

    // Post-extraction interventions (non-blocking, fire and forget)
    if (newNodes.length > 0) {
      this.validateSteelmans(newNodes, responder).catch(() => {});
      this.verifyPreciseClaims(newNodes).catch(() => {});
    }

    // Position drift detection (non-blocking)
    this.trackPositionDrift(responder, statement, round).catch(() => {});

    // Post-turn summarization (DT-2) — fire and forget
    this.summarizeEntry(entry).catch(() => {});

    // ── Update active moderator state for next round ──
    const validationResult = activeIntervention
      ? { proceed: true, validated_move: activeIntervention.move, validated_family: activeIntervention.family, validated_target: activeIntervention.target_debater } as import('./types').EngineValidationResult
      : { proceed: false, validated_move: 'PIN' as InterventionMove, validated_family: 'elicitation' as import('./types').InterventionFamily, validated_target: responder } as import('./types').EngineValidationResult;
    updateModeratorState(modState, activeIntervention, validationResult, round, phase);
    this.session.moderator_state = modState;
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
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
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
    const text = await this.generate(prompt, 'Probing questions');

    let questions: { text: string; targets: string[] }[] = [];
    try {
      const parsed = parseJsonRobust(text) as any;
      questions = parsed.questions ?? [];
    } catch (err) {
      this.warn('Parsing probing questions', err, 'Skipping probing questions for this round');
    }

    if (questions.length > 0) {
      const content = questions.map((q, i) => {
        // Handle varying AI response shapes: {text, targets} or {question, options} or string
        const qText = typeof q === 'string' ? q
          : (q as any).text ?? (q as any).question ?? JSON.stringify(q);
        const targets = (q as any).targets ?? (q as any).options;
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
      console.warn(`Neutral evaluation (${checkpoint}) failed: ${errorMsg}`);
      return null;
    }
  }

  // ── Context compression ────────────────────────────────────

  private async compressContext(): Promise<void> {
    const keepRecent = 8;
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

    const entries = toCompress.map(e => {
      const label = e.speaker === 'user' ? 'Moderator'
        : POVER_INFO[e.speaker as Exclude<PoverId, 'user'>]?.label ?? e.speaker;
      return `${label}: ${e.content}`;
    }).join('\n\n');

    const prompt = contextCompressionPrompt(entries, this.config.audience);
    const text = await this.generate(prompt, 'Context compression');

    try {
      const parsed = parseJsonRobust(text) as any;
      if (parsed.summary) {
        this.session.context_summaries.push({
          up_to_entry_id: toCompress[toCompress.length - 1].id,
          summary: parsed.summary,
        });

        // Context-rot: transcript compression metrics
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
    this.progress('synthesis', undefined, 'Phase 1/3: Extracting agreements and disagreements');
    const extractText = await this.generate(
      synthExtractPrompt(this.session.topic.final, fullTranscript, this.config.audience),
      'Synthesis Phase 1: Extract', 60_000,
    );
    let extractData: Record<string, unknown> = {};
    try { extractData = parseJsonRobust(extractText) as any; }
    catch { extractData = extractArraysFromPartialJson(stripCodeFences(extractText)); }
    Object.assign(synthesisData, extractData);

    // Phase 2: Build argument map
    this.progress('synthesis', undefined, 'Phase 2/3: Building argument map');
    const disagreementsSummary = JSON.stringify(extractData.areas_of_disagreement ?? []);
    const mapText = await this.generate(
      synthMapPrompt(this.session.topic.final, fullTranscript, disagreementsSummary, hasSourceDoc, this.config.audience),
      'Synthesis Phase 2: Map', 60_000,
    );
    let mapData: Record<string, unknown> = {};
    try { mapData = parseJsonRobust(mapText) as any; }
    catch { mapData = extractArraysFromPartialJson(stripCodeFences(mapText)); }
    Object.assign(synthesisData, mapData);

    // Phase 3: Evaluate preferences + policy implications
    this.progress('synthesis', undefined, 'Phase 3/3: Evaluating preferences');
    const argMapSummary = JSON.stringify(mapData.argument_map ?? []);
    const evalText = await this.generate(
      synthEvaluatePrompt(this.session.topic.final, disagreementsSummary, argMapSummary, policyContext, this.config.audience),
      'Synthesis Phase 3: Evaluate', 60_000,
    );
    let evalData: Record<string, unknown> = {};
    try { evalData = parseJsonRobust(evalText) as any; }
    catch { evalData = extractArraysFromPartialJson(stripCodeFences(evalText)); }
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
        const povers = a.povers.map(p => POVER_INFO[p as Exclude<PoverId, 'user'>]?.label ?? p).join(', ');
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
      for (const povKey of ['accelerationist', 'safetyist', 'skeptic'] as const) {
        const povData = this.taxonomy[povKey];
        if (!povData?.nodes) continue;
        for (const node of povData.nodes) {
          const cat = (node as any).category ?? 'unknown';
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

      const text = await this.generate(prompt, 'Missing arguments pass');
      const parsed = parseJsonRobust(text) as any;
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
      for (const povKey of ['accelerationist', 'safetyist', 'skeptic'] as const) {
        const povData = this.taxonomy[povKey];
        if (!povData?.nodes) continue;
        for (const node of povData.nodes) {
          if (refIds.has(node.id)) {
            referencedNodes.push({
              id: node.id,
              label: node.label,
              pov: povKey,
              category: (node as any).category ?? 'unknown',
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

      const text = await this.generate(prompt, 'Taxonomy refinement pass');
      const parsed = parseJsonRobust(text) as any;
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
  private async runGapInjection(round: number): Promise<void> {
    try {
      this.progress('gap-injection', undefined, 'Analyzing debate gaps');

      const transcriptText = formatRecentTranscript(this.session.transcript, 20, this.session.context_summaries);

      // Build compact taxonomy summary (same format as missing arguments pass)
      const summaryLines: string[] = [];
      for (const povKey of ['accelerationist', 'safetyist', 'skeptic'] as const) {
        const povData = this.taxonomy[povKey];
        if (!povData?.nodes) continue;
        for (const node of povData.nodes) {
          const cat = (node as any).category ?? 'unknown';
          summaryLines.push(`[${node.id}] ${node.label} (${cat}) — ${povKey}`);
        }
      }
      const taxSummary = summaryLines.slice(0, 80).join('\n');

      const anTexts = (this.session.argument_network?.nodes || []).map(n => n.text);
      const gapPrompt = midDebateGapPrompt(this.session.topic.final, transcriptText, taxSummary, anTexts);

      const gapResult = await this.adapter.generateText(gapPrompt, this.config.model, {
        temperature: 0.5,
        timeoutMs: 30_000,
      });
      this.apiCallCount++;

      const parsed = parseJsonRobust(gapResult) as any;
      const gapArgs: GapArgument[] = parsed?.gap_arguments ?? [];

      if (gapArgs.length > 0) {
        const gapContent = gapArgs.map((g: GapArgument, i: number) =>
          `**Gap ${i + 1} (${g.gap_type}):** ${g.argument}\n*Why missing:* ${g.why_missing}`,
        ).join('\n\n');

        const entry = this.addEntry({
          type: 'system',
          speaker: 'system',
          content: `## Mid-Debate Gap Analysis\n\n${gapContent}`,
          taxonomy_refs: [],
        });

        this.recordDiagnostic(entry.id, {
          prompt: gapPrompt,
          raw_response: gapResult,
          model: this.config.model,
        });

        this.session.gap_injections = [{
          round,
          arguments: gapArgs,
          transcript_entry_id: entry.id,
          responses: [],
        }];
      }
    } catch (err) {
      this.warn('Mid-debate gap injection', err, 'Non-critical — debate continues without gap analysis');
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

      const sitLabels = (this.taxonomy.situations?.nodes || []).map((n: any) => n.label);
      const ccPrompt = crossCuttingNodePrompt(agreements, sitLabels, this.session.topic.final);

      const ccResult = await this.adapter.generateText(ccPrompt, this.config.model, {
        temperature: 0.3,
        timeoutMs: 30_000,
      });
      this.apiCallCount++;

      const ccParsed = parseJsonRobust(ccResult) as any;
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
      for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
        taxonomyNodes[pov] = (this.taxonomy[pov]?.nodes || []).map((n: any) => ({
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
    const adapter = this.adapter as any;
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
        const maxEntailment = Math.max(...result.results.map((r: any) => r.nli_entailment ?? 0));

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
    const adapter = this.adapter as any;
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
        const parsed = parseJsonRobust(result.text) as any;

        if (parsed.verdict) {
          node.verification_status = parsed.verdict;
          node.verification_evidence = parsed.evidence;

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
      model: this.session.debate_model ?? '',
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
      extraction_prompt_version: debaterClaims && debaterClaims.length > 0 ? 'classify-v1' : 'extract-v1',
    };

    let text: string;
    const extractStart = Date.now();
    try {
      text = await this.generate(prompt, 'Claim extraction');
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
      const parsed = parseJsonRobust(text) as any;
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
  }
}
