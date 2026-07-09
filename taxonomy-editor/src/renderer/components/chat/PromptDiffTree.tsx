// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useCallback } from 'react';
import { DEFAULT_MODEL } from '@lib/ai-client/defaults';
import { POVER_INFO } from '../../types/debate';
import type { SpeakerId, DebateSession } from '../../types/debate';
import type { CitationResolutionDiagnostics } from '@lib/debate/citationResolution.js';

export type DiffViewMode = 'prompts' | 'responses';

export interface ValidationDetail {
  rule: string;
  pass: boolean;
  value?: string;
}

export interface DirectiveCompliance {
  compliant: boolean;
  repair_hint: string;
  directive_terms: string[];
  matched_terms: number;
}

export interface StageValidation {
  pass: boolean;
  hints?: string[];
  details?: ValidationDetail[];
  directive_compliance?: DirectiveCompliance;
}

export interface QualityCheck {
  grounded: boolean;
  falsifiable: boolean;
  engages: boolean;
  weaknesses: string[];
}

export interface OrchestrationValidation {
  outcome: string;
  process_reward: number;
  repairHints: string[];
  dimensions: {
    schema: { pass: boolean; issues: string[] };
    grounding: { pass: boolean; issues: string[] };
    advancement: { pass: boolean; signals: string[] };
    clarifies: { pass: boolean; signals: string[] };
  };
}

/** Sub-node kind: 'stage' for normal stage runs, 'tool-call' for citation tool calls, 'scrub' for Path A scrub, 'attempt-verdict' for orchestration judge verdicts. */
export type PromptNodeKind = 'stage' | 'tool-call' | 'scrub' | 'attempt-verdict';

export interface PromptNode {
  entryId: string;
  entryIndex: number;
  speaker: string;
  type: string;
  stage: string;
  runIndex: number;
  runCount: number;
  model: string;
  temperature: number;
  responseTimeMs: number;
  validationPass?: boolean;
  prompt: string;
  response: string;
  validation?: StageValidation;
  qualityCheck?: QualityCheck;
  orchestrationValidation?: OrchestrationValidation;
  retryTrigger?: RetryTrigger;
  repairHintsIn?: string[];
  /** Discriminator for tool-call / scrub sub-nodes. Defaults to 'stage'. */
  kind?: PromptNodeKind;
  /** For tool-call nodes: the tool name (e.g. 'lookup_citation'). */
  toolName?: string;
  /** For tool-call nodes: index within the tool_calls array. */
  toolCallIndex?: number;
  /** For tool-call nodes: whether the lookup returned empty results. */
  toolCallEmpty?: boolean;
  /** Citation resolution diagnostics (only on draft stage nodes). */
  citationResolution?: CitationResolutionDiagnostics;
}

interface Props {
  debate: DebateSession;
  focusedEntryId: string | null;
  onSelectNode: (node: PromptNode) => void;
  selectedNodeKey?: string;
}

const STAGE_ORDER = ['brief', 'plan', 'evidence', 'draft', 'cite'];
const STAGE_COLORS: Record<string, string> = {
  brief: '#3b82f6', plan: '#a855f7', evidence: '#f59e0b', draft: '#22c55e', cite: '#f97316',
};

function speakerLabel(speaker: string): string {
  const info = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>];
  return info?.label ?? speaker;
}

function abbreviateModel(model: string): string {
  return model
    .replace('gemini-3.1-flash-lite-preview', 'gemini-3.1')
    .replace(DEFAULT_MODEL, 'gemini-lite')
    .replace('claude-3-5-haiku-20241022', 'haiku-3.5')
    .replace(/^models\//, '')
    .slice(0, 20);
}

function nodeKey(entryId: string, stage: string, runIndex: number, kind?: PromptNodeKind, subIndex?: number): string {
  if (kind === 'tool-call') return `${entryId}::${stage}::${runIndex}::tc${subIndex ?? 0}`;
  if (kind === 'scrub') return `${entryId}::${stage}::${runIndex}::scrub`;
  if (kind === 'attempt-verdict') return `${entryId}::verdict::${runIndex}`;
  return `${entryId}::${stage}::${runIndex}`;
}

export type RetryTrigger = 'initial' | 'stage-retry' | 'orchestration-rerun';

interface StageRun {
  stage: string;
  model: string;
  temperature: number;
  response_time_ms: number;
  prompt: string;
  raw_response: string;
  work_product?: Record<string, unknown>;
  stage_validation?: StageValidation;
  qualityCheck?: QualityCheck;
  retryTrigger?: RetryTrigger;
  repairHintsIn?: string[];
  runIndex: number;
  subNodes?: StageSubNode[];
  citationResolution?: CitationResolutionDiagnostics;
}

/** Extract tool-call and scrub sub-nodes from a draft stage diagnostic's citation_resolution. */
function extractDraftSubNodes(sd: Record<string, unknown>): StageSubNode[] {
  const cr = sd.citation_resolution as CitationResolutionDiagnostics | undefined;
  if (!cr) return [];
  const subs: StageSubNode[] = [];

  // Path B: tool calls
  if (cr.tool_calls && cr.tool_calls.length > 0) {
    for (let i = 0; i < cr.tool_calls.length; i++) {
      const tc = cr.tool_calls[i];
      const queryText = tc.source_type
        ? `lookup_citation\n\nQuery: ${tc.query}\nSource type: ${tc.source_type}`
        : `lookup_citation\n\nQuery: ${tc.query}\nSource type: any`;
      let resultText: string;
      if (tc.empty) {
        resultText = `No verified sources found for this query.\n\nThe citation bank (${cr.bank_size} sources) had no match above the similarity threshold.`;
      } else if (tc.top_result) {
        resultText = `Results: ${tc.results_count}\nTop: "${tc.top_result.doc_id}" — ${tc.top_result.title} (relevance: ${tc.top_result.relevance.toFixed(2)})`;
      } else {
        resultText = `Results: ${tc.results_count}`;
      }
      subs.push({
        kind: 'tool-call',
        toolCallIndex: i,
        toolName: 'lookup_citation',
        timeMs: tc.time_ms,
        empty: tc.empty,
        prompt: queryText,
        response: resultText,
      });
    }
  }

  // Path A: scrub diff — use scrub_original (pre-scrub) vs raw_response from the stage diag
  const preScrub = cr.scrub_original ?? (sd.raw_response as string | undefined);
  const postScrub = (sd.work_product as Record<string, unknown> | undefined)?.statement as string | undefined;
  if (cr.path === 'bank-scrub' && preScrub && postScrub) {
    subs.push({
      kind: 'scrub',
      prompt: preScrub,
      response: postScrub,
    });
  }

  return subs;
}

/** Sub-node under a stage run: either a tool call or a scrub diff. */
interface StageSubNode {
  kind: 'tool-call' | 'scrub';
  toolCallIndex?: number;
  toolName?: string;
  timeMs?: number;
  empty?: boolean;
  /** The prompt text (tool call query or pre-scrub draft). */
  prompt: string;
  /** The response text (tool call result JSON or post-scrub draft). */
  response: string;
}

/** Orchestration-level verdict for a single attempt (displayed as its own tree node). */
interface AttemptVerdict {
  attemptIndex: number;
  validation: OrchestrationValidation;
}

interface StageGroup {
  stage: string;
  runs: StageRun[];
}

export function PromptDiffTree({ debate, focusedEntryId, onSelectNode, selectedNodeKey }: Props) {
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(() =>
    new Set(focusedEntryId ? [focusedEntryId] : [])
  );
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());

  const toggleEntry = useCallback((id: string) => {
    setExpandedEntries(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleStage = useCallback((key: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const entries = debate.transcript.map((entry, idx) => {
    const diags = debate.diagnostics?.entries?.[entry.id];
    const trail = debate.turn_validations?.[entry.id];
    const attempts = trail?.attempts ?? [];

    let grouped: StageGroup[];
    const verdicts: AttemptVerdict[] = [];

    if (attempts.length > 0) {
      // Multi-run entry: flatMap across ALL orchestration attempts' stage_diagnostics
      // to capture per-stage retries within each attempt (not just one per attempt)
      grouped = STAGE_ORDER.map(stage => {
        let runIdx = 0;
        const runs: StageRun[] = attempts.flatMap((attempt) => {
          const allStages = attempt.stage_diagnostics as Array<Record<string, unknown>> | undefined;
          const stageEntries = allStages?.filter(s => s.stage === stage && s.prompt) ?? [];
          return stageEntries.map(sd => {
            // Look up draft_quality stage for this attempt (pairs with 'draft' stage)
            let qualityCheck: QualityCheck | undefined;
            if (stage === 'draft') {
              const dq = allStages?.find(s => s.stage === 'draft_quality');
              const wp = dq?.work_product as Record<string, unknown> | undefined;
              if (wp && typeof wp.grounded === 'boolean') {
                qualityCheck = {
                  grounded: wp.grounded as boolean,
                  falsifiable: wp.falsifiable as boolean,
                  engages: wp.engages as boolean,
                  weaknesses: (wp.weaknesses as string[]) ?? [],
                };
              }
            }
            return {
              stage,
              model: (sd.model as string) ?? '',
              temperature: (sd.temperature as number) ?? 0,
              response_time_ms: (sd.response_time_ms as number) ?? 0,
              prompt: sd.prompt as string,
              raw_response: (sd.raw_response as string) ?? '',
              work_product: sd.work_product as Record<string, unknown> | undefined,
              stage_validation: sd.stage_validation as StageValidation | undefined,
              qualityCheck,
              retryTrigger: sd.retry_trigger as RetryTrigger | undefined,
              repairHintsIn: sd.repair_hints_in as string[] | undefined,
              runIndex: runIdx++,
              subNodes: stage === 'draft' ? extractDraftSubNodes(sd) : undefined,
              citationResolution: stage === 'draft' ? sd.citation_resolution as CitationResolutionDiagnostics | undefined : undefined,
            } as StageRun;
          });
        });
        return { stage, runs };
      }).filter(g => g.runs.length > 0);

      // Extract orchestration-level verdicts — one per attempt, displayed as separate tree nodes
      for (const [ai, attempt] of attempts.entries()) {
        const av = attempt.validation as Record<string, unknown> | undefined;
        if (av) {
          verdicts.push({
            attemptIndex: ai,
            validation: {
              outcome: (av.outcome as string) ?? 'unknown',
              process_reward: (av.process_reward as number) ?? 0,
              repairHints: (av.repairHints as string[]) ?? [],
              dimensions: (av.dimensions as OrchestrationValidation['dimensions']) ?? {
                schema: { pass: true, issues: [] }, grounding: { pass: true, issues: [] },
                advancement: { pass: true, signals: [] }, clarifies: { pass: true, signals: [] },
              },
            },
          });
        }
      }
    } else {
      // Single-run fallback: use diagnostics.entries stage_diagnostics
      const allStages = (diags?.stage_diagnostics ?? []) as Array<Record<string, unknown>>;
      grouped = STAGE_ORDER.map(stage => ({
        stage,
        runs: allStages
          .filter(s => s.stage === stage && s.prompt)
          .map((s, i) => {
            let qualityCheck: QualityCheck | undefined;
            if (stage === 'draft') {
              const dq = allStages.find(x => x.stage === 'draft_quality');
              const wp = dq?.work_product as Record<string, unknown> | undefined;
              if (wp && typeof wp.grounded === 'boolean') {
                qualityCheck = {
                  grounded: wp.grounded as boolean,
                  falsifiable: wp.falsifiable as boolean,
                  engages: wp.engages as boolean,
                  weaknesses: (wp.weaknesses as string[]) ?? [],
                };
              }
            }
            return {
              stage,
              model: (s.model as string) ?? '',
              temperature: (s.temperature as number) ?? 0,
              response_time_ms: (s.response_time_ms as number) ?? 0,
              prompt: s.prompt as string,
              raw_response: (s.raw_response as string) ?? '',
              work_product: s.work_product as Record<string, unknown> | undefined,
              stage_validation: s.stage_validation as StageValidation | undefined,
              qualityCheck,
              retryTrigger: s.retry_trigger as RetryTrigger | undefined,
              repairHintsIn: s.repair_hints_in as string[] | undefined,
              runIndex: i,
              subNodes: stage === 'draft' ? extractDraftSubNodes(s) : undefined,
              citationResolution: stage === 'draft' ? s.citation_resolution as CitationResolutionDiagnostics | undefined : undefined,
            } as StageRun;
          }),
      })).filter(g => g.runs.length > 0);
    }

    const totalRuns = attempts.length || 1;
    return { entry, idx, grouped, verdicts, totalRuns, hasPrompts: grouped.some(g => g.runs.length > 0) };
  });

  return (
    <div style={{ fontSize: '0.72rem', overflowY: 'auto', height: '100%', padding: '4px 0' }}>
      {entries.map(({ entry, idx, grouped, verdicts, totalRuns, hasPrompts }) => {
        const isExpanded = expandedEntries.has(entry.id);
        const isFocused = entry.id === focusedEntryId;
        return (
          <div key={entry.id}>
            <div
              onClick={() => hasPrompts && toggleEntry(entry.id)}
              style={{
                padding: '3px 8px',
                cursor: hasPrompts ? 'pointer' : 'default',
                color: hasPrompts ? 'var(--text-primary)' : 'var(--text-muted)',
                opacity: hasPrompts ? 1 : 0.5,
                fontWeight: isFocused ? 700 : 400,
                background: isFocused ? 'rgba(168,85,247,0.08)' : 'transparent',
                display: 'flex', alignItems: 'center', gap: 4,
                borderLeft: isFocused ? '2px solid #a855f7' : '2px solid transparent',
              }}
            >
              <span style={{ width: 12, textAlign: 'center', fontSize: 'var(--text-2xs)' }}>
                {hasPrompts ? (isExpanded ? '▼' : '▶') : '·'}
              </span>
              <span style={{ fontWeight: 600 }}>S{idx + 1}</span>
              <span>{speakerLabel(entry.speaker)}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>({entry.type})</span>
              {totalRuns > 1 && (
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>
                  {totalRuns} runs
                </span>
              )}
            </div>

            {isExpanded && (<>
              {grouped.map(({ stage, runs }) => {
              const stageKey = `${entry.id}::${stage}`;
              const isStageExpanded = expandedStages.has(stageKey) || runs.length === 1;
              return (
                <div key={stage}>
                  <div
                    onClick={() => runs.length > 1 && toggleStage(stageKey)}
                    style={{
                      padding: '2px 8px 2px 28px',
                      cursor: runs.length > 1 ? 'pointer' : 'default',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    {runs.length > 1 && (
                      <span style={{ width: 10, textAlign: 'center', fontSize: 'var(--text-2xs)' }}>
                        {isStageExpanded ? '▼' : '▶'}
                      </span>
                    )}
                    <span style={{
                      padding: '0 5px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600,
                      background: `${STAGE_COLORS[stage] ?? '#888'}20`,
                      color: STAGE_COLORS[stage] ?? '#888',
                      textTransform: 'uppercase',
                    }}>
                      {stage}
                    </span>
                    {runs.length > 1 && (
                      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                        ({runs.length} runs)
                      </span>
                    )}
                  </div>

                  {isStageExpanded && runs.map((r) => {
                    const key = nodeKey(entry.id, stage, r.runIndex);
                    const isSelected = key === selectedNodeKey;
                    const node: PromptNode = {
                      entryId: entry.id,
                      entryIndex: idx,
                      speaker: entry.speaker,
                      type: entry.type,
                      stage,
                      runIndex: r.runIndex,
                      runCount: runs.length,
                      model: r.model,
                      temperature: r.temperature,
                      responseTimeMs: r.response_time_ms,
                      validationPass: r.stage_validation?.pass,
                      prompt: r.prompt,
                      response: r.raw_response,
                      validation: r.stage_validation,
                      qualityCheck: r.qualityCheck,
                      retryTrigger: r.retryTrigger,
                      repairHintsIn: r.repairHintsIn,
                      citationResolution: r.citationResolution,
                    };
                    const toolCalls = r.subNodes?.filter(sn => sn.kind === 'tool-call') ?? [];
                    const scrubNode = r.subNodes?.find(sn => sn.kind === 'scrub');
                    return (
                      <div key={r.runIndex}>
                        <div
                          onClick={() => onSelectNode(node)}
                          style={{
                            padding: '2px 8px 2px 46px',
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 6,
                            background: isSelected ? 'rgba(59,130,246,0.12)' : 'transparent',
                            borderLeft: isSelected ? '2px solid #3b82f6' : '2px solid transparent',
                          }}
                          title="Click to add to diff pane"
                        >
                          <span style={{ fontWeight: 500 }}>Run {r.runIndex + 1}</span>
                          {r.retryTrigger === 'stage-retry' && (
                            <span
                              style={{
                                fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 4px', borderRadius: 3,
                                background: 'rgba(245,158,11,0.15)', color: '#f59e0b', textTransform: 'uppercase',
                              }}
                              title={r.repairHintsIn?.join('\n') ?? 'Stage validator retry'}
                            >
                              Stage Retry
                            </span>
                          )}
                          {r.retryTrigger === 'orchestration-rerun' && (
                            <span
                              style={{
                                fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 4px', borderRadius: 3,
                                background: 'rgba(239,68,68,0.15)', color: '#ef4444', textTransform: 'uppercase',
                              }}
                              title={r.repairHintsIn?.join('\n') ?? 'Judge-triggered rerun'}
                            >
                              Rerun
                            </span>
                          )}
                          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>
                            {abbreviateModel(node.model)}, {node.temperature}, {(node.responseTimeMs / 1000).toFixed(1)}s
                          </span>
                          {node.validationPass !== undefined && (
                            <span style={{
                              color: node.validationPass ? '#22c55e' : '#ef4444',
                              fontWeight: 700, fontSize: 'var(--text-2xs)',
                            }}>
                              {node.validationPass ? '✓' : '✗'}
                            </span>
                          )}
                        </div>
                        {/* Tool call sub-nodes (Path B) */}
                        {toolCalls.length > 0 && toolCalls.map((tc, ti) => {
                          const tcKey = nodeKey(entry.id, stage, r.runIndex, 'tool-call', ti);
                          const tcSelected = tcKey === selectedNodeKey;
                          const tcNode: PromptNode = {
                            ...node,
                            kind: 'tool-call',
                            toolName: tc.toolName,
                            toolCallIndex: tc.toolCallIndex,
                            toolCallEmpty: tc.empty,
                            prompt: tc.prompt,
                            response: tc.response,
                          };
                          return (
                            <div
                              key={tcKey}
                              onClick={() => onSelectNode(tcNode)}
                              style={{
                                padding: '1px 8px 1px 60px',
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 4,
                                background: tcSelected ? 'rgba(59,130,246,0.12)' : 'transparent',
                                borderLeft: tcSelected ? '2px solid #3b82f6' : '2px solid transparent',
                                fontSize: 'var(--text-2xs)',
                              }}
                              title="Tool call — click to view query & results"
                            >
                              <span style={{
                                padding: '0 4px', borderRadius: 2, fontWeight: 600, fontSize: 'var(--text-2xs)',
                                background: 'rgba(14,165,233,0.12)', color: '#0ea5e9',
                              }}>
                                🔍
                              </span>
                              <span style={{ fontWeight: 500 }}>{tc.toolName ?? 'lookup_citation'}</span>
                              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>
                                #{(tc.toolCallIndex ?? ti) + 1}
                              </span>
                              {tc.timeMs != null && (
                                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>
                                  {(tc.timeMs / 1000).toFixed(1)}s
                                </span>
                              )}
                              {tc.empty && (
                                <span style={{
                                  padding: '0 3px', borderRadius: 2, fontWeight: 700, fontSize: 'var(--text-2xs)',
                                  background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                                }}>
                                  EMPTY
                                </span>
                              )}
                            </div>
                          );
                        })}
                        {/* Scrub sub-node (Path A) */}
                        {scrubNode && (() => {
                          const scrubKey = nodeKey(entry.id, stage, r.runIndex, 'scrub');
                          const scrubSelected = scrubKey === selectedNodeKey;
                          const scrubPNode: PromptNode = {
                            ...node,
                            kind: 'scrub',
                            prompt: scrubNode.prompt,
                            response: scrubNode.response,
                          };
                          return (
                            <div
                              onClick={() => onSelectNode(scrubPNode)}
                              style={{
                                padding: '1px 8px 1px 60px',
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 4,
                                background: scrubSelected ? 'rgba(59,130,246,0.12)' : 'transparent',
                                borderLeft: scrubSelected ? '2px solid #3b82f6' : '2px solid transparent',
                                fontSize: 'var(--text-2xs)',
                              }}
                              title="Scrub diff — pre-scrub vs post-scrub draft"
                            >
                              <span style={{
                                padding: '0 4px', borderRadius: 2, fontWeight: 600, fontSize: 'var(--text-2xs)',
                                background: 'rgba(168,85,247,0.12)', color: '#a855f7',
                              }}>
                                ✂
                              </span>
                              <span style={{ fontWeight: 500 }}>Scrub</span>
                              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>
                                pre → post
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              );
            })}
              {/* Attempt verdict nodes — orchestration judge results, one per attempt */}
              {verdicts.map((v) => {
                const vKey = nodeKey(entry.id, 'verdict', v.attemptIndex, 'attempt-verdict');
                const vSelected = vKey === selectedNodeKey;
                const isAccept = v.validation.outcome === 'accept' || v.validation.outcome === 'accept_with_flag';
                const verdictNode: PromptNode = {
                  entryId: entry.id,
                  entryIndex: idx,
                  speaker: entry.speaker,
                  type: entry.type,
                  stage: 'verdict',
                  runIndex: v.attemptIndex,
                  runCount: verdicts.length,
                  model: '',
                  temperature: 0,
                  responseTimeMs: 0,
                  prompt: '',
                  response: '',
                  kind: 'attempt-verdict',
                  orchestrationValidation: v.validation,
                };
                return (
                  <div
                    key={vKey}
                    onClick={() => onSelectNode(verdictNode)}
                    style={{
                      padding: '3px 8px 3px 28px',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: vSelected ? 'rgba(59,130,246,0.12)' : 'transparent',
                      borderLeft: vSelected ? '2px solid #3b82f6' : '2px solid transparent',
                      fontSize: 'var(--text-2xs)',
                    }}
                    title={`Orchestration judge verdict for attempt ${v.attemptIndex + 1}`}
                  >
                    <span style={{ fontSize: 'var(--text-2xs)' }}>⚖</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>
                      Attempt {v.attemptIndex + 1}
                    </span>
                    <span style={{
                      padding: '0 5px', borderRadius: 3, fontWeight: 700, fontSize: 'var(--text-2xs)',
                      background: isAccept ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                      color: isAccept ? '#22c55e' : '#ef4444',
                      textTransform: 'uppercase',
                    }}>
                      {v.validation.outcome.replace(/_/g, ' ')}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>
                      ({v.validation.process_reward.toFixed(2)})
                    </span>
                  </div>
                );
              })}
            </>)}
          </div>
        );
      })}
    </div>
  );
}

export { nodeKey };
