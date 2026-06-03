// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { PrecacheProgress } from '../hooks/usePrecache';

export function PrecacheToast({
  progress,
  onCancel,
  onDismiss,
}: {
  progress: PrecacheProgress;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  if (progress.state === 'idle') return null;

  return (
    <div className="precache-toast">
      <span className="precache-toast-text">{progress.currentLabel}</span>
      {progress.state === 'caching' && (
        <button className="precache-toast-btn" onClick={onCancel}>Cancel</button>
      )}
      {(progress.state === 'done' || progress.state === 'error' || progress.state === 'limited') && (
        <button className="precache-toast-btn" onClick={onDismiss}>Dismiss</button>
      )}
    </div>
  );
}
