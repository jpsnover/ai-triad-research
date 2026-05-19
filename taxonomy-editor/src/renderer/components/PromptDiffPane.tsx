// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useRef, useEffect, useCallback } from 'react';
import type { DiffLine } from '@lib/diff/lineDiff.js';
import type { PromptNode } from './PromptDiffTree';
import { POVER_INFO } from '../types/debate';
import type { SpeakerId } from '../types/debate';

const STAGE_COLORS: Record<string, string> = {
  brief: '#3b82f6', plan: '#a855f7', evidence: '#f59e0b', draft: '#22c55e', cite: '#f97316',
};

const LINE_BG: Record<DiffLine['type'], string> = {
  same: 'transparent',
  added: 'rgba(234,179,8,0.15)',
  removed: 'rgba(239,68,68,0.15)',
  ghost: 'rgba(128,128,128,0.04)',
};

function speakerLabel(speaker: string): string {
  return POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label ?? speaker;
}

export interface PaneData {
  node: PromptNode;
  lines: DiffLine[];
  stats?: { added: number; removed: number; same: number; total: number };
}

interface Props {
  pane: PaneData;
  paneIndex: number;
  isReference: boolean;
  isFocused: boolean;
  onClose: () => void;
  onFocus: () => void;
  onScroll?: (scrollTop: number) => void;
  scrollTop?: number;
}

export function PromptDiffPane({ pane, paneIndex, isReference, isFocused, onClose, onFocus, onScroll, scrollTop }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const suppressScrollEvent = useRef(false);

  // Sync scroll from external source
  useEffect(() => {
    if (scrollTop !== undefined && contentRef.current) {
      if (Math.abs(contentRef.current.scrollTop - scrollTop) > 1) {
        suppressScrollEvent.current = true;
        contentRef.current.scrollTop = scrollTop;
      }
    }
  }, [scrollTop]);

  const handleScroll = useCallback(() => {
    if (suppressScrollEvent.current) {
      suppressScrollEvent.current = false;
      return;
    }
    if (contentRef.current && onScroll) {
      onScroll(contentRef.current.scrollTop);
    }
  }, [onScroll]);

  const { node, lines, stats } = pane;
  const stageColor = STAGE_COLORS[node.stage] ?? '#888';

  return (
    <div
      onClick={onFocus}
      style={{
        flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column',
        border: isFocused ? '1px solid #3b82f6' : '1px solid var(--border-color)',
        borderRadius: 4, overflow: 'hidden',
        background: 'var(--bg-primary)',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        fontSize: '0.68rem',
        flexShrink: 0,
      }}>
        <span style={{
          padding: '1px 5px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 700,
          background: `${stageColor}20`, color: stageColor,
          textTransform: 'uppercase',
        }}>
          {node.stage}
        </span>
        <span style={{ fontWeight: 600 }}>Run {node.runIndex + 1}</span>
        <span style={{ color: 'var(--text-muted)' }}>
          S{node.entryIndex + 1} {speakerLabel(node.speaker)}
        </span>
        {stats && !isReference && (
          <span style={{ marginLeft: 'auto', fontSize: '0.6rem', color: 'var(--text-muted)' }}>
            <span style={{ color: '#eab308' }}>+{stats.added}</span>
            {' / '}
            <span style={{ color: '#ef4444' }}>-{stats.removed}</span>
            {' / '}
            {stats.total} lines
          </span>
        )}
        {isReference && (
          <span style={{ marginLeft: 'auto', fontSize: '0.58rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            reference
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: '0.9rem', padding: '0 2px',
            lineHeight: 1,
          }}
          title={`Close pane ${paneIndex + 1} (Ctrl+W)`}
        >&times;</button>
      </div>

      {/* Content */}
      <div
        ref={contentRef}
        onScroll={handleScroll}
        style={{
          flex: 1, overflowY: 'auto', overflowX: 'auto',
          fontFamily: 'Consolas, "Fira Code", monospace',
          fontSize: '0.68rem',
          lineHeight: '1.4em',
          whiteSpace: 'pre',
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              background: LINE_BG[line.type],
              minHeight: '1.4em',
            }}
          >
            <span style={{
              width: 40, flexShrink: 0, textAlign: 'right', paddingRight: 6,
              color: 'var(--text-muted)', fontSize: '0.6rem',
              userSelect: 'none', borderRight: '1px solid var(--border-color)',
              opacity: line.type === 'ghost' ? 0 : 0.6,
            }}>
              {line.lineNumber ?? ''}
            </span>
            <span style={{ paddingLeft: 6 }}>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
