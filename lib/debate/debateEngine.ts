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
} from './types';
import { POVER_INFO, getDebatePhase } from './types';
import type { PovNode, SituationNode } from './taxonomyTypes';
import type { TaxonomyContext } from './taxonomyContext';
import {
  clarificationPrompt,
  documentClarificationPrompt,
  situationClarificationPrompt,
  synthesisPrompt,
  openingStatementPrompt,
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
} from './prompts';
import { extractClaimsPrompt, classifyClaimsPrompt, formatArgumentNetworkContext, formatCommitments, formatEstablishedPoints, updateUnansweredLedger, formatUnansweredClaimsHint, formatSpecifyHint, formatConcessionCandidatesHint } from './argumentNetwork';
import { formatTaxonomyContext, computeInjectionManifest } from './taxonomyContext';
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
} from './helpers';
import { computeQbafStrengths, computeQbafConvergence } from './qbaf';
import { computeCoverageMap } from './coverageTracker';
import { generateDialecticTraces } from './dialecticTrace';
import { validateTurn, buildRepairPrompt, resolveTurnValidationConfig } from './turnValidator';
import type { TurnAttempt, TurnValidation } from './types';

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
  /** Lazy-built set of every taxonomy node id in the loaded taxonomy. */
  private _knownNodeIds: Set<string> | null = null;
  /** Lazy-built set of every policy id in the loaded policy registry. */
  private _policyIds: Set<string> | null = null;

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

    // Finalize
    this.session.updated_at = nowISO();
    this.session.diagnostics!.overview.total_ai_calls = this.apiCallCount;
    this.session.diagnostics!.overview.total_response_time_ms = this.totalResponseTimeMs;

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

  private formatDebaterEdgeContext(debaterPov: string): string {
    if (!this.taxonomy.edges?.edges) return '';

    const povPrefixes: Record<string, string> = {
      accelerationist: 'acc-', safetyist: 'saf-', skeptic: 'skp-',
    };
    const myPrefix = povPrefixes[debaterPov];
    if (!myPrefix) return '';

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

    if (relevantEdges.length === 0) return '';

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
    return lines.join('\n');
  }

  private formatModeratorEdgeContext(): string {
    if (!this.taxonomy.edges?.edges) return '';

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

    if (relevantEdges.length === 0) return '';

    const top = relevantEdges.sort((a, b) => b.confidence - a.confidence).slice(0, 15);
    const lines = ['', '=== KNOWN TENSIONS BETWEEN POSITIONS ==='];
    for (const e of top) {
      lines.push(`${e.source} ${e.type} ${e.target} (confidence: ${e.confidence.toFixed(2)})`);
    }
    return lines.join('\n');
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
      prompt = documentClarificationPrompt(this.config.topic, this.config.sourceContent ?? '');
    } else if (this.config.sourceType === 'situations') {
      prompt = situationClarificationPrompt(this.config.topic, this.config.sourceContent ?? '');
    } else {
      prompt = clarificationPrompt(this.config.topic, this.config.sourceContent);
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
    const synthPrompt = synthesisPrompt(this.config.topic, qaPairs);
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
    const prompt = documentAnalysisPrompt(
      this.config.sourceContent ?? '',
      this.session.topic.final,
      activePovers,
      taxonomySample,
    );

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

    for (const poverId of order) {
      const info = POVER_INFO[poverId];
      this.progress('opening', poverId, `${info.label} preparing opening statement`);

      const taxonomyContext = await this.getRelevantTaxonomyContext(info.pov);
      const commitmentContext = this.getCommitmentContext(poverId);
      const establishedPoints = this.getEstablishedPointsContext(poverId);
      const edgeContext = this.formatDebaterEdgeContext(info.pov);

      let priorBlock = '';
      if (priorStatements.length > 0) {
        priorBlock = '\n\n=== PRIOR OPENING STATEMENTS ===\n';
        for (const ps of priorStatements) {
          priorBlock += `\n${ps.speaker}:\n${ps.statement}\n`;
        }
      }

      const fullContext = taxonomyContext + commitmentContext + establishedPoints + edgeContext;
      const prompt = openingStatementPrompt(
        info.label, info.pov, info.personality,
        this.session.topic.final, fullContext, priorBlock,
        priorStatements.length === 0,
        this.session.document_analysis ? undefined : this.config.sourceContent,
        this.config.responseLength,
        this.session.document_analysis,
      );

      const start = Date.now();
      const text = await this.generate(prompt, `${info.label} opening statement`);
      const elapsed = Date.now() - start;

      const { statement, taxonomyRefs, meta } = parsePoverResponse(text);

      const entry = this.addEntry({
        type: 'opening',
        speaker: poverId,
        content: statement,
        taxonomy_refs: taxonomyRefs,
        policy_refs: meta.policy_refs,
        metadata: {
          move_types: meta.move_types,
          key_assumptions: meta.key_assumptions,
          my_claims: meta.my_claims,
          injection_manifest: this._lastInjectionManifest ?? undefined,
        },
      });

      this.recordDiagnostic(entry.id, {
        prompt,
        raw_response: text,
        model: this.config.model,
        response_time_ms: elapsed,
        taxonomy_context: taxonomyContext,
        commitment_context: commitmentContext,
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
    const edgeContext = this.formatModeratorEdgeContext();
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
        qbafContext = '\n\n=== STRONGEST UNADDRESSED CLAIMS (by QBAF strength) ===\nPrioritize these — they are well-supported but no one has responded to them yet.\nClaims marked [unscored] have default strength (0.5) — their actual strength is unknown pending human review.\n'
          + unaddressed.map(n => {
            const unscoredTag = n.scoring_method === 'default_pending' ? ' [unscored]' : '';
            return `- ${n.id} (${POVER_INFO[n.speaker as Exclude<PoverId, 'user'>]?.label ?? n.speaker}, strength ${n.computed_strength!.toFixed(2)}${unscoredTag}): ${n.text}`;
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
        .flatMap(e => ((e.metadata as Record<string, unknown>)?.move_types as string[]) ?? []);
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

    const selectionPrompt = crossRespondSelectionPrompt(recentTranscript, activeLabels, edgeContext + anContext + qbafContext + ledgerHint + specifyHint, recentScheme, metaphorReframe, phase);
    const selectionStart = Date.now();
    const selectionText = await this.generate(selectionPrompt, `Round ${round}: Selecting responder`);
    const selectionElapsed = Date.now() - selectionStart;

    let responder: Exclude<PoverId, 'user'> | null = null;
    let focusPoint = 'Continue the discussion';
    let addressing = 'general';
    let agreementDetected = false;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = parseJsonRobust(selectionText) as any;
      // Map label back to PoverId
      const labelMap: Record<string, Exclude<PoverId, 'user'>> = {
        prometheus: 'prometheus', sentinel: 'sentinel', cassandra: 'cassandra',
        Prometheus: 'prometheus', Sentinel: 'sentinel', Cassandra: 'cassandra',
      };
      responder = labelMap[String(parsed.responder ?? '').toLowerCase()] ?? null;
      focusPoint = parsed.focus_point ?? focusPoint;
      addressing = parsed.addressing ?? 'general';
      agreementDetected = !!parsed.agreement_detected;

      if (agreementDetected) {
        this.addEntry({
          type: 'system',
          speaker: 'system',
          content: `[Round ${round}] Moderator detected broad agreement. Focus: ${focusPoint}`,
          taxonomy_refs: [],
        });
      }
    } catch (err) {
      this.warn('Parsing moderator responder selection', err, 'Falling back to least-recently-spoken debater');
    }

    // Record moderator deliberation as a system entry with full diagnostics
    const modEntry = this.addEntry({
      type: 'system',
      speaker: 'system',
      content: `[Round ${round}] Moderator: ${POVER_INFO[responder ?? 'prometheus']?.label ?? responder} → ${addressing} on: ${focusPoint}`,
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
          metaphor_reframe_used: false, // will be updated from parsed response below
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
    });

    // Fallback: pick pover who spoke least recently
    if (!responder || !this.config.activePovers.includes(responder)) {
      const lastSpoke = new Map<string, number>();
      this.session.transcript.forEach((e, i) => { if (e.speaker !== 'user' && e.speaker !== 'system') lastSpoke.set(e.speaker, i); });
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
    const debaterEdgeContext = this.formatDebaterEdgeContext(info.pov);

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
      .flatMap(e => ((e.metadata as Record<string, unknown>)?.move_types as string[]) ?? [])
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

    const prompt = crossRespondPrompt(
      info.label, info.pov, info.personality,
      this.session.topic.final,
      taxonomyContext + commitmentContext + establishedPoints + debaterEdgeContext + concessionHint,
      updatedTranscript, focusPoint, addressing,
      this.config.responseLength,
      this.session.document_analysis ? undefined : this.config.sourceContent,
      this.session.document_analysis,
      priorMoves,
      phase,
      priorRefs,
      availablePovNodeIds,
      priorFlaggedHints,
      crossPovNodeIds,
    );

    // ── Cross-respond with per-turn validation + retry loop ──
    const vConfig = resolveTurnValidationConfig(this.config.turnValidation);
    const attempts: TurnAttempt[] = [];

    let attemptPrompt = prompt;
    let attemptIdx = 0;
    let turnStart = Date.now();
    let text = await this.generate(attemptPrompt, `${info.label} cross-respond`);
    let elapsed = Date.now() - turnStart;
    let parsed = parsePoverResponse(text);
    let statement = parsed.statement;
    let taxonomyRefs = parsed.taxonomyRefs;
    let meta = parsed.meta;
    let validation: TurnValidation;
    let totalElapsed = elapsed;

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
        config: vConfig,
        callJudge: (p, l) => this.generateWithModel(p, l, vConfig.judgeModel, 20000),
        callJudgeFallback: this.config.model !== vConfig.judgeModel
          ? (p, l) => this.generateWithModel(p, l, this.config.model, 20000)
          : undefined,
      });

      attempts.push({
        attempt: attemptIdx,
        model: this.config.model,
        prompt_delta: attemptIdx === 0 ? '' : attemptPrompt.slice(prompt.length),
        raw_response: text,
        response_time_ms: elapsed,
        validation,
      });

      if (validation.outcome !== 'retry' || attemptIdx >= vConfig.maxRetries) break;

      attemptIdx += 1;
      attemptPrompt = buildRepairPrompt(prompt, validation, attemptIdx);
      turnStart = Date.now();
      text = await this.generate(attemptPrompt, `${info.label} cross-respond (retry ${attemptIdx})`);
      elapsed = Date.now() - turnStart;
      totalElapsed += elapsed;
      parsed = parsePoverResponse(text);
      statement = parsed.statement;
      taxonomyRefs = parsed.taxonomyRefs;
      meta = parsed.meta;
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

    this.session.turn_validations ||= {};
    this.session.turn_validations[entry.id] = { attempts, final: validation };

    if (validation.clarifies_taxonomy.length > 0) {
      this.routeTurnValidatorHints(validation, entry.id);
    }

    this.recordDiagnostic(entry.id, {
      prompt: attemptPrompt,
      raw_response: text,
      model: this.config.model,
      response_time_ms: totalElapsed,
      taxonomy_context: taxonomyContext,
      commitment_context: commitmentContext,
    });

    // Track move types and disagreement types
    if (meta.move_types) {
      for (const m of meta.move_types) {
        this.session.diagnostics!.overview.move_type_counts[m] = (this.session.diagnostics!.overview.move_type_counts[m] ?? 0) + 1;
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

    // CT-4: Compute uncovered document claims to steer probing questions toward gaps
    let uncoveredClaims: string[] | undefined;
    if (this.session.document_analysis?.i_nodes?.length) {
      const anNodes = this.session.argument_network?.nodes ?? [];
      if (anNodes.length > 0) {
        try {
          const documentClaims = this.session.document_analysis.i_nodes.map(n => ({ id: n.id, text: n.text }));
          const coverageMap = computeCoverageMap(anNodes, documentClaims);
          uncoveredClaims = coverageMap.coverage
            .filter(c => c.status === 'uncovered')
            .map(c => {
              const text = documentClaims.find(dc => dc.id === c.claimId)?.text ?? c.claimId;
              return `[${c.claimId}] ${text}`;
            })
            .slice(0, 10); // Cap at 10 to avoid prompt bloat
        } catch {
          // Coverage computation failed — proceed without uncovered claims
        }
      }
    }

    const prompt = probingQuestionsPrompt(this.session.topic.final, transcript, unreferencedNodes, hasSourceDoc, uncoveredClaims);
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

    const prompt = contextCompressionPrompt(entries);
    const text = await this.generate(prompt, 'Context compression');

    try {
      const parsed = parseJsonRobust(text) as any;
      if (parsed.summary) {
        this.session.context_summaries.push({
          up_to_entry_id: toCompress[toCompress.length - 1].id,
          summary: parsed.summary,
        });
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
      synthExtractPrompt(this.session.topic.final, fullTranscript),
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
      synthMapPrompt(this.session.topic.final, fullTranscript, disagreementsSummary, hasSourceDoc),
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
      synthEvaluatePrompt(this.session.topic.final, disagreementsSummary, argMapSummary, policyContext),
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

    this.session.transcript.push({
      id: generateId(),
      timestamp: nowISO(),
      type: 'system',
      speaker: 'system',
      content: `[Sycophancy guard] ${speakerLabel} appears to be drifting toward ${opponentLabel}'s position over the last 3 turns without explicit concession. Self-similarity: ${recent.map(d => d.self_similarity.toFixed(2)).join(' → ')}. Consider whether this represents genuine agreement or accommodation.`,
      taxonomy_refs: [],
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

          this.session.transcript.push({
            id: generateId(),
            timestamp: nowISO(),
            type: 'system',
            speaker: 'system',
            content: `[Steelman check] ${speakerLabel}'s steelman of ${targetLabel}'s position (max entailment: ${maxEntailment.toFixed(2)}) diverges from their actual assertions. ${targetLabel} actually asserted: ${topAssertions}`,
            taxonomy_refs: [],
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

  /** Word-overlap (Jaccard-ish) between two texts, using words >3 chars. */
  private wordOverlap(a: string, b: string): number {
    const wa = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const wb = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    if (wa.size === 0) return 0;
    return [...wa].filter(w => wb.has(w)).length / wa.size;
  }

  /** Best word-overlap of a candidate claim against existing AN node texts. */
  private maxOverlapVsExisting(claimText: string, nodes: ArgumentNetworkNode[]): number {
    let max = 0;
    for (const n of nodes) {
      const o = this.wordOverlap(claimText, n.text);
      if (o > max) max = o;
    }
    return max;
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
      this.session.transcript.push({
        id: `S-${this.session.transcript.length + 1}`,
        timestamp: new Date().toISOString(),
        type: 'system',
        speaker: 'system',
        content:
          `[Extraction plateau] No new AN nodes since ${lastId} (turn ${plateauStartedAt}). ` +
          `Reason cluster: ${reasonCluster}. See Diagnostics → Extraction Timeline.`,
        taxonomy_refs: [],
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

    let claims: { text: string; bdi_category?: string; base_strength?: number; specificity?: string; steelman_of?: string | null; responds_to?: { prior_claim_id: string; relationship: string; attack_type?: string; scheme?: string; argumentation_scheme?: string; warrant?: string }[] }[] = [];
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

    const accepted: { text: string; id: string; overlap_pct: number }[] = [];
    const rejected: { text: string; reason: string; overlap_pct: number }[] = [];

    // Debater-provided claims (classifyClaimsPrompt path) are already grounded
    // in the statement, so use a lower overlap threshold.
    const overlapThreshold = (debaterClaims && debaterClaims.length > 0) ? 0.1 : 0.15;

    for (const claim of claims.slice(0, 6)) {
      if (!claim.text || claim.text.length < 10) {
        if (claim.text) {
          rejected.push({ text: claim.text, reason: 'too_short', overlap_pct: 0 });
          trace.rejection_reasons['too_short'] = (trace.rejection_reasons['too_short'] ?? 0) + 1;
        }
        continue;
      }

      // Validate word overlap
      const overlap = this.wordOverlap(claim.text, statement);

      // Track overlap vs. existing AN nodes — catches "saturated network" failure mode.
      const overlapVsExisting = this.maxOverlapVsExisting(claim.text, an.nodes);
      if (overlapVsExisting > trace.max_overlap_vs_existing) {
        trace.max_overlap_vs_existing = overlapVsExisting;
      }

      if (overlap < overlapThreshold) {
        const pct = Math.round(overlap * 100);
        rejected.push({ text: claim.text, reason: 'low_overlap', overlap_pct: pct });
        trace.rejection_reasons['low_overlap'] = (trace.rejection_reasons['low_overlap'] ?? 0) + 1;
        trace.rejected_overlap_pcts.push(pct);
        continue;
      }

      const nodeId = `AN-${an.nodes.length + 1}`;
      accepted.push({ text: claim.text, id: nodeId, overlap_pct: Math.round(overlap * 100) });

      an.nodes.push({
        id: nodeId,
        text: claim.text,
        speaker,
        source_entry_id: entryId,
        taxonomy_refs: taxonomyRefIds,
        turn_number: turnNumber,
        base_strength: typeof claim.base_strength === 'number' ? claim.base_strength : 0.5,
        scoring_method: typeof claim.base_strength === 'number'
          ? 'ai_rubric'
          : (claim.bdi_category === 'belief' ? 'default_pending' : 'ai_rubric'),
        bdi_category: claim.bdi_category as ArgumentNetworkNode['bdi_category'],
        specificity: claim.specificity as ArgumentNetworkNode['specificity'],
        steelman_of: claim.steelman_of || undefined,
      });

      // Track commitment
      this.session.commitments![speaker].asserted.push(claim.text);

      // Process relationships
      for (const rel of claim.responds_to ?? []) {
        if (!rel.prior_claim_id || !an.nodes.some(n => n.id === rel.prior_claim_id)) continue;

        const edgeId = `AE-${an.edges.length + 1}`;
        an.edges.push({
          id: edgeId,
          source: nodeId,
          target: rel.prior_claim_id,
          type: rel.relationship === 'attacks' ? 'attacks' : 'supports',
          attack_type: rel.attack_type as 'rebut' | 'undercut' | 'undermine' | undefined,
          scheme: rel.scheme as ArgumentNetworkEdge['scheme'],
          warrant: rel.warrant,
          argumentation_scheme: rel.argumentation_scheme as ArgumentNetworkEdge['argumentation_scheme'],
        });

        // Track concessions and challenges
        if (rel.scheme === 'CONCEDE') {
          const targetNode = an.nodes.find(n => n.id === rel.prior_claim_id);
          if (targetNode) this.session.commitments![speaker].conceded.push(targetNode.text);
        } else if (rel.relationship === 'attacks') {
          const targetNode = an.nodes.find(n => n.id === rel.prior_claim_id);
          if (targetNode) this.session.commitments![speaker].challenged.push(targetNode.text);
        }
      }
    }

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
      for (const node of an.nodes) {
        if (node.computed_strength != null) strengths[node.id] = node.computed_strength;
      }
      this.session.qbaf_timeline.push({ turn: turnNumber, strengths });

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
