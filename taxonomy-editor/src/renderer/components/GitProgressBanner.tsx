// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Inline banner showing git operation progress — spinner, elapsed time,
 * step description. Auto-dismisses on success after 5 seconds; errors stay
 * until manually dismissed.
 */

import { useEffect, useState, useRef } from 'react';
import { useGitProgress } from '../hooks/useGitProgress';

export function GitProgressBanner() {
  const { progress, dismiss } = useGitProgress();
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed timer — ticks every second while active
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!progress) { setElapsed(0); return; }

    const tick = () => setElapsed(Math.floor((Date.now() - progress.startTime) / 1000));
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [progress?.startTime, progress?.active]);

  // Auto-dismiss success after 5 seconds
  useEffect(() => {
    if (!progress || !progress.success) return;
    const t = setTimeout(dismiss, 5000);
    return () => clearTimeout(t);
  }, [progress?.success, dismiss]);

  if (!progress) return null;

  const isActive = progress.active;
  const isSuccess = progress.success;
  const isError = !!progress.error;

  const stateClass = isActive ? 'git-progress--active'
    : isSuccess ? 'git-progress--success'
    : 'git-progress--error';

  const icon = isActive ? (
    <span className="git-progress-spinner" />
  ) : isSuccess ? (
    <span className="git-progress-icon git-progress-icon--check">&#x2713;</span>
  ) : (
    <span className="git-progress-icon git-progress-icon--x">&#x2717;</span>
  );

  const formatElapsed = (s: number) => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

  return (
    <div className={`git-progress-banner ${stateClass}`}>
      {icon}
      <span className="git-progress-label">
        {isError ? progress.error : progress.label}
      </span>
      {isActive && progress.stepTotal > 1 && (
        <span className="git-progress-steps">
          ({progress.stepIndex + 1}/{progress.stepTotal})
        </span>
      )}
      <span className="git-progress-elapsed">{formatElapsed(elapsed)}</span>
      {!isActive && (
        <button className="git-progress-dismiss" onClick={dismiss} aria-label="Dismiss">&times;</button>
      )}
    </div>
  );
}
