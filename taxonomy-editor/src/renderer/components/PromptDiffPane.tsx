// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { DiffLine } from '@lib/diff/lineDiff.js';
import type { PromptNode, DiffViewMode, StageValidation, QualityCheck, OrchestrationValidation, RetryTrigger } from './PromptDiffTree';
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

export interface PaneDiffLine extends DiffLine {
  /** Text of the counterpart line (removed↔added) for word-level diffing. */
  pairText?: string;
}

export interface PaneData {
  node: PromptNode;
  lines: PaneDiffLine[];
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
  searchTerm?: string;
  activeMatchIndex?: number;
  matchOffset?: number;
  viewMode?: DiffViewMode;
  wordWrap?: boolean;
  validationHeight?: number;
  onValidationResize?: (height: number) => void;
  onFindInPanes?: (text: string) => void;
}

function highlightMatches(
  text: string,
  searchLower: string,
  activeMatchIndex: number,
  lineMatchStart: number,
  activeMatchRef: React.RefObject<HTMLSpanElement | null>,
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let matchIdx = lineMatchStart;
  const lower = text.toLowerCase();
  let pos = 0;
  while ((pos = lower.indexOf(searchLower, pos)) !== -1) {
    if (pos > last) parts.push(text.slice(last, pos));
    const isActive = matchIdx === activeMatchIndex;
    parts.push(
      <span
        key={`m${pos}`}
        ref={isActive ? activeMatchRef : undefined}
        style={{
          background: isActive ? 'rgba(34,197,94,0.7)' : 'rgba(34,197,94,0.4)',
          color: isActive ? '#000' : 'inherit',
          borderRadius: 2,
        }}
      >
        {text.slice(pos, pos + searchLower.length)}
      </span>,
    );
    last = pos + searchLower.length;
    pos = last;
    matchIdx++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length > 0 ? parts : text;
}

// ── Hint classification (matches DiagnosticsWindow logic) ────

const CITE_HINT_RE = /taxonomy_refs.*(?:filler|too-short|relevance)|No new taxonomy_refs|Unknown taxonomy node|Unknown policy_refs|grounding_confidence/i;
const DRAFT_HINT_RE = /move_types|my_claims|paragraph|statement|hedge|constructive|pin_response|probe_response|challenge_response|clarification|check_response|revoice|reflection|compressed_thesis|commitment/i;

function classifyHint(hint: string): 'draft' | 'cite' | 'judge' {
  if (CITE_HINT_RE.test(hint)) return 'cite';
  if (!DRAFT_HINT_RE.test(hint)) return 'judge';
  return 'draft';
}

const HINT_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'DRAFT', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  cite: { label: 'CITE', color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  judge: { label: 'QUALITY', color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
};

const TRIGGER_LABEL: Record<RetryTrigger, { text: string; color: string; bg: string }> = {
  'initial': { text: 'Initial', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  'stage-retry': { text: 'Stage Retry', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  'orchestration-rerun': { text: 'Rerun (Judge)', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};

function ValidationPanel({ validation, qualityCheck, orchestrationValidation, retryTrigger, repairHintsIn }: {
  validation?: StageValidation; qualityCheck?: QualityCheck; orchestrationValidation?: OrchestrationValidation;
  retryTrigger?: RetryTrigger; repairHintsIn?: string[];
}) {
  if (!validation && !qualityCheck && !orchestrationValidation && !retryTrigger) {
    return (
      <div style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: '0.62rem', fontStyle: 'italic' }}>
        No validation data
      </div>
    );
  }

  return (
    <div style={{ padding: '4px 8px', fontSize: '0.65rem', overflowY: 'auto' }}>
      {/* Retry trigger badge + input repair hints */}
      {retryTrigger && retryTrigger !== 'initial' && (() => {
        const tl = TRIGGER_LABEL[retryTrigger];
        return (
          <div style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ fontWeight: 600, fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Triggered By
              </span>
              <span style={{
                display: 'inline-block', padding: '1px 6px', borderRadius: 3,
                fontWeight: 700, fontSize: '0.58rem', background: tl.bg, color: tl.color,
              }}>
                {tl.text}
              </span>
            </div>
            {repairHintsIn && repairHintsIn.length > 0 && (
              <ul style={{ margin: '2px 0 0 14px', padding: 0 }}>
                {repairHintsIn.map((h, i) => (
                  <li key={i} style={{ marginBottom: 1, color: 'var(--text-secondary)', fontSize: '0.6rem' }}>{h}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })()}

      {validation && (
        <div>
          {/* Pass/Fail badge */}
          <span style={{
            display: 'inline-block', padding: '1px 6px', borderRadius: 3,
            fontWeight: 700, fontSize: '0.6rem',
            background: validation.pass ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            color: validation.pass ? '#22c55e' : '#ef4444',
          }}>
            {validation.pass ? '✓ Pass' : '✗ Fail'}
          </span>

          {/* Hints */}
          {validation.hints && validation.hints.length > 0 && (
            <ul style={{ margin: '4px 0 4px 14px', padding: 0 }}>
              {validation.hints.map((h, i) => {
                const cat = classifyHint(h);
                const s = HINT_STYLE[cat];
                return (
                  <li key={i} style={{ marginBottom: 2 }}>
                    <span style={{
                      display: 'inline-block', fontSize: '0.55rem', fontWeight: 700,
                      color: s.color, background: s.bg, padding: '0 4px',
                      borderRadius: 2, marginRight: 4,
                    }}>{s.label}</span>
                    {h}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Directive compliance */}
          {validation.directive_compliance && (
            <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                fontWeight: 700, fontSize: '0.6rem',
                color: validation.directive_compliance.compliant ? '#22c55e' : '#ef4444',
              }}>
                {validation.directive_compliance.compliant ? '✓' : '✗'}
              </span>
              <span>Directive: {validation.directive_compliance.matched_terms}/{validation.directive_compliance.directive_terms.length} terms</span>
            </div>
          )}

          {/* Per-rule details */}
          {validation.details && validation.details.length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                {validation.details.filter(d => d.pass).length}/{validation.details.length} rules passed
              </summary>
              <div style={{ marginTop: 2 }}>
                {validation.details.map((d, i) => (
                  <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{ color: d.pass ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: '0.6rem' }}>
                      {d.pass ? '✓' : '✗'}
                    </span>
                    <span>{d.rule}</span>
                    {d.value && <span style={{ color: 'var(--text-muted)' }}>({d.value})</span>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Quality Pre-Check */}
      {qualityCheck && (
        <div style={{ marginTop: validation ? 6 : 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.6rem', marginBottom: 2, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Quality Pre-Check
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['grounded', 'falsifiable', 'engages'] as const).map(dim => (
              <span key={dim} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <span style={{ color: qualityCheck[dim] ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: '0.6rem' }}>
                  {qualityCheck[dim] ? '✓' : '✗'}
                </span>
                <span style={{ textTransform: 'capitalize' }}>{dim}</span>
              </span>
            ))}
          </div>
          {qualityCheck.weaknesses.length > 0 && (
            <ul style={{ margin: '2px 0 0 14px', padding: 0, color: 'var(--text-muted)' }}>
              {qualityCheck.weaknesses.map((w, i) => (
                <li key={i} style={{ marginBottom: 1 }}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Orchestration Validation (judge feedback across the whole turn attempt) */}
      {orchestrationValidation && (
        <div style={{ marginTop: (validation || qualityCheck) ? 6 : 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.6rem', marginBottom: 2, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Orchestration Validation
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{
              display: 'inline-block', padding: '1px 6px', borderRadius: 3,
              fontWeight: 700, fontSize: '0.6rem',
              background: orchestrationValidation.outcome === 'accept'
                ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
              color: orchestrationValidation.outcome === 'accept'
                ? '#22c55e' : '#ef4444',
            }}>
              {orchestrationValidation.outcome.toUpperCase()}
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
              score: {orchestrationValidation.process_reward.toFixed(2)}
            </span>
          </div>

          {/* Repair hints */}
          {orchestrationValidation.repairHints.length > 0 && (
            <ul style={{ margin: '2px 0 4px 14px', padding: 0 }}>
              {orchestrationValidation.repairHints.map((h, i) => {
                const cat = classifyHint(h);
                const s = HINT_STYLE[cat];
                return (
                  <li key={i} style={{ marginBottom: 2 }}>
                    <span style={{
                      display: 'inline-block', fontSize: '0.55rem', fontWeight: 700,
                      color: s.color, background: s.bg, padding: '0 4px',
                      borderRadius: 2, marginRight: 4,
                    }}>{s.label}</span>
                    {h}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Dimensions breakdown */}
          <details style={{ marginTop: 2 }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.6rem', color: 'var(--text-muted)' }}>
              Dimensions
              {' '}
              {(['schema', 'grounding', 'advancement', 'clarifies'] as const)
                .filter(d => !orchestrationValidation.dimensions[d].pass).length === 0
                ? <span style={{ color: '#22c55e', fontWeight: 700 }}>all pass</span>
                : <span style={{ color: '#ef4444', fontWeight: 700 }}>
                    {(['schema', 'grounding', 'advancement', 'clarifies'] as const)
                      .filter(d => !orchestrationValidation.dimensions[d].pass).length} failed
                  </span>
              }
            </summary>
            <div style={{ marginTop: 2 }}>
              {(['schema', 'grounding', 'advancement', 'clarifies'] as const).map(dim => {
                const d = orchestrationValidation.dimensions[dim];
                const items = 'issues' in d ? d.issues : d.signals;
                return (
                  <div key={dim} style={{ marginBottom: 2 }}>
                    <span style={{ color: d.pass ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: '0.6rem' }}>
                      {d.pass ? '✓' : '✗'}
                    </span>
                    {' '}
                    <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>{dim}</span>
                    {items.length > 0 && (
                      <ul style={{ margin: '1px 0 0 14px', padding: 0, color: 'var(--text-muted)' }}>
                        {items.map((item, j) => <li key={j} style={{ marginBottom: 1 }}>{item}</li>)}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

/** LCS-based word-level diff. Returns segments tagged same/added/removed. */
function diffWords(oldText: string, newText: string): Array<{ text: string; type: 'same' | 'added' | 'removed' }> {
  const oldTokens = oldText.split(/(\s+)/);
  const newTokens = newText.split(/(\s+)/);
  const m = oldTokens.length, n = newTokens.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldTokens[i - 1] === newTokens[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);

  const raw: Array<{ text: string; type: 'same' | 'added' | 'removed' }> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      raw.push({ text: newTokens[j - 1], type: 'same' });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ text: newTokens[j - 1], type: 'added' });
      j--;
    } else {
      raw.push({ text: oldTokens[i - 1], type: 'removed' });
      i--;
    }
  }
  raw.reverse();

  // Merge adjacent segments of the same type
  const merged: typeof raw = [];
  for (const seg of raw) {
    const last = merged.length > 0 ? merged[merged.length - 1] : null;
    if (last && last.type === seg.type) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged;
}

/** Render a line with word-level diff highlights. Shows only 'same' + the line's own change type. */
function renderWordDiff(
  text: string, pairText: string, lineType: 'added' | 'removed',
): React.ReactNode {
  const segments = lineType === 'removed'
    ? diffWords(text, pairText)  // this line is "old", pair is "new"
    : diffWords(pairText, text); // pair is "old", this line is "new"

  const changeType = lineType; // 'added' or 'removed'
  const strongBg = lineType === 'removed' ? 'rgba(239,68,68,0.35)' : 'rgba(234,179,8,0.35)';

  return segments
    .filter(s => s.type === 'same' || s.type === changeType)
    .map((seg, i) => (
      seg.type === 'same'
        ? <span key={i}>{seg.text}</span>
        : <span key={i} style={{ background: strongBg, borderRadius: 2 }}>{seg.text}</span>
    ));
}

const VALIDATION_MIN_HEIGHT = 28;
const VALIDATION_DEFAULT_HEIGHT = 150;
const VALIDATION_MAX_HEIGHT = 500;

function ValidationPanelContainer({ node, height, onResize, onFind }: {
  node: PromptNode; height: number; onResize: (h: number) => void; onFind?: (text: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const sel = window.getSelection()?.toString().trim();
    if (!sel) return; // no selection — let default menu show
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, text: sel });
  }, []);

  // Close context menu on any click
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener('click', close, { once: true });
    return () => document.removeEventListener('click', close);
  }, [ctxMenu]);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: height };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      onResize(Math.min(VALIDATION_MAX_HEIGHT, Math.max(VALIDATION_MIN_HEIGHT,
        dragRef.current.startH + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [height, onResize]);

  return (
    <div style={{
      flexShrink: 0,
      height: collapsed ? 'auto' : height,
      borderTop: '1px solid var(--border-color)',
      background: 'var(--bg-secondary)',
      fontSize: '0.65rem',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Drag handle */}
      {!collapsed && (
        <div
          onMouseDown={onDragStart}
          style={{
            height: 4, cursor: 'ns-resize', flexShrink: 0,
            background: 'transparent',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          title="Drag to resize validation panel"
        />
      )}
      {/* Summary / toggle */}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          cursor: 'pointer', padding: '3px 8px', flexShrink: 0,
          fontWeight: 600, fontSize: '0.62rem',
          color: 'var(--text-muted)', userSelect: 'none',
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        <span style={{ fontSize: '0.55rem' }}>{collapsed ? '▶' : '▼'}</span>
        Validation
        {node.validation && (
          <span style={{
            fontWeight: 700, fontSize: '0.58rem',
            color: node.validation.pass ? '#22c55e' : '#ef4444',
          }}>
            {node.validation.pass ? '✓' : '✗'}
          </span>
        )}
        {node.orchestrationValidation && (
          <span style={{
            fontWeight: 700, fontSize: '0.55rem',
            padding: '0 4px', borderRadius: 2,
            background: node.orchestrationValidation.outcome === 'accept'
              ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            color: node.orchestrationValidation.outcome === 'accept'
              ? '#22c55e' : '#ef4444',
          }}>
            {node.orchestrationValidation.outcome} ({node.orchestrationValidation.process_reward.toFixed(2)})
          </span>
        )}
      </div>
      {/* Content */}
      {!collapsed && (
        <div style={{ flex: 1, overflowY: 'auto' }} onContextMenu={handleContextMenu}>
          <ValidationPanel
            validation={node.validation}
            qualityCheck={node.qualityCheck}
            orchestrationValidation={node.orchestrationValidation}
            retryTrigger={node.retryTrigger}
            repairHintsIn={node.repairHintsIn}
          />
        </div>
      )}
      {/* Context menu */}
      {ctxMenu && (
        <div style={{
          position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999,
          background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
          borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          padding: '2px 0', fontSize: '0.7rem', minWidth: 120,
        }}>
          <div
            onClick={() => { void navigator.clipboard.writeText(ctxMenu.text); setCtxMenu(null); }}
            style={{
              padding: '4px 12px', cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.15)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >Copy</div>
          {onFind && (
            <div
              onClick={() => { onFind(ctxMenu.text); setCtxMenu(null); }}
              style={{
                padding: '4px 12px', cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.15)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >Find in Panes</div>
          )}
        </div>
      )}
    </div>
  );
}

export function PromptDiffPane({ pane, paneIndex, isReference, isFocused, onClose, onFocus, onScroll, scrollTop, searchTerm, activeMatchIndex, matchOffset, viewMode, wordWrap, validationHeight, onValidationResize, onFindInPanes }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const suppressScrollEvent = useRef(false);
  const activeMatchRef = useRef<HTMLSpanElement>(null);

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

  // Search: compute matches in this pane
  const searchLower = searchTerm?.toLowerCase() ?? '';
  const matchCount = useMemo(() => {
    if (!searchLower) return 0;
    let count = 0;
    for (const line of pane.lines) {
      if (line.type === 'ghost') continue;
      let idx = 0;
      const lower = line.text.toLowerCase();
      while ((idx = lower.indexOf(searchLower, idx)) !== -1) {
        count++;
        idx += searchLower.length;
      }
    }
    return count;
  }, [pane.lines, searchLower]);

  // Scroll active match into view and propagate scroll position for sync
  useEffect(() => {
    if (activeMatchRef.current) {
      activeMatchRef.current.scrollIntoView({ block: 'center' });
      // Propagate the new scroll position so sync-scroll carries other panes along
      if (contentRef.current && onScroll) {
        onScroll(contentRef.current.scrollTop);
      }
    }
  }, [activeMatchIndex, matchOffset, onScroll]);

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
        {viewMode === 'responses' && (
          <span style={{
            padding: '1px 4px', borderRadius: 3, fontSize: '0.55rem', fontWeight: 700,
            background: 'rgba(239,68,68,0.15)', color: '#ef4444',
            textTransform: 'uppercase',
          }}>
            resp
          </span>
        )}
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
          flex: 1, overflowY: 'auto', overflowX: wordWrap ? 'hidden' : 'auto',
          fontFamily: 'Consolas, "Fira Code", monospace',
          fontSize: '0.68rem',
          lineHeight: '1.4em',
          whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
          wordBreak: wordWrap ? 'break-word' : undefined,
        }}
      >
        {(() => {
          let globalIdx = matchOffset ?? 0;
          return lines.map((line, i) => {
            const lineMatchStart = globalIdx;
            const el = (
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
                <span style={{ paddingLeft: 6 }}>
                  {searchLower && line.type !== 'ghost'
                    ? highlightMatches(line.text, searchLower, activeMatchIndex ?? -1, lineMatchStart, activeMatchRef)
                    : line.pairText != null && (line.type === 'added' || line.type === 'removed')
                      ? renderWordDiff(line.text, line.pairText, line.type)
                      : line.text}
                </span>
              </div>
            );
            if (searchLower && line.type !== 'ghost') {
              let si = 0;
              const lower = line.text.toLowerCase();
              while ((si = lower.indexOf(searchLower, si)) !== -1) {
                globalIdx++;
                si += searchLower.length;
              }
            }
            return el;
          });
        })()}
      </div>

      {/* Validation panel — resizable via drag handle, height synced across panes */}
      {(node.validation || node.qualityCheck || node.orchestrationValidation) && (
        <ValidationPanelContainer
          node={node}
          height={validationHeight ?? VALIDATION_DEFAULT_HEIGHT}
          onResize={onValidationResize ?? (() => {})}
          onFind={onFindInPanes}
        />
      )}
    </div>
  );
}
