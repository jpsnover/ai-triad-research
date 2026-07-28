// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import { Highlight, CopyButton } from '../helpers';
import './LookaheadTab.css';

export interface LookaheadTabProps {
  lookaheadDiag: any;
}

export function LookaheadTab(props: LookaheadTabProps) {
  const { lookaheadDiag } = props;
  return (
    <div className="look-container">
      {/* Header */}
      <div className="look-header">
        {/* eslint-disable-next-line local/no-inline-style -- dynamic pass/fail background+color */}
        <span style={{
          padding: '1px 6px', borderRadius: 3, fontWeight: 600,
          background: lookaheadDiag.final_pass ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)',
          color: lookaheadDiag.final_pass ? 'var(--success)' : 'var(--danger)',
        }}>{lookaheadDiag.final_pass ? '✓ PASS' : '✗ FAIL'}</span>
        <span>LOOKAHEAD</span>
        <span>{(lookaheadDiag.elapsed_ms / 1000).toFixed(1)}s</span>
        {lookaheadDiag.regen_triggered && <span className="look-regen-badge">REGEN TRIGGERED</span>}
      </div>

      {/* Utility Delta Gauge */}
      {(() => {
        const r = lookaheadDiag.first_attempt;
        const before = r.utility_before.composite;
        const after = r.utility_after.composite;
        const delta = r.utility_delta;
        const pct = Math.min(Math.max((after / Math.max(before, 0.01)) * 50, 5), 95);
        const deltaColor = delta > 0.05 ? 'var(--success)' : delta >= 0 ? 'var(--warning)' : 'var(--danger)';
        return (
          // eslint-disable-next-line local/no-inline-style -- dynamic deltaColor border/background
          <div style={{ padding: 8, margin: '6px 0', borderLeft: `3px solid ${deltaColor}`, background: `${deltaColor}08`, borderRadius: 4 }}>
            <div className="look-gauge-row">
              <span>Before: <strong>{before.toFixed(3)}</strong></span>
              {/* eslint-disable-next-line local/no-inline-style -- dynamic deltaColor */}
              <span style={{ color: deltaColor, fontWeight: 700 }}>{'Δ'}u = {delta >= 0 ? '+' : ''}{delta.toFixed(3)}</span>
              <span>After: <strong>{after.toFixed(3)}</strong></span>
            </div>
            <div className="look-bar-track">
              <div className="look-bar-baseline" />
              {/* eslint-disable-next-line local/no-inline-style -- dynamic pct width + deltaColor */}
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: deltaColor, borderRadius: 5, transition: 'width 0.3s' }} />
            </div>
            <div className="look-bar-footer">
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
          <div className="look-assessment">
            <div className="look-section-label">STRATEGIC ASSESSMENT</div>
            {assessments.map((a, i) => (
              // eslint-disable-next-line local/no-inline-style -- dynamic borderLeft color
              <div key={i} style={{ margin: '3px 0', paddingLeft: 8, borderLeft: `2px solid ${a.includes('Pattern:') ? (r.pass ? 'var(--success)40' : 'var(--danger)40') : 'var(--text-muted)40'}` }}>
                {a}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Utility Breakdown */}
      <details open className="look-mt6"><summary className="look-summary">Utility Breakdown</summary>
        <table className="look-table">
          <thead>
            <tr className="look-thead-row">
              <th className="look-cell-l">Component</th>
              <th className="look-cell-r">Before</th>
              <th className="look-cell-r">After</th>
              <th className="look-cell-r">{'Δ'}</th>
              <th className="look-cell-l">Assessment</th>
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
              const hintColor = hint === 'diluting' || hint === 'no attacks' || hint === 'avoiding cruxes' ? 'var(--danger)'
                : hint === 'stable' || hint === 'plateau' || hint === 'fully engaged' ? 'var(--text-muted)'
                : 'var(--success)';
              return (
                // eslint-disable-next-line local/no-inline-style -- dynamic fontWeight for composite row
                <tr key={k} style={{ borderBottom: '1px solid var(--border)', fontWeight: k === 'composite' ? 700 : 400 }}>
                  <td className="look-cell-p">{k.replace(/_/g, ' ')}</td>
                  <td className="look-cell-r">{b.toFixed(3)}</td>
                  <td className="look-cell-r">{a.toFixed(3)}</td>
                  {/* eslint-disable-next-line local/no-inline-style -- dynamic delta color */}
                  <td style={{ textAlign: 'right', padding: '2px 6px', color: d > 0 ? 'var(--success)' : d < 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{d >= 0 ? '+' : ''}{d.toFixed(3)}</td>
                  {/* eslint-disable-next-line local/no-inline-style -- dynamic hintColor */}
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
          <details open className="look-mt6"><summary className="look-summary">
            Tentative Claims ({claims.length})
            <span className="look-claims-meta">
              {strongCount > 0 && <span className="look-c-success">{strongCount} strong</span>}
              {strongCount > 0 && weakCount > 0 && ', '}
              {weakCount > 0 && <span className="look-c-danger">{weakCount} weak</span>}
            </span>
          </summary>
            {claims.map((c: any, i: number) => {
              const pca = firstPca?.perClaim[i];
              const classification = pca?.classification;
              const marginalDelta = pca?.marginal_delta;
              const reason = firstPca?.analysis[classification === 'STRONG' ? 'strongFoundations' : 'avoidClaims']
                ?.find((a: any) => a.text === c.text)?.reason;
              const claimColor = classification === 'STRONG' ? 'var(--success)' : classification === 'WEAK' ? 'var(--danger)' : (c.strength >= 0.7 ? 'var(--success)' : c.strength >= 0.4 ? 'var(--warning)' : 'var(--danger)');
              const label = classification ?? (c.strength >= 0.7 ? 'STRONG' : c.strength >= 0.4 ? 'MODERATE' : 'WEAK');
              return (
                // eslint-disable-next-line local/no-inline-style -- dynamic claimColor border
                <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: `2px solid ${claimColor}40`, fontSize: '0.7rem' }}>
                  <div className="look-claim-header">
                    {/* eslint-disable-next-line local/no-inline-style -- dynamic claimColor */}
                    <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-2xs)', color: claimColor, fontWeight: 600 }}>{c.strength.toFixed(2)}</span>
                    {/* eslint-disable-next-line local/no-inline-style -- dynamic claimColor background+color */}
                    <span style={{ fontSize: 'var(--text-2xs)', padding: '0 4px', borderRadius: 3, background: `${claimColor}15`, color: claimColor, fontWeight: 600 }}>{label}</span>
                    {marginalDelta != null && (
                      // eslint-disable-next-line local/no-inline-style -- dynamic marginalDelta color
                      <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-2xs)', color: marginalDelta >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                        {'Δ'}u {marginalDelta >= 0 ? '+' : ''}{marginalDelta.toFixed(4)}
                      </span>
                    )}
                  </div>
                  <Highlight text={c.text} />
                  {reason && (
                    <div className="look-reason-inline">{reason}</div>
                  )}
                </div>
              );
            })}
            <div className="look-net-size">
              Tentative network: {lookaheadDiag.first_attempt.tentative_network_size.nodes} nodes, {lookaheadDiag.first_attempt.tentative_network_size.edges} edges
            </div>
          </details>
        );
      })()}

      {/* Attempt Progression Summary */}
      {lookaheadDiag.per_claim_analysis && lookaheadDiag.per_claim_analysis.length > 0 && (
        <div className="look-progression">
          {lookaheadDiag.per_claim_analysis.map((pca: any, idx: number) => {
            const sCount = pca.perClaim.filter((pc: any) => pc.classification === 'STRONG').length;
            const wCount = pca.perClaim.filter((pc: any) => pc.classification === 'WEAK').length;
            const regenAttempts = lookaheadDiag.regen_attempts ?? (lookaheadDiag.regen_attempt ? [lookaheadDiag.regen_attempt] : []);
            const delta = idx === 0 ? lookaheadDiag.first_attempt.utility_delta : regenAttempts[idx - 1]?.utility_delta;
            const pass = idx === 0 ? lookaheadDiag.first_attempt.pass : regenAttempts[idx - 1]?.pass;
            return (
              <div key={idx} className="look-attempt">
                <span className="look-fw600">Attempt {idx + 1}:</span>{' '}
                {/* eslint-disable-next-line local/no-inline-style -- dynamic delta sign color */}
                <span style={{ color: delta != null && delta >= 0 ? 'var(--success)' : 'var(--danger)' }}>{'Δ'}u = {delta != null ? (delta >= 0 ? '+' : '') + delta.toFixed(3) : '?'}</span>{' '}
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
            <div key={ai} className="look-regen-box">
              <div className="look-regen-header">
                <span className="look-regen-badge">REGEN {ai + 1}/{attempts.length}</span>
                {/* eslint-disable-next-line local/no-inline-style -- dynamic ra.pass background+color */}
                <span style={{
                  padding: '1px 6px', borderRadius: 3, fontWeight: 600, fontSize: 'var(--text-2xs)',
                  background: ra.pass ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)',
                  color: ra.pass ? 'var(--success)' : 'var(--danger)',
                }}>{ra.pass ? '✓ PASS' : '✗ FAIL'}</span>
              </div>
              <div className="look-fs072">
                <span>{'Δ'}u = {ra.utility_delta >= 0 ? '+' : ''}{ra.utility_delta.toFixed(3)}</span>
                <span className="look-threshold">threshold: {ra.threshold.toFixed(3)}</span>
              </div>

              {/* Guidance injected into this retry */}
              {guidancePca && (guidancePca.analysis.strongFoundations.length > 0 || guidancePca.analysis.avoidClaims.length > 0) && (
                <details className="look-mt4"><summary className="look-summary-sm">Guidance Injected</summary>
                  {guidancePca.analysis.strongFoundations.length > 0 && (
                    <div className="look-mt2">
                      <div className="look-guide-head-success">STRONG FOUNDATIONS</div>
                      {guidancePca.analysis.strongFoundations.map((sf: any, si: number) => (
                        <div key={si} className="look-guide-item-success">
                          <span className="look-mono-success">{'Δ'}u +{sf.marginal_delta.toFixed(4)}</span>
                          <span>{sf.text.slice(0, 80)}{sf.text.length > 80 ? '…' : ''}</span>
                          <div className="look-reason">{sf.reason}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {guidancePca.analysis.avoidClaims.length > 0 && (
                    <div className="look-mt4">
                      <div className="look-guide-head-danger">DO NOT USE</div>
                      {guidancePca.analysis.avoidClaims.map((ac: any, aci: number) => (
                        <div key={aci} className="look-guide-item-danger">
                          <span className="look-mono-danger">{'Δ'}u {ac.marginal_delta.toFixed(4)}</span>
                          <span>{ac.text.slice(0, 80)}{ac.text.length > 80 ? '…' : ''}</span>
                          <div className="look-reason">{ac.reason}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              )}

              {/* Regen claims with per-claim analysis if available */}
              {ra.tentative_claims.length > 0 && (
                <details className="look-mt4"><summary className="look-summary-sm">Regen Claims ({ra.tentative_claims.length})</summary>
                  {ra.tentative_claims.map((c: any, ci: number) => {
                    const pc = regenPca?.perClaim[ci];
                    const pcColor = pc ? (pc.classification === 'STRONG' ? 'var(--success)' : 'var(--danger)') : 'var(--text-muted)';
                    return (
                      // eslint-disable-next-line local/no-inline-style -- dynamic pcColor border
                      <div key={ci} style={{ margin: '3px 0', paddingLeft: 8, borderLeft: `2px solid ${pcColor}40`, fontSize: 'var(--text-2xs)' }}>
                        <div className="look-regen-claim-header">
                          {/* eslint-disable-next-line local/no-inline-style -- dynamic pcColor */}
                          <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-2xs)', color: pcColor, fontWeight: 600 }}>{c.strength.toFixed(2)}</span>
                          {/* eslint-disable-next-line local/no-inline-style -- dynamic pcColor background+color */}
                          {pc && <span style={{ fontSize: 'var(--text-2xs)', padding: '0 3px', borderRadius: 2, background: `${pcColor}15`, color: pcColor, fontWeight: 600 }}>{pc.classification}</span>}
                          {/* eslint-disable-next-line local/no-inline-style -- dynamic pcColor */}
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
        <div className="look-low-util">
          Low utility turn — all attempts failed threshold. Committed anyway; <code>low_utility_turn</code> logged.
        </div>
      )}

      {/* Raw Data */}
      <details className="look-mt8">
        <summary className="look-summary-raw">
          Raw Data <CopyButton text={JSON.stringify(lookaheadDiag, null, 2)} />
        </summary>
        <pre className="look-pre">{JSON.stringify(lookaheadDiag, null, 2)}</pre>
      </details>
    </div>
  );
}
