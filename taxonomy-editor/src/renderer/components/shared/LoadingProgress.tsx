// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useRef, useState } from 'react';
import './LoadingProgress.css';

export interface LoadingProgressProps {
  /** Visible + screen-reader label, e.g. "Loading debate…". Omit → bar only (aria-label falls back to "Loading"). */
  label?: string;
  /** Anti-flash: suppress render until this many ms since load start. Default 300. The elapsed timer still
   *  counts from load start, so a bar that appears at 300ms already reads 0:00→0:01… correctly. */
  delayMs?: number;
  /** Load-start epoch (ms). Elapsed measures from HERE, not from first paint. Default = mount time. */
  startedAt?: number;
  /** Show the mm:ss elapsed counter. Default true. */
  showElapsed?: boolean;
  /** Extra class on the root for consumer layout. */
  className?: string;
}

/** Format elapsed milliseconds as mm:ss (minutes are not zero-padded). Exported for chat adoption (t/2479). */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Indeterminate loading bar + elapsed-time counter (t/2498). Consumer-controlled lifecycle:
 * mount while loading, unmount when done. The elapsed timer measures from `startedAt` (default mount
 * time), NOT from when the bar becomes visible, so `delayMs` anti-flash doesn't distort the reading.
 * Import directly (no barrel — PR #777 convention).
 */
export function LoadingProgress({
  label,
  delayMs = 300,
  startedAt,
  showElapsed = true,
  className,
}: LoadingProgressProps) {
  // Capture load start once at mount (explicit startedAt wins). A later load should remount the component.
  const startRef = useRef<number>(startedAt ?? Date.now());
  const [visible, setVisible] = useState(delayMs <= 0);
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - startRef.current);

  useEffect(() => {
    if (delayMs <= 0) return;
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  useEffect(() => {
    if (!showElapsed) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startRef.current), 1000);
    return () => clearInterval(id);
  }, [showElapsed]);

  if (!visible) return null;

  return (
    <div
      className={`lp-root${className ? ` ${className}` : ''}`}
      role="progressbar"
      aria-busy="true"
      aria-label={label ?? 'Loading'}
    >
      <div className="lp-bar">
        <div className="lp-bar-indeterminate" />
      </div>
      {(label || showElapsed) && (
        <div className="lp-meta">
          {label && <span className="lp-label">{label}</span>}
          {/* aria-live="off": the label is announced once via aria-label; the ticking counter must not chatter. */}
          {showElapsed && <span className="lp-elapsed" aria-live="off">{formatElapsed(elapsedMs)}</span>}
        </div>
      )}
    </div>
  );
}
