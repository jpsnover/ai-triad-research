// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import type { TurnAttempt, TurnValidationTrail, TurnValidationDimensions } from '../../../../types/debate';
import { humanizeSpeakerIds } from '../../../../utils/humanizeSpeakers';
import { ScoreBreakdown, OutcomeBadge } from './ScoreBreakdown';

// NOTE: Section and CopyButton stay in DiagnosticsWindow.tsx (parent).
// NOTE: Highlight stays in DiagnosticsWindow.tsx (parent).
// When integrating, TurnValidationSection should be wrapped in a <Section> by the caller.

/** Regex that identifies hints about taxonomy citations/grounding issues. */
export const CITE_HINT_RE = /taxonomy_refs.*(?:filler|too-short|relevance)|No new taxonomy_refs|Unknown taxonomy node|Unknown policy_refs|grounding_confidence/i;

export function classifyHintTarget(hint: string): 'draft' | 'cite' | 'judge' {
  if (CITE_HINT_RE.test(hint)) return 'cite';
  // Judge weaknesses tend to be short observations without field names
  if (!/move_types|my_claims|paragraph|statement|hedge|constructive|pin_response|probe_response|challenge_response|clarification|check_response|revoice|reflection|compressed_thesis|commitment/i.test(hint)) return 'judge';
  return 'draft';
}

export const HINT_TARGET_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'DRAFT', color: 'var(--warning)', bg: 'color-mix(in srgb, var(--warning) 8%, transparent)' },
  cite: { label: 'CITE', color: 'var(--text-secondary)', bg: 'var(--bg-hover)' },
  judge: { label: 'QUALITY', color: 'var(--text-secondary)', bg: 'var(--bg-hover)' },
};

export function TurnValidationAttemptRow({ a }: { a: TurnAttempt }) {
  const [open, setOpen] = useState(false);
  const v = a.validation;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 4, marginBottom: 6 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          cursor: 'pointer', padding: '6px 8px', display: 'flex',
          alignItems: 'center', gap: 8, fontSize: '0.75rem',
        }}
      >
        <span style={{ color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
        <strong>Attempt {a.attempt}{a.attempt === 0 ? ' (original)' : ''}</strong>
        <OutcomeBadge outcome={v.outcome} />
        <span style={{ color: 'var(--text-muted)' }}>score {(v.process_reward ?? 0).toFixed(2)}</span>
        <span style={{ color: 'var(--text-muted)' }}>{((a.response_time_ms ?? 0) / 1000).toFixed(1)}s</span>
        {v.judge_used && <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>judge: {v.judge_model}</span>}
      </div>
      {open && (
        <div style={{ padding: '4px 10px 10px', fontSize: '0.72rem' }}>
          {v.dimensions && (
            <ScoreBreakdown dims={{
              schema: v.dimensions.schema ?? { pass: true, issues: [] },
              grounding: v.dimensions.grounding ?? { pass: true, issues: [] },
              advancement: v.dimensions.advancement ?? { pass: true, signals: [] },
              clarifies: v.dimensions.clarifies ?? { pass: true, signals: [] },
            } as TurnValidationDimensions} processReward={v.process_reward ?? 0} judgeUsed={v.judge_used} />
          )}
          {(v.repairHints?.length ?? 0) > 0 && (
            <>
              <div style={{ fontWeight: 600, marginTop: 4 }}>Caveats</div>
              <ul style={{ margin: '2px 0 6px 16px', padding: 0 }}>
                {v.repairHints.map((h, i) => {
                  const target = classifyHintTarget(h);
                  const ts = HINT_TARGET_STYLE[target];
                  return (
                    <li key={i} style={{ marginBottom: 3 }}>
                      <span style={{
                        display: 'inline-block', fontSize: 'var(--text-2xs)', fontWeight: 700,
                        color: ts.color, background: ts.bg, padding: '1px 5px',
                        borderRadius: 3, marginRight: 5, verticalAlign: 'middle',
                      }}>{ts.label}</span>
                      {humanizeSpeakerIds(h)}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {(v.clarifies_taxonomy?.length ?? 0) > 0 && (
            <>
              <div style={{ fontWeight: 600, marginTop: 4 }}>Taxonomy clarification hints</div>
              <ul style={{ margin: '2px 0 6px 16px', padding: 0 }}>
                {v.clarifies_taxonomy.map((h, i) => (
                  <li key={i}>
                    <strong>{h.action}</strong>
                    {h.node_id ? ` ${h.node_id}` : h.label ? ` "${h.label}"` : ''}
                    {h.rationale ? ` — ${h.rationale}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          {/* Hint effectiveness tracking (retry attempts only) */}
          {a.hint_effectiveness && a.hint_effectiveness.length > 0 && (
            <>
              <div style={{ fontWeight: 600, marginTop: 6 }}>Hint Effectiveness</div>
              <div style={{ marginTop: 4 }}>
                {(() => {
                  const he = a.hint_effectiveness as Array<{
                    hint_text: string; category: string; source: string; specificity: string;
                    resolution: string; cited_fragment?: string; fragment_persists?: boolean;
                    pre_score: number; post_score?: number; score_delta?: number;
                  }>;
                  const fixed = he.filter(h => h.resolution === 'fixed').length;
                  const partial = he.filter(h => h.resolution === 'partially_fixed').length;
                  const ignored = he.filter(h => h.resolution === 'ignored').length;
                  const worse = he.filter(h => h.resolution === 'made_worse').length;
                  const resColors: Record<string, string> = {
                    fixed: 'var(--success)', partially_fixed: 'var(--warning)', ignored: 'var(--text-muted)', made_worse: 'var(--danger)', pending: 'var(--text-secondary)',
                  };
                  const specColors: Record<string, string> = {
                    concrete: 'var(--success)', structural: 'var(--text-secondary)', evaluative: 'var(--warning)',
                  };
                  return (
                    <>
                      <div style={{ display: 'flex', gap: 10, marginBottom: 6, fontSize: 'var(--text-2xs)' }}>
                        <span style={{ color: 'var(--success)', fontWeight: 700 }}>Fixed: {fixed}</span>
                        <span style={{ color: 'var(--warning)', fontWeight: 700 }}>Partial: {partial}</span>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>Ignored: {ignored}</span>
                        <span style={{ color: 'var(--danger)', fontWeight: 700 }}>Worse: {worse}</span>
                        <span style={{ color: 'var(--text-muted)' }}>
                          Score: {he[0]?.pre_score?.toFixed(2)} → {he[0]?.post_score?.toFixed(2)} ({(he[0]?.score_delta ?? 0) >= 0 ? '+' : ''}{he[0]?.score_delta?.toFixed(2)})
                        </span>
                      </div>
                      {he.map((h, hi) => (
                        <div key={hi} style={{
                          marginBottom: 4, padding: '4px 8px', borderRadius: 4, fontSize: 'var(--text-2xs)',
                          borderLeft: `3px solid ${resColors[h.resolution] ?? 'var(--text-muted)'}`,
                          background: 'var(--bg-subtle)',
                        }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                            <span style={{
                              fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 4px', borderRadius: 3,
                              color: resColors[h.resolution] ?? 'var(--text-muted)',
                              background: `${resColors[h.resolution] ?? 'var(--text-muted)'}18`,
                            }}>{h.resolution.toUpperCase().replace('_', ' ')}</span>
                            <span style={{
                              fontSize: 'var(--text-2xs)', padding: '0 4px', borderRadius: 3,
                              color: specColors[h.specificity] ?? 'var(--text-muted)',
                              background: `${specColors[h.specificity] ?? 'var(--text-muted)'}18`,
                            }}>{h.specificity}</span>
                            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{h.source.replace('_', ' ')}</span>
                          </div>
                          <div>{humanizeSpeakerIds(h.hint_text)}</div>
                          {h.cited_fragment && (
                            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                              Fragment: &ldquo;{humanizeSpeakerIds(h.cited_fragment)}&rdquo; {h.fragment_persists ? '— still present' : '— removed'}
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  );
                })()}
              </div>
            </>
          )}
          {a.prompt_delta && (
            <>
              <div style={{ fontWeight: 600, marginTop: 4 }}>Repair prompt delta</div>
              <pre style={{
                whiteSpace: 'pre-wrap', background: 'var(--bg-subtle)',
                padding: 6, borderRadius: 3, maxHeight: 200, overflow: 'auto',
                fontSize: '0.7rem',
              }}>{a.prompt_delta}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function sanitizeTurnValidation(trail: TurnValidationTrail): TurnValidationTrail {
  return {
    final: {
      ...trail.final,
      process_reward: trail.final.process_reward ?? 0,
      dimensions: {
        schema: trail.final.dimensions?.schema ?? { pass: true, issues: [] },
        grounding: trail.final.dimensions?.grounding ?? { pass: true, issues: [] },
        advancement: trail.final.dimensions?.advancement ?? { pass: true, signals: [] },
        clarifies: trail.final.dimensions?.clarifies ?? { pass: true, signals: [] },
      },
      repairHints: trail.final.repairHints ?? [],
    },
    attempts: trail.attempts ?? [],
  };
}

export function TurnValidationSection({ trail: rawTrail }: { trail: TurnValidationTrail }) {
  const trail = sanitizeTurnValidation(rawTrail);
  const f = trail.final;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <OutcomeBadge outcome={f.outcome} />
        <span style={{ fontSize: '0.8rem' }}>score <strong>{(f.process_reward ?? 0).toFixed(2)}</strong></span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {trail.attempts.length} attempt{trail.attempts.length === 1 ? '' : 's'}
        </span>
        {f.judge_used && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>judge: {f.judge_model}</span>
        )}
        {/* Best-attempt indicator — shows when the system used an earlier attempt over the last */}
        {trail.attempts.length > 1 && (() => {
          const scores = trail.attempts.map(a => a.validation.process_reward ?? 0);
          const bestIdx = scores.indexOf(Math.max(...scores));
          const lastIdx = scores.length - 1;
          if (bestIdx !== lastIdx) {
            return (
              <span style={{ fontSize: 'var(--text-2xs)', padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--success) 15%, transparent)', color: 'var(--success)', fontWeight: 600 }}>
                Used attempt {bestIdx} (score {scores[bestIdx].toFixed(2)}) — last attempt regressed to {scores[lastIdx].toFixed(2)}
              </span>
            );
          }
          return null;
        })()}
      </div>
      <ScoreBreakdown dims={f.dimensions!} processReward={f.process_reward ?? 0} judgeUsed={f.judge_used} />
      {f.repairHints.length > 0 && (
        <div style={{ fontSize: '0.75rem', marginBottom: 8 }}>
          <strong>Caveats (final)</strong>
          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
            {f.repairHints.map((h, i) => {
              const target = classifyHintTarget(h);
              const ts = HINT_TARGET_STYLE[target];
              return (
                <li key={i} style={{ marginBottom: 3 }}>
                  <span style={{
                    display: 'inline-block', fontSize: 'var(--text-2xs)', fontWeight: 700,
                    color: ts.color, background: ts.bg, padding: '1px 5px',
                    borderRadius: 3, marginRight: 5, verticalAlign: 'middle',
                  }}>{ts.label}</span>
                  {humanizeSpeakerIds(h)}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Attempts</div>
      {trail.attempts.map((a, i) => <TurnValidationAttemptRow key={i} a={a} />)}
    </div>
  );
}
