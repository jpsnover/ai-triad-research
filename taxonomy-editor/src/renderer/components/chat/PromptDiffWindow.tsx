// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Dispatch, SetStateAction, RefObject } from 'react';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { lineDiff } from '@lib/diff/lineDiff.js';
import type { DiffLine, DiffResult } from '@lib/diff/lineDiff.js';
import { PromptDiffTree, nodeKey } from './PromptDiffTree';
import type { PromptNode, DiffViewMode } from './PromptDiffTree';
import { PromptDiffPane } from './PromptDiffPane';
import type { PaneData, PaneDiffLine } from './PromptDiffPane';
import { POVER_INFO } from '../../types/debate';
import type { SpeakerId, DebateSession } from '../../types/debate';
import './PromptDiffWindow.css';

const MAX_PANES = 4;

function parseHashParams(): { debateId: string; entryId: string } {
  const hash = window.location.hash;
  const q = hash.indexOf('?');
  if (q < 0) return { debateId: '', entryId: '' };
  const params = new URLSearchParams(hash.slice(q + 1));
  return {
    debateId: params.get('debateId') ?? '',
    entryId: params.get('entryId') ?? '',
  };
}

function speakerLabel(speaker: string): string {
  return POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label ?? speaker;
}

/** Get the text content from a node based on the current view mode and pre-scrub state. */
function getNodeText(node: PromptNode, mode: DiffViewMode, preScrub?: boolean): string {
  if (mode === 'responses' && preScrub && node.citationResolution?.scrub_original) {
    return node.citationResolution.scrub_original;
  }
  return mode === 'responses' ? node.response : node.prompt;
}

/** Compute diff-colored lines for each pane. Pane 0 = reference (plain lines), Pane N diffs against Pane N-1. */
function computePaneLines(nodes: PromptNode[], mode: DiffViewMode, preScrubPanes?: Set<number>): PaneData[] {
  if (nodes.length === 0) return [];

  const result: PaneData[] = [];

  // Pane 0: reference — plain lines, no diff
  const refText = getNodeText(nodes[0], mode, preScrubPanes?.has(0));
  const refLines: DiffLine[] = refText.split('\n').map((text, i) => ({
    type: 'same' as const,
    text,
    lineNumber: i + 1,
  }));
  result.push({ node: nodes[0], lines: refLines });

  // Pane 1+: diff against left neighbor
  for (let i = 1; i < nodes.length; i++) {
    const diff: DiffResult = lineDiff(getNodeText(nodes[i - 1], mode, preScrubPanes?.has(i - 1)), getNodeText(nodes[i], mode, preScrubPanes?.has(i)));
    // Annotate paired removed/added lines with counterpart text for word-level diffing
    const leftLines: PaneDiffLine[] = diff.left.map((line, j) => {
      if (line.type === 'removed' && j < diff.right.length && diff.right[j].type === 'added') {
        return { ...line, pairText: diff.right[j].text };
      }
      return line;
    });
    const rightLines: PaneDiffLine[] = diff.right.map((line, j) => {
      if (line.type === 'added' && j < diff.left.length && diff.left[j].type === 'removed') {
        return { ...line, pairText: diff.left[j].text };
      }
      return line;
    });
    result.push({
      node: nodes[i],
      lines: rightLines,
      stats: diff.stats,
    });
    // Update left pane's lines to include ghost alignment from this diff
    result[i - 1] = { ...result[i - 1], lines: leftLines };
  }

  return result;
}

/** Build diff blocks (contiguous added/removed regions) for the outline sidebar. */
function buildDiffBlocks(lines: DiffLine[]): { startFrac: number; endFrac: number; type: 'added' | 'removed' }[] {
  if (lines.length === 0) return [];
  const blocks: { startFrac: number; endFrac: number; type: 'added' | 'removed' }[] = [];
  let blockStart = -1;
  let blockType: 'added' | 'removed' | null = null;
  for (let i = 0; i <= lines.length; i++) {
    const t = i < lines.length ? lines[i].type : 'same';
    const isBlock = t === 'added' || t === 'removed';
    if (isBlock && blockType === t) continue;
    if (blockType && blockStart >= 0) {
      blocks.push({
        startFrac: blockStart / lines.length,
        endFrac: i / lines.length,
        type: blockType,
      });
    }
    if (isBlock) {
      blockStart = i;
      blockType = t as 'added' | 'removed';
    } else {
      blockStart = -1;
      blockType = null;
    }
  }
  return blocks;
}

type DiffBlock = { startFrac: number; endFrac: number; type: 'added' | 'removed' };

/** Context passed to the keyboard-shortcut helpers. */
interface KeyboardShortcutCtx {
  searchOpen: boolean;
  totalMatches: number;
  paneNodes: PromptNode[];
  focusedPane: number;
  outlineBlocks: DiffBlock[];
  panes: PaneData[];
  scrollTop: number;
  focusSearchInput: () => void;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  setSearchTerm: Dispatch<SetStateAction<string>>;
  setActiveMatchIndex: Dispatch<SetStateAction<number>>;
  setFocusedPane: Dispatch<SetStateAction<number>>;
  setWordWrap: Dispatch<SetStateAction<boolean>>;
  closePane: (index: number) => void;
  setSyncScroll: Dispatch<SetStateAction<boolean>>;
  setScrollTop: Dispatch<SetStateAction<number>>;
}

/** Search-related keyboard shortcuts (Ctrl+F, Escape, F3/Ctrl+G). Returns true if handled. */
function handleSearchKeys(e: KeyboardEvent, ctx: KeyboardShortcutCtx): boolean {
  // Search shortcuts
  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault();
    ctx.setSearchOpen(true);
    setTimeout(() => ctx.focusSearchInput(), 0);
    return true;
  }
  if (e.key === 'Escape' && ctx.searchOpen) {
    ctx.setSearchOpen(false);
    ctx.setSearchTerm('');
    ctx.setActiveMatchIndex(0);
    return true;
  }
  if (e.key === 'F3' || (e.ctrlKey && e.key === 'g' && ctx.searchOpen)) {
    e.preventDefault();
    if (ctx.totalMatches > 0) {
      ctx.setActiveMatchIndex(prev => e.shiftKey ? (prev - 1 + ctx.totalMatches) % ctx.totalMatches : (prev + 1) % ctx.totalMatches);
    }
    return true;
  }
  return false;
}

/** Number keys 1-4 focus the corresponding pane (only when search input not focused). Returns true if handled. */
function handlePaneFocusKeys(e: KeyboardEvent, ctx: KeyboardShortcutCtx): boolean {
  // Pane focus (only when search input not focused)
  if (e.key >= '1' && e.key <= '4' && document.activeElement?.tagName !== 'INPUT') {
    const idx = parseInt(e.key) - 1;
    if (idx < ctx.paneNodes.length) ctx.setFocusedPane(idx);
    return true;
  }
  return false;
}

/** Toggle shortcuts: word wrap, close pane, scroll sync, fullscreen. Returns true if handled. */
function handleToggleKeys(e: KeyboardEvent, ctx: KeyboardShortcutCtx): boolean {
  if (e.ctrlKey && e.shiftKey && (e.key === 'W' || e.key === 'w')) {
    e.preventDefault();
    ctx.setWordWrap(p => !p);
    return true;
  }
  if (e.ctrlKey && e.key === 'w') {
    e.preventDefault();
    if (ctx.paneNodes.length > 0) ctx.closePane(ctx.focusedPane);
    return true;
  }
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    ctx.setSyncScroll(p => !p);
    return true;
  }
  if (e.key === 'F11') {
    e.preventDefault();
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
    return true;
  }
  return false;
}

/** Ctrl+G (with search closed) jumps to the next/prev diff block in the outline. */
function handleDiffJumpKeys(e: KeyboardEvent, ctx: KeyboardShortcutCtx): void {
  if (e.ctrlKey && e.key === 'g' && !ctx.searchOpen) {
    e.preventDefault();
    // Jump to next/prev diff block
    const blocks = ctx.outlineBlocks;
    if (blocks.length === 0) return;
    const totalLines = ctx.panes.length > 0 ? ctx.panes[ctx.panes.length - 1].lines.length : 0;
    const currentLine = ctx.scrollTop / 18; // approx
    const currentFrac = currentLine / Math.max(1, totalLines);
    if (e.shiftKey) {
      // Previous block
      const prev = blocks.filter(b => b.startFrac < currentFrac - 0.01);
      const target = prev.length > 0 ? prev[prev.length - 1] : blocks[blocks.length - 1];
      ctx.setScrollTop(target.startFrac * totalLines * 18);
    } else {
      // Next block
      const next = blocks.find(b => b.startFrac > currentFrac + 0.01);
      const target = next ?? blocks[0];
      ctx.setScrollTop(target.startFrac * totalLines * 18);
    }
  }
}

/** Toolbar: view-mode toggle (prompts/responses) and word-wrap toggle. */
function PromptDiffToolbar({ viewMode, setViewMode, wordWrap, setWordWrap }: {
  viewMode: DiffViewMode;
  setViewMode: Dispatch<SetStateAction<DiffViewMode>>;
  wordWrap: boolean;
  setWordWrap: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <div className="pdw-toolbar">
      <span className="pdw-title">Prompt Diff</span>
      <div className="pdw-toggle-group">
        {(['prompts', 'responses'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className="pdw-mode-btn"
            /* eslint-disable-next-line local/no-inline-style -- dynamic: active-state background/color */
            style={{
              background: viewMode === mode ? '#3b82f6' : 'var(--bg-primary)',
              color: viewMode === mode ? '#fff' : 'var(--text-muted)',
            }}
          >
            {mode}
          </button>
        ))}
      </div>
      <button
        onClick={() => setWordWrap(p => !p)}
        className="pdw-wrap-btn"
        /* eslint-disable-next-line local/no-inline-style -- dynamic: active-state background/color */
        style={{
          background: wordWrap ? '#3b82f6' : 'var(--bg-primary)',
          color: wordWrap ? '#fff' : 'var(--text-muted)',
        }}
        title="Toggle word wrap (Ctrl+Shift+W)"
      >
        Wrap
      </button>
    </div>
  );
}

/** Search bar — visible only when search is open. */
function PromptDiffSearchBar({
  searchOpen, searchInputRef, searchTerm, setSearchTerm, setActiveMatchIndex,
  totalMatches, activeMatchIndex, viewMode, setSearchOpen,
}: {
  searchOpen: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchTerm: string;
  setSearchTerm: Dispatch<SetStateAction<string>>;
  setActiveMatchIndex: Dispatch<SetStateAction<number>>;
  totalMatches: number;
  activeMatchIndex: number;
  viewMode: DiffViewMode;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
}) {
  if (!searchOpen) return null;
  return (
    <div className="pdw-search-bar">
      <input
        ref={searchInputRef}
        type="text"
        value={searchTerm}
        onChange={(e) => { setSearchTerm(e.target.value); setActiveMatchIndex(0); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (totalMatches > 0) {
              setActiveMatchIndex(prev => e.shiftKey ? (prev - 1 + totalMatches) % totalMatches : (prev + 1) % totalMatches);
            }
          }
          if (e.key === 'Escape') {
            setSearchOpen(false);
            setSearchTerm('');
            setActiveMatchIndex(0);
          }
        }}
        placeholder={`Search ${viewMode}... (F3 next, Shift+F3 prev)`}
        className="pdw-search-input"
      />
      {searchTerm && (
        <span
          className="pdw-match-count"
          /* eslint-disable-next-line local/no-inline-style -- dynamic: color depends on match count */
          style={{ color: totalMatches > 0 ? 'var(--text-primary)' : '#ef4444' }}
        >
          {totalMatches > 0 ? `${activeMatchIndex + 1} of ${totalMatches}` : 'No matches'}
        </span>
      )}
      <button
        onClick={() => totalMatches > 0 && setActiveMatchIndex(prev => (prev - 1 + totalMatches) % totalMatches)}
        disabled={totalMatches === 0}
        className="pdw-search-nav-btn"
        title="Previous (Shift+F3)"
        aria-label="Previous match"
      >&#9650;</button>
      <button
        onClick={() => totalMatches > 0 && setActiveMatchIndex(prev => (prev + 1) % totalMatches)}
        disabled={totalMatches === 0}
        className="pdw-search-nav-btn"
        title="Next (F3)"
        aria-label="Next match"
      >&#9660;</button>
      <button
        onClick={() => { setSearchOpen(false); setSearchTerm(''); setActiveMatchIndex(0); }}
        className="pdw-search-close-btn"
        title="Close (Esc)"
        aria-label="Close"
      >&times;</button>
    </div>
  );
}

/** Status bar — pane count, diff chain, scroll-sync toggle, search launcher. */
function PromptDiffStatusBar({ panes, viewMode, syncScroll, setSyncScroll, searchOpen, setSearchOpen, searchInputRef }: {
  panes: PaneData[];
  viewMode: DiffViewMode;
  syncScroll: boolean;
  setSyncScroll: Dispatch<SetStateAction<boolean>>;
  searchOpen: boolean;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  searchInputRef: RefObject<HTMLInputElement | null>;
}) {
  // Diff chain description for status bar
  const diffChain = panes.length >= 2
    ? panes.slice(1).map((_, i) => `Pane ${i + 2} vs Pane ${i + 1}`).join(', ')
    : '';

  return (
    <div className="pdw-status-bar">
      <span>{panes.length} {viewMode === 'responses' ? 'response' : 'prompt'}{panes.length !== 1 ? 's' : ''} loaded</span>
      {diffChain && <span>Diff: {diffChain}</span>}
      <span
        onClick={() => setSyncScroll(p => !p)}
        className="pdw-status-link"
        title="Ctrl+S to toggle"
      >
        Scroll sync: {syncScroll ? 'ON' : 'OFF'}
      </span>
      {!searchOpen && (
        <span
          onClick={() => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0); }}
          className="pdw-status-link"
          title="Ctrl+F to search"
        >
          Search
        </span>
      )}
    </div>
  );
}

/** Embeddable prompt diff content — used both in standalone window and DiagnosticsWindow tab. */
export function PromptDiffContent({ debate, focusedEntryId: externalFocusedEntryId, embedded }: { debate: DebateSession | null; focusedEntryId?: string; embedded?: boolean }) {
  const [focusedEntryId, setFocusedEntryId] = useState(externalFocusedEntryId ?? '');

  // Sync when parent changes the focused entry
  useEffect(() => {
    if (externalFocusedEntryId) setFocusedEntryId(externalFocusedEntryId);
  }, [externalFocusedEntryId]);

  // Pane state
  const [paneNodes, setPaneNodes] = useState<PromptNode[]>([]);
  const [focusedPane, setFocusedPane] = useState(0);
  const [syncScroll, setSyncScroll] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);

  // View mode: prompts vs responses
  const [viewMode, setViewMode] = useState<DiffViewMode>('prompts');

  // Word wrap
  const [wordWrap, setWordWrap] = useState(false);

  // Pre-scrub state: set of pane indices showing pre-scrub text
  const [preScrubPanes, setPreScrubPanes] = useState<Set<number>>(new Set());

  // Shared validation panel height (synced across all panes)
  const [validationHeight, setValidationHeight] = useState(350);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const findInPanes = useCallback((text: string) => {
    setSearchTerm(text);
    setSearchOpen(true);
    setActiveMatchIndex(0);
    // Focus the search input after state updates
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  const addNode = useCallback((node: PromptNode) => {
    setPaneNodes(prev => {
      // Don't add duplicates
      const key = nodeKey(node.entryId, node.stage, node.runIndex, node.kind, node.toolCallIndex);
      if (prev.some(n => nodeKey(n.entryId, n.stage, n.runIndex, n.kind, n.toolCallIndex) === key)) return prev;
      if (prev.length >= MAX_PANES) {
        // Replace rightmost
        return [...prev.slice(0, MAX_PANES - 1), node];
      }
      return [...prev, node];
    });
  }, []);

  const closePane = useCallback((index: number) => {
    setPaneNodes(prev => prev.filter((_, i) => i !== index));
    setFocusedPane(p => Math.min(p, Math.max(0, paneNodes.length - 2)));
    // Clear pre-scrub for closed pane and shift indices
    setPreScrubPanes(prev => {
      const next = new Set<number>();
      for (const pi of prev) {
        if (pi < index) next.add(pi);
        else if (pi > index) next.add(pi - 1);
      }
      return next;
    });
  }, [paneNodes.length]);

  const handleScroll = useCallback((st: number) => {
    if (syncScroll) setScrollTop(st);
  }, [syncScroll]);

  const panes = useMemo(() => computePaneLines(paneNodes, viewMode, preScrubPanes), [paneNodes, viewMode, preScrubPanes]);

  // Search: compute match counts per pane and cumulative offsets
  const searchLower = searchTerm.toLowerCase();
  const { paneMatchCounts, paneMatchOffsets, totalMatches } = useMemo(() => {
    if (!searchLower) return { paneMatchCounts: [] as number[], paneMatchOffsets: [] as number[], totalMatches: 0 };
    const counts: number[] = [];
    const offsets: number[] = [];
    let cumulative = 0;
    for (const pane of panes) {
      offsets.push(cumulative);
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
      counts.push(count);
      cumulative += count;
    }
    return { paneMatchCounts: counts, paneMatchOffsets: offsets, totalMatches: cumulative };
  }, [panes, searchLower]);

  // Outline sidebar — use rightmost diff
  const outlineBlocks = useMemo(() => {
    if (panes.length < 2) return [];
    return buildDiffBlocks(panes[panes.length - 1].lines);
  }, [panes]);

  const contentRef = useRef<HTMLDivElement>(null);
  const viewportFrac = useMemo(() => {
    if (!contentRef.current || panes.length === 0) return { top: 0, height: 0.1 };
    const el = contentRef.current;
    const total = Math.max(1, panes[panes.length - 1]?.lines.length ?? 1) * 18; // approx line height
    return {
      top: scrollTop / total,
      height: Math.min(1, el.clientHeight / total),
    };
  }, [scrollTop, panes]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctx: KeyboardShortcutCtx = {
        searchOpen, totalMatches, paneNodes, focusedPane, outlineBlocks, panes, scrollTop,
        focusSearchInput: () => searchInputRef.current?.focus(),
        setSearchOpen, setSearchTerm, setActiveMatchIndex, setFocusedPane,
        setWordWrap, closePane, setSyncScroll, setScrollTop,
      };
      if (handleSearchKeys(e, ctx)) return;
      if (handlePaneFocusKeys(e, ctx)) return;
      if (handleToggleKeys(e, ctx)) return;
      handleDiffJumpKeys(e, ctx);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [paneNodes, focusedPane, closePane, syncScroll, searchOpen, totalMatches, outlineBlocks, scrollTop, panes]);

  // Window title (standalone mode only)
  useEffect(() => {
    if (embedded) return;
    if (debate && focusedEntryId) {
      const entry = debate.transcript.find(e => e.id === focusedEntryId);
      if (entry) {
        const idx = debate.transcript.indexOf(entry);
        const modeLabel = viewMode === 'responses' ? 'Response Diff' : 'Prompt Diff';
        document.title = `${modeLabel} — S${idx + 1} ${speakerLabel(entry.speaker)} (${entry.type})`;
      }
    }
  }, [debate, focusedEntryId, viewMode, embedded]);

  if (!debate) {
    return (
      <div className="pdw-loading">
        Loading debate...
      </div>
    );
  }

  return (
    <div
      className="pdw-root"
      /* eslint-disable-next-line local/no-inline-style -- dynamic: height/flex depend on embedded */
      style={{ height: embedded ? '100%' : '100vh', flex: embedded ? 1 : undefined }}
    >
      {/* Toolbar */}
      <PromptDiffToolbar
        viewMode={viewMode}
        setViewMode={setViewMode}
        wordWrap={wordWrap}
        setWordWrap={setWordWrap}
      />

      {/* Search bar */}
      <PromptDiffSearchBar
        searchOpen={searchOpen}
        searchInputRef={searchInputRef}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        setActiveMatchIndex={setActiveMatchIndex}
        totalMatches={totalMatches}
        activeMatchIndex={activeMatchIndex}
        viewMode={viewMode}
        setSearchOpen={setSearchOpen}
      />

      {/* Main area: tree + panes + outline */}
      <div className="pdw-main">
        {/* Tree (left) */}
        <div className="pdw-tree">
          <PromptDiffTree
            debate={debate}
            focusedEntryId={focusedEntryId}
            onSelectNode={addNode}
            selectedNodeKey={paneNodes.length > 0
              ? nodeKey(paneNodes[paneNodes.length - 1].entryId, paneNodes[paneNodes.length - 1].stage, paneNodes[paneNodes.length - 1].runIndex, paneNodes[paneNodes.length - 1].kind, paneNodes[paneNodes.length - 1].toolCallIndex)
              : undefined}
          />
        </div>

        {/* Panes (center) */}
        <div ref={contentRef} className="pdw-panes">
          {panes.length === 0 && (
            <div className="pdw-empty">
              Click a node in the tree to add its {viewMode === 'responses' ? 'response' : 'prompt'} to a pane
            </div>
          )}
          {panes.map((pane, i) => (
            <PromptDiffPane
              key={nodeKey(pane.node.entryId, pane.node.stage, pane.node.runIndex, pane.node.kind, pane.node.toolCallIndex)}
              pane={pane}
              paneIndex={i}
              isReference={i === 0}
              isFocused={i === focusedPane}
              onClose={() => closePane(i)}
              onFocus={() => setFocusedPane(i)}
              onScroll={syncScroll ? handleScroll : undefined}
              scrollTop={syncScroll ? scrollTop : undefined}
              searchTerm={searchTerm}
              activeMatchIndex={activeMatchIndex}
              matchOffset={paneMatchOffsets[i]}
              viewMode={viewMode}
              wordWrap={wordWrap}
              validationHeight={validationHeight}
              onValidationResize={setValidationHeight}
              onFindInPanes={findInPanes}
              preScrub={preScrubPanes.has(i)}
              onTogglePreScrub={() => setPreScrubPanes(prev => {
                const next = new Set(prev);
                if (next.has(i)) next.delete(i); else next.add(i);
                return next;
              })}
            />
          ))}
        </div>

        {/* Outline sidebar (far right) */}
        {panes.length >= 2 && (
          <div className="pdw-outline">
            {outlineBlocks.map((block, i) => (
              <div
                key={i}
                onClick={() => {
                  const totalLines = panes[panes.length - 1].lines.length;
                  setScrollTop(block.startFrac * totalLines * 18);
                }}
                className="pdw-outline-block"
                /* eslint-disable-next-line local/no-inline-style -- dynamic: top/height/background from block fractions and type */
                style={{
                  top: `${block.startFrac * 100}%`,
                  height: `${Math.max(2, (block.endFrac - block.startFrac) * 100)}%`,
                  background: block.type === 'added' ? 'rgba(234,179,8,0.6)' : 'rgba(239,68,68,0.6)',
                }}
                title={`${block.type}: click to jump`}
              />
            ))}
            {/* Viewport overlay */}
            <div
              className="pdw-viewport-overlay"
              /* eslint-disable-next-line local/no-inline-style -- dynamic: top/height from viewport fractions */
              style={{
                top: `${viewportFrac.top * 100}%`,
                height: `${Math.max(3, viewportFrac.height * 100)}%`,
              }}
            />
          </div>
        )}
      </div>

      {/* Status bar */}
      <PromptDiffStatusBar
        panes={panes}
        viewMode={viewMode}
        syncScroll={syncScroll}
        setSyncScroll={setSyncScroll}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        searchInputRef={searchInputRef}
      />
    </div>
  );
}

/** Standalone window wrapper — loads debate from hash params and renders PromptDiffContent. */
export function PromptDiffWindow() {
  const { debateId: initialDebateId, entryId: initialEntryId } = parseHashParams();

  const { activeDebate, loadDebate } = useDebateStore(useShallow(s => ({
    activeDebate: s.activeDebate,
    loadDebate: s.loadDebate,
  })));

  // Load debate if needed
  useEffect(() => {
    if (initialDebateId && activeDebate?.id !== initialDebateId) {
      void loadDebate(initialDebateId);
    }
  }, [initialDebateId, activeDebate?.id, loadDebate]);

  const debate = activeDebate?.id === initialDebateId ? activeDebate : null;

  const [focusedEntryId, setFocusedEntryId] = useState(initialEntryId);

  // Listen for context updates from Electron (when window is reused)
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).electronAPI) {
      const eApi = (window as unknown as Record<string, unknown>).electronAPI as {
        onPromptDiffContext?: (cb: (ctx: { debateId: string; entryId: string }) => void) => void;
      };
      eApi.onPromptDiffContext?.((ctx) => {
        setFocusedEntryId(ctx.entryId);
        if (ctx.debateId !== initialDebateId) {
          void loadDebate(ctx.debateId);
        }
      });
    }
  }, [initialDebateId, loadDebate]);

  return <PromptDiffContent debate={debate} focusedEntryId={focusedEntryId} />;
}
