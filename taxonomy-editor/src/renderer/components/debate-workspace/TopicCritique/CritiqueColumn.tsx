// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type React from 'react';
import { DIMENSION_LABELS, DIMENSION_TOOLTIPS, RATING_COLORS } from './constants';
import { RadarChart } from './RadarChart';
import type { TopicCritique } from '@lib/debate/topicCritique';

/** Single-column critique breakdown (used in both left and right columns) */
export function CritiqueColumn({ critique, label, topicText, accentColor, action }: {
  critique: TopicCritique;
  label: string;
  topicText?: string;
  accentColor: string;
  action?: React.ReactNode;
}) {
  const highIssues = critique.issues.filter(i => i.severity === 'high');
  const mediumIssues = critique.issues.filter(i => i.severity === 'medium');

  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      {/* Column header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        <span style={{
          background: accentColor, color: '#fff', padding: '1px 8px', borderRadius: 4,
          fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase',
        }}>
          {critique.rating}
        </span>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          {critique.composite_score}/20
        </span>
      </div>

      {/* Topic text */}
      {topicText && (
        <div style={{
          fontSize: '0.78rem', fontStyle: 'italic', padding: '6px 10px', marginBottom: 8,
          background: 'var(--bg-secondary)', borderRadius: 6, lineHeight: 1.5,
          borderLeft: `3px solid ${accentColor}40`,
        }}>
          {topicText}
        </div>
      )}

      {action && <div style={{ marginBottom: 8 }}>{action}</div>}

      {/* Radar chart + scores */}
      <RadarChart structural={critique.structural_score} frame={critique.frame_score} />

      <div style={{ fontSize: '0.75rem', fontWeight: 600, marginTop: 8, marginBottom: 4, color: 'var(--text-secondary)' }}>
        Structural ({critique.structural_score.total}/10)
      </div>
      {(['crux_density', 'evidence_coverage', 'bdi_heterogeneity', 'abstraction_level', 'situation_activation'] as const).map(key => {
        const val = critique.structural_score[key] as number;
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, fontSize: '0.78rem' }} title={DIMENSION_TOOLTIPS[key]}>
            <span style={{ width: 90, color: 'var(--text-secondary)', cursor: 'help', borderBottom: '1px dotted var(--text-muted, #999)' }}>{DIMENSION_LABELS[key]}</span>
            <span style={{ color: val === 0 ? '#dc2626' : val === 1 ? '#d97706' : '#16a34a', fontWeight: 600, width: 16 }}>{val}</span>
            <span style={{ color: 'var(--text-tertiary, #777)', fontSize: '0.7rem' }}>/2</span>
          </div>
        );
      })}

      {critique.frame_score && (
        <>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, marginTop: 8, marginBottom: 4, color: 'var(--text-secondary)' }}>
            Frame ({critique.frame_score.total}/10)
          </div>
          {(['conditionality', 'mechanism', 'stakeholder', 'tension', 'scope'] as const).map(key => {
            const val = critique.frame_score![key] as number;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, fontSize: '0.78rem' }} title={DIMENSION_TOOLTIPS[key]}>
                <span style={{ width: 90, color: 'var(--text-secondary)', cursor: 'help', borderBottom: '1px dotted var(--text-muted, #999)' }}>{DIMENSION_LABELS[key]}</span>
                <span style={{ color: val === 0 ? '#dc2626' : val === 1 ? '#d97706' : '#16a34a', fontWeight: 600, width: 16 }}>{val}</span>
                <span style={{ color: 'var(--text-tertiary, #777)', fontSize: '0.7rem' }}>/2</span>
              </div>
            );
          })}
        </>
      )}

      {/* Policymaker political operationality sub-scores (t/251) */}
      {critique.frame_score?.actor_specificity != null && (
        <>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, marginTop: 8, marginBottom: 4, color: '#ef4444' }}>
            Political Operationality ({((critique.frame_score.actor_specificity ?? 0) + (critique.frame_score.decision_proximity ?? 0) + (critique.frame_score.constituency_impact ?? 0))}/6)
          </div>
          {(['actor_specificity', 'decision_proximity', 'constituency_impact'] as const).map(key => {
            const val = critique.frame_score![key] as number | undefined;
            if (val == null) return null;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, fontSize: '0.78rem' }} title={DIMENSION_TOOLTIPS[key]}>
                <span style={{ width: 90, color: 'var(--text-secondary)', cursor: 'help', borderBottom: '1px dotted var(--text-muted, #999)' }}>{DIMENSION_LABELS[key]}</span>
                <span style={{ color: val === 0 ? '#dc2626' : val === 1 ? '#d97706' : '#16a34a', fontWeight: 600, width: 16 }}>{val}</span>
                <span style={{ color: 'var(--text-tertiary, #777)', fontSize: '0.7rem' }}>/2</span>
              </div>
            );
          })}
        </>
      )}

      {/* Issues */}
      {(highIssues.length > 0 || mediumIssues.length > 0) && (
        <div style={{ marginTop: 8, fontSize: '0.75rem' }}>
          {highIssues.length > 0 && (
            <div style={{ color: '#dc2626', marginBottom: 2 }}>
              {highIssues.length} critical: {highIssues.map(i => DIMENSION_LABELS[i.dimension] ?? i.dimension).join(', ')}
            </div>
          )}
          {mediumIssues.length > 0 && (
            <div style={{ color: '#d97706' }}>
              {mediumIssues.length} warning{mediumIssues.length !== 1 ? 's' : ''}: {mediumIssues.map(i => DIMENSION_LABELS[i.dimension] ?? i.dimension).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
