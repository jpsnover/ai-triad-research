// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import { api } from '@bridge';
import type { EntryDiagnostics, ArgumentNetworkNode, ArgumentNetworkEdge } from '../../../../types/debate';
import { POVER_INFO } from '../../../../types/debate';
import { Highlight, Section, CopyButton } from '../helpers';
import { ScoreBadge, VerdictChip } from '../shared';
import type { Verdict } from '../shared/VerdictChip';

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
    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
      {/* Low-value claims filter banner (anti-filibustering, t/22) */}
      {((): React.ReactNode => {
        const lvr = (extTrace?.rejection_reasons as Record<string, number> | undefined)?.low_marginal_value;
        if (!lvr || lvr <= 0) return null;
        return (
          <div style={{
            padding: '6px 8px', marginBottom: 8, borderRadius: 4,
            borderLeft: '3px solid var(--warning)', background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
            fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--warning) 20%, transparent)', color: 'var(--warning)', fontWeight: 600, fontSize: 'var(--text-2xs)' }}>ANTI-FILIBUSTER</span>
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
            <div key={i} style={{ margin: '3px 0', fontSize: '0.7rem' }}>
              <span style={{ color: 'var(--color-saf)' }}>{i + 1}.</span> <Highlight text={c.claim} />
              {c.targets?.length > 0 && (
                <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
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
                            style={{ color: 'var(--danger)', fontWeight: 600 }}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: '0.7rem' }}>
            {status === 'pending' && (
              <span style={{ padding: '2px 8px', borderRadius: 3, background: 'color-mix(in srgb, var(--color-saf) 15%, transparent)', color: 'var(--color-saf)', fontWeight: 600, fontSize: 'var(--text-2xs)' }}>EXTRACTING...</span>
            )}
            {status === 'failed' && (
              <span style={{ padding: '2px 8px', borderRadius: 3, background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)', fontWeight: 600, fontSize: 'var(--text-2xs)' }}>EXTRACTION FAILED</span>
            )}
            {showReExtract && (
              <button
                style={{
                  padding: '3px 10px', borderRadius: 4, border: '1px solid var(--color-saf)',
                  background: 'color-mix(in srgb, var(--color-saf) 10%, transparent)', color: 'var(--color-saf)', cursor: 'pointer',
                  fontWeight: 600, fontSize: 'var(--text-2xs)',
                }}
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
          <span style={{ padding: '0 4px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, marginLeft: 6,
            background: sharedBdiCategory === 'belief' ? 'color-mix(in srgb, var(--color-saf) 15%, transparent)' : sharedBdiCategory === 'desire' ? 'color-mix(in srgb, var(--color-skp) 15%, transparent)' : 'color-mix(in srgb, var(--color-acc) 15%, transparent)',
            color: sharedBdiCategory === 'belief' ? 'var(--color-saf)' : sharedBdiCategory === 'desire' ? 'var(--color-skp)' : 'var(--color-acc)' }}>
            {sharedBdiCategory}
          </span>
        ) : null;
        const specificityHeaderBadge = sharedSpecificity ? (
          <span style={{ padding: '0 4px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, marginLeft: 6, background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
            {sharedSpecificity}
          </span>
        ) : null;
        const steelmanHeaderBadge = sharedSteelmanOf ? (
          <span style={{ padding: '0 4px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, marginLeft: 6, background: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)', color: 'var(--text-secondary)' }}>
            steelman of {POVER_INFO[sharedSteelmanOf as keyof typeof POVER_INFO]?.label ?? sharedSteelmanOf}
          </span>
        ) : null;

        const sectionSuffix = (bdiHeaderBadge || specificityHeaderBadge || steelmanHeaderBadge) ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
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
              <details key={i} open style={{ margin: '4px 0' }}>
                <summary style={{ cursor: 'pointer' }}>
                  <span style={{ color: 'var(--success)' }}>✓ {c.id}</span> <span data-tooltip={`Word Overlap: ${c.overlap_pct}%\n\nMeasures grounding of claim in the debater's statement.\nFormula: shared words ≥4 chars / total claim words ≥4 chars × 100.\n\nThreshold: < 10-15% = rejected as not grounded.\n${c.overlap_pct}% = ${c.overlap_pct < 50 ? 'moderate' : 'strong'} lexical grounding.`} style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)', cursor: 'default' }}>{c.overlap_pct}%</span>{' '}
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
                    <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', opacity: 0.6, marginRight: 4 }}>not sampled</span>
                  )}
                  {/* §3: per-row badge only when not hoisted to section header */}
                  {anNode?.bdi_category && !sharedBdiCategory && (
                    <span style={{ padding: '0 4px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, marginRight: 3, background: anNode.bdi_category === 'belief' ? 'color-mix(in srgb, var(--color-saf) 15%, transparent)' : anNode.bdi_category === 'desire' ? 'color-mix(in srgb, var(--color-skp) 15%, transparent)' : 'color-mix(in srgb, var(--color-acc) 15%, transparent)', color: anNode.bdi_category === 'belief' ? 'var(--color-saf)' : anNode.bdi_category === 'desire' ? 'var(--color-skp)' : 'var(--color-acc)' }}>
                      {anNode.bdi_category}
                    </span>
                  )}
                  {anNode?.specificity && !sharedSpecificity && (
                    <span style={{ padding: '0 4px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, marginRight: 3, background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
                      {anNode.specificity}
                    </span>
                  )}
                  {anNode?.steelman_of && !sharedSteelmanOf && (
                    <span style={{ padding: '0 4px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, marginRight: 3, background: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)', color: 'var(--text-secondary)' }}>
                      steelman of {POVER_INFO[anNode.steelman_of as keyof typeof POVER_INFO]?.label ?? anNode.steelman_of}
                    </span>
                  )}
                  <Highlight text={c.text} />
                  {anNode?.attribution_text_genus && <div className="claim-attribution-text"><span className="claim-attribution-label">Attribution:</span>{anNode.attribution_text_genus}</div>}
                  {outEdges.length > 0 && (
                    <span style={{ fontSize: 'var(--text-2xs)', marginLeft: 6, color: 'var(--text-muted)' }}>
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
                  <div style={{ paddingLeft: 20, marginTop: 4, marginBottom: 4 }}>
                    {concedeAndPivot && (
                      <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, padding: '2px 6px', marginBottom: 4, borderRadius: 3, background: 'color-mix(in srgb, var(--color-skp) 10%, transparent)', color: 'var(--color-skp)' }}>
                        Concede-and-pivot: supports + attacks edges from the same claim
                      </div>
                    )}
                    {outEdges.map((edge, ei) => {
                      const targetNode = an?.nodes.find(n => n.id === edge.target);
                      const edgeLabel = edge.type === 'attacks'
                        ? (edge.attack_type ? `attacks (${edge.attack_type})` : 'attacks')
                        : 'supports';
                      return (
                        <div key={ei} style={{ fontSize: 'var(--text-2xs)', margin: '3px 0', paddingLeft: 10, borderLeft: edge.type === 'attacks' ? '2px solid var(--danger)' : '2px solid var(--success)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            <span style={{ color: edge.type === 'attacks' ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>{edgeLabel}</span>
                            {edge.strength && (
                              <span style={{ padding: '0 3px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, background: 'var(--bg-hover)', color: strengthColors[edge.strength] ?? 'var(--text-muted)' }}>
                                {edge.strength}
                              </span>
                            )}
                            {edge.argumentation_scheme && <span style={{ padding: '0 3px', borderRadius: 3, fontSize: 'var(--text-2xs)', background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>{edge.argumentation_scheme}</span>}
                          </div>
                          {targetNode && (
                            <div style={{ color: 'var(--text-muted)', marginTop: 1 }}>
                              <span style={{ fontWeight: 600 }}>{targetNode.id}</span> ({POVER_INFO[targetNode.speaker as keyof typeof POVER_INFO]?.label ?? targetNode.speaker}): {targetNode.text}
                            </div>
                          )}
                          {edge.warrant && (
                            <div style={{ color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic', fontSize: 'var(--text-2xs)', paddingLeft: 4, borderLeft: '1px solid var(--border)' }}>
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
                  <div style={{ paddingLeft: 20, marginTop: 6, marginBottom: 4, padding: '6px 8px', borderRadius: 4, background: (repair.verdict as string) === 'entailed' ? 'color-mix(in srgb, var(--success) 8%, transparent)' : repair.verdict === 'partial' ? 'color-mix(in srgb, var(--warning) 8%, transparent)' : 'color-mix(in srgb, var(--danger) 8%, transparent)', border: (repair.verdict as string) === 'entailed' ? '1px solid color-mix(in srgb, var(--success) 20%, transparent)' : repair.verdict === 'partial' ? '1px solid color-mix(in srgb, var(--warning) 20%, transparent)' : '1px solid color-mix(in srgb, var(--danger) 20%, transparent)' }}>
                    <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: verdictColor!, marginBottom: 4 }}>
                      Entailment Repair ({repair.verdict})
                    </div>
                    <div style={{ fontSize: 'var(--text-2xs)', marginBottom: 3 }}>
                      <span style={{ textDecoration: 'line-through', color: 'var(--danger)', opacity: 0.7 }}>{repair.original_text}</span>
                    </div>
                    <div style={{ fontSize: 'var(--text-2xs)', marginBottom: 3, color: 'var(--success)' }}>
                      {repair.repaired_text}
                    </div>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      {repair.explanation}
                    </div>
                  </div>
                )}
                {anNode && (anNode.base_strength != null || anNode.bdi_sub_scores) && (
                  <details style={{ paddingLeft: 20, marginTop: 6, marginBottom: 4 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)' }}>
                      Scores{anNode.base_strength != null ? ` — base: ${anNode.base_strength.toFixed(2)}` : ''}{anNode.computed_strength != null ? ` → computed: ${anNode.computed_strength.toFixed(2)}` : ''}{anNode.scoring_method ? ` (${anNode.scoring_method.replace(/_/g, ' ')})` : ''}
                    </summary>
                    <div style={{ fontSize: 'var(--text-2xs)', marginTop: 4 }}>
                      {anNode.base_strength != null && (
                        <div style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
                          <span><strong>Base:</strong> {anNode.base_strength.toFixed(2)}</span>
                          {anNode.computed_strength != null && <span><strong>Computed:</strong> {anNode.computed_strength.toFixed(2)}</span>}
                          {anNode.scoring_method && <span style={{ color: 'var(--text-muted)' }}>via {anNode.scoring_method.replace(/_/g, ' ')}</span>}
                        </div>
                      )}
                      {anNode.bdi_sub_scores && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                          {Object.entries(anNode.bdi_sub_scores).filter(([, v]) => v != null).map(([k, v]) => {
                            const label = k.replace(/_/g, ' ');
                            const strVal = typeof v === 'number' ? (v >= 0.7 ? 'yes' : v >= 0.4 ? 'partial' : 'no') : String(v);
                            const color = strVal === 'yes' ? 'var(--success)' : strVal === 'partial' ? 'var(--warning)' : 'var(--danger)';
                            return (
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
                    <div style={{ paddingLeft: 20, marginTop: 6, marginBottom: 4 }}>
                      <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                        Evidence ({supports.length} support, {contradicts.length} contradict)
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--bg-primary)' }}>
                          <div style={{ width: `${barPct}%`, height: '100%', borderRadius: 3, background: barColor }} />
                        </div>
                        <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: barColor, minWidth: 36 }}>
                          {eg.computed_strength.toFixed(2)}
                        </span>
                        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                          {eg.qbaf_iterations} iter
                        </span>
                      </div>
                      {eg.evidence_items
                        .sort((a, b) => a.relation !== b.relation ? (a.relation === 'contradict' ? -1 : 1) : b.similarity - a.similarity)
                        .map(item => (
                        <div key={item.id} style={{
                          marginBottom: 3, padding: '3px 6px', borderRadius: 4, fontSize: 'var(--text-2xs)',
                          borderLeft: item.relation === 'support' ? '2px solid var(--success)' : '2px solid var(--danger)',
                          background: item.relation === 'support' ? 'color-mix(in srgb, var(--success) 6%, transparent)' : 'color-mix(in srgb, var(--danger) 6%, transparent)',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{
                              fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 4px', borderRadius: 3,
                              background: item.relation === 'support' ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'color-mix(in srgb, var(--danger) 15%, transparent)',
                              color: item.relation === 'support' ? 'var(--success)' : 'var(--danger)',
                            }}>
                              {item.relation === 'support' ? 'SUP' : 'CON'}
                            </span>
                            <span style={{ color: 'var(--text-muted)' }}>{(item.similarity * 100).toFixed(0)}%</span>
                            <span style={{ color: 'var(--text-muted)', flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.source_doc_id}
                            </span>
                          </div>
                          <div style={{ lineHeight: 1.3, color: 'var(--text-primary)', marginTop: 1 }}>
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
              <div key={i} style={{ margin: '3px 0' }}>
                <span style={{ color: 'var(--danger)' }}>✗</span> <span data-tooltip={`Word Overlap: ${c.overlap_pct}%\n\nMeasures grounding of claim in the debater's statement.\nFormula: shared words ≥4 chars / total claim words ≥4 chars × 100.\n\nRejected: ${rejectedNote}.`} style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)', cursor: 'default' }}>{c.overlap_pct}%</span> <Highlight text={c.text} />
                <div style={{ color: 'var(--warning)', fontSize: 'var(--text-2xs)', paddingLeft: 16 }}>
                  {c.reason}
                  {isDup && dupOf && (
                    <span style={{ color: 'var(--text-muted)' }}>
                      {' → duplicates '}
                      <span style={{ fontWeight: 600 }}>{dupOf}</span>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: '0.7rem', marginBottom: 6 }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>Proposed</div>
              <div>{extTrace.candidates_proposed}</div>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>Accepted</div>
              <div style={{ color: 'var(--success)' }}>{extTrace.candidates_accepted}</div>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>Rejected</div>
              <div style={{ color: 'var(--danger)' }}>{extTrace.candidates_rejected}</div>
            </div>
          </div>
          {extTrace.an_node_count_before != null && (
            <div style={{ fontSize: 'var(--text-2xs)', marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>AN nodes:</span>{' '}
              {extTrace.an_node_count_before} → {extTrace.an_node_count_after}
              {extTrace.an_nodes_added_ids.length > 0 && (
                <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                  (+{extTrace.an_nodes_added_ids.join(', +')})
                </span>
              )}
            </div>
          )}
          {Object.keys(extTrace.rejection_reasons).length > 0 && (
            <div style={{ fontSize: 'var(--text-2xs)' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Rejection reasons:</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                {Object.entries(extTrace.rejection_reasons).map(([reason, count]) => (
                  <span key={reason} style={{ padding: '1px 6px', borderRadius: 3, fontSize: 'var(--text-2xs)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)' }}>
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
            <pre style={{ fontSize: 'var(--text-2xs)', whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto', padding: '6px 8px', borderRadius: 4, background: 'var(--bg-secondary)', fontFamily: 'monospace' }}>{diag.claim_extraction.prompt}</pre>
          </Section>
          <Section title={`Raw Extraction Response — ${diag.claim_extraction.claims_parsed} claims, ${(diag.claim_extraction.response_time_ms / 1000).toFixed(1)}s`} copyText={diag.claim_extraction.raw_response}>
            <pre style={{ fontSize: 'var(--text-2xs)', whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto', padding: '6px 8px', borderRadius: 4, background: 'var(--bg-secondary)', fontFamily: 'monospace' }}>{diag.claim_extraction.raw_response}</pre>
          </Section>
        </>
      ) : diag?.extracted_claims && (
        <div style={{ padding: '6px 10px', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
          No claim extraction diagnostics — claims were extracted inline during the draft stage. Check the Draft tab for raw prompt/response.
        </div>
      )}
    </div>
  );
}
