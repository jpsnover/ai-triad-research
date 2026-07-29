// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { DiffLine } from '@lib/diff/lineDiff.js';
import type { PromptNode, DiffViewMode, StageValidation, QualityCheck, OrchestrationValidation, RetryTrigger } from './PromptDiffTree';
import type { CitationResolutionDiagnostics } from '@lib/debate/citationResolution.js';
import { POVER_INFO } from '../../types/debate';
import type { SpeakerId } from '../../types/debate';
import { humanizeSpeakerIds } from '../../utils/humanizeSpeakers';
import './PromptDiffPane.css';

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
        className="pdp-br2"
        // eslint-disable-next-line local/no-inline-style -- dynamic: search-match highlight background/color depend on isActive
        style={{
          background: isActive ? 'rgba(34,197,94,0.7)' : 'rgba(34,197,94,0.4)',
          color: isActive ? '#000' : 'inherit',
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
    <div className="pdp-cr-root">
      <div className="pdp-cr-title">
        Citation Resolution
      </div>
      <div className="pdp-cr-row">
        <span>
          Path:{' '}
          <span
            className="pdp-mini-badge"
            // eslint-disable-next-line local/no-inline-style -- dynamic: badge background/color depend on cr.path
            style={{
              background: cr.path === 'tool-calling' ? 'rgba(59,130,246,0.12)' : 'rgba(245,158,11,0.12)',
              color: cr.path === 'tool-calling' ? '#3b82f6' : '#f59e0b',
            }}
          >
            {cr.path === 'tool-calling' ? 'Tool-Call' : 'Bank+Scrub'}
          </span>
        </span>
        <span className="pdp-muted">Bank: {cr.bank_size} srcs</span>
        <span>
          Matched:{' '}
          <span
            className="pdp-fw600"
            // eslint-disable-next-line local/no-inline-style -- dynamic: color depends on matched/extracted parity
            style={{
              color: cr.citations_matched === cr.citations_extracted ? '#22c55e' : '#f59e0b',
            }}
          >
            {cr.citations_matched}/{cr.citations_extracted}
          </span>
        </span>
        <span>
          Fabricated:{' '}
          {/* eslint-disable-next-line local/no-inline-style -- dynamic: color derived from fabricatedColor(count) */}
          <span className="pdp-fw600" style={{ color: fabColor }}>{fabDetail}</span>
        </span>
      </div>
      <div className="pdp-cr-row2">
        {cr.tool_calls && cr.tool_calls.length > 0 && (
          <span>
            Tool calls: {cr.tool_calls.length}
            {cr.tool_calls.some(tc => tc.empty) && (
              <span className="pdp-c-amber"> ({cr.tool_calls.filter(tc => tc.empty).length} empty)</span>
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

function RetrySection({ retryTrigger, repairHintsIn }: {
  retryTrigger?: RetryTrigger; repairHintsIn?: string[];
}) {
  if (!(retryTrigger && retryTrigger !== 'initial')) return null;
  const tl = TRIGGER_LABEL[retryTrigger];
  return (
    <div className="pdp-mb6">
      <div className="pdp-flex-ac-g6-mb2">
        <span className="pdp-uc-label">
          Triggered By
        </span>
        {/* eslint-disable-next-line local/no-inline-style -- dynamic: badge background/color from TRIGGER_LABEL[retryTrigger] */}
        <span className="pdp-badge" style={{ background: tl.bg, color: tl.color }}>
          {tl.text}
        </span>
      </div>
      {repairHintsIn && repairHintsIn.length > 0 && (
        <ul className="pdp-ul-hint">
          {repairHintsIn.map((h, i) => (
            <li key={i} className="pdp-li-secondary">{humanizeSpeakerIds(h)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StageValidationSection({ validation }: { validation?: StageValidation }) {
  if (!validation) return null;
  return (
    <div>
      {/* Pass/Fail badge */}
      {/* eslint-disable-next-line local/no-inline-style -- dynamic: badge background/color depend on validation.pass */}
      <span className="pdp-badge" style={{
        background: validation.pass ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
        color: validation.pass ? '#22c55e' : '#ef4444',
      }}>
        {validation.pass ? '✓ Pass' : '✗ Fail'}
      </span>

      {/* Hints */}
      {validation.hints && validation.hints.length > 0 && (
        <ul className="pdp-ul-hints2">
          {validation.hints.map((h, i) => {
            const cat = classifyHint(h);
            const s = HINT_STYLE[cat];
            return (
              <li key={i} className="pdp-mb2">
                {/* eslint-disable-next-line local/no-inline-style -- dynamic: hint-tag color/background from HINT_STYLE[cat] */}
                <span className="pdp-hint-tag" style={{ color: s.color, background: s.bg }}>{s.label}</span>
                {humanizeSpeakerIds(h)}
              </li>
            );
          })}
        </ul>
      )}

      {/* Directive compliance */}
      {validation.directive_compliance && (
        <div className="pdp-mt2-flex-ac-g4">
          {/* eslint-disable-next-line local/no-inline-style -- dynamic: color depends on directive compliance */}
          <span className="pdp-check" style={{
            color: validation.directive_compliance.compliant ? '#22c55e' : '#ef4444',
          }}>
            {validation.directive_compliance.compliant ? '✓' : '✗'}
          </span>
          <span>Directive: {validation.directive_compliance.matched_terms}/{validation.directive_compliance.directive_terms.length} terms</span>
        </div>
      )}

      {/* Per-rule details */}
      {validation.details && validation.details.length > 0 && (
        <details className="pdp-mt4">
          <summary className="pdp-summary">
            {validation.details.filter(d => d.pass).length}/{validation.details.length} rules passed
          </summary>
          <div className="pdp-mt2">
            {validation.details.map((d, i) => (
              <div key={i} className="pdp-flex-g4-ac">
                {/* eslint-disable-next-line local/no-inline-style -- dynamic: color depends on rule d.pass */}
                <span className="pdp-check" style={{ color: d.pass ? '#22c55e' : '#ef4444' }}>
                  {d.pass ? '✓' : '✗'}
                </span>
                <span>{d.rule}</span>
                {d.value && <span className="pdp-muted">({d.value})</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function QualitySection({ qualityCheck, validation }: {
  qualityCheck?: QualityCheck; validation?: StageValidation;
}) {
  if (!qualityCheck) return null;
  return (
    // eslint-disable-next-line local/no-inline-style -- dynamic: margin-top depends on whether validation section rendered above
    <div style={{ marginTop: validation ? 6 : 0 }}>
      <div className="pdp-section-title">
        Quality Pre-Check
      </div>
      <div className="pdp-flex-g8">
        {(['grounded', 'falsifiable', 'engages'] as const).map(dim => (
          <span key={dim} className="pdp-flex-ac-g2">
            {/* eslint-disable-next-line local/no-inline-style -- dynamic: color depends on qualityCheck[dim] */}
            <span className="pdp-check" style={{ color: qualityCheck[dim] ? '#22c55e' : '#ef4444' }}>
              {qualityCheck[dim] ? '✓' : '✗'}
            </span>
            <span className="pdp-capitalize">{dim}</span>
          </span>
        ))}
      </div>
      {qualityCheck.weaknesses.length > 0 && (
        <ul className="pdp-ul-14-muted">
          {qualityCheck.weaknesses.map((w, i) => (
            <li key={i} className="pdp-mb1">{humanizeSpeakerIds(w)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OrchestrationSection({ orchestrationValidation, validation, qualityCheck }: {
  orchestrationValidation?: OrchestrationValidation; validation?: StageValidation; qualityCheck?: QualityCheck;
}) {
  if (!orchestrationValidation) return null;
  return (
    // eslint-disable-next-line local/no-inline-style -- dynamic: margin-top depends on whether prior sections rendered
    <div style={{ marginTop: (validation || qualityCheck) ? 6 : 0 }}>
      <div className="pdp-section-title">
        Orchestration Validation
      </div>
      <div className="pdp-flex-ac-g6-mb3">
        {/* eslint-disable-next-line local/no-inline-style -- dynamic: badge background/color depend on outcome */}
        <span className="pdp-badge" style={{
          background: orchestrationValidation.outcome === 'accept'
            ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          color: orchestrationValidation.outcome === 'accept'
            ? '#22c55e' : '#ef4444',
        }}>
          {orchestrationValidation.outcome.toUpperCase()}
        </span>
        <span className="pdp-2xs-muted">
          score: {orchestrationValidation.process_reward.toFixed(2)}
        </span>
      </div>

      {/* Repair hints */}
      {orchestrationValidation.repairHints.length > 0 && (
        <ul className="pdp-ul-hints3">
          {orchestrationValidation.repairHints.map((h, i) => {
            const cat = classifyHint(h);
            const s = HINT_STYLE[cat];
            return (
              <li key={i} className="pdp-mb2">
                {/* eslint-disable-next-line local/no-inline-style -- dynamic: hint-tag color/background from HINT_STYLE[cat] */}
                <span className="pdp-hint-tag" style={{ color: s.color, background: s.bg }}>{s.label}</span>
                {humanizeSpeakerIds(h)}
              </li>
            );
          })}
        </ul>
      )}

      {/* Dimensions breakdown */}
      <details className="pdp-mt2">
        <summary className="pdp-summary">
          Dimensions
          {' '}
          {(['schema', 'grounding', 'advancement', 'clarifies'] as const)
            .filter(d => !orchestrationValidation.dimensions[d].pass).length === 0
            ? <span className="pdp-green-700">all pass</span>
            : <span className="pdp-red-700">
                {(['schema', 'grounding', 'advancement', 'clarifies'] as const)
                  .filter(d => !orchestrationValidation.dimensions[d].pass).length} failed
              </span>
          }
        </summary>
        <div className="pdp-mt2">
          {(['schema', 'grounding', 'advancement', 'clarifies'] as const).map(dim => {
            const d = orchestrationValidation.dimensions[dim];
            const items = 'issues' in d ? d.issues : d.signals;
            return (
              <div key={dim} className="pdp-mb2">
                {/* eslint-disable-next-line local/no-inline-style -- dynamic: color depends on dimension d.pass */}
                <span className="pdp-check" style={{ color: d.pass ? '#22c55e' : '#ef4444' }}>
                  {d.pass ? '✓' : '✗'}
                </span>
                {' '}
                <span className="pdp-cap-500">{dim}</span>
                {items.length > 0 && (
                  <ul className="pdp-ul-14b-muted">
                    {items.map((item, j) => <li key={j} className="pdp-mb1">{humanizeSpeakerIds(item)}</li>)}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

function ValidationPanel({ validation, qualityCheck, orchestrationValidation, retryTrigger, repairHintsIn, citationResolution }: {
  validation?: StageValidation; qualityCheck?: QualityCheck; orchestrationValidation?: OrchestrationValidation;
  retryTrigger?: RetryTrigger; repairHintsIn?: string[]; citationResolution?: CitationResolutionDiagnostics;
}) {
  if (!validation && !qualityCheck && !orchestrationValidation && !retryTrigger && !citationResolution) {
    return (
      <div className="pdp-no-validation">
        No validation data
      </div>
    );
  }

  return (
    <div className="pdp-validation-panel">
      {/* Retry trigger badge + input repair hints */}
      <RetrySection retryTrigger={retryTrigger} repairHintsIn={repairHintsIn} />

      <StageValidationSection validation={validation} />

      {/* Quality Pre-Check */}
      <QualitySection qualityCheck={qualityCheck} validation={validation} />

      {/* Orchestration Validation (judge feedback across the whole turn attempt) */}
      <OrchestrationSection orchestrationValidation={orchestrationValidation} validation={validation} qualityCheck={qualityCheck} />

      {/* Citation Resolution Summary */}
      {citationResolution && (
        <CitationResolutionSummary cr={citationResolution} />
      )}
    </div>
  );
}

type WordSeg = { text: string; type: 'same' | 'added' | 'removed' };

/** Merge adjacent segments of the same type. */
function mergeAdjacentSegments(raw: WordSeg[]): WordSeg[] {
  const merged: WordSeg[] = [];
  for (const seg of raw) {
    const last = merged.length > 0 ? merged[merged.length - 1] : null;
    if (last && last.type === seg.type) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged;
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

  return mergeAdjacentSegments(raw);
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
        // eslint-disable-next-line local/no-inline-style -- dynamic: word-diff highlight background depends on lineType
        : <span key={i} className="pdp-br2" style={{ background: wordBg }}>{seg.text}</span>
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
    <div
      className="pdp-vpc-root"
      // eslint-disable-next-line local/no-inline-style -- dynamic: resizable panel height (collapsed ? 'auto' : height)
      style={{ height: collapsed ? 'auto' : height }}
    >
      {/* Drag handle */}
      {!collapsed && (
        <div
          onMouseDown={onDragStart}
          className="pdp-drag-handle"
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          title="Drag to resize validation panel"
        />
      )}
      {/* Summary / toggle */}
      <div
        onClick={() => setCollapsed(c => !c)}
        className="pdp-vpc-summary"
      >
        <span className="pdp-2xs">{collapsed ? '▶' : '▼'}</span>
        Validation
        {node.validation && (
          // eslint-disable-next-line local/no-inline-style -- dynamic: color depends on node.validation.pass
          <span className="pdp-check" style={{
            color: node.validation.pass ? '#22c55e' : '#ef4444',
          }}>
            {node.validation.pass ? '✓' : '✗'}
          </span>
        )}
        {node.orchestrationValidation && (
          // eslint-disable-next-line local/no-inline-style -- dynamic: badge background/color depend on outcome
          <span className="pdp-mini-badge" style={{
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
        <div className="pdp-flex1-auto" onContextMenu={handleContextMenu}>
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
        // eslint-disable-next-line local/no-inline-style -- dynamic: context-menu left/top follow cursor position
        <div className="pdp-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <div
            onClick={() => { void navigator.clipboard.writeText(ctxMenu.text); setCtxMenu(null); }}
            className="pdp-ctx-item"
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.15)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >Copy</div>
          {onFind && (
            <div
              onClick={() => { onFind(ctxMenu.text); setCtxMenu(null); }}
              className="pdp-ctx-item"
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

function countMatches(lines: PaneDiffLine[], searchLower: string): number {
  if (!searchLower) return 0;
  let count = 0;
  for (const line of lines) {
    if (line.type === 'ghost') continue;
    let idx = 0;
    const lower = line.text.toLowerCase();
    while ((idx = lower.indexOf(searchLower, idx)) !== -1) {
      count++;
      idx += searchLower.length;
    }
  }
  return count;
}

function renderDiffBody(
  lines: PaneDiffLine[],
  matchOffset: number | undefined,
  expandedRegions: Set<number>,
  toggleCollapsedRegion: (regionIdx: number) => void,
  searchLower: string,
  activeMatchIndex: number | undefined,
  activeMatchRef: React.RefObject<HTMLSpanElement | null>,
): React.ReactNode {
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
            className="pdp-region-toggle"
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
            className="pdp-line"
            // eslint-disable-next-line local/no-inline-style -- dynamic: per-line diff background/border from LINE_BG/LINE_BORDER
            style={{
              background: LINE_BG[line.type],
              borderLeft: LINE_BORDER[line.type],
            }}
          >
            {/* eslint-disable-next-line local/no-inline-style -- dynamic: gutter opacity hides ghost line numbers */}
            <span className="pdp-gutter" style={{
              opacity: line.type === 'ghost' ? 0 : 0.6,
            }}>
              {line.lineNumber ?? ''}
            </span>
            <span className="pdp-line-text">
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
            className="pdp-region-toggle"
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
        className="pdp-line"
        // eslint-disable-next-line local/no-inline-style -- dynamic: per-line diff background/border from LINE_BG/LINE_BORDER
        style={{
          background: LINE_BG[line.type],
          borderLeft: LINE_BORDER[line.type],
        }}
      >
        {/* eslint-disable-next-line local/no-inline-style -- dynamic: gutter opacity hides ghost line numbers */}
        <span className="pdp-gutter" style={{
          opacity: line.type === 'ghost' ? 0 : 0.6,
        }}>
          {line.lineNumber ?? ''}
        </span>
        <span className="pdp-line-text">
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
}

function ToolCallBadges({ node, viewMode }: { node: PromptNode; viewMode?: DiffViewMode }) {
  return (
    <>
      <span className="pdp-tool-badge">
        🔍 {node.toolName ?? 'lookup_citation'}
      </span>
      <span className="pdp-fw600">#{(node.toolCallIndex ?? 0) + 1}</span>
      {node.toolCallEmpty && (
        <span className="pdp-empty-badge">
          EMPTY
        </span>
      )}
      {viewMode === 'responses' && (
        <span className="pdp-results-badge">
          results
        </span>
      )}
    </>
  );
}

function ScrubBadges({ viewMode }: { viewMode?: DiffViewMode }) {
  return (
    <>
      <span className="pdp-scrub-badge">
        ✂ Scrub
      </span>
      {viewMode === 'responses' && (
        <span className="pdp-results-badge">
          post
        </span>
      )}
      {!viewMode || viewMode === 'prompts' ? (
        <span className="pdp-2xs-muted">pre-scrub draft</span>
      ) : (
        <span className="pdp-2xs-muted">post-scrub draft</span>
      )}
    </>
  );
}

function AttemptVerdictBadges({ node }: { node: PromptNode }) {
  return (
    <>
      <span className="pdp-2xs">⚖</span>
      <span className="pdp-fw700">Attempt {node.runIndex + 1} Verdict</span>
      {node.orchestrationValidation && (() => {
        const isAccept = node.orchestrationValidation.outcome === 'accept' || node.orchestrationValidation.outcome === 'accept_with_flag';
        return (
          // eslint-disable-next-line local/no-inline-style -- dynamic: badge background/color depend on isAccept
          <span className="pdp-uc-badge" style={{
            background: isAccept ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            color: isAccept ? '#22c55e' : '#ef4444',
          }}>
            {node.orchestrationValidation.outcome.replace(/_/g, ' ')} ({node.orchestrationValidation.process_reward.toFixed(2)})
          </span>
        );
      })()}
    </>
  );
}

function StageBadges({ node, viewMode, stageColor }: {
  node: PromptNode; viewMode?: DiffViewMode; stageColor: string;
}) {
  return (
    <>
      {/* eslint-disable-next-line local/no-inline-style -- dynamic: badge background/color derived from stageColor */}
      <span className="pdp-uc-badge" style={{
        background: `${stageColor}20`, color: stageColor,
      }}>
        {node.stage}
      </span>
      {viewMode === 'responses' && (
        <span className="pdp-results-badge">
          resp
        </span>
      )}
      <span className="pdp-fw600">Run {node.runIndex + 1}</span>
    </>
  );
}

function PreScrubToggle({ node, viewMode, preScrub, onTogglePreScrub }: {
  node: PromptNode; viewMode?: DiffViewMode; preScrub?: boolean; onTogglePreScrub?: () => void;
}) {
  if (node.kind) return null;
  if (node.stage !== 'draft') return null;
  if (viewMode !== 'responses') return null;
  if (node.citationResolution?.path !== 'bank-scrub') return null;
  if ((node.citationResolution?.fabrications?.length ?? 0) === 0) return null;
  if (!onTogglePreScrub) return null;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onTogglePreScrub(); }}
      className="pdp-prescrub-btn"
      // eslint-disable-next-line local/no-inline-style -- dynamic: button background/color depend on preScrub
      style={{
        background: preScrub ? 'rgba(168,85,247,0.2)' : 'transparent',
        color: preScrub ? '#a855f7' : 'var(--text-muted)',
      }}
      title={preScrub ? 'Showing pre-scrub draft (click to show post-scrub)' : 'Click to show pre-scrub draft (before citation cleanup)'}
    >
      {preScrub ? 'Pre-scrub ✓' : 'Pre-scrub'}
    </button>
  );
}

function PaneHeader({ node, viewMode, pane, stats, isReference, paneIndex, preScrub, onTogglePreScrub, onClose, stageColor }: {
  node: PromptNode;
  viewMode?: DiffViewMode;
  pane: PaneData;
  stats?: PaneData['stats'];
  isReference: boolean;
  paneIndex: number;
  preScrub?: boolean;
  onTogglePreScrub?: () => void;
  onClose: () => void;
  stageColor: string;
}) {
  return (
    <div className="pdp-header">
      {node.kind === 'tool-call' ? (
        <ToolCallBadges node={node} viewMode={viewMode} />
      ) : node.kind === 'scrub' ? (
        <ScrubBadges viewMode={viewMode} />
      ) : node.kind === 'attempt-verdict' ? (
        <AttemptVerdictBadges node={node} />
      ) : (
        <StageBadges node={node} viewMode={viewMode} stageColor={stageColor} />
      )}
      <span className="pdp-muted">
        S{node.entryIndex + 1} {speakerLabel(node.speaker)}
      </span>
      <span className="pdp-2xs-muted">
        ({pane.lines.filter(l => l.type !== 'ghost').length} lines)
      </span>
      {/* Pre-scrub toggle: Path A drafts in Responses mode with fabrications */}
      <PreScrubToggle node={node} viewMode={viewMode} preScrub={preScrub} onTogglePreScrub={onTogglePreScrub} />
      {stats && !isReference && (
        <span className="pdp-stats">
          <span className="pdp-c-yellow">+{stats.added}</span>
          {' / '}
          <span className="pdp-c-red">-{stats.removed}</span>
          {' / '}
          {stats.total} lines
        </span>
      )}
      {isReference && (
        <span className="pdp-ref-label">
          reference
        </span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="pdp-close-btn"
        title={`Close pane ${paneIndex + 1} (Ctrl+W)`}
        aria-label="Close"
      >&times;</button>
    </div>
  );
}

function PaneValidation({ node, validationHeight, onValidationResize, onFindInPanes }: {
  node: PromptNode;
  validationHeight?: number;
  onValidationResize?: (height: number) => void;
  onFindInPanes?: (text: string) => void;
}) {
  if (!((!node.kind || node.kind === 'attempt-verdict') && (node.validation || node.qualityCheck || node.orchestrationValidation || node.citationResolution))) {
    return null;
  }
  return (
    <ValidationPanelContainer
      node={node}
      height={validationHeight ?? VALIDATION_DEFAULT_HEIGHT}
      onResize={onValidationResize ?? (() => {})}
      onFind={onFindInPanes}
    />
  );
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
  const matchCount = useMemo(() => countMatches(pane.lines, searchLower), [pane.lines, searchLower]);

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
      className="pdp-root"
      // eslint-disable-next-line local/no-inline-style -- dynamic: border color depends on isFocused
      style={{
        border: isFocused ? '1px solid #3b82f6' : '1px solid var(--border-color)',
      }}
    >
      {/* Header */}
      <PaneHeader
        node={node}
        viewMode={viewMode}
        pane={pane}
        stats={stats}
        isReference={isReference}
        paneIndex={paneIndex}
        preScrub={preScrub}
        onTogglePreScrub={onTogglePreScrub}
        onClose={onClose}
        stageColor={stageColor}
      />

      {/* Content — hidden for attempt-verdict nodes (validation panel is the sole content) */}
      {node.kind === 'attempt-verdict' ? (
        <div className="pdp-verdict-content">
          Orchestration judge verdict for attempt {node.runIndex + 1}. This assessment was produced after
          the full pipeline (brief → plan → evidence → draft → cite) completed.
        </div>
      ) : (
      <div
        ref={contentRef}
        onScroll={handleScroll}
        onContextMenu={handleContextMenu}
        className="pdp-content"
        // eslint-disable-next-line local/no-inline-style -- dynamic: overflow-x/white-space/word-break depend on wordWrap
        style={{
          overflowX: wordWrap ? 'hidden' : 'auto',
          whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
          wordBreak: wordWrap ? 'break-word' : undefined,
        }}
      >
        {/* §C: per-run header card */}
        <div className="pdp-run-card">
          <div className="pdp-run-title">
            {node.stage} — Run {node.runIndex + 1}
          </div>
          <div>{node.model} · {node.responseTimeMs}ms</div>
        </div>
        {renderDiffBody(lines, matchOffset, expandedRegions, toggleCollapsedRegion, searchLower, activeMatchIndex, activeMatchRef)}
      </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        // eslint-disable-next-line local/no-inline-style -- dynamic: context-menu left/top follow cursor position
        <div className="pdp-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <div
            onClick={() => { void navigator.clipboard.writeText(ctxMenu.text); setCtxMenu(null); }}
            className="pdp-ctx-item"
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.15)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >Copy</div>
          {onFindInPanes && (
            <div
              onClick={() => { onFindInPanes(ctxMenu.text); setCtxMenu(null); }}
              className="pdp-ctx-item"
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.15)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >Find in Panes</div>
          )}
        </div>
      )}

      {/* Validation panel — resizable via drag handle, height synced across panes (not shown for tool-call/scrub sub-nodes) */}
      <PaneValidation node={node} validationHeight={validationHeight} onValidationResize={onValidationResize} onFindInPanes={onFindInPanes} />
    </div>
  );
}
