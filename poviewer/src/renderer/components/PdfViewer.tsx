import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Source, Point, PovCamp } from '../types/types';

interface Props {
  source: Source;
}

function getHighlightColor(point: Point): string {
  if (point.mappings.length === 0) return 'rgba(100, 116, 139, 0.15)';
  if (point.mappings.length === 1) {
    const colorMap: Record<PovCamp, string> = {
      accelerationist: 'rgba(39, 174, 96, 0.20)',
      safetyist: 'rgba(231, 76, 60, 0.18)',
      skeptic: 'rgba(243, 156, 18, 0.20)',
      'cross-cutting': 'rgba(142, 68, 173, 0.17)',
    };
    return colorMap[point.mappings[0].camp];
  }
  return 'rgba(100, 116, 139, 0.20)';
}

export default function PdfViewer({ source }: Props) {
  const povFilters = useAppStore(s => s.povFilters);
  const selectedPointId = useAppStore(s => s.selectedPointId);
  const selectPoint = useAppStore(s => s.selectPoint);

  // For PDF rendering, we display the extracted text with highlights
  // (Full canvas-based PDF.js rendering deferred to a future iteration)
  const visiblePoints = source.points.filter(p => {
    if (p.mappings.length === 0) return true;
    return p.mappings.some(m => povFilters[m.camp]);
  });

  const text = source.snapshotText;
  const sorted = [...visiblePoints].sort((a, b) => a.startOffset - b.startOffset);

  // Build segments
  const segments: Array<{ text: string; point: Point | null }> = [];
  let cursor = 0;

  for (const point of sorted) {
    if (point.startOffset > cursor) {
      segments.push({ text: text.slice(cursor, point.startOffset), point: null });
    }
    const start = Math.max(point.startOffset, cursor);
    if (start < point.endOffset) {
      segments.push({ text: text.slice(start, point.endOffset), point });
      cursor = point.endOffset;
    }
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), point: null });
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer-header">
        <span className="pdf-viewer-badge">PDF</span>
        <span className="pdf-viewer-info">
          Extracted text view ({source.points.length} points mapped)
        </span>
      </div>
      <div className="pdf-viewer-text">
        {segments.map((seg, i) => {
          if (!seg.point) {
            return <span key={i}>{seg.text}</span>;
          }

          const isSelected = seg.point.id === selectedPointId;
          const bg = getHighlightColor(seg.point);

          return (
            <span
              key={i}
              className={`pdf-highlight ${isSelected ? 'selected' : ''}`}
              style={{ backgroundColor: bg }}
              onClick={() => selectPoint(seg.point!.id)}
              title={`Point ${seg.point.id}`}
            >
              {seg.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
