// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import { api } from '@bridge';
import type { EntryDiagnostics, ArgumentNetworkNode, ArgumentNetworkEdge } from '../../../../types/debate';
import { POVER_INFO } from '../../../../types/debate';
import { Highlight, Section, CopyButton } from '../helpers';
import { ScoreBadge, VerdictChip } from '../shared';
import type { Verdict } from '../shared/VerdictChip';
import './ClaimsTab.css';

interface ArgumentNetwork {
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
}

interface ExtractionTrace {
  candidates_proposed: number;
  candidates_accepted: number;
  candidates_rejected: number;
  rejection_reasons: Record<string, number>;
  an_node_count_before: number;
  an_node_count_after: number;
  an_nodes_added_ids: string[];
}

export interface ClaimsTabProps {
  entry: { id: string; type: string; content?: unknown; metadata?: unknown; taxonomy_refs?: unknown[]; policy_refs?: unknown[]; speaker: string };
  diag: EntryDiagnostics | undefined;
  meta: Record<string, unknown> | undefined;
  debate: { topic: Record<string, unknown>; transcript: unknown[] } | undefined;
  an: ArgumentNetwork | undefined;
  nodeWeights: Map<string, number>;
  searchQuery?: string;
}

export function ClaimsTab({ entry, diag, meta, debate, an, nodeWeights, searchQuery }: ClaimsTabProps) {
  const extTrace = diag?.extraction_trace as ExtractionTrace | undefined;

  return (
    <div className="clm-root">
      {/* Low-value claims filter banner (anti-filibustering, t/22) */}
      {((): React.ReactNode => {
        const lvr = (extTrace?.rejection_reasons as Record<string, number> | undefined)?.low_marginal_value;
        if (!lvr || lvr <= 0) return null;
        return (
          <div className="clm-filter-banner">
            <span className="clm-filter-badge">ANTI-FILIBUSTER</span>
            <span>{lvr} low-value claim{lvr !== 1 ? 's' : ''} filtered (weak, non-crux, no novel scheme)</span>
          </div>
        );
      })()}
      {!!meta?.my_claims && (meta.my_claims as { claim: string; targets: string[] }[]).length > 0 && (() => {
        // t/1617: targets are prior AN node ids the claim responds to. A forward/dangling
        // reference (e.g. → AN-7 when the network tops out at AN-6) must not look valid —
        // cross-reference each target against the actual argument-network node ids.
        const anNodeIds = new Set((an?.nodes ?? []).map(n => n.id));
        return (
        <Section title={`Claim Sketches (${(meta.my_claims as unknown[]).length})`} defaultOpen copyText={(meta.my_claims as { claim: string; targets: string[] }[]).map((c, i) => `${i + 1}. ${c.claim}${c.targets?.length > 0 ? ` → ${c.targets.map(t => anNodeIds.has(t) ? t : `${t} (no such node)`).join(', ')}` : ''}`).join('\n')}>
          {(meta.my_claims as { claim: string; targets: string[] }[]).map((c, i) => (
            <div key={i} className="clm-sketch-row">
              <span className="clm-sketch-num">{i + 1}.</span> <Highlight text={c.claim} />
              {c.targets?.length > 0 && (
                <span className="clm-muted-ml6">
                  {'→ '}
                  {c.targets.map((t, ti) => {
                    const resolved = anNodeIds.has(t);
                    return (
                      <React.Fragment key={ti}>
                        {ti > 0 && ', '}
                        {resolved ? (
                          <span>{t}</span>
                        ) : (
                          <span
                            className="clm-dangling"
                            title={`No argument-network node "${t}" exists — dangling/forward reference (target ids should point to prior AN nodes).`}
                          >
                            {t} ⚠ (no such node)
                          </span>
                        )}
                      </React.Fragment>
                    );
                  })}
                </span>
              )}
            </div>
          ))}
        </Section>
        );
      })()}

      {/* Extraction status + re-extract button (t/226) */}
      {(() => {
        const status = (diag as Record<string, unknown> | undefined)?.extraction_status as string | undefined;
        const sketchCount = (meta?.my_claims as unknown[] | undefined)?.length ?? 0;
        const acceptedCount = diag?.extracted_claims?.accepted?.length ?? 0;
        const showReExtract = sketchCount > 0 && acceptedCount === 0 && status !== 'pending';
        if (!status && !showReExtract) return null;
        return (
          <div className="clm-ext-status">
            {status === 'pending' && (
              <span className="clm-badge-extracting">EXTRACTING...</span>
            )}
            {status === 'failed' && (
              <span className="clm-badge-failed">EXTRACTION FAILED</span>
            )}
            {showReExtract && (
              <button
                className="clm-reextract-btn"
                onClick={() => api.requestReExtractClaims(entry.id)}
                title="Re-run claim extraction for this entry"
              >
                Re-extract Claims
              </button>
            )}
          </div>
        );
      })()}

      {diag?.extracted_claims && (() => {
        // Compute shared per-section metadata badges (§3 de-engineering: move repeated labels to section header)
        const acceptedAnNodes = diag.extracted_claims.accepted.map(c => an?.nodes.find(n => n.id === c.id));
        const uniqueBdiCategories = new Set(acceptedAnNodes.map(n => n?.bdi_category).filter(Boolean));
        const uniqueSpecificities = new Set(acceptedAnNodes.map(n => n?.specificity).filter(Boolean));
        const uniqueSteelmanOfs = new Set(acceptedAnNodes.map(n => n?.steelman_of).filter(Boolean));
        // Only hoist to header when all rows share the exact same non-null value
        const sharedBdiCategory = uniqueBdiCategories.size === 1 && diag.extracted_claims.accepted.length > 1
          ? [...uniqueBdiCategories][0] as string : null;
        const sharedSpecificity = uniqueSpecificities.size === 1 && diag.extracted_claims.accepted.length > 1
          ? [...uniqueSpecificities][0] as string : null;
        const sharedSteelmanOf = uniqueSteelmanOfs.size === 1 && diag.extracted_claims.accepted.length > 1
          ? [...uniqueSteelmanOfs][0] as string : null;

        const bdiHeaderBadge = sharedBdiCategory ? (
          // eslint-disable-next-line local/no-inline-style -- background/color computed from sharedBdiCategory
          <span style={{ padding: '0 4px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, marginLeft: 6,
            background: sharedBdiCategory === 'belief' ? 'color-mix(in srgb, var(--color-saf) 15%, transparent)' : sharedBdiCategory === 'desire' ? 'color-mix(in srgb, var(--color-skp) 15%, transparent)' : 'color-mix(in srgb, var(--color-acc) 15%, transparent)',
            color: sharedBdiCategory === 'belief' ? 'var(--color-saf)' : sharedBdiCategory === 'desire' ? 'var(--color-skp)' : 'var(--color-acc)' }}>
            {sharedBdiCategory}
          </span>
        ) : null;
        const specificityHeaderBadge = sharedSpecificity ? (
          <span className="clm-hdr-specificity">
            {sharedSpecificity}
          </span>
        ) : null;
        const steelmanHeaderBadge = sharedSteelmanOf ? (
          <span className="clm-hdr-steelman">
            steelman of {POVER_INFO[sharedSteelmanOf as keyof typeof POVER_INFO]?.label ?? sharedSteelmanOf}
          </span>
        ) : null;

        const sectionSuffix = (bdiHeaderBadge || specificityHeaderBadge || steelmanHeaderBadge) ? (
          <span className="clm-section-suffix">
            {bdiHeaderBadge}{specificityHeaderBadge}{steelmanHeaderBadge}
          </span>
        ) : null;

        return (
        <Section
          title={`Extracted Claims (${diag.extracted_claims.accepted.length} accepted, ${diag.extracted_claims.rejected.length} rejected)`}
          defaultOpen
          titleSuffix={sectionSuffix}
          copyText={[...diag.extracted_claims.accepted.map(c => { const anN = an?.nodes.find(n => n.id === c.id); return `✓ ${c.id} (${c.overlap_pct}%): ${c.text}${anN?.attribution_text_genus ? `\n  [Attribution: ${anN.attribution_text_genus}]` : ''}`; }), ...diag.extracted_claims.rejected.map(c => `✗ (${c.overlap_pct}%): ${c.text} — ${c.reason}`)].join('\n')}
        >
          {diag.extracted_claims.accepted.map((c, i) => {
            const outEdges = an?.edges.filter(e => e.source === c.id) ?? [];
            const edgeSummary = outEdges.map(edge => {
              const label = edge.type === 'attacks'
                ? (edge.attack_type ? `attacks(${edge.attack_type})` : 'attacks')
                : 'supports';
              return `${label} ${edge.target}`;
            }).join(', ');
            const anNode = an?.nodes.find(n => n.id === c.id);
            const ec = anNode?.extraction_confidence;
            const ecBand = ec != null ? (ec >= 1.0 ? 'near-verbatim' : ec >= 0.8 ? 'faithful compression' : ec >= 0.6 ? 'implicit premise' : 'minimum') : null;
            const repair = diag.entailment_repairs?.find(r => r.node_id === c.id);
            const hasEntailmentData = (diag.entailment_repairs?.length ?? 0) > 0;
            // §3: only show chip for non-pass verdicts (flag/fail); pass/entailed shows nothing
            const entailmentVerdict: Verdict | null = repair
              ? (repair.verdict === 'entailed' ? 'pass' : repair.verdict === 'partial' ? 'flag' : 'fail')
              : null;
            const showEntailmentChip = entailmentVerdict != null && entailmentVerdict !== 'pass';
            const verdictColor = repair ? (repair.verdict === 'entailed' ? 'var(--success)' : repair.verdict === 'partial' ? 'var(--warning)' : 'var(--danger)') : null;
            return (
              <details key={i} open className="clm-claim-details">
                <summary className="clm-summary">
                  <span className="clm-c-success">✓ {c.id}</span> <span data-tooltip={`Word Overlap: ${c.overlap_pct}%\n\nMeasures grounding of claim in the debater's statement.\nFormula: shared words ≥4 chars / total claim words ≥4 chars × 100.\n\nThreshold: < 10-15% = rejected as not grounded.\n${c.overlap_pct}% = ${c.overlap_pct < 50 ? 'moderate' : 'strong'} lexical grounding.`} className="clm-overlap-pct">{c.overlap_pct}%</span>{' '}
                  {ec != null && (
                    <ScoreBadge
                      value={ec}
                      label="FIRE"
                      tooltip={`Extraction Confidence: ${ec.toFixed(2)}\nBand: ${ecBand}\n\nFIRE metric — how faithfully this claim was extracted from the speaker's statement.\n1.0 = near-verbatim (overlap ≥70%)\n0.8 = faithful compression (≥50%)\n0.6 = implicit premise (≥30%)\n0.5 = minimum (below 30%)`}
                    />
                  )}
                  {/* §3: chip only for non-pass entailment outcomes */}
                  {showEntailmentChip && repair && (
                    <VerdictChip
                      verdict={entailmentVerdict!}
                      label={`${repair.verdict === 'partial' ? '~' : '✗'} ${repair.verdict}`}
                      tooltip={`Entailment: ${repair.verdict}\n${repair.explanation}`}
                    />
                  )}
                  {!repair && hasEntailmentData && (
                    <span className="clm-not-sampled">not sampled</span>
                  )}
                  {/* §3: per-row badge only when not hoisted to section header */}
                  {anNode?.bdi_category && !sharedBdiCategory && (
                    // eslint-disable-next-line local/no-inline-style -- background/color computed from anNode.bdi_category
                    <span style={{ padding: '0 4px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, marginRight: 3, background: anNode.bdi_category === 'belief' ? 'color-mix(in srgb, var(--color-saf) 15%, transparent)' : anNode.bdi_category === 'desire' ? 'color-mix(in srgb, var(--color-skp) 15%, transparent)' : 'color-mix(in srgb, var(--color-acc) 15%, transparent)', color: anNode.bdi_category === 'belief' ? 'var(--color-saf)' : anNode.bdi_category === 'desire' ? 'var(--color-skp)' : 'var(--color-acc)' }}>
                      {anNode.bdi_category}
                    </span>
                  )}
                  {anNode?.specificity && !sharedSpecificity && (
                    <span className="clm-row-specificity">
                      {anNode.specificity}
                    </span>
                  )}
                  {anNode?.steelman_of && !sharedSteelmanOf && (
                    <span className="clm-row-steelman">
                      steelman of {POVER_INFO[anNode.steelman_of as keyof typeof POVER_INFO]?.label ?? anNode.steelman_of}
                    </span>
                  )}
                  <Highlight text={c.text} />
                  {anNode?.attribution_text_genus && <div className="claim-attribution-text"><span className="claim-attribution-label">Attribution:</span>{anNode.attribution_text_genus}</div>}
                  {outEdges.length > 0 && (
                    <span className="clm-edge-summary">
                      [{edgeSummary}]
                    </span>
                  )}
                </summary>
                {outEdges.length > 0 && (() => {
                  const hasSupports = outEdges.some(e => e.type === 'supports');
                  const hasAttacks = outEdges.some(e => e.type === 'attacks');
                  const concedeAndPivot = hasSupports && hasAttacks;
                  const strengthColors = { decisive: 'var(--success)', substantial: 'var(--color-saf)', tangential: 'var(--text-muted)' } as Record<string, string>;
                  return (
                  <div className="clm-edges-wrap">
                    {concedeAndPivot && (
                      <div className="clm-concede-pivot">
                        Concede-and-pivot: supports + attacks edges from the same claim
                      </div>
                    )}
                    {outEdges.map((edge, ei) => {
                      const targetNode = an?.nodes.find(n => n.id === edge.target);
                      const edgeLabel = edge.type === 'attacks'
                        ? (edge.attack_type ? `attacks (${edge.attack_type})` : 'attacks')
                        : 'supports';
                      return (
                        // eslint-disable-next-line local/no-inline-style -- borderLeft computed from edge.type
                        <div key={ei} style={{ fontSize: 'var(--text-2xs)', margin: '3px 0', paddingLeft: 10, borderLeft: edge.type === 'attacks' ? '2px solid var(--danger)' : '2px solid var(--success)' }}>
                          <div className="clm-edge-head">
                            {/* eslint-disable-next-line local/no-inline-style -- color computed from edge.type */}
                            <span style={{ color: edge.type === 'attacks' ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>{edgeLabel}</span>
                            {edge.strength && (
                              // eslint-disable-next-line local/no-inline-style -- color computed from strengthColors[edge.strength]
                              <span style={{ padding: '0 3px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, background: 'var(--bg-hover)', color: strengthColors[edge.strength] ?? 'var(--text-muted)' }}>
                                {edge.strength}
                              </span>
                            )}
                            {edge.argumentation_scheme && <span className="clm-scheme-badge">{edge.argumentation_scheme}</span>}
                          </div>
                          {targetNode && (
                            <div className="clm-target-node">
                              <span className="clm-fw600">{targetNode.id}</span> ({POVER_INFO[targetNode.speaker as keyof typeof POVER_INFO]?.label ?? targetNode.speaker}): {targetNode.text}
                            </div>
                          )}
                          {edge.warrant && (
                            <div className="clm-warrant">
                              {edge.warrant}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  );
                })()}
                {repair && repair.verdict !== 'entailed' && repair.repaired_text && (
                  // eslint-disable-next-line local/no-inline-style -- background/border computed from repair.verdict
                  <div style={{ paddingLeft: 20, marginTop: 6, marginBottom: 4, padding: '6px 8px', borderRadius: 4, background: (repair.verdict as string) === 'entailed' ? 'color-mix(in srgb, var(--success) 8%, transparent)' : repair.verdict === 'partial' ? 'color-mix(in srgb, var(--warning) 8%, transparent)' : 'color-mix(in srgb, var(--danger) 8%, transparent)', border: (repair.verdict as string) === 'entailed' ? '1px solid color-mix(in srgb, var(--success) 20%, transparent)' : repair.verdict === 'partial' ? '1px solid color-mix(in srgb, var(--warning) 20%, transparent)' : '1px solid color-mix(in srgb, var(--danger) 20%, transparent)' }}>
                    {/* eslint-disable-next-line local/no-inline-style -- color from computed verdictColor */}
                    <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: verdictColor!, marginBottom: 4 }}>
                      Entailment Repair ({repair.verdict})
                    </div>
                    <div className="clm-repair-line">
                      <span className="clm-repair-orig">{repair.original_text}</span>
                    </div>
                    <div className="clm-repair-fixed">
                      {repair.repaired_text}
                    </div>
                    <div className="clm-repair-explain">
                      {repair.explanation}
                    </div>
                  </div>
                )}
                {anNode && (anNode.base_strength != null || anNode.bdi_sub_scores) && (
                  <details className="clm-indent-block">
                    <summary className="clm-scores-summary">
                      Scores{anNode.base_strength != null ? ` — base: ${anNode.base_strength.toFixed(2)}` : ''}{anNode.computed_strength != null ? ` → computed: ${anNode.computed_strength.toFixed(2)}` : ''}{anNode.scoring_method ? ` (${anNode.scoring_method.replace(/_/g, ' ')})` : ''}
                    </summary>
                    <div className="clm-scores-body">
                      {anNode.base_strength != null && (
                        <div className="clm-scores-row">
                          <span><strong>Base:</strong> {anNode.base_strength.toFixed(2)}</span>
                          {anNode.computed_strength != null && <span><strong>Computed:</strong> {anNode.computed_strength.toFixed(2)}</span>}
                          {anNode.scoring_method && <span className="clm-muted">via {anNode.scoring_method.replace(/_/g, ' ')}</span>}
                        </div>
                      )}
                      {anNode.bdi_sub_scores && (
                        <div className="clm-subscores">
                          {Object.entries(anNode.bdi_sub_scores).filter(([, v]) => v != null).map(([k, v]) => {
                            const label = k.replace(/_/g, ' ');
                            const strVal = typeof v === 'number' ? (v >= 0.7 ? 'yes' : v >= 0.4 ? 'partial' : 'no') : String(v);
                            const color = strVal === 'yes' ? 'var(--success)' : strVal === 'partial' ? 'var(--warning)' : 'var(--danger)';
                            return (
                              // eslint-disable-next-line local/no-inline-style -- background/color computed from strVal
                              <span key={k} style={{ padding: '1px 4px', borderRadius: 3, fontSize: 'var(--text-2xs)', background: strVal === 'yes' ? 'color-mix(in srgb, var(--success) 15%, transparent)' : strVal === 'partial' ? 'color-mix(in srgb, var(--warning) 15%, transparent)' : 'color-mix(in srgb, var(--danger) 15%, transparent)', color }}>
                                {label}: {strVal}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </details>
                )}
                {/* Evidence graph inline (t/495) */}
                {(() => {
                  const eg = anNode?.evidence_graph as { evidence_items: { id: string; source_doc_id: string; text: string; relation: 'support' | 'contradict'; similarity: number }[]; computed_strength: number; qbaf_iterations: number } | undefined;
                  if (!eg || eg.evidence_items.length === 0) return null;
                  const barPct = Math.round(eg.computed_strength * 100);
                  const barColor = eg.computed_strength >= 0.7 ? 'var(--success)' : eg.computed_strength >= 0.4 ? 'var(--warning)' : 'var(--danger)';
                  const supports = eg.evidence_items.filter(e => e.relation === 'support');
                  const contradicts = eg.evidence_items.filter(e => e.relation === 'contradict');
                  return (
                    <div className="clm-indent-block">
                      <div className="clm-evidence-header">
                        Evidence ({supports.length} support, {contradicts.length} contradict)
                      </div>
                      <div className="clm-evidence-bar-row">
                        <div className="clm-bar-track">
                          {/* eslint-disable-next-line local/no-inline-style -- width/background computed from barPct/barColor */}
                          <div style={{ width: `${barPct}%`, height: '100%', borderRadius: 3, background: barColor }} />
                        </div>
                        {/* eslint-disable-next-line local/no-inline-style -- color from computed barColor */}
                        <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: barColor, minWidth: 36 }}>
                          {eg.computed_strength.toFixed(2)}
                        </span>
                        <span className="clm-2xs-muted">
                          {eg.qbaf_iterations} iter
                        </span>
                      </div>
                      {eg.evidence_items
                        .sort((a, b) => a.relation !== b.relation ? (a.relation === 'contradict' ? -1 : 1) : b.similarity - a.similarity)
                        .map(item => (
                        // eslint-disable-next-line local/no-inline-style -- borderLeft/background computed from item.relation
                        <div key={item.id} style={{
                          marginBottom: 3, padding: '3px 6px', borderRadius: 4, fontSize: 'var(--text-2xs)',
                          borderLeft: item.relation === 'support' ? '2px solid var(--success)' : '2px solid var(--danger)',
                          background: item.relation === 'support' ? 'color-mix(in srgb, var(--success) 6%, transparent)' : 'color-mix(in srgb, var(--danger) 6%, transparent)',
                        }}>
                          <div className="clm-evidence-item-head">
                            {/* eslint-disable-next-line local/no-inline-style -- background/color computed from item.relation */}
                            <span style={{
                              fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 4px', borderRadius: 3,
                              background: item.relation === 'support' ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'color-mix(in srgb, var(--danger) 15%, transparent)',
                              color: item.relation === 'support' ? 'var(--success)' : 'var(--danger)',
                            }}>
                              {item.relation === 'support' ? 'SUP' : 'CON'}
                            </span>
                            <span className="clm-muted">{(item.similarity * 100).toFixed(0)}%</span>
                            <span className="clm-evidence-src">
                              {item.source_doc_id}
                            </span>
                          </div>
                          <div className="clm-evidence-text">
                            {item.text.length > 120 ? item.text.slice(0, 120) + '…' : item.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </details>
            );
          })}
          {diag.extracted_claims.rejected.map((c, i) => {
            const isDup = c.reason === 'duplicate_claim';
            const dupOf = isDup ? c.duplicate_of : undefined;
            const dupText = isDup ? c.duplicate_of_text : undefined;
            const rejectedNote = c.reason === 'low_overlap'
              ? 'overlap too low (not grounded)'
              : isDup
                ? `duplicate of existing AN node${dupOf ? ` ${dupOf}` : ''}${dupText ? `: "${dupText}"` : ''}`
                : c.reason;
            return (
              <div key={i} className="clm-m3">
                <span className="clm-c-danger">✗</span> <span data-tooltip={`Word Overlap: ${c.overlap_pct}%\n\nMeasures grounding of claim in the debater's statement.\nFormula: shared words ≥4 chars / total claim words ≥4 chars × 100.\n\nRejected: ${rejectedNote}.`} className="clm-overlap-pct">{c.overlap_pct}%</span> <Highlight text={c.text} />
                <div className="clm-reject-reason">
                  {c.reason}
                  {isDup && dupOf && (
                    <span className="clm-muted">
                      {' → duplicates '}
                      <span className="clm-fw600">{dupOf}</span>
                      {dupText && <span title={dupText}>{`: "${dupText.length > 80 ? dupText.slice(0, 80) + '…' : dupText}"`}</span>}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </Section>
        );
      })()}

      {/* Extraction Trace */}
      {extTrace && (
        <Section title={`Extraction Trace — ${extTrace.candidates_proposed} proposed, ${extTrace.candidates_accepted} accepted, ${extTrace.candidates_rejected} rejected`} defaultOpen copyText={JSON.stringify(extTrace, null, 2)}>
          <div className="clm-trace-grid">
            <div>
              <div className="clm-stat-label">Proposed</div>
              <div>{extTrace.candidates_proposed}</div>
            </div>
            <div>
              <div className="clm-stat-label">Accepted</div>
              <div className="clm-c-success">{extTrace.candidates_accepted}</div>
            </div>
            <div>
              <div className="clm-stat-label">Rejected</div>
              <div className="clm-c-danger">{extTrace.candidates_rejected}</div>
            </div>
          </div>
          {extTrace.an_node_count_before != null && (
            <div className="clm-an-nodes">
              <span className="clm-label-muted">AN nodes:</span>{' '}
              {extTrace.an_node_count_before} → {extTrace.an_node_count_after}
              {extTrace.an_nodes_added_ids.length > 0 && (
                <span className="clm-muted-ml6">
                  (+{extTrace.an_nodes_added_ids.join(', +')})
                </span>
              )}
            </div>
          )}
          {Object.keys(extTrace.rejection_reasons).length > 0 && (
            <div className="clm-2xs">
              <span className="clm-label-muted">Rejection reasons:</span>
              <div className="clm-reasons-wrap">
                {Object.entries(extTrace.rejection_reasons).map(([reason, count]) => (
                  <span key={reason} className="clm-reason-chip">
                    {reason.replace(/_/g, ' ')} ({count})
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Raw Prompt */}
      {diag?.claim_extraction ? (
        <>
          <Section title="Raw Extraction Prompt" copyText={diag.claim_extraction.prompt}>
            <pre className="clm-raw-pre">{diag.claim_extraction.prompt}</pre>
          </Section>
          <Section title={`Raw Extraction Response — ${diag.claim_extraction.claims_parsed} claims, ${(diag.claim_extraction.response_time_ms / 1000).toFixed(1)}s`} copyText={diag.claim_extraction.raw_response}>
            <pre className="clm-raw-pre">{diag.claim_extraction.raw_response}</pre>
          </Section>
        </>
      ) : diag?.extracted_claims && (
        <div className="clm-no-diag">
          No claim extraction diagnostics — claims were extracted inline during the draft stage. Check the Draft tab for raw prompt/response.
        </div>
      )}
    </div>
  );
}
