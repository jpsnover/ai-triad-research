// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import type { EntryDiagnostics, ArgumentNetworkNode, ArgumentNetworkEdge, TurnValidationTrail, TurnAttempt } from '../../../../types/debate';
import { humanizeSpeakerIds } from '../../../../utils/humanizeSpeakers';
import { classifyOffScopeDrift, offScopeRepairHint } from '@lib/debate/prompts';
import { Highlight, CopyButton } from '../helpers';
import { classifyHintTarget, HINT_TARGET_STYLE, ArtifactBlock } from '../shared';
import { TaxonomyRefDetail, type TaxRefNode, type TaxRefEdge } from '../../../taxonomy/TaxonomyRefDetail';

interface ArgumentNetwork {
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
}

export interface DraftTabProps {
  entry: {
    id: string;
    type: string;
    content?: unknown;
    metadata?: unknown;
    taxonomy_refs?: unknown[];
    policy_refs?: unknown[];
    speaker: string;
  };
  diag: EntryDiagnostics | undefined;
  meta: Record<string, unknown> | undefined;
  debate: { topic: Record<string, unknown>; transcript: unknown[] } | undefined;
  turnValTrail: TurnValidationTrail | undefined;
  an: ArgumentNetwork | undefined;
  selectedTaxRefId: string | null;
  setSelectedTaxRefId: (id: string | null) => void;
  nodeWeights: Map<string, number>;
  taxNodeMap: Map<string, Record<string, unknown>>;
  allEdges: TaxRefEdge[];
}

export function DraftTab({
  entry,
  diag,
  meta,
  debate,
  turnValTrail,
  an,
  selectedTaxRefId,
  setSelectedTaxRefId,
  nodeWeights,
  taxNodeMap,
  allEdges,
}: DraftTabProps) {
  const stages = diag?.stage_diagnostics;
  const draftAttempts = stages?.filter(s => s.stage === 'draft') ?? [];
  const draftStage = draftAttempts.length > 0 ? draftAttempts[draftAttempts.length - 1] : undefined;
  const postDraftStage = stages?.find(s => s.stage === 'postDraft');
  const draftQualityStage = stages?.find(s => s.stage === 'draft_quality');

  // Build all draft stages across ALL orchestration attempts
  type DraftAttemptEntry = typeof draftAttempts[number] & {
    orchestrationRun: number;
    stageRetryIndex: number;
    stageRetryCount: number;
  };
  const orchAttempts = turnValTrail?.attempts ?? [];
  const allDraftAttempts: DraftAttemptEntry[] = orchAttempts.length > 0
    ? orchAttempts.flatMap((a, runIdx) => {
        const drafts = (a.stage_diagnostics ?? []).filter(s => s.stage === 'draft');
        return drafts.map((s, di) => ({
          ...s, orchestrationRun: runIdx, stageRetryIndex: di, stageRetryCount: drafts.length,
        }));
      })
    : [];
  const hasMultipleOrchRuns = orchAttempts.length > 1;
  const effectiveDraftAttempts: (typeof draftAttempts[number] & {
    orchestrationRun?: number; stageRetryIndex?: number; stageRetryCount?: number;
  })[] =
    allDraftAttempts.length > 0
      ? allDraftAttempts
      : draftAttempts.map((s, i, arr) => ({
          ...s, orchestrationRun: undefined, stageRetryIndex: i, stageRetryCount: arr.length,
        }));

  if (!draftStage && !entry.content) return null;

  const microFixPreStyle = { margin: '4px 0', padding: 6, background: 'rgba(0,0,0,0.15)', borderRadius: 4, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const, fontSize: 'var(--text-2xs)', maxHeight: 200, overflow: 'auto' as const };

  return (
    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
      {/* -- Top section: header + content from final draft -- */}
      {draftStage && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(34,197,94,0.2)', color: '#22c55e', fontWeight: 600 }}>DRAFT</span>
          <span>{draftStage.model}</span>
          <span>temp={draftStage.temperature}</span>
          <span>{(draftStage.response_time_ms / 1000).toFixed(1)}s</span>
        </div>
      )}
      {draftStage?.parse_error && (
        <div style={{ padding: '6px 8px', margin: '6px 0', background: 'rgba(220,38,38,0.1)', borderLeft: '3px solid #dc2626', borderRadius: 4, fontSize: '0.72rem', color: '#dc2626' }}>
          <strong>Parse error:</strong> {draftStage.parse_error}
        </div>
      )}
      {/* Directive compliance (from final draft) */}
      {(() => {
        const sv = (draftStage as Record<string, unknown> | undefined)?.stage_validation as {
          directive_compliance?: { compliant: boolean; repair_hint: string; directive_terms: string[]; matched_terms: number };
        } | undefined;
        const dc = sv?.directive_compliance;
        if (!dc) return null;
        return (
          <div style={{
            margin: '6px 0', padding: '5px 8px', borderRadius: 4, fontSize: '0.7rem',
            borderLeft: `3px solid ${dc.compliant ? '#22c55e' : '#ef4444'}`,
            background: dc.compliant ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
          }}>
            <div style={{ fontWeight: 600, color: dc.compliant ? '#22c55e' : '#ef4444', marginBottom: 2 }}>
              {dc.compliant ? '✓ Directive addressed' : '✗ Directive not addressed'}
            </div>
            {!dc.compliant && <div style={{ color: 'var(--text-secondary)' }}>{dc.repair_hint}</div>}
            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2 }}>
              {dc.matched_terms}/{dc.directive_terms.length} directive terms matched
              {dc.directive_terms.length > 0 && (
                <span style={{ marginLeft: 4 }}>({dc.directive_terms.join(', ')})</span>
              )}
            </div>
          </div>
        );
      })()}
      {/* Claim Sketches */}
      {draftStage && Array.isArray((draftStage.work_product as Record<string, unknown>).claim_sketches) && (
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Claim Sketches</summary>
          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
            {((draftStage.work_product as Record<string, unknown>).claim_sketches as { claim: string; targets: string[] }[]).map((c, i) => (
              <li key={i}>{c.claim}{c.targets?.length > 0 ? ` → ${c.targets.join(', ')}` : ''}</li>
            ))}
          </ul>
        </details>
      )}
      {/* Key Assumptions */}
      {draftStage && Array.isArray((draftStage.work_product as Record<string, unknown>).key_assumptions) && (
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Key Assumptions</summary>
          {((draftStage.work_product as Record<string, unknown>).key_assumptions as { assumption: string; if_wrong: string }[]).map((a, i) => (
            <div key={i} style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid rgba(34,197,94,0.3)' }}>
              <div><strong>Assumption:</strong> {a.assumption}</div>
              <div style={{ color: 'var(--text-muted)' }}><strong>If wrong:</strong> {a.if_wrong}</div>
            </div>
          ))}
        </details>
      )}
      {/* Disagreement type */}
      {draftStage && !!(draftStage.work_product as Record<string, unknown>).disagreement_type && (
        <div style={{ fontSize: '0.72rem', marginTop: 6 }}>
          <strong>Disagreement type:</strong> <Highlight text={String((draftStage.work_product as Record<string, unknown>).disagreement_type)} />
        </div>
      )}
      {/* Statement (from final draft) */}
      {draftStage && !!(draftStage.work_product as Record<string, unknown>).statement && (
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Statement</summary>
          <div style={{ fontSize: '0.75rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            <Highlight text={String((draftStage.work_product as Record<string, unknown>).statement)} />
          </div>
        </details>
      )}
      {/* Fallback: non-pipeline statement (old debates without stage_diagnostics) */}
      {!draftStage && diag && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(34,197,94,0.2)', color: '#22c55e', fontWeight: 600 }}>STATEMENT</span>
          <span>{diag.model}</span>
          {diag.response_time_ms && <span>{(diag.response_time_ms / 1000).toFixed(1)}s</span>}
        </div>
      )}
      {!draftStage && entry.content && (
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Statement</summary>
          <div style={{ fontSize: '0.75rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {typeof entry.content === 'string'
              ? <Highlight text={entry.content} />
              : <Highlight text={Array.isArray(entry.content)
                  ? (entry.content as unknown[]).map((item, i) => typeof item === 'string' ? item : (item as Record<string, unknown>)?.text ?? (item as Record<string, unknown>)?.content ?? JSON.stringify(item)).join('\n')
                  : JSON.stringify(entry.content, null, 2)} />}
          </div>
        </details>
      )}
      {/* Micro-Fix stages (abstract_claims, intervention_compliance, directive_compliance) */}
      {(() => {
        const microFixStages = diag?.stage_diagnostics?.filter(s => s.stage === 'micro-fix') ?? [];
        if (microFixStages.length === 0) return null;
        return microFixStages.map((mf, mi) => {
          const wp = mf.work_product as Record<string, unknown> | undefined;
          const success = wp?.success as boolean | undefined;
          const fixType = wp?.type as string | undefined;
          const elapsed = mf.response_time_ms ?? 0;
          const statusColor = success ? '#22c55e' : '#ef4444';

          // -- Intervention compliance --
          if (fixType === 'intervention_compliance') {
            const move = wp?.move as string | undefined;
            const field = wp?.field as string | undefined;
            const generated = wp?.generated_value as Record<string, unknown> | string | undefined;
            const recheck = wp?.recheck_result as { compliant?: boolean; repair_hint?: string } | undefined;
            const rejected = wp?.rejected_reason as string | undefined;
            return (
              <div key={mi} style={{
                margin: '6px 0', padding: '6px 8px',
                background: success ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                borderLeft: `3px solid ${statusColor}`,
                borderRadius: 4, fontSize: 'var(--text-2xs)',
              }}>
                <div style={{ fontWeight: 600, color: statusColor, marginBottom: 4 }}>
                  Micro-Fix: {move ?? 'Intervention'} Compliance ({elapsed}ms) — {success ? 'Applied' : rejected ? `Rejected (${rejected})` : recheck && !recheck.compliant ? 'Re-validation failed' : 'Failed'}
                </div>
                {field && (
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 4 }}>
                    Field: <code style={{ background: 'rgba(128,128,128,0.15)', padding: '1px 4px', borderRadius: 3 }}>{field}</code>
                    {!success && <span style={{ marginLeft: 6 }}>Before: <em>missing</em></span>}
                  </div>
                )}
                {generated != null && (
                  <details open={success} style={{ fontSize: 'var(--text-2xs)' }}>
                    <summary style={{ cursor: 'pointer', color: statusColor }}>
                      {success ? 'After — Generated value' : 'Attempted value (rejected)'}
                    </summary>
                    <pre style={microFixPreStyle}>
                      {typeof generated === 'string' ? generated : JSON.stringify(generated, null, 2)}
                    </pre>
                  </details>
                )}
                {recheck?.repair_hint && !recheck.compliant && (
                  <div style={{ fontSize: 'var(--text-2xs)', color: '#ef4444', marginTop: 4 }}>
                    {recheck.repair_hint}
                  </div>
                )}
              </div>
            );
          }

          // -- Directive compliance --
          if (fixType === 'directive_compliance') {
            const move = wp?.move as string | undefined;
            const revisedPara = wp?.revised_first_paragraph as string | undefined;
            const recheckCompliant = wp?.recheck_compliant as boolean | undefined;
            const rejected = wp?.rejected_reason as string | undefined;
            return (
              <div key={mi} style={{
                margin: '6px 0', padding: '6px 8px',
                background: success ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                borderLeft: `3px solid ${statusColor}`,
                borderRadius: 4, fontSize: 'var(--text-2xs)',
              }}>
                <div style={{ fontWeight: 600, color: statusColor, marginBottom: 4 }}>
                  Micro-Fix: Directive Compliance — {move ?? '?'} ({elapsed}ms) — {success ? 'Applied' : rejected ? `Rejected (${rejected})` : recheckCompliant === false ? 'Re-validation failed' : 'Failed'}
                </div>
                {revisedPara && (
                  <details open={success} style={{ fontSize: 'var(--text-2xs)' }}>
                    <summary style={{ cursor: 'pointer', color: statusColor }}>
                      {success ? 'After — Revised first paragraph' : 'Attempted revision (rejected)'}
                    </summary>
                    <pre style={microFixPreStyle}>{revisedPara}</pre>
                  </details>
                )}
                {mf.prompt && (
                  <details style={{ fontSize: 'var(--text-2xs)', marginTop: 4 }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>Micro-fix prompt</summary>
                    <pre style={microFixPreStyle}>{mf.prompt}</pre>
                  </details>
                )}
              </div>
            );
          }

          // -- Abstract claims (default) --
          const diffPassed = wp?.diff_check_passed as boolean | undefined;
          const changes = wp?.changes as Array<{ original?: string; revised?: string; fact_source?: string }> | undefined;
          const rejected = wp?.rejected_reason as string | undefined;
          const revisedStatement = wp?.revised_statement as string | undefined;
          return (
            <div key={mi} style={{
              margin: '6px 0', padding: '6px 8px',
              background: success ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
              borderLeft: `3px solid ${statusColor}`,
              borderRadius: 4, fontSize: 'var(--text-2xs)',
            }}>
              <div style={{ fontWeight: 600, color: statusColor, marginBottom: 4 }}>
                Micro-Fix: Abstract Claims ({elapsed}ms) — {success ? 'Applied' : diffPassed === false ? (rejected === 'hallucinated_changes' ? 'Rejected (hallucinated edits)' : 'Rejected (too many changes)') : 'Re-validation failed'}
                {changes && <span style={{ fontWeight: 400, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginLeft: 6 }}>{changes.length} change{changes.length !== 1 ? 's' : ''}</span>}
              </div>
              {changes && changes.length > 0 && (
                <div style={{ fontSize: 'var(--text-2xs)' }}>
                  {changes.map((c, ci) => (
                    <div key={ci} style={{ marginBottom: 6, padding: '3px 0', borderBottom: '1px solid rgba(128,128,128,0.1)' }}>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
                        <span style={{ fontSize: 'var(--text-2xs)', color: '#ef4444', fontWeight: 600, flexShrink: 0 }}>BEFORE</span>
                        <div style={{ color: 'var(--text-muted)', textDecoration: 'line-through', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {c.original ?? ''}
                        </div>
                      </div>
                      {c.revised && c.original !== c.revised && (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'baseline', marginTop: 2 }}>
                          <span style={{ fontSize: 'var(--text-2xs)', color: '#22c55e', fontWeight: 600, flexShrink: 0 }}>AFTER</span>
                          <div style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {c.revised}
                          </div>
                        </div>
                      )}
                      {c.fact_source && (
                        <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2, marginLeft: 48 }}>
                          source: {c.fact_source}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {revisedStatement && (
                <details style={{ fontSize: 'var(--text-2xs)', marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer', color: statusColor }}>
                    {success ? 'After — Full revised statement' : 'Attempted revision (rejected)'}
                  </summary>
                  <pre style={microFixPreStyle}>{revisedStatement}</pre>
                </details>
              )}
              {mf.prompt && (
                <details style={{ fontSize: 'var(--text-2xs)', marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>Micro-fix prompt</summary>
                  <pre style={microFixPreStyle}>{mf.prompt}</pre>
                </details>
              )}
            </div>
          );
        });
      })()}
      {/* Post-Draft Fixups (t/296/t/311) */}
      {postDraftStage && (() => {
        const wp = postDraftStage.work_product as Record<string, unknown> | undefined;
        if (!wp) return null;
        const autoSplit = wp.auto_split as boolean | undefined;
        const splitParas = wp.auto_split_paragraphs as number | undefined;
        const scrubbed = wp.citations_scrubbed as number | undefined;
        const linked = wp.links_added as number | undefined;
        const citWarn = wp.citation_warnings as number | undefined;
        const ignored = wp.ignored_evidence_docs as number | undefined;
        const hasAny = autoSplit || (scrubbed && scrubbed > 0) || (linked && linked > 0) || (citWarn && citWarn > 0);
        if (!hasAny) return null;
        return (
          <div style={{ margin: '6px 0', padding: '6px 8px', background: 'rgba(139,92,246,0.06)', borderLeft: '3px solid #8b5cf6', borderRadius: 4, fontSize: 'var(--text-2xs)' }}>
            <div style={{ fontWeight: 600, color: '#8b5cf6', marginBottom: 4 }}>Post-Draft Fixups ({postDraftStage.response_time_ms}ms)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {autoSplit && <div style={{ color: '#f59e0b' }}>&#9998; Auto-split → {splitParas} paragraphs</div>}
              {scrubbed != null && scrubbed > 0 && (
                <div>
                  <div style={{ color: '#ef4444' }}>&times; {scrubbed} citation(s) scrubbed</div>
                  {(() => {
                    const scrubbedList = wp.scrubbed_citations as string[] | undefined;
                    if (!scrubbedList || scrubbedList.length === 0) return null;
                    return (
                      <div style={{ marginLeft: 12, marginTop: 2, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                        {scrubbedList.map((cit, ci) => (
                          <div key={ci} style={{ textDecoration: 'line-through', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{cit}</div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
              {linked != null && linked > 0 && <div style={{ color: '#22c55e' }}>&#128279; Links added</div>}
              {citWarn != null && citWarn > 0 && (
                <div>
                  <div style={{ color: '#d97706' }}>&#9888; {citWarn} citation warning(s)</div>
                  {(() => {
                    const warnDetails = wp.citation_warning_details as string[] | undefined;
                    if (!warnDetails || warnDetails.length === 0) return null;
                    return (
                      <div style={{ marginLeft: 12, marginTop: 2, fontSize: 'var(--text-2xs)', color: '#d97706' }}>
                        {warnDetails.map((w, wi) => (
                          <div key={wi} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{w}</div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
              {ignored != null && ignored > 0 && (
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>{ignored} evidence doc(s) not cited</div>
                  {(() => {
                    const titles = wp.ignored_evidence_titles as string[] | undefined;
                    if (!titles || titles.length === 0) return null;
                    return (
                      <div style={{ marginLeft: 12, marginTop: 2, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        {titles.map((t, ti) => (
                          <div key={ti}>{t}</div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {/* Vocabulary Disambiguation (t/212) */}
      {(() => {
        const entryMeta = entry.metadata as Record<string, unknown> | undefined;
        const vocabRes = entryMeta?.vocabulary_resolutions as { colloquial: string; canonical: string; confidence: string; offset?: number }[] | undefined;
        const vocabAmb = entryMeta?.vocabulary_ambiguities as { colloquial: string; offset?: number }[] | undefined;
        if ((!vocabRes || vocabRes.length === 0) && (!vocabAmb || vocabAmb.length === 0)) return null;
        return (
          <details open>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>
              Disambiguated Terms ({(vocabRes?.length ?? 0) + (vocabAmb?.length ?? 0)})
              {vocabAmb && vocabAmb.length > 0 && (
                <span style={{ marginLeft: 6, color: '#d97706', fontWeight: 500 }}>
                  {new Set(vocabAmb.map(a => a.colloquial)).size} ambiguous
                </span>
              )}
            </summary>
            {vocabRes && vocabRes.length > 0 && (() => {
              // Dedup: same colloquial+canonical -> keep highest confidence
              const confRank = { high: 3, medium: 2, low: 1 } as Record<string, number>;
              const seen = new Map<string, typeof vocabRes[0]>();
              for (const r of vocabRes) {
                const key = `${r.colloquial}|${r.canonical}`;
                const existing = seen.get(key);
                if (!existing || (confRank[r.confidence] ?? 0) > (confRank[existing.confidence] ?? 0)) {
                  seen.set(key, r);
                }
              }
              const deduped = [...seen.values()].sort((a, b) =>
                a.colloquial.localeCompare(b.colloquial) || a.canonical.localeCompare(b.canonical)
              );
              return (
              <table style={{ fontSize: 'var(--text-2xs)', borderCollapse: 'collapse', marginBottom: 6 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '1px 4px', color: 'var(--text-muted)' }}>Term</th>
                    <th style={{ textAlign: 'left', padding: '1px 4px', color: 'var(--text-muted)' }}>Canonical</th>
                    <th style={{ textAlign: 'center', padding: '1px 4px', color: 'var(--text-muted)' }}>Conf</th>
                  </tr>
                </thead>
                <tbody>
                  {deduped.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(128,128,128,0.1)' }}>
                      <td style={{ padding: '1px 4px' }}>{r.colloquial}</td>
                      <td style={{ padding: '1px 4px', color: 'var(--text-secondary)' }}>{r.canonical}</td>
                      <td style={{
                        padding: '1px 4px', textAlign: 'center', fontWeight: 600,
                        color: r.confidence === 'high' ? '#22c55e' : r.confidence === 'low' ? '#ef4444' : '#d97706',
                      }}>{r.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              );
            })()}
            {vocabAmb && vocabAmb.length > 0 && (() => {
              const unique = [...new Set(vocabAmb.map(a => a.colloquial))].sort((a, b) => a.localeCompare(b));
              return (
              <div style={{ padding: '4px 8px', background: 'rgba(217,119,6,0.06)', borderLeft: '3px solid #d97706', borderRadius: 4, fontSize: 'var(--text-2xs)', marginBottom: 4 }}>
                <div style={{ fontWeight: 600, color: '#d97706', marginBottom: 2 }}>Ambiguous terms:</div>
                {unique.map((term, i) => (
                  <div key={i} style={{ marginLeft: 8 }}>&ldquo;{term}&rdquo;</div>
                ))}
              </div>
              );
            })()}
          </details>
        );
      })()}
      {/* Fact-check evidence detail -- shows web search evidence, queries, and citations */}
      {entry.type === 'fact-check' && (() => {
        const fcMeta = (entry.metadata as Record<string, unknown>)?.fact_check as Record<string, unknown> | undefined;
        if (!fcMeta) return null;
        const verdict = fcMeta.verdict as string | undefined;
        const explanation = fcMeta.explanation as string | undefined;
        const checkedText = fcMeta.checked_text as string | undefined;
        const webEvidence = fcMeta.web_search_evidence as string | undefined;
        const webQueries = Array.isArray(fcMeta.web_search_queries) ? fcMeta.web_search_queries as string[] : [];
        const webCitations = Array.isArray(fcMeta.web_search_citations) ? fcMeta.web_search_citations as Array<{ url?: string; title?: string; startIndex?: number; endIndex?: number }> : [];
        const targetAnId = fcMeta.target_an_id as string | undefined;
        const isAuto = !!targetAnId;
        return (<>
          <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Verdict</summary>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: '0.7rem' }}>
              <span style={{
                padding: '1px 8px', borderRadius: 4, fontWeight: 600, color: '#fff',
                background: verdict === 'verified' || verdict === 'supported' ? '#16a34a' : verdict === 'disputed' || verdict === 'false' ? '#dc2626' : '#6b7280',
              }}>{verdict ?? 'unknown'}</span>
              <span style={{ color: 'var(--text-muted)' }}>{isAuto ? 'auto-verified' : 'user-initiated'}</span>
              {targetAnId && <span style={{ color: 'var(--text-muted)' }}>AN: {targetAnId}</span>}
            </div>
            {checkedText && (
              <div style={{ fontSize: '0.7rem', padding: '4px 8px', background: 'rgba(249,115,22,0.08)', borderRadius: 4, borderLeft: '3px solid #f97316', marginBottom: 6 }}>
                {checkedText}
              </div>
            )}
            {explanation && (
              <div style={{ fontSize: '0.7rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{explanation}</div>
            )}
          </details>
          {webQueries.length > 0 && (() => {
            const isDomains = webQueries.every(q => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(q.trim()));
            const searchText = checkedText || '';
            const allSameQuery = !isDomains;
            return (
              <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>
                {isDomains ? `Web Sources (${webQueries.length})` : `Search Queries (${webQueries.length})`}
              </summary>
                {isDomains && searchText && (
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 4, fontStyle: 'italic' }}>
                    Query: &quot;{searchText.length > 100 ? searchText.slice(0, 97) + '...' : searchText}&quot;
                  </div>
                )}
                <ul style={{ fontSize: 'var(--text-2xs)', margin: '4px 0', paddingLeft: 16, listStyle: 'none' }}>
                  {webQueries.map((q, qi) => {
                    const trimmed = q.trim();
                    const looksLikeDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(trimmed);
                    const searchUrl = looksLikeDomain
                      ? `https://www.google.com/search?q=${encodeURIComponent(searchText + ' site:' + trimmed)}`
                      : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
                    return (
                      <li key={qi} style={{ marginBottom: 2 }}>
                        <a
                          href={searchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
                          title={looksLikeDomain ? `Search "${searchText}" on ${trimmed}` : `Search Google for "${trimmed}"`}
                        >
                          {trimmed}
                        </a>
                        {!allSameQuery && !looksLikeDomain && (
                          <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 'var(--text-2xs)' }}>(query)</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })()}
          {webEvidence && (
            <details><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Web Evidence</summary>
              <pre style={{ fontSize: 'var(--text-2xs)', whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto', background: 'var(--bg-secondary)', padding: 8, borderRadius: 4 }}>{webEvidence}</pre>
            </details>
          )}
          {webCitations.length > 0 && (
            <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Citations ({webCitations.length})</summary>
              <div style={{ fontSize: 'var(--text-2xs)' }}>
                {webCitations.map((c, ci) => (
                  <div key={ci} style={{ margin: '2px 0', paddingLeft: 8, borderLeft: '2px solid rgba(34,197,94,0.3)' }}>
                    {c.title && <div style={{ fontWeight: 600 }}>{c.title}</div>}
                    {c.url && <div style={{ color: 'var(--text-muted)', wordBreak: 'break-all' }}>{c.url}</div>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </>);
      })()}
      {/* -- Per-turn sections (from all orchestration attempts) -- */}
      {effectiveDraftAttempts.length > 0 && (() => {
        let prevOrchRun: number | undefined;
        return effectiveDraftAttempts.map((attempt, ai) => {
          const orchRun = (attempt as { orchestrationRun?: number }).orchestrationRun;
          const retryIdx = (attempt as { stageRetryIndex?: number }).stageRetryIndex ?? 0;
          const retryCount = (attempt as { stageRetryCount?: number }).stageRetryCount ?? 1;
          const isLastInRun = retryIdx === retryCount - 1;
          const hasStageRetries = retryCount > 1;
          const isFinal = ai === effectiveDraftAttempts.length - 1;
          const valData = (attempt as Record<string, unknown>).stage_validation as { pass: boolean; hints: string[]; details?: { rule: string; pass: boolean; value?: string; flagged_claims?: string[] }[] } | undefined;
          const allHints = valData?.hints ?? [];
          // Pull draft + judge hints from overall validation for the final attempt
          const overallHints = isFinal
            ? (turnValTrail?.final.repairHints ?? []).filter(h => classifyHintTarget(h) !== 'cite')
            : [];
          const combinedHints = [...allHints, ...overallHints];
          const turnScore = isFinal ? turnValTrail?.final.process_reward : undefined;

          // Orchestration run header
          const showOrchHeader = hasMultipleOrchRuns && orchRun !== prevOrchRun && orchRun != null;
          const orchAttemptData = orchRun != null ? orchAttempts[orchRun] : undefined;
          const orchOutcome = orchAttemptData?.validation?.outcome;
          const orchAccepted = orchOutcome === 'pass' || orchOutcome === 'accept_with_flag';
          prevOrchRun = orchRun;

          return (
            <div key={ai}>
              {/* Orchestration run header */}
              {showOrchHeader && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 4px',
                  fontSize: 'var(--text-2xs)', fontWeight: 700, color: orchAccepted ? '#16a34a' : '#dc2626',
                }}>
                  <div style={{ flex: 1, height: 2, background: orchAccepted ? 'rgba(22,163,74,0.3)' : 'rgba(220,38,38,0.3)' }} />
                  <span>Orchestration Run {orchRun! + 1}{orchAccepted ? ' (accepted)' : ' (rejected by judge)'}</span>
                  <div style={{ flex: 1, height: 2, background: orchAccepted ? 'rgba(22,163,74,0.3)' : 'rgba(220,38,38,0.3)' }} />
                </div>
              )}
              {/* Orchestration-level validation */}
              {showOrchHeader && orchAttemptData?.validation && (() => {
                const ov = orchAttemptData.validation;
                const dims = ov.dimensions;
                const score = ov.process_reward;
                const stageA =
                  0.4 * (dims.schema.pass ? 1 : 0) +
                  0.3 * (dims.grounding.pass ? 1 : 0) +
                  0.2 * (dims.advancement.pass ? 1 : 0) +
                  0.1 * (dims.clarifies.pass ? 1 : 0);
                const judgeQ = stageA > 0
                  ? Math.max(0, Math.min(1, (score - 0.4 * stageA) / 0.6))
                  : 0.7;
                const mono = { fontFamily: 'monospace', fontSize: 'var(--text-2xs)' } as const;
                const dimColor = (pass: boolean) => pass ? '#16a34a' : '#dc2626';
                const orchHints = ov.repairHints ?? [];
                return (
                  <div style={{
                    margin: '4px 0 8px', borderRadius: 4, padding: '6px 8px', fontSize: '0.7rem',
                    background: orchAccepted ? 'rgba(22,163,74,0.06)' : 'rgba(220,38,38,0.06)',
                    border: `1px solid ${orchAccepted ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)'}`,
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>Orchestration Score:{' '}
                        <span style={{ ...mono, color: score >= 0.7 ? '#16a34a' : score >= 0.5 ? '#d97706' : '#dc2626' }}>
                          {score.toFixed(2)}
                        </span>
                      </span>
                      <span style={{
                        fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                        color: orchAccepted ? '#16a34a' : '#dc2626',
                        background: orchAccepted ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.15)',
                      }}>
                        {orchAccepted ? 'ACCEPTED' : 'REJECTED BY JUDGE'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: 'var(--text-2xs)' }}>
                      <span><span style={{ color: dimColor(dims.schema.pass) }}>●</span> schema ×0.4 = <strong style={mono}>{(0.4 * (dims.schema.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      <span><span style={{ color: dimColor(dims.grounding.pass) }}>●</span> grounding ×0.3 = <strong style={mono}>{(0.3 * (dims.grounding.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      <span><span style={{ color: dimColor(dims.advancement.pass) }}>●</span> advancement ×0.2 = <strong style={mono}>{(0.2 * (dims.advancement.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      <span><span style={{ color: dimColor(dims.clarifies.pass) }}>●</span> clarifies ×0.1 = <strong style={mono}>{(0.1 * (dims.clarifies.pass ? 1 : 0)).toFixed(2)}</strong></span>
                    </div>
                    <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 3, fontSize: 'var(--text-2xs)', display: 'flex', gap: 12 }}>
                      <span>Stage A: <strong style={mono}>{stageA.toFixed(2)}</strong> <span style={{ color: 'var(--text-muted)' }}>×0.4 = {(0.4 * stageA).toFixed(2)}</span></span>
                      <span>Judge: <strong style={mono}>{judgeQ.toFixed(2)}</strong>{!ov.judge_used && <span style={{ color: 'var(--text-muted)' }}> (default)</span>} <span style={{ color: 'var(--text-muted)' }}>×0.6 = {(0.6 * judgeQ).toFixed(2)}</span></span>
                      <span>Total: <strong style={{ ...mono, color: score >= 0.7 ? '#16a34a' : score >= 0.5 ? '#d97706' : '#dc2626' }}>{score.toFixed(2)}</strong></span>
                    </div>
                    {orchHints.length > 0 && (
                      <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 3 }}>
                        <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, marginBottom: 2 }}>Caveats</div>
                        <ul style={{ margin: '2px 0 0 16px', padding: 0, fontSize: 'var(--text-2xs)' }}>
                          {orchHints.map((h, hi) => {
                            const target = classifyHintTarget(h);
                            const ts = HINT_TARGET_STYLE[target];
                            return (
                              <li key={hi} style={{ marginBottom: 2 }}>
                                <span style={{
                                  display: 'inline-block', fontSize: 'var(--text-2xs)', fontWeight: 700,
                                  color: ts.color, background: ts.bg, padding: '1px 4px',
                                  borderRadius: 2, marginRight: 4, verticalAlign: 'middle',
                                }}>{ts.label}</span>
                                {humanizeSpeakerIds(h)}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Draft attempt header */}
              {(hasStageRetries || hasMultipleOrchRuns || effectiveDraftAttempts.length > 1) && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 6px',
                  fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontWeight: 600,
                }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span>
                    Draft Attempt {retryIdx + 1}
                    {hasStageRetries && (
                      <span style={{
                        marginLeft: 4, fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '1px 5px',
                        borderRadius: 3, verticalAlign: 'middle',
                        color: isLastInRun ? '#16a34a' : '#d97706',
                        background: isLastInRun ? 'rgba(22,163,74,0.12)' : 'rgba(217,119,6,0.12)',
                      }}>
                        {isLastInRun ? 'final' : 'refined'}
                      </span>
                    )}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
              )}
              <ArtifactBlock label="Raw Prompt" text={attempt.prompt} />
              <ArtifactBlock label="Raw Response" text={attempt.raw_response} />
              {/* Validation Score -- show the work */}
              {(() => {
                const dims = isFinal ? turnValTrail?.final.dimensions : undefined;
                const judgeUsed = isFinal ? turnValTrail?.final.judge_used ?? false : false;
                if (turnScore != null && dims) {
                  const stageA =
                    0.4 * (dims.schema.pass ? 1 : 0) +
                    0.3 * (dims.grounding.pass ? 1 : 0) +
                    0.2 * (dims.advancement.pass ? 1 : 0) +
                    0.1 * (dims.clarifies.pass ? 1 : 0);
                  const judgeQ = stageA > 0
                    ? Math.max(0, Math.min(1, (turnScore - 0.4 * stageA) / 0.6))
                    : 0.7;
                  const mono = { fontFamily: 'monospace', fontSize: 'var(--text-2xs)' } as const;
                  const dimColor = (pass: boolean) => pass ? '#16a34a' : '#dc2626';
                  return (
                    <div style={{
                      marginTop: 6, background: 'var(--bg-subtle)', borderRadius: 4,
                      padding: '5px 8px', fontSize: '0.7rem',
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        Validation Score:{' '}
                        <span style={{ ...mono, color: turnScore >= 0.7 ? '#16a34a' : turnScore >= 0.5 ? '#d97706' : '#dc2626' }}>
                          {turnScore.toFixed(2)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: 'var(--text-2xs)' }}>
                        <span><span style={{ color: dimColor(dims.schema.pass) }}>●</span> schema ×0.4 = <strong style={mono}>{(0.4 * (dims.schema.pass ? 1 : 0)).toFixed(2)}</strong></span>
                        <span><span style={{ color: dimColor(dims.grounding.pass) }}>●</span> grounding ×0.3 = <strong style={mono}>{(0.3 * (dims.grounding.pass ? 1 : 0)).toFixed(2)}</strong></span>
                        <span><span style={{ color: dimColor(dims.advancement.pass) }}>●</span> advancement ×0.2 = <strong style={mono}>{(0.2 * (dims.advancement.pass ? 1 : 0)).toFixed(2)}</strong></span>
                        <span><span style={{ color: dimColor(dims.clarifies.pass) }}>●</span> clarifies ×0.1 = <strong style={mono}>{(0.1 * (dims.clarifies.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      </div>
                      <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 3, fontSize: 'var(--text-2xs)', display: 'flex', gap: 12 }}>
                        <span>Stage A: <strong style={mono}>{stageA.toFixed(2)}</strong> <span style={{ color: 'var(--text-muted)' }}>×0.4 = {(0.4 * stageA).toFixed(2)}</span></span>
                        <span>Judge: <strong style={mono}>{judgeQ.toFixed(2)}</strong>{!judgeUsed && <span style={{ color: 'var(--text-muted)' }}> (default)</span>} <span style={{ color: 'var(--text-muted)' }}>×0.6 = {(0.6 * judgeQ).toFixed(2)}</span></span>
                        <span>Total: <strong style={{ ...mono, color: turnScore >= 0.7 ? '#16a34a' : turnScore >= 0.5 ? '#d97706' : '#dc2626' }}>{turnScore.toFixed(2)}</strong></span>
                      </div>
                    </div>
                  );
                }
                // Fallback: no dimensions available
                return (
                  <div style={{ marginTop: 6, fontSize: '0.72rem' }}>
                    <div style={{ fontWeight: 600 }}>
                      Per-stage Validation:{' '}
                      {valData ? (
                        <span style={{ color: valData.pass ? '#16a34a' : '#dc2626' }}>
                          {valData.pass ? 'Pass' : 'Fail'}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </div>
                    {valData?.details && valData.details.length > 0 && (
                      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--text-2xs)' }}>
                        {valData.details.map((d, di) => (
                          <div key={di}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ color: d.pass ? '#16a34a' : '#dc2626', fontSize: '0.7rem' }}>{d.pass ? '✓' : '✗'}</span>
                              <span style={{ color: 'var(--text-primary)' }}>{d.rule}</span>
                              {d.value && <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 'var(--text-2xs)' }}>{d.value}</span>}
                            </div>
                            {d.flagged_claims && d.flagged_claims.length > 0 && (
                              <div style={{ marginLeft: 20, marginTop: 2, fontSize: 'var(--text-2xs)', color: '#dc2626' }}>
                                {d.flagged_claims.map((claim: string, ci: number) => (
                                  <div key={ci} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 1 }}>• {claim}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Validation Feedback */}
              {combinedHints.length > 0 && (
                <details open style={{ marginTop: 4, fontSize: '0.72rem' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Validation Feedback</summary>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: '0.7rem' }}>
                    {combinedHints.map((h, hi) => {
                      const target = classifyHintTarget(h);
                      const ts = HINT_TARGET_STYLE[target];
                      return (
                        <li key={hi} style={{ marginBottom: 3 }}>
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
              </details>
            )}
              {/* Per-attempt Micro-Fix stages */}
              {(() => {
                const attemptMicroFixes = orchAttemptData?.stage_diagnostics?.filter(
                  (s: { stage: string }) => s.stage === 'micro-fix',
                ) ?? [];
                if (attemptMicroFixes.length === 0) return null;
                const mfPreStyle = { margin: '4px 0', padding: 6, background: 'rgba(0,0,0,0.15)', borderRadius: 4, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const, fontSize: 'var(--text-2xs)', maxHeight: 200, overflow: 'auto' as const };
                return attemptMicroFixes.map((mf: { stage: string; prompt?: string; raw_response?: string; response_time_ms?: number; work_product?: Record<string, unknown> }, mi: number) => {
                  const wp = mf.work_product;
                  const success = wp?.success as boolean | undefined;
                  const fixType = wp?.type as string | undefined;
                  const elapsed = mf.response_time_ms ?? 0;
                  const statusColor = success ? '#22c55e' : '#ef4444';

                  if (fixType === 'intervention_compliance') {
                    const move = wp?.move as string | undefined;
                    const field = wp?.field as string | undefined;
                    const generated = wp?.generated_value as Record<string, unknown> | string | undefined;
                    const recheck = wp?.recheck_result as { compliant?: boolean; repair_hint?: string } | undefined;
                    const rejected = wp?.rejected_reason as string | undefined;
                    return (
                      <div key={`mf-${mi}`} style={{
                        margin: '6px 0', padding: '6px 8px',
                        background: success ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                        borderLeft: `3px solid ${statusColor}`,
                        borderRadius: 4, fontSize: 'var(--text-2xs)',
                      }}>
                        <div style={{ fontWeight: 600, color: statusColor, marginBottom: 4 }}>
                          Micro-Fix: {move ?? 'Intervention'} Compliance ({elapsed}ms) — {success ? 'Applied' : rejected ? `Rejected (${rejected})` : recheck && !recheck.compliant ? 'Re-validation failed' : 'Failed'}
                        </div>
                        {field && (
                          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 4 }}>
                            Field: <code style={{ background: 'rgba(128,128,128,0.15)', padding: '1px 4px', borderRadius: 3 }}>{field}</code>
                            {!success && <span style={{ marginLeft: 6 }}>Before: <em>missing</em></span>}
                          </div>
                        )}
                        {generated != null && (
                          <details open={success} style={{ fontSize: 'var(--text-2xs)' }}>
                            <summary style={{ cursor: 'pointer', color: statusColor }}>
                              {success ? 'After — Generated value' : 'Attempted value (rejected)'}
                            </summary>
                            <pre style={mfPreStyle}>
                              {typeof generated === 'string' ? generated : JSON.stringify(generated, null, 2)}
                            </pre>
                          </details>
                        )}
                        {recheck?.repair_hint && !recheck.compliant && (
                          <div style={{ fontSize: 'var(--text-2xs)', color: '#ef4444', marginTop: 4 }}>
                            {recheck.repair_hint}
                          </div>
                        )}
                      </div>
                    );
                  }

                  if (fixType === 'directive_compliance') {
                    const move = wp?.move as string | undefined;
                    const revisedPara = wp?.revised_first_paragraph as string | undefined;
                    const recheckCompliant = wp?.recheck_compliant as boolean | undefined;
                    const rejected = wp?.rejected_reason as string | undefined;
                    return (
                      <div key={`mf-${mi}`} style={{
                        margin: '6px 0', padding: '6px 8px',
                        background: success ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                        borderLeft: `3px solid ${statusColor}`,
                        borderRadius: 4, fontSize: 'var(--text-2xs)',
                      }}>
                        <div style={{ fontWeight: 600, color: statusColor, marginBottom: 4 }}>
                          Micro-Fix: Directive Compliance — {move ?? '?'} ({elapsed}ms) — {success ? 'Applied' : rejected ? `Rejected (${rejected})` : recheckCompliant === false ? 'Re-validation failed' : 'Failed'}
                        </div>
                        {revisedPara && (
                          <details open={success} style={{ fontSize: 'var(--text-2xs)' }}>
                            <summary style={{ cursor: 'pointer', color: statusColor }}>
                              {success ? 'After — Revised first paragraph' : 'Attempted revision (rejected)'}
                            </summary>
                            <pre style={mfPreStyle}>{revisedPara}</pre>
                          </details>
                        )}
                      </div>
                    );
                  }

                  const changes = wp?.changes as Array<{ original?: string; revised?: string; fact_source?: string }> | undefined;
                  const diffPassed = wp?.diff_check_passed as boolean | undefined;
                  const rejected = wp?.rejected_reason as string | undefined;
                  const revisedStatement = wp?.revised_statement as string | undefined;
                  return (
                    <div key={`mf-${mi}`} style={{
                      margin: '6px 0', padding: '6px 8px',
                      background: success ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                      borderLeft: `3px solid ${statusColor}`,
                      borderRadius: 4, fontSize: 'var(--text-2xs)',
                    }}>
                      <div style={{ fontWeight: 600, color: statusColor, marginBottom: 4 }}>
                        Micro-Fix: Abstract Claims ({elapsed}ms) — {success ? 'Applied' : diffPassed === false ? (rejected === 'hallucinated_changes' ? 'Rejected (hallucinated edits)' : 'Rejected (too many changes)') : 'Re-validation failed'}
                        {changes && <span style={{ fontWeight: 400, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginLeft: 6 }}>{changes.length} change{changes.length !== 1 ? 's' : ''}</span>}
                      </div>
                      {changes && changes.length > 0 && (
                        <div style={{ fontSize: 'var(--text-2xs)' }}>
                          {changes.map((c, ci) => (
                            <div key={ci} style={{ marginBottom: 6, padding: '3px 0', borderBottom: '1px solid rgba(128,128,128,0.1)' }}>
                              <div style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
                                <span style={{ fontSize: 'var(--text-2xs)', color: '#ef4444', fontWeight: 600, flexShrink: 0 }}>BEFORE</span>
                                <div style={{ color: 'var(--text-muted)', textDecoration: 'line-through', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.original ?? ''}</div>
                              </div>
                              {c.revised && c.original !== c.revised && (
                                <div style={{ display: 'flex', gap: 4, alignItems: 'baseline', marginTop: 2 }}>
                                  <span style={{ fontSize: 'var(--text-2xs)', color: '#22c55e', fontWeight: 600, flexShrink: 0 }}>AFTER</span>
                                  <div style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.revised}</div>
                                </div>
                              )}
                              {c.fact_source && (
                                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2, marginLeft: 48 }}>source: {c.fact_source}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {revisedStatement && (
                        <details style={{ fontSize: 'var(--text-2xs)', marginTop: 4 }}>
                          <summary style={{ cursor: 'pointer', color: statusColor }}>
                            {success ? 'After — Full revised statement' : 'Attempted revision (rejected)'}
                          </summary>
                          <pre style={mfPreStyle}>{revisedStatement}</pre>
                        </details>
                      )}
                    </div>
                  );
                });
              })()}
          </div>
        );
      });
    })()}
    {/* -- Quality Pre-Check (draft_quality stage) -- */}
    {draftQualityStage && (() => {
      const wp = draftQualityStage.work_product as {
        grounded?: boolean; falsifiable?: boolean; engages?: boolean; topic_aligned?: boolean; weaknesses?: string[];
      };
      const indicators: [string, boolean | undefined][] = [
        ['Grounded', wp.grounded],
        ['Falsifiable', wp.falsifiable],
        ['Engages', wp.engages],
        ['Topic Aligned', wp.topic_aligned],
      ];
      const allPass = indicators.every(([, v]) => v === true);
      return (
        <div style={{
          margin: '10px 0 4px', borderRadius: 4, padding: '6px 8px', fontSize: '0.7rem',
          background: allPass ? 'rgba(22,163,74,0.06)' : 'rgba(245,158,11,0.06)',
          border: `1px solid ${allPass ? 'rgba(22,163,74,0.2)' : 'rgba(245,158,11,0.2)'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 'var(--text-2xs)' }}>Quality Pre-Check</span>
            <span style={{ fontSize: 'var(--text-2xs)', padding: '1px 5px', borderRadius: 3, background: 'rgba(99,102,241,0.12)', color: '#6366f1', fontWeight: 600 }}>Draft Attempt 1</span>
            {diag?.topic_alignment?.repaired && (
              <span style={{ fontSize: 'var(--text-2xs)', padding: '1px 5px', borderRadius: 3, background: 'rgba(245,158,11,0.15)', color: '#d97706', fontWeight: 600 }}>triggered regen</span>
            )}
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{draftQualityStage.model}</span>
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{(draftQualityStage.response_time_ms / 1000).toFixed(1)}s</span>
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 'var(--text-2xs)' }}>
            {indicators.map(([label, pass]) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ color: pass ? '#16a34a' : '#dc2626', fontWeight: 700 }}>{pass ? '✓' : '✗'}</span>
                <span>{label}</span>
              </span>
            ))}
          </div>
          {wp.weaknesses && wp.weaknesses.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 3 }}>
              <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, marginBottom: 2, color: '#d97706' }}>Weaknesses</div>
              <ul style={{ margin: '2px 0 0 16px', padding: 0, fontSize: 'var(--text-2xs)' }}>
                {wp.weaknesses.map((w, wi) => (
                  <li key={wi} style={{ marginBottom: 2 }}>{humanizeSpeakerIds(w)}</li>
                ))}
              </ul>
            </div>
          )}
          {draftQualityStage.parse_error && (
            <div style={{ padding: '4px 6px', marginTop: 4, background: 'rgba(220,38,38,0.1)', borderLeft: '3px solid #dc2626', borderRadius: 3, fontSize: 'var(--text-2xs)', color: '#dc2626' }}>
              <strong>Parse error:</strong> {draftQualityStage.parse_error}
            </div>
          )}
        </div>
      );
    })()}
    {/* -- Topic Alignment Detail (per-attempt) -- */}
    {diag?.topic_alignment && (() => {
      const ta = diag.topic_alignment;
      const qg = diag.quality_gate as {
        pre_repair: { grounded: boolean; falsifiable: boolean; engages: boolean; topic_aligned: boolean; pass: boolean; weaknesses: string[] };
        post_repair?: { grounded: boolean; falsifiable: boolean; engages: boolean; topic_aligned: boolean; pass: boolean; weaknesses: string[] };
        repair_outcome?: 'fixed' | 'partial' | 'unchanged';
      } | undefined;
      const scope = ta.scope_used;
      const attempts: { label: string; aligned: boolean; weaknesses: string[] }[] = [];
      if (qg) {
        attempts.push({ label: 'Draft 1', aligned: qg.pre_repair.topic_aligned, weaknesses: qg.pre_repair.weaknesses });
        if (qg.post_repair) {
          attempts.push({ label: 'Draft 2 (regen)', aligned: qg.post_repair.topic_aligned, weaknesses: qg.post_repair.weaknesses });
        }
      } else {
        attempts.push({ label: 'Draft 1', aligned: ta.topic_aligned, weaknesses: [] });
      }
      const finalAligned = ta.topic_aligned;
      return (
        <div style={{
          margin: '10px 0 4px', borderRadius: 4, padding: '6px 8px', fontSize: '0.7rem',
          background: finalAligned ? 'rgba(22,163,74,0.06)' : 'rgba(220,38,38,0.06)',
          border: `1px solid ${finalAligned ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)'}`,
        }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--text-2xs)', marginBottom: 6 }}>Topic Alignment</div>
          {attempts.map((att, ai) => {
            const topicWeaknesses = att.weaknesses.filter(w =>
              /\b(off.?scope|off.?topic|drift|outside.*scope|beyond.*scope|scope|domain|severity|magnitude|escalat|disproportionate|catastroph|existential|extinction|civiliz)\b/i.test(w)
            );
            const driftType = !att.aligned && scope && topicWeaknesses.length > 0
              ? classifyOffScopeDrift(topicWeaknesses, scope)
              : null;
            const repairHint = driftType && scope ? offScopeRepairHint(driftType, scope) : null;
            return (
              <div key={ai} style={{ marginBottom: ai < attempts.length - 1 ? 8 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 600 }}>{att.label}</span>
                  <span style={{
                    padding: '1px 6px', borderRadius: 3, fontWeight: 600, fontSize: 'var(--text-2xs)',
                    background: att.aligned ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)',
                    color: att.aligned ? '#16a34a' : '#dc2626',
                  }}>{att.aligned ? 'ON-SCOPE' : 'OFF-SCOPE'}</span>
                  {driftType && (
                    <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, background: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>
                      {driftType} drift
                    </span>
                  )}
                  {ai === attempts.length - 1 && qg?.repair_outcome && (
                    <span style={{
                      padding: '1px 5px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600,
                      background: qg.repair_outcome === 'fixed' ? 'rgba(22,163,74,0.15)' : qg.repair_outcome === 'partial' ? 'rgba(245,158,11,0.15)' : 'rgba(220,38,38,0.1)',
                      color: qg.repair_outcome === 'fixed' ? '#16a34a' : qg.repair_outcome === 'partial' ? '#d97706' : '#dc2626',
                    }}>repair: {qg.repair_outcome}</span>
                  )}
                </div>
                {!att.aligned && topicWeaknesses.length > 0 && (
                  <div style={{ marginTop: 3, paddingLeft: 8, borderLeft: '2px solid #dc262644' }}>
                    <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, color: '#dc2626', marginBottom: 2 }}>Why off-scope:</div>
                    <ul style={{ margin: '2px 0 0 12px', padding: 0, fontSize: 'var(--text-2xs)' }}>
                      {topicWeaknesses.map((w, wi) => <li key={wi} style={{ marginBottom: 1 }}>{humanizeSpeakerIds(w)}</li>)}
                    </ul>
                    {repairHint && (
                      <div style={{ marginTop: 3, fontSize: 'var(--text-2xs)', color: '#d97706', fontStyle: 'italic', paddingLeft: 4 }}>
                        <strong>Repair instruction:</strong> {repairHint}
                      </div>
                    )}
                  </div>
                )}
                {!att.aligned && topicWeaknesses.length === 0 && att.weaknesses.length > 0 && (
                  <div style={{ marginTop: 3, paddingLeft: 8, borderLeft: '2px solid #dc262644' }}>
                    <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, color: '#dc2626', marginBottom: 2 }}>Why off-scope:</div>
                    <ul style={{ margin: '2px 0 0 12px', padding: 0, fontSize: 'var(--text-2xs)' }}>
                      {att.weaknesses.map((w, wi) => <li key={wi} style={{ marginBottom: 1 }}>{humanizeSpeakerIds(w)}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
          {scope && (
            <details style={{ marginTop: 6, fontSize: 'var(--text-2xs)' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontWeight: 600 }}>Scope Definition</summary>
              <div style={{ marginTop: 3, paddingLeft: 8 }}>
                {scope.core_proposition && (
                  <div style={{ marginBottom: 3 }}><strong>Core proposition:</strong> {scope.core_proposition}</div>
                )}
                {scope.domain && (
                  <div style={{ marginBottom: 3 }}><strong>Domain:</strong> {scope.domain}</div>
                )}
                {scope.example_ceiling && (
                  <div style={{ marginBottom: 3 }}><strong>Example ceiling:</strong> {scope.example_ceiling}</div>
                )}
                {scope.off_scope_topics && scope.off_scope_topics.length > 0 && (
                  <div style={{ marginBottom: 3 }}>
                    <strong>Off-scope topics:</strong>
                    <ul style={{ margin: '2px 0 0 12px', padding: 0 }}>
                      {scope.off_scope_topics.map((t: string, i: number) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                )}
                {scope.drift_signatures && scope.drift_signatures.length > 0 && (
                  <div>
                    <strong>Drift signatures:</strong>
                    <ul style={{ margin: '2px 0 0 12px', padding: 0 }}>
                      {scope.drift_signatures.map((s: string, i: number) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      );
    })()}
    </div>
  );
}
