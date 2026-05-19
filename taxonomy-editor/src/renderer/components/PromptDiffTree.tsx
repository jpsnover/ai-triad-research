// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useCallback } from 'react';
import { POVER_INFO } from '../types/debate';
import type { SpeakerId, DebateSession } from '../types/debate';

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
    .replace('gemini-flash-lite-latest', 'gemini-lite')
    .replace('claude-3-5-haiku-20241022', 'haiku-3.5')
    .replace(/^models\//, '')
    .slice(0, 20);
}

function nodeKey(entryId: string, stage: string, runIndex: number): string {
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
  orchestrationValidation?: OrchestrationValidation;
  retryTrigger?: RetryTrigger;
  repairHintsIn?: string[];
  runIndex: number;
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

    if (attempts.length > 0) {
      // Multi-run entry: flatMap across ALL orchestration attempts' stage_diagnostics
      // to capture per-stage retries within each attempt (not just one per attempt)
      grouped = STAGE_ORDER.map(stage => {
        let runIdx = 0;
        const runs: StageRun[] = attempts.flatMap((attempt, ri) => {
          const allStages = attempt.stage_diagnostics as Array<Record<string, unknown>> | undefined;
          const stageEntries = allStages?.filter(s => s.stage === stage && s.prompt) ?? [];
          // Extract orchestration-level validation from the attempt (shared by all stages in this attempt)
          const av = attempt.validation as Record<string, unknown> | undefined;
          const orchestrationValidation: OrchestrationValidation | undefined = av ? {
            outcome: (av.outcome as string) ?? 'unknown',
            process_reward: (av.process_reward as number) ?? 0,
            repairHints: (av.repairHints as string[]) ?? [],
            dimensions: (av.dimensions as OrchestrationValidation['dimensions']) ?? {
              schema: { pass: true, issues: [] }, grounding: { pass: true, issues: [] },
              advancement: { pass: true, signals: [] }, clarifies: { pass: true, signals: [] },
            },
          } : undefined;
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
              orchestrationValidation,
              retryTrigger: sd.retry_trigger as RetryTrigger | undefined,
              repairHintsIn: sd.repair_hints_in as string[] | undefined,
              runIndex: runIdx++,
            } as StageRun;
          });
        });
        return { stage, runs };
      }).filter(g => g.runs.length > 0);
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
            } as StageRun;
          }),
      })).filter(g => g.runs.length > 0);
    }

    const totalRuns = attempts.length || 1;
    return { entry, idx, grouped, totalRuns, hasPrompts: grouped.some(g => g.runs.length > 0) };
  });

  return (
    <div style={{ fontSize: '0.72rem', overflowY: 'auto', height: '100%', padding: '4px 0' }}>
      {entries.map(({ entry, idx, grouped, totalRuns, hasPrompts }) => {
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
              <span style={{ width: 12, textAlign: 'center', fontSize: '0.6rem' }}>
                {hasPrompts ? (isExpanded ? '▼' : '▶') : '·'}
              </span>
              <span style={{ fontWeight: 600 }}>S{idx + 1}</span>
              <span>{speakerLabel(entry.speaker)}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.62rem' }}>({entry.type})</span>
              {totalRuns > 1 && (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.58rem' }}>
                  {totalRuns} runs
                </span>
              )}
            </div>

            {isExpanded && grouped.map(({ stage, runs }) => {
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
                      <span style={{ width: 10, textAlign: 'center', fontSize: '0.55rem' }}>
                        {isStageExpanded ? '▼' : '▶'}
                      </span>
                    )}
                    <span style={{
                      padding: '0 5px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 600,
                      background: `${STAGE_COLORS[stage] ?? '#888'}20`,
                      color: STAGE_COLORS[stage] ?? '#888',
                      textTransform: 'uppercase',
                    }}>
                      {stage}
                    </span>
                    {runs.length > 1 && (
                      <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
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
                      orchestrationValidation: r.orchestrationValidation,
                      retryTrigger: r.retryTrigger,
                      repairHintsIn: r.repairHintsIn,
                    };
                    return (
                      <div
                        key={r.runIndex}
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
                              fontSize: '0.5rem', fontWeight: 700, padding: '0 4px', borderRadius: 3,
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
                              fontSize: '0.5rem', fontWeight: 700, padding: '0 4px', borderRadius: 3,
                              background: 'rgba(239,68,68,0.15)', color: '#ef4444', textTransform: 'uppercase',
                            }}
                            title={r.repairHintsIn?.join('\n') ?? 'Judge-triggered rerun'}
                          >
                            Rerun
                          </span>
                        )}
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.58rem' }}>
                          {abbreviateModel(node.model)}, {node.temperature}, {(node.responseTimeMs / 1000).toFixed(1)}s
                        </span>
                        {node.validationPass !== undefined && (
                          <span style={{
                            color: node.validationPass ? '#22c55e' : '#ef4444',
                            fontWeight: 700, fontSize: '0.65rem',
                          }}>
                            {node.validationPass ? '✓' : '✗'}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export { nodeKey };
