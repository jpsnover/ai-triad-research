// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import { Section } from '../helpers';
import type { EntryDiagnostics } from '../../../../types/debate';

interface ExclusionViolation {
  claim_id: string;
  claim_text: string;
  node_id: string;
  similarity_main: number;
  similarity_exclusion: number;
}

interface ExclusionGuardData {
  checked: number;
  refs_with_exclusion_vector: number;
  violations: ExclusionViolation[];
  threshold: number;
}

interface ScopeDriftWarning {
  debater: string;
  node_id: string;
  similarity: number;
  draft_excerpt: string;
}

interface ScopeDriftCheckData {
  checked: boolean;
  refs_checked: number;
  refs_with_exclusion_vector: number;
  warnings: ScopeDriftWarning[];
  threshold: number;
}

export interface ExclusionGuardTabProps {
  diag: EntryDiagnostics | undefined;
}

function similarityColor(value: number): string {
  if (value > 0.8) return 'var(--danger)';
  if (value > 0.6) return 'var(--warning)';
  return 'var(--success)';
}

export function ExclusionGuardTab({ diag }: ExclusionGuardTabProps) {
  // --- Claim Extraction Guard ---
  const extTrace = diag?.extraction_trace as Record<string, unknown> | undefined;
  const exclusionGuard = extTrace?.exclusion_guard as ExclusionGuardData | undefined;
  const legacyViolations = extTrace?.exclusion_violations as ExclusionViolation[] | undefined;

  // --- Draft Scope Check ---
  const scopeDriftCheck = (diag as Record<string, unknown> | undefined)?.scope_drift_check as ScopeDriftCheckData | undefined;
  const legacyWarnings = (diag as Record<string, unknown> | undefined)?.scope_drift_warnings as ScopeDriftWarning[] | undefined;

  return (
    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
      {/* Section 1: Claim Extraction Guard */}
      <Section title="Claim Extraction Guard" defaultOpen>
        {exclusionGuard ? (
          <>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6 }}>
              Checked <strong>{exclusionGuard.checked}</strong> claims against{' '}
              <strong>{exclusionGuard.refs_with_exclusion_vector}</strong> exclusion vectors
              (threshold: {exclusionGuard.threshold.toFixed(2)})
            </div>
            {exclusionGuard.violations.length > 0 ? (
              exclusionGuard.violations.map((v, i) => (
                <ViolationItem key={i} violation={v} />
              ))
            ) : (
              <AllClearBanner message={`All ${exclusionGuard.checked} claims within scope — 0 exclusion violations`} />
            )}
          </>
        ) : legacyViolations && legacyViolations.length > 0 ? (
          legacyViolations.map((v, i) => (
            <ViolationItem key={i} violation={v} />
          ))
        ) : extTrace ? (
          <AllClearBanner message="All claims within scope — 0 exclusion violations" />
        ) : (
          <NoDataMessage message="No exclusion guard data — extraction trace not available" />
        )}
      </Section>

      {/* Section 2: Draft Scope Check */}
      <Section title="Draft Scope Check" defaultOpen>
        {scopeDriftCheck ? (
          <>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6 }}>
              Checked <strong>{scopeDriftCheck.refs_checked}</strong> refs,{' '}
              <strong>{scopeDriftCheck.refs_with_exclusion_vector}</strong> with exclusion vectors
              (threshold: {scopeDriftCheck.threshold.toFixed(2)})
            </div>
            {scopeDriftCheck.warnings.length > 0 ? (
              scopeDriftCheck.warnings.map((w, i) => (
                <WarningItem key={i} warning={w} />
              ))
            ) : (
              <AllClearBanner message={`All ${scopeDriftCheck.refs_checked} refs within scope — 0 drift warnings`} />
            )}
          </>
        ) : legacyWarnings && legacyWarnings.length > 0 ? (
          legacyWarnings.map((w, i) => (
            <WarningItem key={i} warning={w} />
          ))
        ) : diag ? (
          <AllClearBanner message="No scope drift detected — 0 warnings" />
        ) : (
          <NoDataMessage message="No scope drift data — diagnostics not available for this entry" />
        )}
      </Section>

      {/* Section 3: Taxonomy Context Injection (future — t/489) */}
      {(diag as Record<string, unknown> | undefined)?.taxonomy_injection_trace ? (() => {
        const tit = (diag as Record<string, unknown>).taxonomy_injection_trace as {
          considered: number; demoted: number;
          demoted_nodes?: { node_id: string; exclusion_similarity: number }[];
        };
        return (
          <Section title={`Taxonomy Context Injection — ${tit.considered} considered, ${tit.demoted} demoted`} defaultOpen>
            {tit.demoted > 0 && tit.demoted_nodes ? (
              tit.demoted_nodes.map((n, i) => (
                <div key={i} style={{
                  padding: '4px 8px', marginBottom: 3, borderRadius: 4, fontSize: '0.7rem',
                  borderLeft: '3px solid var(--warning)', background: 'color-mix(in srgb, var(--warning) 6%, transparent)',
                }}>
                  <span style={{ fontWeight: 600 }}>{n.node_id}</span>
                  <span style={{ marginLeft: 8, fontFamily: 'monospace', color: similarityColor(n.exclusion_similarity) }}>
                    {n.exclusion_similarity.toFixed(3)}
                  </span>
                </div>
              ))
            ) : (
              <AllClearBanner message={`All ${tit.considered} nodes passed exclusion filter`} />
            )}
          </Section>
        );
      })() : null}

      {/* Section 4: Situation Injection (future — t/490) */}
      {(diag as Record<string, unknown> | undefined)?.situation_injection_trace ? (() => {
        const sit = (diag as Record<string, unknown>).situation_injection_trace as {
          considered: number; excluded: number;
          excluded_situations?: { situation_id: string; exclusion_similarity: number }[];
        };
        return (
          <Section title={`Situation Injection — ${sit.considered} considered, ${sit.excluded} excluded`} defaultOpen>
            {sit.excluded > 0 && sit.excluded_situations ? (
              sit.excluded_situations.map((s, i) => (
                <div key={i} style={{
                  padding: '4px 8px', marginBottom: 3, borderRadius: 4, fontSize: '0.7rem',
                  borderLeft: '3px solid var(--warning)', background: 'color-mix(in srgb, var(--warning) 6%, transparent)',
                }}>
                  <span style={{ fontWeight: 600 }}>{s.situation_id}</span>
                  <span style={{ marginLeft: 8, fontFamily: 'monospace', color: similarityColor(s.exclusion_similarity) }}>
                    {s.exclusion_similarity.toFixed(3)}
                  </span>
                </div>
              ))
            ) : (
              <AllClearBanner message={`All ${sit.considered} situations passed exclusion filter`} />
            )}
          </Section>
        );
      })() : null}
    </div>
  );
}

function AllClearBanner({ message }: { message: string }) {
  return (
    <div style={{
      padding: '6px 8px',
      borderRadius: 4,
      background: 'color-mix(in srgb, var(--success) 8%, transparent)',
      borderLeft: '3px solid var(--success)',
      fontSize: '0.72rem',
      color: 'var(--success)',
      fontWeight: 600,
    }}>
      {message}
    </div>
  );
}

function NoDataMessage({ message }: { message: string }) {
  return (
    <div style={{
      fontSize: '0.72rem',
      color: 'var(--text-muted)',
      fontStyle: 'italic',
      padding: '4px 0',
    }}>
      {message}
    </div>
  );
}

function ViolationItem({ violation }: { violation: ExclusionViolation }) {
  return (
    <div style={{
      padding: '6px 8px',
      marginBottom: 4,
      borderRadius: 4,
      background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
      borderLeft: '3px solid var(--danger)',
      fontSize: '0.7rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <span style={{ fontWeight: 700, color: 'var(--danger)' }}>{violation.claim_id}</span>
        <span style={{ color: 'var(--text-muted)' }}>→</span>
        <span style={{ fontWeight: 600 }}>{violation.node_id}</span>
      </div>
      <div style={{ color: 'var(--text-primary)', marginBottom: 4 }}>{violation.claim_text}</div>
      <div style={{ display: 'flex', gap: 12, fontSize: 'var(--text-2xs)' }}>
        <span>
          main:{' '}
          <span style={{ fontFamily: 'monospace', fontWeight: 600, color: similarityColor(violation.similarity_main) }}>
            {violation.similarity_main.toFixed(3)}
          </span>
        </span>
        <span>
          exclusion:{' '}
          <span style={{ fontFamily: 'monospace', fontWeight: 600, color: similarityColor(violation.similarity_exclusion) }}>
            {violation.similarity_exclusion.toFixed(3)}
          </span>
        </span>
      </div>
    </div>
  );
}

function WarningItem({ warning }: { warning: ScopeDriftWarning }) {
  return (
    <div style={{
      padding: '6px 8px',
      marginBottom: 4,
      borderRadius: 4,
      background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
      borderLeft: '3px solid var(--danger)',
      fontSize: '0.7rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <span style={{ fontWeight: 700, color: 'var(--danger)' }}>{warning.debater}</span>
        <span style={{ color: 'var(--text-muted)' }}>→</span>
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{warning.node_id}</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontWeight: 600, color: similarityColor(warning.similarity) }}>
          {warning.similarity.toFixed(3)}
        </span>
      </div>
      <div style={{
        color: 'var(--text-muted)',
        fontStyle: 'italic',
        fontSize: 'var(--text-2xs)',
        padding: '3px 6px',
        borderLeft: '1px solid var(--border)',
        marginTop: 2,
      }}>
        {warning.draft_excerpt.length > 200 ? warning.draft_excerpt.slice(0, 200) + '…' : warning.draft_excerpt}
      </div>
    </div>
  );
}
