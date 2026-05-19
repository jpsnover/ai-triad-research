// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { lineDiff } from '@lib/diff/lineDiff.js';
import type { DiffLine, DiffResult } from '@lib/diff/lineDiff.js';
import { PromptDiffTree, nodeKey } from './PromptDiffTree';
import type { PromptNode, DiffViewMode } from './PromptDiffTree';
import { PromptDiffPane } from './PromptDiffPane';
import type { PaneData, PaneDiffLine } from './PromptDiffPane';
import { POVER_INFO } from '../types/debate';
import type { SpeakerId } from '../types/debate';

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

/** Get the text content from a node based on the current view mode. */
function getNodeText(node: PromptNode, mode: DiffViewMode): string {
  return mode === 'responses' ? node.response : node.prompt;
}

/** Compute diff-colored lines for each pane. Pane 0 = reference (plain lines), Pane N diffs against Pane N-1. */
function computePaneLines(nodes: PromptNode[], mode: DiffViewMode): PaneData[] {
  if (nodes.length === 0) return [];

  const result: PaneData[] = [];

  // Pane 0: reference — plain lines, no diff
  const refText = getNodeText(nodes[0], mode);
  const refLines: DiffLine[] = refText.split('\n').map((text, i) => ({
    type: 'same' as const,
    text,
    lineNumber: i + 1,
  }));
  result.push({ node: nodes[0], lines: refLines });

  // Pane 1+: diff against left neighbor
  for (let i = 1; i < nodes.length; i++) {
    const diff: DiffResult = lineDiff(getNodeText(nodes[i - 1], mode), getNodeText(nodes[i], mode));
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

export function PromptDiffWindow() {
  const { debateId: initialDebateId, entryId: initialEntryId } = parseHashParams();
  const [focusedEntryId, setFocusedEntryId] = useState(initialEntryId);

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

  // Listen for context updates from Electron (when window is reused)
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as Record<string, unknown>).electronAPI) {
      const api = (window as Record<string, unknown>).electronAPI as {
        onPromptDiffContext?: (cb: (ctx: { debateId: string; entryId: string }) => void) => void;
      };
      api.onPromptDiffContext?.((ctx) => {
        setFocusedEntryId(ctx.entryId);
        if (ctx.debateId !== initialDebateId) {
          void loadDebate(ctx.debateId);
        }
      });
    }
  }, [initialDebateId, loadDebate]);

  // Pane state
  const [paneNodes, setPaneNodes] = useState<PromptNode[]>([]);
  const [focusedPane, setFocusedPane] = useState(0);
  const [syncScroll, setSyncScroll] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);

  // View mode: prompts vs responses
  const [viewMode, setViewMode] = useState<DiffViewMode>('prompts');

  // Word wrap
  const [wordWrap, setWordWrap] = useState(false);

  // Shared validation panel height (synced across all panes)
  const [validationHeight, setValidationHeight] = useState(150);

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
      const key = nodeKey(node.entryId, node.stage, node.runIndex);
      if (prev.some(n => nodeKey(n.entryId, n.stage, n.runIndex) === key)) return prev;
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
  }, [paneNodes.length]);

  const handleScroll = useCallback((st: number) => {
    if (syncScroll) setScrollTop(st);
  }, [syncScroll]);

  const panes = useMemo(() => computePaneLines(paneNodes, viewMode), [paneNodes, viewMode]);

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
      // Search shortcuts
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
        setSearchTerm('');
        setActiveMatchIndex(0);
        return;
      }
      if (e.key === 'F3' || (e.ctrlKey && e.key === 'g' && searchOpen)) {
        e.preventDefault();
        if (totalMatches > 0) {
          setActiveMatchIndex(prev => e.shiftKey ? (prev - 1 + totalMatches) % totalMatches : (prev + 1) % totalMatches);
        }
        return;
      }
      // Pane focus (only when search input not focused)
      if (e.key >= '1' && e.key <= '4' && document.activeElement?.tagName !== 'INPUT') {
        const idx = parseInt(e.key) - 1;
        if (idx < paneNodes.length) setFocusedPane(idx);
        return;
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'W' || e.key === 'w')) {
        e.preventDefault();
        setWordWrap(p => !p);
        return;
      }
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        if (paneNodes.length > 0) closePane(focusedPane);
        return;
      }
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        setSyncScroll(p => !p);
        return;
      }
      if (e.key === 'F11') {
        e.preventDefault();
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else {
          void document.documentElement.requestFullscreen();
        }
        return;
      }
      if (e.ctrlKey && e.key === 'g' && !searchOpen) {
        e.preventDefault();
        // Jump to next/prev diff block
        const blocks = outlineBlocks;
        if (blocks.length === 0) return;
        const totalLines = panes.length > 0 ? panes[panes.length - 1].lines.length : 0;
        const currentLine = scrollTop / 18; // approx
        const currentFrac = currentLine / Math.max(1, totalLines);
        if (e.shiftKey) {
          // Previous block
          const prev = blocks.filter(b => b.startFrac < currentFrac - 0.01);
          const target = prev.length > 0 ? prev[prev.length - 1] : blocks[blocks.length - 1];
          setScrollTop(target.startFrac * totalLines * 18);
        } else {
          // Next block
          const next = blocks.find(b => b.startFrac > currentFrac + 0.01);
          const target = next ?? blocks[0];
          setScrollTop(target.startFrac * totalLines * 18);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [paneNodes, focusedPane, closePane, syncScroll, searchOpen, totalMatches, outlineBlocks, scrollTop, panes]);

  // Window title
  useEffect(() => {
    if (debate && focusedEntryId) {
      const entry = debate.transcript.find(e => e.id === focusedEntryId);
      if (entry) {
        const idx = debate.transcript.indexOf(entry);
        const modeLabel = viewMode === 'responses' ? 'Response Diff' : 'Prompt Diff';
        document.title = `${modeLabel} — S${idx + 1} ${speakerLabel(entry.speaker)} (${entry.type})`;
      }
    }
  }, [debate, focusedEntryId, viewMode]);

  if (!debate) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
        Loading debate...
      </div>
    );
  }

  // Diff chain description for status bar
  const diffChain = panes.length >= 2
    ? panes.slice(1).map((_, i) => `Pane ${i + 2} vs Pane ${i + 1}`).join(', ')
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* Toolbar */}
      <div style={{
        borderBottom: '1px solid var(--border-color)',
        padding: '4px 12px',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--bg-secondary)',
        flexShrink: 0,
        fontSize: '0.7rem',
      }}>
        <span style={{ fontWeight: 600, fontSize: '0.72rem' }}>Prompt Diff</span>
        <div style={{
          display: 'inline-flex', borderRadius: 4, overflow: 'hidden',
          border: '1px solid var(--border-color)',
        }}>
          {(['prompts', 'responses'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '2px 10px',
                border: 'none', cursor: 'pointer',
                fontSize: '0.65rem', fontWeight: 600,
                textTransform: 'capitalize',
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
          style={{
            padding: '2px 8px', borderRadius: 4,
            border: '1px solid var(--border-color)',
            cursor: 'pointer',
            fontSize: '0.65rem', fontWeight: 600,
            background: wordWrap ? '#3b82f6' : 'var(--bg-primary)',
            color: wordWrap ? '#fff' : 'var(--text-muted)',
          }}
          title="Toggle word wrap (Ctrl+Shift+W)"
        >
          Wrap
        </button>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div style={{
          borderBottom: '1px solid var(--border-color)',
          padding: '4px 12px',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-secondary)',
          flexShrink: 0,
          fontSize: '0.7rem',
        }}>
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
            style={{
              flex: 1, maxWidth: 300, padding: '2px 8px',
              border: '1px solid var(--border-color)', borderRadius: 3,
              background: 'var(--bg-primary)', color: 'var(--text-primary)',
              fontSize: '0.7rem', fontFamily: 'inherit', outline: 'none',
            }}
          />
          {searchTerm && (
            <span style={{ color: totalMatches > 0 ? 'var(--text-primary)' : '#ef4444', fontSize: '0.65rem' }}>
              {totalMatches > 0 ? `${activeMatchIndex + 1} of ${totalMatches}` : 'No matches'}
            </span>
          )}
          <button
            onClick={() => totalMatches > 0 && setActiveMatchIndex(prev => (prev - 1 + totalMatches) % totalMatches)}
            disabled={totalMatches === 0}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 4px' }}
            title="Previous (Shift+F3)"
          >&#9650;</button>
          <button
            onClick={() => totalMatches > 0 && setActiveMatchIndex(prev => (prev + 1) % totalMatches)}
            disabled={totalMatches === 0}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 4px' }}
            title="Next (F3)"
          >&#9660;</button>
          <button
            onClick={() => { setSearchOpen(false); setSearchTerm(''); setActiveMatchIndex(0); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0 4px' }}
            title="Close (Esc)"
          >&times;</button>
        </div>
      )}

      {/* Main area: tree + panes + outline */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Tree (left) */}
        <div style={{
          width: 240, minWidth: 180, maxWidth: 350,
          borderRight: '1px solid var(--border-color)',
          overflowY: 'auto', flexShrink: 0,
        }}>
          <PromptDiffTree
            debate={debate}
            focusedEntryId={focusedEntryId}
            onSelectNode={addNode}
            selectedNodeKey={paneNodes.length > 0
              ? nodeKey(paneNodes[paneNodes.length - 1].entryId, paneNodes[paneNodes.length - 1].stage, paneNodes[paneNodes.length - 1].runIndex)
              : undefined}
          />
        </div>

        {/* Panes (center) */}
        <div ref={contentRef} style={{ flex: 1, display: 'flex', gap: 2, padding: 2, overflow: 'hidden' }}>
          {panes.length === 0 && (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', fontSize: '0.8rem',
            }}>
              Click a node in the tree to add its {viewMode === 'responses' ? 'response' : 'prompt'} to a pane
            </div>
          )}
          {panes.map((pane, i) => (
            <PromptDiffPane
              key={nodeKey(pane.node.entryId, pane.node.stage, pane.node.runIndex)}
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
            />
          ))}
        </div>

        {/* Outline sidebar (far right) */}
        {panes.length >= 2 && (
          <div style={{
            width: 20, flexShrink: 0,
            borderLeft: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
            position: 'relative', cursor: 'pointer',
          }}>
            {outlineBlocks.map((block, i) => (
              <div
                key={i}
                onClick={() => {
                  const totalLines = panes[panes.length - 1].lines.length;
                  setScrollTop(block.startFrac * totalLines * 18);
                }}
                style={{
                  position: 'absolute',
                  top: `${block.startFrac * 100}%`,
                  height: `${Math.max(2, (block.endFrac - block.startFrac) * 100)}%`,
                  left: 2, right: 2,
                  background: block.type === 'added' ? 'rgba(234,179,8,0.6)' : 'rgba(239,68,68,0.6)',
                  borderRadius: 1,
                }}
                title={`${block.type}: click to jump`}
              />
            ))}
            {/* Viewport overlay */}
            <div style={{
              position: 'absolute',
              top: `${viewportFrac.top * 100}%`,
              height: `${Math.max(3, viewportFrac.height * 100)}%`,
              left: 0, right: 0,
              background: 'rgba(59,130,246,0.2)',
              border: '1px solid rgba(59,130,246,0.4)',
              pointerEvents: 'none',
            }} />
          </div>
        )}
      </div>

      {/* Status bar */}
      <div style={{
        borderTop: '1px solid var(--border-color)',
        padding: '3px 12px',
        fontSize: '0.62rem',
        color: 'var(--text-muted)',
        display: 'flex', gap: 16,
        background: 'var(--bg-secondary)',
        flexShrink: 0,
      }}>
        <span>{panes.length} {viewMode === 'responses' ? 'response' : 'prompt'}{panes.length !== 1 ? 's' : ''} loaded</span>
        {diffChain && <span>Diff: {diffChain}</span>}
        <span
          onClick={() => setSyncScroll(p => !p)}
          style={{ cursor: 'pointer', borderBottom: '1px dotted var(--text-muted)' }}
          title="Ctrl+S to toggle"
        >
          Scroll sync: {syncScroll ? 'ON' : 'OFF'}
        </span>
        {!searchOpen && (
          <span
            onClick={() => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0); }}
            style={{ cursor: 'pointer', borderBottom: '1px dotted var(--text-muted)' }}
            title="Ctrl+F to search"
          >
            Search
          </span>
        )}
      </div>
    </div>
  );
}
