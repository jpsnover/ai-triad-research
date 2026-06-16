// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * FIRE iterative extraction progress indicators (FIRE-2, t/131).
 * Shows iteration count, confident/uncertain claim counts, and confidence trajectory.
 * Used in debate workspace (claim extraction) and fact-check UI.
 */

export interface FireProgress {
  claimIndex: number;
  totalClaims: number;
  iteration: number;
  maxIterations: number;
  confidence: number;
  status: 'extracting' | 'searching' | 'verifying' | 'confident';
}

interface FireProgressIndicatorProps {
  progress: FireProgress | null;
  compact?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  extracting: 'Extracting claims',
  searching: 'Searching for evidence',
  verifying: 'Verifying confidence',
  confident: 'Claim confirmed',
};

function confidenceBar(value: number): string {
  if (value >= 0.8) return 'fire-conf-high';
  if (value >= 0.5) return 'fire-conf-medium';
  return 'fire-conf-low';
}

/** Inline progress indicator for debate workspace claim extraction */
export function FireProgressIndicator({ progress, compact }: FireProgressIndicatorProps) {
  if (!progress) return null;

  if (compact) {
    return (
      <span className="fire-progress-compact">
        <span className="fire-progress-iter">
          iter {progress.iteration}/{progress.maxIterations}
        </span>
        <span className={`fire-progress-conf ${confidenceBar(progress.confidence)}`}>
          {(progress.confidence * 100).toFixed(0)}%
        </span>
      </span>
    );
  }

  return (
    <div className="fire-progress">
      <div className="fire-progress-header">
        <span className="fire-progress-status">{STATUS_LABELS[progress.status] ?? progress.status}</span>
        <span className="fire-progress-claim">
          claim {progress.claimIndex + 1}/{progress.totalClaims}
        </span>
      </div>
      <div className="fire-progress-bar-track">
        <div
          className={`fire-progress-bar-fill ${confidenceBar(progress.confidence)}`}
          style={{ width: `${Math.min(progress.confidence * 100, 100)}%` }}
        />
      </div>
      <div className="fire-progress-details">
        <span>Iteration {progress.iteration}/{progress.maxIterations}</span>
        <span>Confidence: {(progress.confidence * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

interface FireFactCheckProgressProps {
  queryCount: number;
  confidence: number;
  previousConfidence?: number;
}

/** Progress indicator for fact-check with FIRE — shows confidence climbing */
export function FireFactCheckProgress({ queryCount, confidence, previousConfidence }: FireFactCheckProgressProps) {
  const delta = previousConfidence != null ? confidence - previousConfidence : 0;

  return (
    <div className="fire-factcheck-progress">
      <span className="fire-factcheck-queries">
        {queryCount} quer{queryCount !== 1 ? 'ies' : 'y'}
      </span>
      <span className={`fire-factcheck-conf ${confidenceBar(confidence)}`}>
        confidence: {(confidence * 100).toFixed(0)}%
        {delta > 0 && <span className="fire-factcheck-delta"> (+{(delta * 100).toFixed(0)}%)</span>}
      </span>
    </div>
  );
}
