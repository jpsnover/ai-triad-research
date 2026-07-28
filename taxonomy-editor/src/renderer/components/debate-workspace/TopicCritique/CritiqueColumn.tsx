// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type React from 'react';
import { DIMENSION_LABELS, DIMENSION_TOOLTIPS, RATING_COLORS } from './constants';
import { RadarChart } from './RadarChart';
import type { TopicCritique } from '@lib/debate/topicCritique';
import './CritiqueColumn.css';

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
    <div className="critique-col">
      {/* Column header */}
      <div className="critique-col-header">
        <span className="critique-col-label">{label}</span>
        <span
          className="critique-col-rating-badge"
          // eslint-disable-next-line local/no-inline-style -- dynamic accent color from rating
          style={{ background: accentColor }}
        >
          {critique.rating}
        </span>
        <span className="critique-col-score">
          {critique.composite_score}/20
        </span>
      </div>

      {/* Topic text */}
      {topicText && (
        <div
          className="critique-col-topic"
          // eslint-disable-next-line local/no-inline-style -- dynamic accent border from rating
          style={{ borderLeft: `3px solid ${accentColor}40` }}
        >
          {topicText}
        </div>
      )}

      {action && <div className="critique-col-action">{action}</div>}

      {/* Radar chart + scores */}
      <RadarChart structural={critique.structural_score} frame={critique.frame_score} />

      <div className="critique-col-section-label">
        Structural ({critique.structural_score.total}/10)
      </div>
      {(['crux_density', 'evidence_coverage', 'bdi_heterogeneity', 'abstraction_level', 'situation_activation'] as const).map(key => {
        const val = critique.structural_score[key] as number;
        return (
          <div key={key} className="critique-col-dim-row" title={DIMENSION_TOOLTIPS[key]}>
            <span className="critique-col-dim-label">{DIMENSION_LABELS[key]}</span>
            {/* eslint-disable-next-line local/no-inline-style -- dynamic score color from value */}
            <span className="critique-col-dim-val" style={{ color: val === 0 ? '#dc2626' : val === 1 ? '#d97706' : '#16a34a' }}>{val}</span>
            <span className="critique-col-dim-max">/2</span>
          </div>
        );
      })}

      {critique.frame_score && (
        <>
          <div className="critique-col-section-label">
            Frame ({critique.frame_score.total}/10)
          </div>
          {(['conditionality', 'mechanism', 'stakeholder', 'tension', 'scope'] as const).map(key => {
            const val = critique.frame_score![key] as number;
            return (
              <div key={key} className="critique-col-dim-row" title={DIMENSION_TOOLTIPS[key]}>
                <span className="critique-col-dim-label">{DIMENSION_LABELS[key]}</span>
                {/* eslint-disable-next-line local/no-inline-style -- dynamic score color from value */}
                <span className="critique-col-dim-val" style={{ color: val === 0 ? '#dc2626' : val === 1 ? '#d97706' : '#16a34a' }}>{val}</span>
                <span className="critique-col-dim-max">/2</span>
              </div>
            );
          })}
        </>
      )}

      {/* Policymaker political operationality sub-scores (t/251) */}
      {critique.frame_score?.actor_specificity != null && (
        <>
          <div className="critique-col-section-label critique-col-section-label--political">
            Political Operationality ({((critique.frame_score.actor_specificity ?? 0) + (critique.frame_score.decision_proximity ?? 0) + (critique.frame_score.constituency_impact ?? 0))}/6)
          </div>
          {(['actor_specificity', 'decision_proximity', 'constituency_impact'] as const).map(key => {
            const val = critique.frame_score![key] as number | undefined;
            if (val == null) return null;
            return (
              <div key={key} className="critique-col-dim-row" title={DIMENSION_TOOLTIPS[key]}>
                <span className="critique-col-dim-label">{DIMENSION_LABELS[key]}</span>
                {/* eslint-disable-next-line local/no-inline-style -- dynamic score color from value */}
                <span className="critique-col-dim-val" style={{ color: val === 0 ? '#dc2626' : val === 1 ? '#d97706' : '#16a34a' }}>{val}</span>
                <span className="critique-col-dim-max">/2</span>
              </div>
            );
          })}
        </>
      )}

      {/* Issues */}
      {(highIssues.length > 0 || mediumIssues.length > 0) && (
        <div className="critique-col-issues">
          {highIssues.length > 0 && (
            <div className="critique-col-issues-high">
              {highIssues.length} critical: {highIssues.map(i => DIMENSION_LABELS[i.dimension] ?? i.dimension).join(', ')}
            </div>
          )}
          {mediumIssues.length > 0 && (
            <div className="critique-col-issues-medium">
              {mediumIssues.length} warning{mediumIssues.length !== 1 ? 's' : ''}: {mediumIssues.map(i => DIMENSION_LABELS[i.dimension] ?? i.dimension).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
