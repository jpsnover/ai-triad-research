// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import { Highlight, CopyButton } from '../helpers';

export interface LookaheadTabProps {
  lookaheadDiag: any;
}

export function LookaheadTab(props: LookaheadTabProps) {
  const { lookaheadDiag } = props;
  return (
    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        <span style={{
          padding: '1px 6px', borderRadius: 3, fontWeight: 600,
          background: lookaheadDiag.final_pass ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)',
          color: lookaheadDiag.final_pass ? '#16a34a' : '#dc2626',
        }}>{lookaheadDiag.final_pass ? '✓ PASS' : '✗ FAIL'}</span>
        <span>LOOKAHEAD</span>
        <span>{(lookaheadDiag.elapsed_ms / 1000).toFixed(1)}s</span>
        {lookaheadDiag.regen_triggered && <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(245,158,11,0.2)', color: '#d97706', fontWeight: 600, fontSize: 'var(--text-2xs)' }}>REGEN TRIGGERED</span>}
      </div>

      {/* Utility Delta Gauge */}
      {(() => {
        const r = lookaheadDiag.first_attempt;
        const before = r.utility_before.composite;
        const after = r.utility_after.composite;
        const delta = r.utility_delta;
        const pct = Math.min(Math.max((after / Math.max(before, 0.01)) * 50, 5), 95);
        const deltaColor = delta > 0.05 ? '#16a34a' : delta >= 0 ? '#d97706' : '#dc2626';
        return (
          <div style={{ padding: 8, margin: '6px 0', borderLeft: `3px solid ${deltaColor}`, background: `${deltaColor}08`, borderRadius: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginBottom: 6 }}>
              <span>Before: <strong>{before.toFixed(3)}</strong></span>
              <span style={{ color: deltaColor, fontWeight: 700 }}>{'Δ'}u = {delta >= 0 ? '+' : ''}{delta.toFixed(3)}</span>
              <span>After: <strong>{after.toFixed(3)}</strong></span>
            </div>
            <div style={{ height: 10, borderRadius: 5, background: 'var(--bg-secondary)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '50%', background: 'rgba(128,128,128,0.15)', borderRight: '2px solid var(--text-muted)' }} />
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: deltaColor, borderRadius: 5, transition: 'width 0.3s' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2 }}>
              <span>threshold: {r.threshold.toFixed(3)}</span>
              <span>{r.pass ? '✓ passed' : '✗ below threshold'}</span>
            </div>
          </div>
        );
      })()}

      {/* Strategic Assessment */}
      {(() => {
        const r = lookaheadDiag.first_attempt;
        const posDelta = r.utility_after.position_strength - r.utility_before.position_strength;
        const atkDelta = r.utility_after.attack_effectiveness - r.utility_before.attack_effectiveness;
        const crxDelta = r.utility_after.crux_engagement - r.utility_before.crux_engagement;
        const claims = r.tentative_claims;
        const weakClaims = claims.filter((c: any) => c.strength < 0.4).length;
        const strongClaims = claims.filter((c: any) => c.strength >= 0.7).length;

        const assessments: string[] = [];
        if (posDelta < -0.03 && r.utility_before.position_strength > 0.7) {
          assessments.push(`Position dilution: speaker had strong position (${r.utility_before.position_strength.toFixed(2)}) but new claims drag the average down${weakClaims > 0 ? ` — ${weakClaims} weak claim${weakClaims !== 1 ? 's' : ''} (< 0.4 strength) pulling the mean` : ''}.`);
        } else if (posDelta < -0.03) {
          assessments.push(`Position weakened: new claims undermine the speaker's existing arguments.`);
        } else if (posDelta > 0.03) {
          assessments.push(`Position strengthened: new claims reinforce the speaker's stance (+${posDelta.toFixed(3)}).`);
        }
        if (atkDelta < 0.001 && r.utility_before.attack_effectiveness < 0.3) {
          assessments.push(`No offensive impact: claims are defensive — they reinforce the speaker's position but don't target opponent weak points.`);
        } else if (atkDelta < 0.001 && r.utility_before.attack_effectiveness >= 0.3) {
          assessments.push(`Attack plateau: speaker already has good attack coverage (${r.utility_before.attack_effectiveness.toFixed(2)}) and these claims don't extend it.`);
        } else if (atkDelta > 0.05) {
          assessments.push(`Strong offensive move: attacks landed on opponent nodes (+${atkDelta.toFixed(3)} effectiveness).`);
        }
        if (crxDelta < 0.001 && r.utility_before.crux_engagement >= 0.9) {
          assessments.push(`Cruxes fully addressed: all identified cruxes already engaged — new claims don't open new territory.`);
        } else if (crxDelta < 0.001 && r.utility_before.crux_engagement < 0.5) {
          assessments.push(`Crux avoidance: ${((1 - r.utility_before.crux_engagement) * 100).toFixed(0)}% of cruxes unaddressed and these claims don't engage them.`);
        } else if (crxDelta > 0.05) {
          assessments.push(`Crux engagement improved: speaker addressed previously unengaged disagreement points.`);
        }
        if (!r.pass && posDelta < 0 && atkDelta < 0.001) {
          assessments.push(`Pattern: padding — speaker is adding volume without advancing the debate. Retry hint would push toward targeted attacks on opponent weak points or unresolved cruxes.`);
        } else if (!r.pass && r.utility_delta >= 0 && r.utility_delta < r.threshold) {
          assessments.push(`Pattern: marginal — claims add slight value but below the threshold for meaningful contribution. More specific, falsifiable claims would score higher.`);
        } else if (r.pass && r.utility_delta > 0.05) {
          assessments.push(`Pattern: strong move — claims meaningfully advance the speaker's position.`);
        }

        if (assessments.length === 0) return null;
        return (
          <div style={{ margin: '6px 0', padding: '6px 8px', borderRadius: 4, background: 'var(--bg-secondary)', fontSize: '0.7rem', lineHeight: 1.5 }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--text-2xs)', marginBottom: 4, color: 'var(--text-muted)' }}>STRATEGIC ASSESSMENT</div>
            {assessments.map((a, i) => (
              <div key={i} style={{ margin: '3px 0', paddingLeft: 8, borderLeft: `2px solid ${a.includes('Pattern:') ? (r.pass ? '#16a34a40' : '#dc262640') : '#6b728040'}` }}>
                {a}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Utility Breakdown */}
      <details open style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem' }}>Utility Breakdown</summary>
        <table style={{ width: '100%', fontSize: 'var(--text-2xs)', borderCollapse: 'collapse', marginTop: 4 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <th style={{ textAlign: 'left', padding: '2px 6px' }}>Component</th>
              <th style={{ textAlign: 'right', padding: '2px 6px' }}>Before</th>
              <th style={{ textAlign: 'right', padding: '2px 6px' }}>After</th>
              <th style={{ textAlign: 'right', padding: '2px 6px' }}>{'Δ'}</th>
              <th style={{ textAlign: 'left', padding: '2px 6px' }}>Assessment</th>
            </tr>
          </thead>
          <tbody>
            {(['position_strength', 'attack_effectiveness', 'crux_engagement', 'composite'] as const).map(k => {
              const b = lookaheadDiag.first_attempt.utility_before[k];
              const a = lookaheadDiag.first_attempt.utility_after[k];
              const d = a - b;
              const hint = k === 'position_strength'
                ? (d < -0.03 ? 'diluting' : d > 0.03 ? 'reinforcing' : 'stable')
                : k === 'attack_effectiveness'
                ? (d < 0.001 ? (b < 0.3 ? 'no attacks' : 'plateau') : 'attacks landed')
                : k === 'crux_engagement'
                ? (d < 0.001 ? (b >= 0.9 ? 'fully engaged' : 'avoiding cruxes') : 'engaging')
                : '';
              const hintColor = hint === 'diluting' || hint === 'no attacks' || hint === 'avoiding cruxes' ? '#dc2626'
                : hint === 'stable' || hint === 'plateau' || hint === 'fully engaged' ? 'var(--text-muted)'
                : '#16a34a';
              return (
                <tr key={k} style={{ borderBottom: '1px solid var(--border)', fontWeight: k === 'composite' ? 700 : 400 }}>
                  <td style={{ padding: '2px 6px' }}>{k.replace(/_/g, ' ')}</td>
                  <td style={{ textAlign: 'right', padding: '2px 6px' }}>{b.toFixed(3)}</td>
                  <td style={{ textAlign: 'right', padding: '2px 6px' }}>{a.toFixed(3)}</td>
                  <td style={{ textAlign: 'right', padding: '2px 6px', color: d > 0 ? '#16a34a' : d < 0 ? '#dc2626' : 'var(--text-muted)' }}>{d >= 0 ? '+' : ''}{d.toFixed(3)}</td>
                  <td style={{ padding: '2px 6px', fontSize: 'var(--text-2xs)', color: hintColor, fontStyle: 'italic' }}>{hint}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>

      {/* Tentative Claims with Per-Claim Marginal Utility */}
      {lookaheadDiag.first_attempt.tentative_claims.length > 0 && (() => {
        const firstPca = lookaheadDiag.per_claim_analysis?.[0];
        const claims = lookaheadDiag.first_attempt.tentative_claims;
        const strongCount = firstPca ? firstPca.perClaim.filter((pc: any) => pc.classification === 'STRONG').length : claims.filter((c: any) => c.strength >= 0.7).length;
        const weakCount = firstPca ? firstPca.perClaim.filter((pc: any) => pc.classification === 'WEAK').length : claims.filter((c: any) => c.strength < 0.4).length;
        return (
          <details open style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem' }}>
            Tentative Claims ({claims.length})
            <span style={{ fontWeight: 400, fontSize: 'var(--text-2xs)', marginLeft: 8, color: 'var(--text-muted)' }}>
              {strongCount > 0 && <span style={{ color: '#16a34a' }}>{strongCount} strong</span>}
              {strongCount > 0 && weakCount > 0 && ', '}
              {weakCount > 0 && <span style={{ color: '#dc2626' }}>{weakCount} weak</span>}
            </span>
          </summary>
            {claims.map((c: any, i: number) => {
              const pca = firstPca?.perClaim[i];
              const classification = pca?.classification;
              const marginalDelta = pca?.marginal_delta;
              const reason = firstPca?.analysis[classification === 'STRONG' ? 'strongFoundations' : 'avoidClaims']
                ?.find((a: any) => a.text === c.text)?.reason;
              const claimColor = classification === 'STRONG' ? '#16a34a' : classification === 'WEAK' ? '#dc2626' : (c.strength >= 0.7 ? '#16a34a' : c.strength >= 0.4 ? '#d97706' : '#dc2626');
              const label = classification ?? (c.strength >= 0.7 ? 'STRONG' : c.strength >= 0.4 ? 'MODERATE' : 'WEAK');
              return (
                <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: `2px solid ${claimColor}40`, fontSize: '0.7rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-2xs)', color: claimColor, fontWeight: 600 }}>{c.strength.toFixed(2)}</span>
                    <span style={{ fontSize: 'var(--text-2xs)', padding: '0 4px', borderRadius: 3, background: `${claimColor}15`, color: claimColor, fontWeight: 600 }}>{label}</span>
                    {marginalDelta != null && (
                      <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-2xs)', color: marginalDelta >= 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                        {'Δ'}u {marginalDelta >= 0 ? '+' : ''}{marginalDelta.toFixed(4)}
                      </span>
                    )}
                  </div>
                  <Highlight text={c.text} />
                  {reason && (
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2, paddingLeft: 4 }}>{reason}</div>
                  )}
                </div>
              );
            })}
            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 4 }}>
              Tentative network: {lookaheadDiag.first_attempt.tentative_network_size.nodes} nodes, {lookaheadDiag.first_attempt.tentative_network_size.edges} edges
            </div>
          </details>
        );
      })()}

      {/* Attempt Progression Summary */}
      {lookaheadDiag.per_claim_analysis && lookaheadDiag.per_claim_analysis.length > 0 && (
        <div style={{ margin: '6px 0', padding: '6px 8px', borderRadius: 4, background: 'var(--bg-secondary)', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
          {lookaheadDiag.per_claim_analysis.map((pca: any, idx: number) => {
            const sCount = pca.perClaim.filter((pc: any) => pc.classification === 'STRONG').length;
            const wCount = pca.perClaim.filter((pc: any) => pc.classification === 'WEAK').length;
            const regenAttempts = lookaheadDiag.regen_attempts ?? (lookaheadDiag.regen_attempt ? [lookaheadDiag.regen_attempt] : []);
            const delta = idx === 0 ? lookaheadDiag.first_attempt.utility_delta : regenAttempts[idx - 1]?.utility_delta;
            const pass = idx === 0 ? lookaheadDiag.first_attempt.pass : regenAttempts[idx - 1]?.pass;
            return (
              <div key={idx} style={{ display: 'inline-block', marginRight: 12 }}>
                <span style={{ fontWeight: 600 }}>Attempt {idx + 1}:</span>{' '}
                <span style={{ color: delta != null && delta >= 0 ? '#16a34a' : '#dc2626' }}>{'Δ'}u = {delta != null ? (delta >= 0 ? '+' : '') + delta.toFixed(3) : '?'}</span>{' '}
                ({sCount} strong, {wCount} weak){pass ? ' ✓' : ''}
              </div>
            );
          })}
        </div>
      )}

      {/* Regeneration Attempts */}
      {lookaheadDiag.regen_triggered && (() => {
        const attempts = lookaheadDiag.regen_attempts ?? (lookaheadDiag.regen_attempt ? [lookaheadDiag.regen_attempt] : []);
        if (attempts.length === 0) return null;
        const pcaLog = lookaheadDiag.per_claim_analysis;
        return attempts.map((ra: any, ai: number) => {
          const guidancePca = pcaLog?.[ai];
          const regenPca = pcaLog?.[ai + 1];
          return (
            <div key={ai} style={{ marginTop: 8, padding: 8, borderLeft: '3px solid #d97706', background: 'rgba(245,158,11,0.06)', borderRadius: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(245,158,11,0.2)', color: '#d97706', fontWeight: 600, fontSize: 'var(--text-2xs)' }}>REGEN {ai + 1}/{attempts.length}</span>
                <span style={{
                  padding: '1px 6px', borderRadius: 3, fontWeight: 600, fontSize: 'var(--text-2xs)',
                  background: ra.pass ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)',
                  color: ra.pass ? '#16a34a' : '#dc2626',
                }}>{ra.pass ? '✓ PASS' : '✗ FAIL'}</span>
              </div>
              <div style={{ fontSize: '0.72rem' }}>
                <span>{'Δ'}u = {ra.utility_delta >= 0 ? '+' : ''}{ra.utility_delta.toFixed(3)}</span>
                <span style={{ marginLeft: 12, color: 'var(--text-muted)' }}>threshold: {ra.threshold.toFixed(3)}</span>
              </div>

              {/* Guidance injected into this retry */}
              {guidancePca && (guidancePca.analysis.strongFoundations.length > 0 || guidancePca.analysis.avoidClaims.length > 0) && (
                <details style={{ marginTop: 4 }}><summary style={{ cursor: 'pointer', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>Guidance Injected</summary>
                  {guidancePca.analysis.strongFoundations.length > 0 && (
                    <div style={{ marginTop: 2 }}>
                      <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, color: '#16a34a', marginBottom: 2 }}>STRONG FOUNDATIONS</div>
                      {guidancePca.analysis.strongFoundations.map((sf: any, si: number) => (
                        <div key={si} style={{ margin: '2px 0', paddingLeft: 8, borderLeft: '2px solid rgba(22,163,74,0.3)', fontSize: 'var(--text-2xs)' }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-2xs)', color: '#16a34a', marginRight: 4 }}>{'Δ'}u +{sf.marginal_delta.toFixed(4)}</span>
                          <span>{sf.text.slice(0, 80)}{sf.text.length > 80 ? '…' : ''}</span>
                          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>{sf.reason}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {guidancePca.analysis.avoidClaims.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, color: '#dc2626', marginBottom: 2 }}>DO NOT USE</div>
                      {guidancePca.analysis.avoidClaims.map((ac: any, aci: number) => (
                        <div key={aci} style={{ margin: '2px 0', paddingLeft: 8, borderLeft: '2px solid rgba(220,38,38,0.3)', fontSize: 'var(--text-2xs)' }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-2xs)', color: '#dc2626', marginRight: 4 }}>{'Δ'}u {ac.marginal_delta.toFixed(4)}</span>
                          <span>{ac.text.slice(0, 80)}{ac.text.length > 80 ? '…' : ''}</span>
                          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>{ac.reason}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              )}

              {/* Regen claims with per-claim analysis if available */}
              {ra.tentative_claims.length > 0 && (
                <details style={{ marginTop: 4 }}><summary style={{ cursor: 'pointer', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>Regen Claims ({ra.tentative_claims.length})</summary>
                  {ra.tentative_claims.map((c: any, ci: number) => {
                    const pc = regenPca?.perClaim[ci];
                    const pcColor = pc ? (pc.classification === 'STRONG' ? '#16a34a' : '#dc2626') : 'var(--text-muted)';
                    return (
                      <div key={ci} style={{ margin: '3px 0', paddingLeft: 8, borderLeft: `2px solid ${pcColor}40`, fontSize: 'var(--text-2xs)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-2xs)', color: pcColor, fontWeight: 600 }}>{c.strength.toFixed(2)}</span>
                          {pc && <span style={{ fontSize: 'var(--text-2xs)', padding: '0 3px', borderRadius: 2, background: `${pcColor}15`, color: pcColor, fontWeight: 600 }}>{pc.classification}</span>}
                          {pc && <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-2xs)', color: pcColor }}>{'Δ'}u {pc.marginal_delta >= 0 ? '+' : ''}{pc.marginal_delta.toFixed(4)}</span>}
                        </div>
                        <Highlight text={c.text} />
                      </div>
                    );
                  })}
                </details>
              )}
            </div>
          );
        });
      })()}

      {/* Low Utility Warning */}
      {!lookaheadDiag.final_pass && (
        <div style={{
          marginTop: 8, padding: '8px 10px', borderRadius: 4,
          borderLeft: '3px solid #dc2626', background: 'rgba(220,38,38,0.08)',
          fontSize: '0.72rem', color: '#dc2626', fontWeight: 600,
        }}>
          Low utility turn — all attempts failed threshold. Committed anyway; <code>low_utility_turn</code> logged.
        </div>
      )}

      {/* Raw Data */}
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Raw Data <CopyButton text={JSON.stringify(lookaheadDiag, null, 2)} />
        </summary>
        <pre style={{ fontSize: 'var(--text-2xs)', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(lookaheadDiag, null, 2)}</pre>
      </details>
    </div>
  );
}
