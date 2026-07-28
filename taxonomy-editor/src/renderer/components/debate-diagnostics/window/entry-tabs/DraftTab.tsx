// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import type { EntryDiagnostics, ArgumentNetworkNode, ArgumentNetworkEdge, TurnValidationTrail, TurnAttempt } from '../../../../types/debate';
import { humanizeSpeakerIds } from '../../../../utils/humanizeSpeakers';
import { classifyOffScopeDrift, offScopeRepairHint } from '@lib/debate/prompts';
import { Highlight, CopyButton } from '../helpers';
import { classifyHintTarget, HINT_TARGET_STYLE, ArtifactBlock } from '../shared';
import { TaxonomyRefDetail, type TaxRefNode, type TaxRefEdge } from '../../../taxonomy/TaxonomyRefDetail';
import './DraftTab.css';

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

  return (
    <div className="draft-root">
      {/* -- Top section: header + content from final draft -- */}
      {draftStage && (
        <div className="draft-header-row">
          <span className="draft-chip-success">DRAFT</span>
          <span>{draftStage.model}</span>
          <span>temp={draftStage.temperature}</span>
          <span>{(draftStage.response_time_ms / 1000).toFixed(1)}s</span>
        </div>
      )}
      {draftStage?.parse_error && (
        <div className="draft-parse-error">
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
          // eslint-disable-next-line local/no-inline-style -- compliance-driven border/background
          <div style={{
            margin: '6px 0', padding: '5px 8px', borderRadius: 4, fontSize: '0.7rem',
            borderLeft: `3px solid ${dc.compliant ? 'var(--success)' : 'var(--danger)'}`,
            background: dc.compliant ? 'color-mix(in srgb, var(--success) 6%, transparent)' : 'color-mix(in srgb, var(--danger) 6%, transparent)',
          }}>
            {/* eslint-disable-next-line local/no-inline-style -- compliance-driven color */}
            <div style={{ fontWeight: 600, color: dc.compliant ? 'var(--success)' : 'var(--danger)', marginBottom: 2 }}>
              {dc.compliant ? '✓ Directive addressed' : '✗ Directive not addressed'}
            </div>
            {!dc.compliant && <div className="draft-text-secondary">{dc.repair_hint}</div>}
            <div className="draft-terms-note">
              {dc.matched_terms}/{dc.directive_terms.length} directive terms matched
              {dc.directive_terms.length > 0 && (
                <span className="draft-ml4">({dc.directive_terms.join(', ')})</span>
              )}
            </div>
          </div>
        );
      })()}
      {/* Claim Sketches */}
      {draftStage && Array.isArray((draftStage.work_product as Record<string, unknown>).claim_sketches) && (
        <details open><summary className="draft-summary">Claim Sketches</summary>
          <ul className="draft-ul-72">
            {((draftStage.work_product as Record<string, unknown>).claim_sketches as { claim: string; targets: string[] }[]).map((c, i) => (
              <li key={i}>{c.claim}{c.targets?.length > 0 ? ` → ${c.targets.join(', ')}` : ''}</li>
            ))}
          </ul>
        </details>
      )}
      {/* Key Assumptions */}
      {((): React.ReactNode => {
        if (!draftStage || !Array.isArray((draftStage.work_product as Record<string, unknown>).key_assumptions)) return null;
        return (
          <details open><summary className="draft-summary">Key Assumptions</summary>
            {((draftStage.work_product as Record<string, unknown>).key_assumptions as { assumption: string; if_wrong: string }[]).map((a, i) => (
              <div key={i} className="draft-assumption">
                <div><strong>Assumption:</strong> {a.assumption}</div>
                <div className="draft-text-muted"><strong>If wrong:</strong> {a.if_wrong}</div>
              </div>
            ))}
          </details>
        );
      })()}
      {/* Disagreement type */}
      {draftStage && !!(draftStage.work_product as Record<string, unknown>).disagreement_type && (
        <div className="draft-disagreement">
          <strong>Disagreement type:</strong> <Highlight text={String((draftStage.work_product as Record<string, unknown>).disagreement_type)} />
        </div>
      )}
      {/* Statement (from final draft) */}
      {draftStage && !!(draftStage.work_product as Record<string, unknown>).statement && (
        <details open><summary className="draft-summary">Statement</summary>
          <div className="draft-statement-body">
            <Highlight text={String((draftStage.work_product as Record<string, unknown>).statement)} />
          </div>
        </details>
      )}
      {/* Fallback: non-pipeline statement (old debates without stage_diagnostics) */}
      {!draftStage && diag && (
        <div className="draft-header-row">
          <span className="draft-chip-success">STATEMENT</span>
          <span>{diag.model}</span>
          {diag.response_time_ms && <span>{(diag.response_time_ms / 1000).toFixed(1)}s</span>}
        </div>
      )}
      {!draftStage && !!entry.content && (
        <details open><summary className="draft-summary">Statement</summary>
          <div className="draft-statement-body">
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
          const statusColor = success ? 'var(--success)' : 'var(--danger)';

          // -- Intervention compliance --
          if (fixType === 'intervention_compliance') {
            const move = wp?.move as string | undefined;
            const field = wp?.field as string | undefined;
            const generated = wp?.generated_value as Record<string, unknown> | string | undefined;
            const recheck = wp?.recheck_result as { compliant?: boolean; repair_hint?: string } | undefined;
            const rejected = wp?.rejected_reason as string | undefined;
            return (
              // eslint-disable-next-line local/no-inline-style -- success-driven border/background
              <div key={mi} style={{
                margin: '6px 0', padding: '6px 8px',
                background: success ? 'color-mix(in srgb, var(--success) 6%, transparent)' : 'color-mix(in srgb, var(--danger) 6%, transparent)',
                borderLeft: `3px solid ${statusColor}`,
                borderRadius: 4, fontSize: 'var(--text-2xs)',
              }}>
                {/* eslint-disable-next-line local/no-inline-style -- statusColor-driven */}
                <div style={{ fontWeight: 600, color: statusColor, marginBottom: 4 }}>
                  Micro-Fix: {move ?? 'Intervention'} Compliance ({elapsed}ms) — {success ? 'Applied' : rejected ? `Rejected (${rejected})` : recheck && !recheck.compliant ? 'Re-validation failed' : 'Failed'}
                </div>
                {field && (
                  <div className="draft-field-note">
                    Field: <code className="draft-code-chip">{field}</code>
                    {!success && <span className="draft-ml6">Before: <em>missing</em></span>}
                  </div>
                )}
                {generated != null && (
                  <details open={success} className="draft-2xs">
                    {/* eslint-disable-next-line local/no-inline-style -- statusColor-driven */}
                    <summary style={{ cursor: 'pointer', color: statusColor }}>
                      {success ? 'After — Generated value' : 'Attempted value (rejected)'}
                    </summary>
                    <pre className="draft-mf-pre">
                      {typeof generated === 'string' ? generated : JSON.stringify(generated, null, 2)}
                    </pre>
                  </details>
                )}
                {recheck?.repair_hint && !recheck.compliant && (
                  <div className="draft-danger-note-mt4">
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
              // eslint-disable-next-line local/no-inline-style -- success-driven border/background
              <div key={mi} style={{
                margin: '6px 0', padding: '6px 8px',
                background: success ? 'color-mix(in srgb, var(--success) 6%, transparent)' : 'color-mix(in srgb, var(--danger) 6%, transparent)',
                borderLeft: `3px solid ${statusColor}`,
                borderRadius: 4, fontSize: 'var(--text-2xs)',
              }}>
                {/* eslint-disable-next-line local/no-inline-style -- statusColor-driven */}
                <div style={{ fontWeight: 600, color: statusColor, marginBottom: 4 }}>
                  Micro-Fix: Directive Compliance — {move ?? '?'} ({elapsed}ms) — {success ? 'Applied' : rejected ? `Rejected (${rejected})` : recheckCompliant === false ? 'Re-validation failed' : 'Failed'}
                </div>
                {revisedPara && (
                  <details open={success} className="draft-2xs">
                    {/* eslint-disable-next-line local/no-inline-style -- statusColor-driven */}
                    <summary style={{ cursor: 'pointer', color: statusColor }}>
                      {success ? 'After — Revised first paragraph' : 'Attempted revision (rejected)'}
                    </summary>
                    <pre className="draft-mf-pre">{revisedPara}</pre>
                  </details>
                )}
                {mf.prompt && (
                  <details className="draft-2xs-mt4">
                    <summary className="draft-summary-muted">Micro-fix prompt</summary>
                    <pre className="draft-mf-pre">{mf.prompt}</pre>
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
            // eslint-disable-next-line local/no-inline-style -- success-driven border/background
            <div key={mi} style={{
              margin: '6px 0', padding: '6px 8px',
              background: success ? 'color-mix(in srgb, var(--success) 6%, transparent)' : 'color-mix(in srgb, var(--danger) 6%, transparent)',
              borderLeft: `3px solid ${statusColor}`,
              borderRadius: 4, fontSize: 'var(--text-2xs)',
            }}>
              {/* eslint-disable-next-line local/no-inline-style -- statusColor-driven */}
              <div style={{ fontWeight: 600, color: statusColor, marginBottom: 4 }}>
                Micro-Fix: Abstract Claims ({elapsed}ms) — {success ? 'Applied' : diffPassed === false ? (rejected === 'hallucinated_changes' ? 'Rejected (hallucinated edits)' : 'Rejected (too many changes)') : 'Re-validation failed'}
                {changes && <span className="draft-change-count">{changes.length} change{changes.length !== 1 ? 's' : ''}</span>}
              </div>
              {changes && changes.length > 0 && (
                <div className="draft-2xs">
                  {changes.map((c, ci) => (
                    <div key={ci} className="draft-change-row">
                      <div className="draft-flex-baseline">
                        <span className="draft-before-label">BEFORE</span>
                        <div className="draft-before-text">
                          {c.original ?? ''}
                        </div>
                      </div>
                      {c.revised && c.original !== c.revised && (
                        <div className="draft-flex-baseline-mt2">
                          <span className="draft-after-label">AFTER</span>
                          <div className="draft-after-text">
                            {c.revised}
                          </div>
                        </div>
                      )}
                      {c.fact_source && (
                        <div className="draft-source-note">
                          source: {c.fact_source}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {revisedStatement && (
                <details className="draft-2xs-mt4">
                  {/* eslint-disable-next-line local/no-inline-style -- statusColor-driven */}
                  <summary style={{ cursor: 'pointer', color: statusColor }}>
                    {success ? 'After — Full revised statement' : 'Attempted revision (rejected)'}
                  </summary>
                  <pre className="draft-mf-pre">{revisedStatement}</pre>
                </details>
              )}
              {mf.prompt && (
                <details className="draft-2xs-mt4">
                  <summary className="draft-summary-muted">Micro-fix prompt</summary>
                  <pre className="draft-mf-pre">{mf.prompt}</pre>
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
          <div className="draft-postdraft-box">
            <div className="draft-postdraft-title">Post-Draft Fixups ({postDraftStage.response_time_ms}ms)</div>
            <div className="draft-col-gap4">
              {autoSplit && <div className="draft-warning">&#9998; Auto-split → {splitParas} paragraphs</div>}
              {scrubbed != null && scrubbed > 0 && (
                <div>
                  <div className="draft-danger">&times; {scrubbed} citation(s) scrubbed</div>
                  {(() => {
                    const scrubbedList = wp.scrubbed_citations as string[] | undefined;
                    if (!scrubbedList || scrubbedList.length === 0) return null;
                    return (
                      <div className="draft-sublist-muted">
                        {scrubbedList.map((cit, ci) => (
                          <div key={ci} className="draft-strike-wrap">{cit}</div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
              {linked != null && linked > 0 && <div className="draft-success">&#128279; Links added</div>}
              {citWarn != null && citWarn > 0 && (
                <div>
                  <div className="draft-warning">&#9888; {citWarn} citation warning(s)</div>
                  {(() => {
                    const warnDetails = wp.citation_warning_details as string[] | undefined;
                    if (!warnDetails || warnDetails.length === 0) return null;
                    return (
                      <div className="draft-sublist-warning">
                        {warnDetails.map((w, wi) => (
                          <div key={wi} className="draft-wrap">{w}</div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
              {ignored != null && ignored > 0 && (
                <div>
                  <div className="draft-text-muted">{ignored} evidence doc(s) not cited</div>
                  {(() => {
                    const titles = wp.ignored_evidence_titles as string[] | undefined;
                    if (!titles || titles.length === 0) return null;
                    return (
                      <div className="draft-sublist-muted-italic">
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
            <summary className="draft-summary">
              Disambiguated Terms ({(vocabRes?.length ?? 0) + (vocabAmb?.length ?? 0)})
              {vocabAmb && vocabAmb.length > 0 && (
                <span className="draft-ambiguous-count">
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
              <table className="draft-vocab-table">
                <thead>
                  <tr className="draft-tr-border">
                    <th className="draft-th-left">Term</th>
                    <th className="draft-th-left">Canonical</th>
                    <th className="draft-th-center">Conf</th>
                  </tr>
                </thead>
                <tbody>
                  {deduped.map((r, i) => (
                    <tr key={i} className="draft-tr-border-soft">
                      <td className="draft-td">{r.colloquial}</td>
                      <td className="draft-td-secondary">{r.canonical}</td>
                      {/* eslint-disable-next-line local/no-inline-style -- confidence-driven color */}
                      <td style={{
                        padding: '1px 4px', textAlign: 'center', fontWeight: 600,
                        color: r.confidence === 'high' ? 'var(--success)' : r.confidence === 'low' ? 'var(--danger)' : 'var(--warning)',
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
              <div className="draft-ambiguous-box">
                <div className="draft-ambiguous-title">Ambiguous terms:</div>
                {unique.map((term, i) => (
                  <div key={i} className="draft-ml8">&ldquo;{term}&rdquo;</div>
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
          <details open><summary className="draft-summary">Verdict</summary>
            <div className="draft-verdict-row">
              {/* eslint-disable-next-line local/no-inline-style -- verdict-driven background */}
              <span style={{
                padding: '1px 8px', borderRadius: 4, fontWeight: 600, color: 'var(--text-primary)',
                background: verdict === 'supported' ? 'var(--success)' : verdict === 'disputed' || verdict === 'false' ? 'var(--danger)' : 'var(--text-muted)',
              }}>{verdict ?? 'unknown'}</span>
              <span className="draft-text-muted">{isAuto ? 'auto-verified' : 'user-initiated'}</span>
              {targetAnId && <span className="draft-text-muted">AN: {targetAnId}</span>}
            </div>
            {checkedText && (
              <div className="draft-checked-text">
                {checkedText}
              </div>
            )}
            {explanation && (
              <div className="draft-explanation">{explanation}</div>
            )}
          </details>
          {webQueries.length > 0 && (() => {
            const isDomains = webQueries.every(q => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(q.trim()));
            const searchText = checkedText || '';
            const allSameQuery = !isDomains;
            return (
              <details open><summary className="draft-summary">
                {isDomains ? `Web Sources (${webQueries.length})` : `Search Queries (${webQueries.length})`}
              </summary>
                {isDomains && searchText && (
                  <div className="draft-query-note">
                    Query: &quot;{searchText.length > 100 ? searchText.slice(0, 97) + '...' : searchText}&quot;
                  </div>
                )}
                <ul className="draft-ul-none">
                  {webQueries.map((q, qi) => {
                    const trimmed = q.trim();
                    const looksLikeDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(trimmed);
                    const searchUrl = looksLikeDomain
                      ? `https://www.google.com/search?q=${encodeURIComponent(searchText + ' site:' + trimmed)}`
                      : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
                    return (
                      <li key={qi} className="draft-mb2">
                        <a
                          href={searchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="draft-link"
                          title={looksLikeDomain ? `Search "${searchText}" on ${trimmed}` : `Search Google for "${trimmed}"`}
                        >
                          {trimmed}
                        </a>
                        {!allSameQuery && !looksLikeDomain && (
                          <span className="draft-query-tag">(query)</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })()}
          {webEvidence && (
            <details><summary className="draft-summary">Web Evidence</summary>
              <pre className="draft-web-evidence">{webEvidence}</pre>
            </details>
          )}
          {webCitations.length > 0 && (
            <details open><summary className="draft-summary">Citations ({webCitations.length})</summary>
              <div className="draft-2xs">
                {webCitations.map((c, ci) => (
                  <div key={ci} className="draft-citation">
                    {c.title && <div className="draft-bold">{c.title}</div>}
                    {c.url && <div className="draft-url">{c.url}</div>}
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
                // eslint-disable-next-line local/no-inline-style -- accepted-driven color
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 4px',
                  fontSize: 'var(--text-2xs)', fontWeight: 700, color: orchAccepted ? 'var(--success)' : 'var(--danger)',
                }}>
                  {/* eslint-disable-next-line local/no-inline-style -- accepted-driven background */}
                  <div style={{ flex: 1, height: 2, background: orchAccepted ? 'color-mix(in srgb, var(--success) 30%, transparent)' : 'color-mix(in srgb, var(--danger) 30%, transparent)' }} />
                  <span>Orchestration Run {orchRun! + 1}{orchAccepted ? ' (accepted)' : ' (rejected by judge)'}</span>
                  {/* eslint-disable-next-line local/no-inline-style -- accepted-driven background */}
                  <div style={{ flex: 1, height: 2, background: orchAccepted ? 'color-mix(in srgb, var(--success) 30%, transparent)' : 'color-mix(in srgb, var(--danger) 30%, transparent)' }} />
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
                const dimColor = (pass: boolean) => pass ? 'var(--success)' : 'var(--danger)';
                const orchHints = ov.repairHints ?? [];
                return (
                  // eslint-disable-next-line local/no-inline-style -- accepted-driven background/border
                  <div style={{
                    margin: '4px 0 8px', borderRadius: 4, padding: '6px 8px', fontSize: '0.7rem',
                    background: orchAccepted ? 'color-mix(in srgb, var(--success) 6%, transparent)' : 'color-mix(in srgb, var(--danger) 6%, transparent)',
                    border: `1px solid ${orchAccepted ? 'color-mix(in srgb, var(--success) 20%, transparent)' : 'color-mix(in srgb, var(--danger) 20%, transparent)'}`,
                  }}>
                    <div className="draft-score-header">
                      <span>Orchestration Score:{' '}
                        {/* eslint-disable-next-line local/no-inline-style -- score-driven color */}
                        <span style={{ ...mono, color: score >= 0.7 ? 'var(--success)' : score >= 0.5 ? 'var(--warning)' : 'var(--danger)' }}>
                          {score.toFixed(2)}
                        </span>
                      </span>
                      {/* eslint-disable-next-line local/no-inline-style -- accepted-driven color/background */}
                      <span style={{
                        fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                        color: orchAccepted ? 'var(--success)' : 'var(--danger)',
                        background: orchAccepted ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'color-mix(in srgb, var(--danger) 15%, transparent)',
                      }}>
                        {orchAccepted ? 'ACCEPTED' : 'REJECTED BY JUDGE'}
                      </span>
                    </div>
                    <div className="draft-dims-row">
                      {/* eslint-disable-next-line local/no-inline-style -- dimension-pass-driven color */}
                      <span><span style={{ color: dimColor(dims.schema.pass) }}>●</span> schema ×0.4 = <strong className="draft-mono">{(0.4 * (dims.schema.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      {/* eslint-disable-next-line local/no-inline-style -- dimension-pass-driven color */}
                      <span><span style={{ color: dimColor(dims.grounding.pass) }}>●</span> grounding ×0.3 = <strong className="draft-mono">{(0.3 * (dims.grounding.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      {/* eslint-disable-next-line local/no-inline-style -- dimension-pass-driven color */}
                      <span><span style={{ color: dimColor(dims.advancement.pass) }}>●</span> advancement ×0.2 = <strong className="draft-mono">{(0.2 * (dims.advancement.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      {/* eslint-disable-next-line local/no-inline-style -- dimension-pass-driven color */}
                      <span><span style={{ color: dimColor(dims.clarifies.pass) }}>●</span> clarifies ×0.1 = <strong className="draft-mono">{(0.1 * (dims.clarifies.pass ? 1 : 0)).toFixed(2)}</strong></span>
                    </div>
                    <div className="draft-score-breakdown">
                      <span>Stage A: <strong className="draft-mono">{stageA.toFixed(2)}</strong> <span className="draft-text-muted">×0.4 = {(0.4 * stageA).toFixed(2)}</span></span>
                      <span>Judge: <strong className="draft-mono">{judgeQ.toFixed(2)}</strong>{!ov.judge_used && <span className="draft-text-muted"> (default)</span>} <span className="draft-text-muted">×0.6 = {(0.6 * judgeQ).toFixed(2)}</span></span>
                      {/* eslint-disable-next-line local/no-inline-style -- score-driven color */}
                      <span>Total: <strong style={{ ...mono, color: score >= 0.7 ? 'var(--success)' : score >= 0.5 ? 'var(--warning)' : 'var(--danger)' }}>{score.toFixed(2)}</strong></span>
                    </div>
                    {orchHints.length > 0 && (
                      <div className="draft-caveats-box">
                        <div className="draft-caveats-title">Caveats</div>
                        <ul className="draft-hint-list">
                          {orchHints.map((h, hi) => {
                            const target = classifyHintTarget(h);
                            const ts = HINT_TARGET_STYLE[target];
                            return (
                              <li key={hi} className="draft-mb2">
                                {/* eslint-disable-next-line local/no-inline-style -- hint-target-driven color/background */}
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
                <div className="draft-attempt-header">
                  <div className="draft-hr-line" />
                  <span>
                    Draft Attempt {retryIdx + 1}
                    {hasStageRetries && (
                      // eslint-disable-next-line local/no-inline-style -- last-in-run-driven color/background
                      <span style={{
                        marginLeft: 4, fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '1px 5px',
                        borderRadius: 3, verticalAlign: 'middle',
                        color: isLastInRun ? 'var(--success)' : 'var(--warning)',
                        background: isLastInRun ? 'color-mix(in srgb, var(--success) 12%, transparent)' : 'color-mix(in srgb, var(--warning) 12%, transparent)',
                      }}>
                        {isLastInRun ? 'final' : 'refined'}
                      </span>
                    )}
                  </span>
                  <div className="draft-hr-line" />
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
                  const dimColor = (pass: boolean) => pass ? 'var(--success)' : 'var(--danger)';
                  return (
                    <div className="draft-valscore-box">
                      <div className="draft-valscore-title">
                        Validation Score:{' '}
                        {/* eslint-disable-next-line local/no-inline-style -- score-driven color */}
                        <span style={{ ...mono, color: turnScore >= 0.7 ? 'var(--success)' : turnScore >= 0.5 ? 'var(--warning)' : 'var(--danger)' }}>
                          {turnScore.toFixed(2)}
                        </span>
                      </div>
                      <div className="draft-dims-row">
                        {/* eslint-disable-next-line local/no-inline-style -- dimension-pass-driven color */}
                        <span><span style={{ color: dimColor(dims.schema.pass) }}>●</span> schema ×0.4 = <strong className="draft-mono">{(0.4 * (dims.schema.pass ? 1 : 0)).toFixed(2)}</strong></span>
                        {/* eslint-disable-next-line local/no-inline-style -- dimension-pass-driven color */}
                        <span><span style={{ color: dimColor(dims.grounding.pass) }}>●</span> grounding ×0.3 = <strong className="draft-mono">{(0.3 * (dims.grounding.pass ? 1 : 0)).toFixed(2)}</strong></span>
                        {/* eslint-disable-next-line local/no-inline-style -- dimension-pass-driven color */}
                        <span><span style={{ color: dimColor(dims.advancement.pass) }}>●</span> advancement ×0.2 = <strong className="draft-mono">{(0.2 * (dims.advancement.pass ? 1 : 0)).toFixed(2)}</strong></span>
                        {/* eslint-disable-next-line local/no-inline-style -- dimension-pass-driven color */}
                        <span><span style={{ color: dimColor(dims.clarifies.pass) }}>●</span> clarifies ×0.1 = <strong className="draft-mono">{(0.1 * (dims.clarifies.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      </div>
                      <div className="draft-score-breakdown">
                        <span>Stage A: <strong className="draft-mono">{stageA.toFixed(2)}</strong> <span className="draft-text-muted">×0.4 = {(0.4 * stageA).toFixed(2)}</span></span>
                        <span>Judge: <strong className="draft-mono">{judgeQ.toFixed(2)}</strong>{!judgeUsed && <span className="draft-text-muted"> (default)</span>} <span className="draft-text-muted">×0.6 = {(0.6 * judgeQ).toFixed(2)}</span></span>
                        {/* eslint-disable-next-line local/no-inline-style -- score-driven color */}
                        <span>Total: <strong style={{ ...mono, color: turnScore >= 0.7 ? 'var(--success)' : turnScore >= 0.5 ? 'var(--warning)' : 'var(--danger)' }}>{turnScore.toFixed(2)}</strong></span>
                      </div>
                    </div>
                  );
                }
                // Fallback: no dimensions available
                return (
                  <div className="draft-perstage-box">
                    <div className="draft-bold">
                      Per-stage Validation:{' '}
                      {valData ? (
                        // eslint-disable-next-line local/no-inline-style -- pass-driven color
                        <span style={{ color: valData.pass ? 'var(--success)' : 'var(--danger)' }}>
                          {valData.pass ? 'Pass' : 'Fail'}
                        </span>
                      ) : (
                        <span className="draft-text-muted">—</span>
                      )}
                    </div>
                    {valData?.details && valData.details.length > 0 && (
                      <div className="draft-details-list">
                        {valData.details.map((d, di) => (
                          <div key={di}>
                            <div className="draft-flex-center-gap6">
                              {/* eslint-disable-next-line local/no-inline-style -- pass-driven color */}
                              <span style={{ color: d.pass ? 'var(--success)' : 'var(--danger)', fontSize: '0.7rem' }}>{d.pass ? '✓' : '✗'}</span>
                              <span className="draft-text-primary">{d.rule}</span>
                              {d.value && <span className="draft-mono-muted">{d.value}</span>}
                            </div>
                            {d.flagged_claims && d.flagged_claims.length > 0 && (
                              <div className="draft-flagged-list">
                                {d.flagged_claims.map((claim: string, ci: number) => (
                                  <div key={ci} className="draft-flagged-item">• {claim}</div>
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
                <details open className="draft-feedback">
                  <summary className="draft-summary-plain">Validation Feedback</summary>
                  <ul className="draft-feedback-list">
                    {combinedHints.map((h, hi) => {
                      const target = classifyHintTarget(h);
                      const ts = HINT_TARGET_STYLE[target];
                      return (
                        <li key={hi} className="draft-mb3">
                          {/* eslint-disable-next-line local/no-inline-style -- hint-target-driven color/background */}
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
                return attemptMicroFixes.map((mf: { stage: string; prompt?: string; raw_response?: string; response_time_ms?: number; work_product?: Record<string, unknown> }, mi: number) => {
                  const wp = mf.work_product;
                  const success = wp?.success as boolean | undefined;
                  const fixType = wp?.type as string | undefined;
                  const elapsed = mf.response_time_ms ?? 0;
                  const statusColor = success ? 'var(--success)' : 'var(--danger)';

                  if (fixType === 'intervention_compliance') {
                    const move = wp?.move as string | undefined;
                    const field = wp?.field as string | undefined;
                    const generated = wp?.generated_value as Record<string, unknown> | string | undefined;
                    const recheck = wp?.recheck_result as { compliant?: boolean; repair_hint?: string } | undefined;
                    const rejected = wp?.rejected_reason as string | undefined;
                    return (
                      // eslint-disable-next-line local/no-inline-style -- success-driven border/background
                      <div key={`mf-${mi}`} style={{
                        margin: '6px 0', padding: '6px 8px',
                        background: success ? 'color-mix(in srgb, var(--success) 6%, transparent)' : 'color-mix(in srgb, var(--danger) 6%, transparent)',
                        borderLeft: `3px solid ${statusColor}`,
                        borderRadius: 4, fontSize: 'var(--text-2xs)',
                      }}>
                        {/* eslint-disable-next-line local/no-inline-style -- statusColor-driven */}
                        <div style={{ fontWeight: 600, color: statusColor, marginBottom: 4 }}>
                          Micro-Fix: {move ?? 'Intervention'} Compliance ({elapsed}ms) — {success ? 'Applied' : rejected ? `Rejected (${rejected})` : recheck && !recheck.compliant ? 'Re-validation failed' : 'Failed'}
                        </div>
                        {field && (
                          <div className="draft-field-note">
                            Field: <code className="draft-code-chip">{field}</code>
                            {!success && <span className="draft-ml6">Before: <em>missing</em></span>}
                          </div>
                        )}
                        {generated != null && (
                          <details open={success} className="draft-2xs">
                            {/* eslint-disable-next-line local/no-inline-style -- statusColor-driven */}
                            <summary style={{ cursor: 'pointer', color: statusColor }}>
                              {success ? 'After — Generated value' : 'Attempted value (rejected)'}
                            </summary>
                            <pre className="draft-mf-pre">
                              {typeof generated === 'string' ? generated : JSON.stringify(generated, null, 2)}
                            </pre>
                          </details>
                        )}
                        {recheck?.repair_hint && !recheck.compliant && (
                          <div className="draft-danger-note-mt4">
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
                      // eslint-disable-next-line local/no-inline-style -- success-driven border/background
                      <div key={`mf-${mi}`} style={{
                        margin: '6px 0', padding: '6px 8px',
                        background: success ? 'color-mix(in srgb, var(--success) 6%, transparent)' : 'color-mix(in srgb, var(--danger) 6%, transparent)',
                        borderLeft: `3px solid ${statusColor}`,
                        borderRadius: 4, fontSize: 'var(--text-2xs)',
                      }}>
                        {/* eslint-disable-next-line local/no-inline-style -- statusColor-driven */}
                        <div style={{ fontWeight: 600, color: statusColor, marginBottom: 4 }}>
                          Micro-Fix: Directive Compliance — {move ?? '?'} ({elapsed}ms) — {success ? 'Applied' : rejected ? `Rejected (${rejected})` : recheckCompliant === false ? 'Re-validation failed' : 'Failed'}
                        </div>
                        {revisedPara && (
                          <details open={success} className="draft-2xs">
                            {/* eslint-disable-next-line local/no-inline-style -- statusColor-driven */}
                            <summary style={{ cursor: 'pointer', color: statusColor }}>
                              {success ? 'After — Revised first paragraph' : 'Attempted revision (rejected)'}
                            </summary>
                            <pre className="draft-mf-pre">{revisedPara}</pre>
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
                    // eslint-disable-next-line local/no-inline-style -- success-driven border/background
                    <div key={`mf-${mi}`} style={{
                      margin: '6px 0', padding: '6px 8px',
                      background: success ? 'color-mix(in srgb, var(--success) 6%, transparent)' : 'color-mix(in srgb, var(--danger) 6%, transparent)',
                      borderLeft: `3px solid ${statusColor}`,
                      borderRadius: 4, fontSize: 'var(--text-2xs)',
                    }}>
                      {/* eslint-disable-next-line local/no-inline-style -- statusColor-driven */}
                      <div style={{ fontWeight: 600, color: statusColor, marginBottom: 4 }}>
                        Micro-Fix: Abstract Claims ({elapsed}ms) — {success ? 'Applied' : diffPassed === false ? (rejected === 'hallucinated_changes' ? 'Rejected (hallucinated edits)' : 'Rejected (too many changes)') : 'Re-validation failed'}
                        {changes && <span className="draft-change-count">{changes.length} change{changes.length !== 1 ? 's' : ''}</span>}
                      </div>
                      {changes && changes.length > 0 && (
                        <div className="draft-2xs">
                          {changes.map((c, ci) => (
                            <div key={ci} className="draft-change-row">
                              <div className="draft-flex-baseline">
                                <span className="draft-before-label">BEFORE</span>
                                <div className="draft-before-text">{c.original ?? ''}</div>
                              </div>
                              {c.revised && c.original !== c.revised && (
                                <div className="draft-flex-baseline-mt2">
                                  <span className="draft-after-label">AFTER</span>
                                  <div className="draft-after-text">{c.revised}</div>
                                </div>
                              )}
                              {c.fact_source && (
                                <div className="draft-source-note">source: {c.fact_source}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {revisedStatement && (
                        <details className="draft-2xs-mt4">
                          {/* eslint-disable-next-line local/no-inline-style -- statusColor-driven */}
                          <summary style={{ cursor: 'pointer', color: statusColor }}>
                            {success ? 'After — Full revised statement' : 'Attempted revision (rejected)'}
                          </summary>
                          <pre className="draft-mf-pre">{revisedStatement}</pre>
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
      // §3: if all indicators pass, collapse to a single summary line
      if (allPass && !draftQualityStage.parse_error) {
        return (
          <div className="draft-qcheck-pass">
            <span className="draft-qcheck-icon">✓</span>
            <span className="draft-qcheck-label">Quality Pre-Check — all pass</span>
            <span className="draft-meta-muted">{draftQualityStage.model}</span>
            <span className="draft-meta-muted">{(draftQualityStage.response_time_ms / 1000).toFixed(1)}s</span>
          </div>
        );
      }
      return (
        <div className="draft-qcheck-warn">
          <div className="draft-qcheck-head">
            <span className="draft-qcheck-title">Quality Pre-Check</span>
            <span className="draft-qcheck-badge">Draft Attempt 1</span>
            {diag?.topic_alignment?.repaired && (
              <span className="draft-qcheck-regen">triggered regen</span>
            )}
            <span className="draft-meta-muted">{draftQualityStage.model}</span>
            <span className="draft-meta-muted">{(draftQualityStage.response_time_ms / 1000).toFixed(1)}s</span>
          </div>
          <div className="draft-indicators-row">
            {indicators.map(([label, pass]) => (
              <span key={label} className="draft-indicator">
                {/* eslint-disable-next-line local/no-inline-style -- pass-driven color */}
                <span style={{ color: pass ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>{pass ? '✓' : '✗'}</span>
                <span>{label}</span>
              </span>
            ))}
          </div>
          {wp.weaknesses && wp.weaknesses.length > 0 && (
            <div className="draft-caveats-box">
              <div className="draft-weakness-title">Weaknesses</div>
              <ul className="draft-hint-list">
                {wp.weaknesses.map((w, wi) => (
                  <li key={wi} className="draft-mb2">{humanizeSpeakerIds(w)}</li>
                ))}
              </ul>
            </div>
          )}
          {draftQualityStage.parse_error && (
            <div className="draft-qcheck-parse-error">
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
        // eslint-disable-next-line local/no-inline-style -- aligned-driven background/border
        <div style={{
          margin: '10px 0 4px', borderRadius: 4, padding: '6px 8px', fontSize: '0.7rem',
          background: finalAligned ? 'rgba(22,163,74,0.06)' : 'rgba(220,38,38,0.06)',
          border: `1px solid ${finalAligned ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)'}`,
        }}>
          <div className="draft-ta-title">Topic Alignment</div>
          {attempts.map((att, ai) => {
            const topicWeaknesses = att.weaknesses.filter(w =>
              /\b(off.?scope|off.?topic|drift|outside.*scope|beyond.*scope|scope|domain|severity|magnitude|escalat|disproportionate|catastroph|existential|extinction|civiliz)\b/i.test(w)
            );
            const driftType = !att.aligned && scope && topicWeaknesses.length > 0
              ? classifyOffScopeDrift(topicWeaknesses, scope)
              : null;
            const repairHint = driftType && scope ? offScopeRepairHint(driftType, scope) : null;
            return (
              // eslint-disable-next-line local/no-inline-style -- data-driven margin
              <div key={ai} style={{ marginBottom: ai < attempts.length - 1 ? 8 : 0 }}>
                <div className="draft-ta-row">
                  <span className="draft-ta-label">{att.label}</span>
                  {/* eslint-disable-next-line local/no-inline-style -- aligned-driven color/background */}
                  <span style={{
                    padding: '1px 6px', borderRadius: 3, fontWeight: 600, fontSize: 'var(--text-2xs)',
                    background: att.aligned ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)',
                    color: att.aligned ? 'var(--success)' : 'var(--danger)',
                  }}>{att.aligned ? 'ON-SCOPE' : 'OFF-SCOPE'}</span>
                  {driftType && (
                    <span className="draft-drift-badge">
                      {driftType} drift
                    </span>
                  )}
                  {ai === attempts.length - 1 && qg?.repair_outcome && (
                    // eslint-disable-next-line local/no-inline-style -- repair-outcome-driven color/background
                    <span style={{
                      padding: '1px 5px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600,
                      background: qg.repair_outcome === 'fixed' ? 'rgba(22,163,74,0.15)' : qg.repair_outcome === 'partial' ? 'color-mix(in srgb, var(--warning) 15%, transparent)' : 'rgba(220,38,38,0.1)',
                      color: qg.repair_outcome === 'fixed' ? 'var(--success)' : qg.repair_outcome === 'partial' ? 'var(--warning)' : 'var(--danger)',
                    }}>repair: {qg.repair_outcome}</span>
                  )}
                </div>
                {!att.aligned && topicWeaknesses.length > 0 && (
                  <div className="draft-offscope-box">
                    <div className="draft-offscope-title">Why off-scope:</div>
                    <ul className="draft-offscope-list">
                      {topicWeaknesses.map((w, wi) => <li key={wi} className="draft-mb1">{humanizeSpeakerIds(w)}</li>)}
                    </ul>
                    {repairHint && (
                      <div className="draft-repair-hint">
                        <strong>Repair instruction:</strong> {repairHint}
                      </div>
                    )}
                  </div>
                )}
                {!att.aligned && topicWeaknesses.length === 0 && att.weaknesses.length > 0 && (
                  <div className="draft-offscope-box">
                    <div className="draft-offscope-title">Why off-scope:</div>
                    <ul className="draft-offscope-list">
                      {att.weaknesses.map((w, wi) => <li key={wi} className="draft-mb1">{humanizeSpeakerIds(w)}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
          {scope && (
            <details className="draft-scope-details">
              <summary className="draft-scope-summary">Scope Definition</summary>
              <div className="draft-scope-body">
                {scope.core_proposition && (
                  <div className="draft-mb3"><strong>Core proposition:</strong> {scope.core_proposition}</div>
                )}
                {scope.domain && (
                  <div className="draft-mb3"><strong>Domain:</strong> {scope.domain}</div>
                )}
                {scope.example_ceiling && (
                  <div className="draft-mb3"><strong>Example ceiling:</strong> {scope.example_ceiling}</div>
                )}
                {scope.off_scope_topics && scope.off_scope_topics.length > 0 && (
                  <div className="draft-mb3">
                    <strong>Off-scope topics:</strong>
                    <ul className="draft-scope-list">
                      {scope.off_scope_topics.map((t: string, i: number) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                )}
                {scope.drift_signatures && scope.drift_signatures.length > 0 && (
                  <div>
                    <strong>Drift signatures:</strong>
                    <ul className="draft-scope-list">
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
