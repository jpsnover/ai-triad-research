// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Pure debate orchestration engine — no UI, Zustand, or Electron dependencies.
 * Runs a full structured debate using the AIAdapter interface.
 */

import type { AIAdapter } from './aiAdapter';
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
} from './types';
import { POVER_INFO } from './types';
import type { PovNode, SituationNode } from './taxonomyTypes';
import type { TaxonomyContext } from './taxonomyContext';
import {
  clarificationPrompt,
  documentClarificationPrompt,
  situationClarificationPrompt,
  synthesisPrompt,
  openingStatementPrompt,
  crossRespondSelectionPrompt,
  crossRespondPrompt,
  debateSynthesisPrompt,
  synthExtractPrompt,
  synthMapPrompt,
  synthEvaluatePrompt,
  probingQuestionsPrompt,
  contextCompressionPrompt,
} from './prompts';
import { extractClaimsPrompt, classifyClaimsPrompt, formatArgumentNetworkContext, formatCommitments, formatEstablishedPoints } from './argumentNetwork';
import { formatTaxonomyContext } from './taxonomyContext';
import { documentAnalysisPrompt, buildTaxonomySample } from './documentAnalysis';
import type { DocumentAnalysis } from './types';
import {
  scoreNodeRelevance,
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

  constructor(config: DebateConfig, adapter: AIAdapter, taxonomy: LoadedTaxonomy) {
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

    // Phase 3: Cross-respond rounds
    for (let round = 1; round <= this.config.rounds; round++) {
      this.progress('debate', undefined, `Cross-respond round ${round}/${this.config.rounds}`, round);
      await this.runCrossRespondRound(round);

      // Probing questions every N rounds
      if (this.config.enableProbing && this.config.probingInterval &&
          round % this.config.probingInterval === 0 && round < this.config.rounds) {
        await this.runProbingQuestions();
      }

      // Context compression if transcript is getting long
      if (this.session.transcript.length >= 12) {
        await this.compressContext();
      }
    }

    // Phase 4: Synthesis
    await this.runSynthesis();

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
      temperature: this.config.temperature ?? 0.5,
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

  private addEntry(entry: Omit<TranscriptEntry, 'id' | 'timestamp'>): TranscriptEntry {
    const full: TranscriptEntry = { id: generateId(), timestamp: nowISO(), ...entry };
    this.session.transcript.push(full);
    return full;
  }

  private recordDiagnostic(entryId: string, data: Partial<EntryDiagnostics>): void {
    const diag = this.session.diagnostics!;
    diag.entries[entryId] = { ...diag.entries[entryId], ...data };
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

  private getRelevantTaxonomyContext(pov: string): string {
    const ctx = this.getTaxonomyContext(pov);

    // Try relevance filtering with pre-computed embeddings
    const hasEmbeddings = Object.keys(this.taxonomy.embeddings).length > 0;
    if (hasEmbeddings) {
      const recentTranscript = formatRecentTranscript(this.session.transcript, 8, this.session.context_summaries);
      const query = buildRelevanceQuery(this.session.topic.final, recentTranscript);

      // Build pseudo-query vector by averaging node vectors whose text overlaps with the query
      const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const matchingVectors: number[][] = [];
      for (const [, entry] of Object.entries(this.taxonomy.embeddings)) {
        if (matchingVectors.length >= 5) break;
        // We don't have node text here easily, so use all embeddings for the POV
        if (entry.vector?.length > 0) matchingVectors.push(entry.vector);
      }

      // If we have embeddings, try to filter — otherwise fall through to unfiltered
      if (matchingVectors.length > 0) {
        const scores = scoreNodeRelevance(matchingVectors[0], this.taxonomy.embeddings);
        const scoredPov = selectRelevantNodes(ctx.povNodes, scores, 0.3, 3);
        const filteredSit = selectRelevantSituationNodes(ctx.situationNodes, scores, 0.3, 3);
        return formatTaxonomyContext({
          povNodes: scoredPov.map(s => s.node),
          situationNodes: filteredSit,
          policyRegistry: ctx.policyRegistry,
          nodeScores: scores,
        }, pov);
      }
    }

    // Fallback: unfiltered, top 21 POV + 10 CC
    return formatTaxonomyContext({
      povNodes: ctx.povNodes.slice(0, 21),
      situationNodes: ctx.situationNodes.slice(0, 10),
      policyRegistry: ctx.policyRegistry,
    }, pov);
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

      const taxonomyContext = this.getRelevantTaxonomyContext(info.pov);
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
      await this.extractClaims(statement, poverId, entry.id, taxonomyRefs.map(r => r.node_id), meta.my_claims);

      priorStatements.push({ speaker: info.label, statement });
    }

    this.session.phase = 'debate';
  }

  // ── Phase: Cross-respond round ─────────────────────────────

  private async runCrossRespondRound(round: number): Promise<void> {
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
        qbafContext = '\n\n=== STRONGEST UNADDRESSED CLAIMS (by QBAF strength) ===\nPrioritize these — they are well-supported but no one has responded to them yet.\n'
          + unaddressed.map(n => `- ${n.id} (${POVER_INFO[n.speaker as Exclude<PoverId, 'user'>]?.label ?? n.speaker}, strength ${n.computed_strength!.toFixed(2)}): ${n.text}`).join('\n');
      }
    }

    const selectionPrompt = crossRespondSelectionPrompt(recentTranscript, activeLabels, edgeContext + anContext + qbafContext);
    const selectionText = await this.generate(selectionPrompt, `Round ${round}: Selecting responder`);

    let responder: Exclude<PoverId, 'user'> | null = null;
    let focusPoint = 'Continue the discussion';
    let addressing = 'general';

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

      if (parsed.agreement_detected) {
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

    const taxonomyContext = this.getRelevantTaxonomyContext(info.pov);
    const commitmentContext = this.getCommitmentContext(responder);
    const establishedPoints = this.getEstablishedPointsContext(responder);
    const debaterEdgeContext = this.formatDebaterEdgeContext(info.pov);
    const updatedTranscript = formatRecentTranscript(this.session.transcript, 8, this.session.context_summaries);

    // Collect this debater's prior move_types for diversity enforcement
    const priorMoves = this.session.transcript
      .filter(e => e.speaker === responder && e.metadata)
      .flatMap(e => ((e.metadata as Record<string, unknown>)?.move_types as string[]) ?? [])
      .slice(-6); // Last 3 turns × ~2 moves each

    const prompt = crossRespondPrompt(
      info.label, info.pov, info.personality,
      this.session.topic.final,
      taxonomyContext + commitmentContext + establishedPoints + debaterEdgeContext,
      updatedTranscript, focusPoint, addressing,
      this.config.responseLength,
      this.session.document_analysis ? undefined : this.config.sourceContent,
      this.session.document_analysis,
      priorMoves,
    );

    const start = Date.now();
    const text = await this.generate(prompt, `${info.label} cross-respond`);
    const elapsed = Date.now() - start;

    const { statement, taxonomyRefs, meta } = parsePoverResponse(text);

    const entry = this.addEntry({
      type: 'statement',
      speaker: responder,
      content: statement,
      taxonomy_refs: taxonomyRefs,
      policy_refs: meta.policy_refs,
      addressing: addressing as PoverId | 'all',
      metadata: {
        cross_respond: true,
        focus_point: focusPoint,
        addressing_label: addressing,
        move_types: meta.move_types,
        disagreement_type: meta.disagreement_type,
        my_claims: meta.my_claims,
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
    await this.extractClaims(statement, responder, entry.id, taxonomyRefs.map(r => r.node_id), meta.my_claims);
  }

  // ── Probing questions ──────────────────────────────────────

  private async runProbingQuestions(): Promise<void> {
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
    const prompt = probingQuestionsPrompt(this.session.topic.final, transcript, unreferencedNodes, hasSourceDoc);
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
        metadata: { questions },
      });
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

  // ── Claim extraction ───────────────────────────────────────

  private async extractClaims(
    statement: string,
    speaker: Exclude<PoverId, 'user'>,
    entryId: string,
    taxonomyRefIds: string[],
    debaterClaims?: { claim: string; targets: string[] }[],
  ): Promise<void> {
    const an = this.session.argument_network!;
    const priorClaims = an.nodes.map(n => ({
      id: n.id,
      text: n.text,
      speaker: POVER_INFO[n.speaker as Exclude<PoverId, 'user'>]?.label ?? n.speaker,
    }));

    let prompt: string;
    if (debaterClaims && debaterClaims.length > 0) {
      prompt = classifyClaimsPrompt(statement, POVER_INFO[speaker].label, debaterClaims, priorClaims);
    } else {
      prompt = extractClaimsPrompt(statement, POVER_INFO[speaker].label, priorClaims);
    }

    let text: string;
    try {
      text = await this.generate(prompt, 'Claim extraction');
    } catch (err) {
      this.warn(`Claim extraction for ${POVER_INFO[speaker].label}`, err, 'Skipping — argument network will be incomplete for this turn');
      return;
    }

    let claims: { text: string; bdi_category?: string; base_strength?: number; responds_to?: { prior_claim_id: string; relationship: string; attack_type?: string; scheme?: string; warrant?: string }[] }[] = [];
    try {
      const parsed = parseJsonRobust(text) as any;
      claims = parsed.claims ?? [];
    } catch (err) {
      this.warn(`Parsing claim extraction response for ${POVER_INFO[speaker].label}`, err, 'Skipping — argument network will be incomplete for this turn');
      return;
    }

    const accepted: { text: string; id: string; overlap_pct: number }[] = [];
    const rejected: { text: string; reason: string; overlap_pct: number }[] = [];
    const turnNumber = this.session.transcript.length;

    for (const claim of claims.slice(0, 4)) {
      if (!claim.text || claim.text.length < 10) continue;

      // Validate word overlap
      const claimWords = new Set(claim.text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const stmtWords = new Set(statement.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const overlap = [...claimWords].filter(w => stmtWords.has(w)).length / Math.max(claimWords.size, 1);

      if (overlap < 0.3) {
        rejected.push({ text: claim.text, reason: 'low overlap', overlap_pct: Math.round(overlap * 100) });
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
    }

    this.recordDiagnostic(entryId, {
      extracted_claims: { accepted, rejected },
    });
  }
}
