// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Reusable hover tooltip for the hand-coded SVG charts (t/894). A single
 * fixed-position layer follows the cursor; callers attach mouse handlers to
 * their bars/points and pass rich content. Shared by ActivityChart and
 * MetricChart so positioning/clamping logic lives in one place.
 */

import { useState, useCallback, type ReactNode } from 'react';
import './chartTooltip.css';

export interface ChartTip { x: number; y: number; content: ReactNode }

export function useChartTooltip() {
  const [tip, setTip] = useState<ChartTip | null>(null);
  const showTip = useCallback((e: { clientX: number; clientY: number }, content: ReactNode) => {
    setTip({ x: e.clientX, y: e.clientY, content });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);
  return { tip, showTip, hideTip };
}

/** Fixed-position tooltip, clamped to the viewport. Renders nothing when inactive. */
export function ChartTooltipLayer({ tip }: { tip: ChartTip | null }) {
  if (!tip) return null;
  const margin = 8;
  const halfWidth = 95; // ~ max-width/2, used to keep the centered tooltip on-screen
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const left = Math.min(Math.max(tip.x, margin + halfWidth), vw - margin - halfWidth);
  // Flip below the cursor when too close to the top edge.
  const below = tip.y < 72;
  const top = below ? tip.y + 16 : tip.y - 12;
  return (
    <div
      className="chart-tooltip"
      role="tooltip"
      style={{ left, top, transform: `translate(-50%, ${below ? '0' : '-100%'})` }}
    >
      {tip.content}
    </div>
  );
}
