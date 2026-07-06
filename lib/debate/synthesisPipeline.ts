// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ── Session-write map (t/1300 condition 1) ─────────────────
// Method                      → session field(s) written
// runSynthesis                → transcript[concluding], diagnostics.entries[*]
// runMissingArgumentsPass     → missing_arguments
// runTaxonomyRefinementPass   → taxonomy_suggestions  (post-debate entries merged with turn-validator hints)
// runDialecticTracePass       → dialectic_traces
// runExtractionCoverage       → diagnostics.entries[*].extraction_coverage  (via computeExtractionCoverage)
// ────────────────────────────────────────────────────────────

import type { DebateConfig } from './debateEngine.js';
import type { DebateSession, TranscriptEntry, SpeakerId } from './types.js';
import type { LoadedTaxonomy } from './taxonomyLoader.js';
import type { EntryDiagnostics } from './types.js';
import { POVER_INFO, POV_KEYS } from './types.js';
import { formatRecentTranscript, parseJsonRobust } from './helpers.js';
import { runSynthesisPhases } from './synthesisPhases.js';
import { missingArgumentsPrompt, taxonomyRefinementPrompt } from './prompts.js';
import { generateDialecticTraces } from './dialecticTrace.js';
import { computeExtractionCoverage } from './calibrationLogger.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';

export interface SynthesisContext {
  session: DebateSession;
  config: DebateConfig;
  taxonomy: LoadedTaxonomy;
  generate: (prompt: string, label: string, timeoutMs?: number) => Promise<string>;
  generateWithEvaluator: (prompt: string, label: string) => Promise<string>;
  addEntry: (entry: Omit<TranscriptEntry, 'id' | 'timestamp'>) => TranscriptEntry;
  recordDiagnostic: (entryId: string, data: Partial<EntryDiagnostics>) => void;
  progress: (phase: string, speaker?: string, message?: string) => void;
  warn: (operation: string, error: unknown, recovery: string) => void;
  checkAborted: () => void;
}

export class SynthesisPipeline {
  private ctx: SynthesisContext;

  constructor(ctx: SynthesisContext) {
    this.ctx = ctx;
  }

  async runSynthesis(maxPhase?: number): Promise<void> {
    this.ctx.progress('concluding', undefined, 'Generating synthesis');

    const fullTranscript = formatRecentTranscript(this.ctx.session.transcript, 50, this.ctx.session.context_summaries);

    const policyLines = this.ctx.taxonomy.policyRegistry.length > 0
      ? this.ctx.taxonomy.policyRegistry.slice(0, 10).map(p => `${p.id}: ${p.action}`)
      : undefined;

    const result = await runSynthesisPhases(
      {
        topic: this.ctx.session.topic.final,
        transcript: fullTranscript,
        audience: this.ctx.config.audience,
        cruxTracker: this.ctx.session.crux_tracker,
        policyLines,
        hasSourceDoc: this.ctx.config.sourceType === 'document' || this.ctx.config.sourceType === 'url',
      },
      (prompt, label) => this.ctx.generate(prompt, label),
      (_phase, label) => this.ctx.progress('concluding', undefined, label),
      (context, problem, nextStep) => this.ctx.warn(context, problem, nextStep),
      () => this.ctx.checkAborted(),
      maxPhase,
      this.ctx.config.usageDeps,
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

    let content: string;
    if (lines.length > 0) {
      content = lines.join('\n');
    } else if (typeof concludingData.summary === 'string') {
      content = concludingData.summary;
    } else {
      content = JSON.stringify(concludingData, null, 2);
    }

    const entry = this.ctx.addEntry({
      type: 'concluding',
      speaker: 'system',
      content,
      taxonomy_refs: [],
      metadata: { synthesis: concludingData },
    });

    this.ctx.recordDiagnostic(entry.id, {
      raw_response: JSON.stringify(result.rawResponses),
      model: this.ctx.config.model,
      response_time_ms: elapsed,
    });
  }

  async runMissingArgumentsPass(): Promise<void> {
    try {
      const synthEntry = this.ctx.session.transcript.find(e => e.type === 'concluding');
      const concludingText = synthEntry?.content ?? '';
      if (!concludingText) return;

      const summaryLines: string[] = [];
      for (const povKey of POV_KEYS) {
        const povData = this.ctx.taxonomy[povKey];
        if (!povData?.nodes) continue;
        for (const node of povData.nodes) {
          const cat = node.category ?? 'unknown';
          summaryLines.push(`[${node.id}] ${node.label} (${cat}) — ${povKey}`);
        }
      }
      const taxonomySummary = summaryLines.slice(0, 80).join('\n');

      const prompt = missingArgumentsPrompt(
        this.ctx.session.topic.final,
        taxonomySummary,
        concludingText.slice(0, 4000),
        this.ctx.config.audience,
      );

      const text = await this.ctx.generate(prompt, 'Missing arguments pass', 180_000);
      const parsed = parseJsonRobust(text) as { missing_arguments?: unknown[] };
      if (parsed.missing_arguments && Array.isArray(parsed.missing_arguments)) {
        this.ctx.session.missing_arguments = parsed.missing_arguments.slice(0, 5);
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.ctx.session?.id, message: 'Missing arguments pass failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.ctx.warn('Missing arguments pass', err, 'Non-critical — debate results unaffected');
    }
  }

  async runTaxonomyRefinementPass(): Promise<void> {
    try {
      const synthEntry = this.ctx.session.transcript.find(e => e.type === 'concluding');
      const concludingText = synthEntry?.content ?? '';
      if (!concludingText) return;

      const refIds = new Set<string>();
      for (const entry of this.ctx.session.transcript) {
        for (const ref of entry.taxonomy_refs ?? []) {
          refIds.add(ref.node_id);
        }
      }
      if (refIds.size === 0) return;

      const referencedNodes: { id: string; label: string; pov: string; category: string; description: string }[] = [];
      for (const povKey of POV_KEYS) {
        const povData = this.ctx.taxonomy[povKey];
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

      const an = this.ctx.session.argument_network;
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
        this.ctx.session.topic.final,
        concludingText.slice(0, 4000),
        referencedNodes.slice(0, 25),
        anSummary,
        this.ctx.config.audience,
      );

      const text = await this.ctx.generate(prompt, 'Taxonomy refinement pass', 180_000);
      const parsed = parseJsonRobust(text) as { taxonomy_suggestions?: unknown[] };
      if (parsed.taxonomy_suggestions && Array.isArray(parsed.taxonomy_suggestions)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const postDebate = parsed.taxonomy_suggestions.slice(0, 10).map((s: any) => ({
          ...s,
          source: 'post-debate' as const,
        }));
        const existing = this.ctx.session.taxonomy_suggestions ?? [];
        const turnValidator = existing.filter(s => s.source === 'turn-validator');
        this.ctx.session.taxonomy_suggestions = [...postDebate, ...turnValidator];
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.ctx.session?.id, message: 'Taxonomy refinement pass failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.ctx.warn('Taxonomy refinement pass', err, 'Non-critical — debate results unaffected');
    }
  }

  runDialecticTracePass(): void {
    try {
      const traces = generateDialecticTraces(this.ctx.session);
      if (traces.length > 0) {
        this.ctx.session.dialectic_traces = traces;
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.ctx.session?.id, message: 'Dialectic trace pass failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      this.ctx.warn('Dialectic trace pass', err, 'Non-critical — debate results unaffected');
    }
  }

  async runExtractionCoverage(): Promise<void> {
    try {
      const coverageGenFn = (prompt: string) => this.ctx.generateWithEvaluator(prompt, 'Extraction coverage');
      await computeExtractionCoverage(this.ctx.session, coverageGenFn);

      const recorder = getGlobalRecorder();
      if (!recorder || !this.ctx.session.diagnostics?.entries) return;

      for (const [entryId, entryDiag] of Object.entries(this.ctx.session.diagnostics.entries)) {
        const ec = (entryDiag as Record<string, unknown>).extraction_coverage as { coverage_rate: number } | undefined;
        if (ec && ec.coverage_rate < 0.70) {
          recorder.record({
            type: 'an.extraction_coverage_low',
            component: 'calibration',
            level: 'warn',
            debate_id: this.ctx.session.id,
            turn_id: entryId,
            message: `Extraction coverage ${Math.round(ec.coverage_rate * 100)}% < 70% threshold`,
            data: { coverage_rate: ec.coverage_rate },
          });
        }
      }
      const coverageSamples = Object.values(this.ctx.session.diagnostics.entries)
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
            debate_id: this.ctx.session.id,
            message: `Debate-level extraction coverage ${Math.round(aggCoverage * 100)}% < 70% threshold`,
            data: { aggregate_coverage_rate: aggCoverage, samples: coverageSamples.length },
          });
        }
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: this.ctx.session?.id, message: 'Coverage computation failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
  }
}
