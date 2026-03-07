// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo } from 'react';
import { useAnalysisStore } from '../store/useAnalysisStore';
import { ANALYSIS_STATUS_LABELS } from '../types/analysis';
import type { AnalysisStatus } from '../types/analysis';

interface Props {
  sourceId: string;
  onCancel: () => void;
}

const STATUS_ORDER: AnalysisStatus[] = [
  'queued', 'reading', 'stage1_running', 'stage1_complete',
  'stage2_running', 'stage2_complete', 'merging', 'complete',
];

export default function AnalysisProgress({ sourceId, onCancel }: Props) {
  const analyses = useAnalysisStore(s => s.analyses);
  const analysis = analyses[sourceId];

  const elapsed = useMemo(() => {
    if (!analysis?.startedAt) return '';
    const start = new Date(analysis.startedAt).getTime();
    const now = Date.now();
    const seconds = Math.floor((now - start) / 1000);
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }, [analysis?.startedAt, analysis?.status]);

  if (!analysis || analysis.status === 'idle') {
    return null;
  }

  if (analysis.status === 'error') {
    return (
      <div className="analysis-progress">
        <div className="analysis-progress-error">
          <span className="analysis-error-icon">!</span>
          <span>{analysis.error || 'Analysis failed'}</span>
        </div>
      </div>
    );
  }

  const currentIndex = STATUS_ORDER.indexOf(analysis.status);
  const totalSteps = STATUS_ORDER.length;
  const progressPct = analysis.progress || (currentIndex >= 0 ? Math.round((currentIndex / totalSteps) * 100) : 0);

  return (
    <div className="analysis-progress">
      <div className="analysis-progress-header">
        <span className="analysis-progress-label">
          {ANALYSIS_STATUS_LABELS[analysis.status]}
        </span>
        {elapsed && <span className="analysis-progress-elapsed">{elapsed}</span>}
      </div>

      <div className="analysis-progress-bar-track">
        <div
          className="analysis-progress-bar-fill"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="analysis-progress-footer">
        <span className="analysis-progress-pct">{progressPct}%</span>
        <button className="analysis-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <div className="analysis-progress-steps">
        {STATUS_ORDER.slice(0, -1).map((step, i) => (
          <div
            key={step}
            className={`analysis-step ${
              i < currentIndex ? 'done' : i === currentIndex ? 'active' : ''
            }`}
          >
            <span className="analysis-step-dot" />
            <span className="analysis-step-label">{ANALYSIS_STATUS_LABELS[step]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
