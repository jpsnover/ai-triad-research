// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { DiffLine } from '@lib/diff/lineDiff.js';
import type { PromptNode, DiffViewMode, StageValidation, QualityCheck, OrchestrationValidation, RetryTrigger } from './PromptDiffTree';
import type { CitationResolutionDiagnostics } from '@lib/debate/citationResolution.js';
import { POVER_INFO } from '../../types/debate';
import type { SpeakerId } from '../../types/debate';
import { humanizeSpeakerIds } from '../../utils/humanizeSpeakers';

const STAGE_COLORS: Record<string, string> = {
  brief: '#3b82f6', plan: '#a855f7', evidence: '#f59e0b', draft: '#22c55e', cite: '#f97316',
};

const LINE_BG: Record<DiffLine['type'], string> = {
  same: 'transparent',
  added: 'color-mix(in srgb, var(--success) 8%, transparent)',
  removed: 'color-mix(in srgb, var(--danger) 8%, transparent)',
  ghost: 'transparent',
};

const LINE_BORDER: Record<DiffLine['type'], string> = {
  same: 'none',
  added: '2px solid var(--success)',
  removed: '2px solid var(--danger)',
  ghost: 'none',
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
  /** Whether pre-scrub mode is active (Path A drafts in Responses mode). */
  preScrub?: boolean;
  /** Toggle pre-scrub mode for this pane. */
  onTogglePreScrub?: () => void;
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

function fabricatedColor(count: number): string {
  if (count === 0) return '#22c55e';
  if (count <= 2) return '#f59e0b';
  return '#ef4444';
}

function CitationResolutionSummary({ cr }: { cr: CitationResolutionDiagnostics }) {
  const fabColor = fabricatedColor(cr.citations_fabricated);
  const removed = cr.fabrications.filter(f => f.action === 'removed').length;
  const hedged = cr.fabrications.filter(f => f.action === 'hedged').length;
  const fabDetail = cr.citations_fabricated === 0
    ? '0 — clean'
    : [removed > 0 ? `${removed} removed` : '', hedged > 0 ? `${hedged} hedged` : ''].filter(Boolean).join(', ');
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontWeight: 600, fontSize: 'var(--text-2xs)', marginBottom: 3, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
        Citation Resolution
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 'var(--text-2xs)' }}>
        <span>
          Path:{' '}
          <span style={{
            fontWeight: 700, fontSize: 'var(--text-2xs)', padding: '0 4px', borderRadius: 2,
            background: cr.path === 'tool-calling' ? 'rgba(59,130,246,0.12)' : 'rgba(245,158,11,0.12)',
            color: cr.path === 'tool-calling' ? '#3b82f6' : '#f59e0b',
          }}>
            {cr.path === 'tool-calling' ? 'Tool-Call' : 'Bank+Scrub'}
          </span>
        </span>
        <span style={{ color: 'var(--text-muted)' }}>Bank: {cr.bank_size} srcs</span>
        <span>
          Matched:{' '}
          <span style={{
            fontWeight: 600,
            color: cr.citations_matched === cr.citations_extracted ? '#22c55e' : '#f59e0b',
          }}>
            {cr.citations_matched}/{cr.citations_extracted}
          </span>
        </span>
        <span>
          Fabricated:{' '}
          <span style={{ fontWeight: 600, color: fabColor }}>{fabDetail}</span>
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2 }}>
        {cr.tool_calls && cr.tool_calls.length > 0 && (
          <span>
            Tool calls: {cr.tool_calls.length}
            {cr.tool_calls.some(tc => tc.empty) && (
              <span style={{ color: '#f59e0b' }}> ({cr.tool_calls.filter(tc => tc.empty).length} empty)</span>
            )}
          </span>
        )}
        {cr.scrub_diff && (
          <span>Scrub: {cr.scrub_diff.lines_removed} removed, {cr.scrub_diff.lines_modified} modified</span>
        )}
        <span>Resolution: {cr.resolution_time_ms}ms</span>
      </div>
    </div>
  );
}

function ValidationPanel({ validation, qualityCheck, orchestrationValidation, retryTrigger, repairHintsIn, citationResolution }: {
  validation?: StageValidation; qualityCheck?: QualityCheck; orchestrationValidation?: OrchestrationValidation;
  retryTrigger?: RetryTrigger; repairHintsIn?: string[]; citationResolution?: CitationResolutionDiagnostics;
}) {
  if (!validation && !qualityCheck && !orchestrationValidation && !retryTrigger && !citationResolution) {
    return (
      <div style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 'var(--text-2xs)', fontStyle: 'italic' }}>
        No validation data
      </div>
    );
  }

  return (
    <div style={{ padding: '4px 8px', fontSize: 'var(--text-2xs)', overflowY: 'auto' }}>
      {/* Retry trigger badge + input repair hints */}
      {retryTrigger && retryTrigger !== 'initial' && (() => {
        const tl = TRIGGER_LABEL[retryTrigger];
        return (
          <div style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ fontWeight: 600, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Triggered By
              </span>
              <span style={{
                display: 'inline-block', padding: '1px 6px', borderRadius: 3,
                fontWeight: 700, fontSize: 'var(--text-2xs)', background: tl.bg, color: tl.color,
              }}>
                {tl.text}
              </span>
            </div>
            {repairHintsIn && repairHintsIn.length > 0 && (
              <ul style={{ margin: '2px 0 0 14px', padding: 0 }}>
                {repairHintsIn.map((h, i) => (
                  <li key={i} style={{ marginBottom: 1, color: 'var(--text-secondary)', fontSize: 'var(--text-2xs)' }}>{humanizeSpeakerIds(h)}</li>
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
            fontWeight: 700, fontSize: 'var(--text-2xs)',
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
                      display: 'inline-block', fontSize: 'var(--text-2xs)', fontWeight: 700,
                      color: s.color, background: s.bg, padding: '0 4px',
                      borderRadius: 2, marginRight: 4,
                    }}>{s.label}</span>
                    {humanizeSpeakerIds(h)}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Directive compliance */}
          {validation.directive_compliance && (
            <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                fontWeight: 700, fontSize: 'var(--text-2xs)',
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
              <summary style={{ cursor: 'pointer', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                {validation.details.filter(d => d.pass).length}/{validation.details.length} rules passed
              </summary>
              <div style={{ marginTop: 2 }}>
                {validation.details.map((d, i) => (
                  <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{ color: d.pass ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: 'var(--text-2xs)' }}>
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
          <div style={{ fontWeight: 600, fontSize: 'var(--text-2xs)', marginBottom: 2, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Quality Pre-Check
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['grounded', 'falsifiable', 'engages'] as const).map(dim => (
              <span key={dim} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <span style={{ color: qualityCheck[dim] ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: 'var(--text-2xs)' }}>
                  {qualityCheck[dim] ? '✓' : '✗'}
                </span>
                <span style={{ textTransform: 'capitalize' }}>{dim}</span>
              </span>
            ))}
          </div>
          {qualityCheck.weaknesses.length > 0 && (
            <ul style={{ margin: '2px 0 0 14px', padding: 0, color: 'var(--text-muted)' }}>
              {qualityCheck.weaknesses.map((w, i) => (
                <li key={i} style={{ marginBottom: 1 }}>{humanizeSpeakerIds(w)}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Orchestration Validation (judge feedback across the whole turn attempt) */}
      {orchestrationValidation && (
        <div style={{ marginTop: (validation || qualityCheck) ? 6 : 0 }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-2xs)', marginBottom: 2, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Orchestration Validation
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{
              display: 'inline-block', padding: '1px 6px', borderRadius: 3,
              fontWeight: 700, fontSize: 'var(--text-2xs)',
              background: orchestrationValidation.outcome === 'accept'
                ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
              color: orchestrationValidation.outcome === 'accept'
                ? '#22c55e' : '#ef4444',
            }}>
              {orchestrationValidation.outcome.toUpperCase()}
            </span>
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
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
                      display: 'inline-block', fontSize: 'var(--text-2xs)', fontWeight: 700,
                      color: s.color, background: s.bg, padding: '0 4px',
                      borderRadius: 2, marginRight: 4,
                    }}>{s.label}</span>
                    {humanizeSpeakerIds(h)}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Dimensions breakdown */}
          <details style={{ marginTop: 2 }}>
            <summary style={{ cursor: 'pointer', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
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
                    <span style={{ color: d.pass ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: 'var(--text-2xs)' }}>
                      {d.pass ? '✓' : '✗'}
                    </span>
                    {' '}
                    <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>{dim}</span>
                    {items.length > 0 && (
                      <ul style={{ margin: '1px 0 0 14px', padding: 0, color: 'var(--text-muted)' }}>
                        {items.map((item, j) => <li key={j} style={{ marginBottom: 1 }}>{humanizeSpeakerIds(item)}</li>)}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        </div>
      )}

      {/* Citation Resolution Summary */}
      {citationResolution && (
        <CitationResolutionSummary cr={citationResolution} />
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
  const wordBg = lineType === 'removed'
    ? 'color-mix(in srgb, var(--danger) 20%, transparent)'
    : 'color-mix(in srgb, var(--success) 20%, transparent)';

  return segments
    .filter(s => s.type === 'same' || s.type === changeType)
    .map((seg, i) => (
      seg.type === 'same'
        ? <span key={i}>{seg.text}</span>
        : <span key={i} style={{ background: wordBg, borderRadius: 2 }}>{seg.text}</span>
    ));
}

const VALIDATION_MIN_HEIGHT = 28;
const VALIDATION_DEFAULT_HEIGHT = 350;
const VALIDATION_MAX_HEIGHT = 800;

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
      fontSize: 'var(--text-2xs)',
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
          fontWeight: 600, fontSize: 'var(--text-2xs)',
          color: 'var(--text-muted)', userSelect: 'none',
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        <span style={{ fontSize: 'var(--text-2xs)' }}>{collapsed ? '▶' : '▼'}</span>
        Validation
        {node.validation && (
          <span style={{
            fontWeight: 700, fontSize: 'var(--text-2xs)',
            color: node.validation.pass ? '#22c55e' : '#ef4444',
          }}>
            {node.validation.pass ? '✓' : '✗'}
          </span>
        )}
        {node.orchestrationValidation && (
          <span style={{
            fontWeight: 700, fontSize: 'var(--text-2xs)',
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
            citationResolution={node.citationResolution}
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

/** Post-process diff lines into renderable items: groups of 3+ consecutive same/ghost lines become collapsible regions. */
type DiffItem =
  | { kind: 'line'; line: PaneDiffLine; originalIndex: number }
  | { kind: 'region'; lines: PaneDiffLine[]; startIdx: number; regionIdx: number };

function groupDiffLines(lines: PaneDiffLine[]): DiffItem[] {
  const COLLAPSE_THRESHOLD = 3;
  const items: DiffItem[] = [];
  let regionIdx = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'same' || line.type === 'ghost') {
      // Collect run of same/ghost lines
      let j = i;
      while (j < lines.length && (lines[j].type === 'same' || lines[j].type === 'ghost')) j++;
      const run = lines.slice(i, j);
      if (run.length >= COLLAPSE_THRESHOLD) {
        items.push({ kind: 'region', lines: run, startIdx: i, regionIdx: regionIdx++ });
      } else {
        for (let k = 0; k < run.length; k++) {
          items.push({ kind: 'line', line: run[k], originalIndex: i + k });
        }
      }
      i = j;
    } else {
      items.push({ kind: 'line', line, originalIndex: i });
      i++;
    }
  }
  return items;
}

export function PromptDiffPane({ pane, paneIndex, isReference, isFocused, onClose, onFocus, onScroll, scrollTop, searchTerm, activeMatchIndex, matchOffset, viewMode, wordWrap, validationHeight, onValidationResize, onFindInPanes, preScrub, onTogglePreScrub }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const suppressScrollEvent = useRef(false);
  const activeMatchRef = useRef<HTMLSpanElement>(null);

  // §B: track which unchanged regions are expanded (empty = all collapsed by default)
  const [expandedRegions, setExpandedRegions] = useState<Set<number>>(new Set());
  const toggleCollapsedRegion = useCallback((regionIdx: number) => {
    setExpandedRegions(prev => {
      const next = new Set(prev);
      if (next.has(regionIdx)) next.delete(regionIdx);
      else next.add(regionIdx);
      return next;
    });
  }, []);

  // Context menu for copying selected text
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const sel = window.getSelection()?.toString().trim();
    if (!sel) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, text: sel });
  }, []);
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener('click', close, { once: true });
    return () => document.removeEventListener('click', close);
  }, [ctxMenu]);

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
        fontSize: 'var(--text-2xs)',
        flexShrink: 0,
      }}>
        {node.kind === 'tool-call' ? (
          <>
            <span style={{
              padding: '1px 5px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 700,
              background: 'rgba(14,165,233,0.12)', color: '#0ea5e9',
            }}>
              🔍 {node.toolName ?? 'lookup_citation'}
            </span>
            <span style={{ fontWeight: 600 }}>#{(node.toolCallIndex ?? 0) + 1}</span>
            {node.toolCallEmpty && (
              <span style={{
                padding: '1px 4px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 700,
                background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
              }}>
                EMPTY
              </span>
            )}
            {viewMode === 'responses' && (
              <span style={{
                padding: '1px 4px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 700,
                background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                textTransform: 'uppercase',
              }}>
                results
              </span>
            )}
          </>
        ) : node.kind === 'scrub' ? (
          <>
            <span style={{
              padding: '1px 5px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 700,
              background: 'rgba(168,85,247,0.12)', color: '#a855f7',
            }}>
              ✂ Scrub
            </span>
            {viewMode === 'responses' && (
              <span style={{
                padding: '1px 4px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 700,
                background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                textTransform: 'uppercase',
              }}>
                post
              </span>
            )}
            {!viewMode || viewMode === 'prompts' ? (
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>pre-scrub draft</span>
            ) : (
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>post-scrub draft</span>
            )}
          </>
        ) : node.kind === 'attempt-verdict' ? (
          <>
            <span style={{ fontSize: 'var(--text-2xs)' }}>⚖</span>
            <span style={{ fontWeight: 700 }}>Attempt {node.runIndex + 1} Verdict</span>
            {node.orchestrationValidation && (() => {
              const isAccept = node.orchestrationValidation.outcome === 'accept' || node.orchestrationValidation.outcome === 'accept_with_flag';
              return (
                <span style={{
                  padding: '1px 5px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 700,
                  background: isAccept ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                  color: isAccept ? '#22c55e' : '#ef4444',
                  textTransform: 'uppercase',
                }}>
                  {node.orchestrationValidation.outcome.replace(/_/g, ' ')} ({node.orchestrationValidation.process_reward.toFixed(2)})
                </span>
              );
            })()}
          </>
        ) : (
          <>
            <span style={{
              padding: '1px 5px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 700,
              background: `${stageColor}20`, color: stageColor,
              textTransform: 'uppercase',
            }}>
              {node.stage}
            </span>
            {viewMode === 'responses' && (
              <span style={{
                padding: '1px 4px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 700,
                background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                textTransform: 'uppercase',
              }}>
                resp
              </span>
            )}
            <span style={{ fontWeight: 600 }}>Run {node.runIndex + 1}</span>
          </>
        )}
        <span style={{ color: 'var(--text-muted)' }}>
          S{node.entryIndex + 1} {speakerLabel(node.speaker)}
        </span>
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
          ({pane.lines.filter(l => l.type !== 'ghost').length} lines)
        </span>
        {/* Pre-scrub toggle: Path A drafts in Responses mode with fabrications */}
        {!node.kind && node.stage === 'draft' && viewMode === 'responses'
          && node.citationResolution?.path === 'bank-scrub'
          && (node.citationResolution?.fabrications?.length ?? 0) > 0
          && onTogglePreScrub && (
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePreScrub(); }}
            style={{
              padding: '1px 6px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 700,
              border: '1px solid var(--border-color)', cursor: 'pointer',
              background: preScrub ? 'rgba(168,85,247,0.2)' : 'transparent',
              color: preScrub ? '#a855f7' : 'var(--text-muted)',
            }}
            title={preScrub ? 'Showing pre-scrub draft (click to show post-scrub)' : 'Click to show pre-scrub draft (before citation cleanup)'}
          >
            {preScrub ? 'Pre-scrub ✓' : 'Pre-scrub'}
          </button>
        )}
        {stats && !isReference && (
          <span style={{ marginLeft: 'auto', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
            <span style={{ color: '#eab308' }}>+{stats.added}</span>
            {' / '}
            <span style={{ color: '#ef4444' }}>-{stats.removed}</span>
            {' / '}
            {stats.total} lines
          </span>
        )}
        {isReference && (
          <span style={{ marginLeft: 'auto', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>
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
          aria-label="Close"
        >&times;</button>
      </div>

      {/* Content — hidden for attempt-verdict nodes (validation panel is the sole content) */}
      {node.kind === 'attempt-verdict' ? (
        <div style={{
          padding: '12px 16px', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)',
          fontStyle: 'italic',
        }}>
          Orchestration judge verdict for attempt {node.runIndex + 1}. This assessment was produced after
          the full pipeline (brief → plan → evidence → draft → cite) completed.
        </div>
      ) : (
      <div
        ref={contentRef}
        onScroll={handleScroll}
        onContextMenu={handleContextMenu}
        style={{
          flex: 1, overflowY: 'auto', overflowX: wordWrap ? 'hidden' : 'auto',
          fontFamily: 'Consolas, "Fira Code", monospace',
          fontSize: 'var(--text-2xs)',
          lineHeight: '1.4em',
          whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
          wordBreak: wordWrap ? 'break-word' : undefined,
        }}
      >
        {/* §C: per-run header card */}
        <div style={{
          padding: '6px 10px',
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-color)',
          margin: '6px 8px 8px',
          fontSize: 'var(--text-2xs)',
          color: 'var(--text-secondary)',
          whiteSpace: 'normal',
        }}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
            {node.stage} — Run {node.runIndex + 1}
          </div>
          <div>{node.model} · {node.responseTimeMs}ms</div>
        </div>
        {(() => {
          let globalIdx = matchOffset ?? 0;
          const diffItems = groupDiffLines(lines);
          // Pre-count search matches per original line index for correct globalIdx accounting
          return diffItems.map((item, itemIdx) => {
            if (item.kind === 'region') {
              const { regionIdx, lines: regionLines } = item;
              const collapsed = !expandedRegions.has(regionIdx);
              const count = regionLines.length;
              // When collapsed, skip globalIdx for these lines (they aren't rendered, so no match highlights)
              // When expanded, account for matches in region lines
              if (collapsed) {
                return (
                  <div
                    key={`region-${itemIdx}`}
                    onClick={() => toggleCollapsedRegion(regionIdx)}
                    style={{
                      textAlign: 'center',
                      padding: '4px 0',
                      fontSize: 'var(--text-2xs)',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      background: 'var(--bg-secondary)',
                      borderRadius: 'var(--radius-sm)',
                      margin: '2px 0',
                      whiteSpace: 'normal',
                    }}
                  >
                    {`⋯ ${count} unchanged lines`}
                  </div>
                );
              }
              // Expanded: render all lines in region
              const renderedLines = regionLines.map((line, k) => {
                const lineMatchStart = globalIdx;
                const el = (
                  <div
                    key={`region-${itemIdx}-line-${k}`}
                    style={{
                      display: 'flex',
                      background: LINE_BG[line.type],
                      borderLeft: LINE_BORDER[line.type],
                      minHeight: '1.4em',
                    }}
                  >
                    <span style={{
                      width: 40, flexShrink: 0, textAlign: 'right', paddingRight: 6,
                      color: 'var(--text-muted)', fontSize: 'var(--text-2xs)',
                      userSelect: 'none', borderRight: '1px solid var(--border-color)',
                      opacity: line.type === 'ghost' ? 0 : 0.6,
                    }}>
                      {line.lineNumber ?? ''}
                    </span>
                    <span style={{ paddingLeft: 6, color: 'var(--text-primary)' }}>
                      {searchLower && line.type !== 'ghost'
                        ? highlightMatches(line.text, searchLower, activeMatchIndex ?? -1, lineMatchStart, activeMatchRef)
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
              return (
                <div key={`region-${itemIdx}`}>
                  <div
                    onClick={() => toggleCollapsedRegion(regionIdx)}
                    style={{
                      textAlign: 'center',
                      padding: '4px 0',
                      fontSize: 'var(--text-2xs)',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      background: 'var(--bg-secondary)',
                      borderRadius: 'var(--radius-sm)',
                      margin: '2px 0',
                      whiteSpace: 'normal',
                    }}
                  >
                    {`▼ collapse ${count} lines`}
                  </div>
                  {renderedLines}
                </div>
              );
            }
            // kind === 'line'
            const { line } = item;
            const lineMatchStart = globalIdx;
            const el = (
              <div
                key={`line-${itemIdx}`}
                style={{
                  display: 'flex',
                  background: LINE_BG[line.type],
                  borderLeft: LINE_BORDER[line.type],
                  minHeight: '1.4em',
                }}
              >
                <span style={{
                  width: 40, flexShrink: 0, textAlign: 'right', paddingRight: 6,
                  color: 'var(--text-muted)', fontSize: 'var(--text-2xs)',
                  userSelect: 'none', borderRight: '1px solid var(--border-color)',
                  opacity: line.type === 'ghost' ? 0 : 0.6,
                }}>
                  {line.lineNumber ?? ''}
                </span>
                <span style={{ paddingLeft: 6, color: 'var(--text-primary)' }}>
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
            style={{ padding: '4px 12px', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.15)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >Copy</div>
          {onFindInPanes && (
            <div
              onClick={() => { onFindInPanes(ctxMenu.text); setCtxMenu(null); }}
              style={{ padding: '4px 12px', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.15)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >Find in Panes</div>
          )}
        </div>
      )}

      {/* Validation panel — resizable via drag handle, height synced across panes (not shown for tool-call/scrub sub-nodes) */}
      {(!node.kind || node.kind === 'attempt-verdict') && (node.validation || node.qualityCheck || node.orchestrationValidation || node.citationResolution) && (
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
