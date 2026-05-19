// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { lineDiff } from '@lib/diff/lineDiff.js';
import type { DiffLine, DiffResult } from '@lib/diff/lineDiff.js';
import { PromptDiffTree, nodeKey } from './PromptDiffTree';
import type { PromptNode } from './PromptDiffTree';
import { PromptDiffPane } from './PromptDiffPane';
import type { PaneData } from './PromptDiffPane';
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

/** Compute diff-colored lines for each pane. Pane 0 = reference (plain lines), Pane N diffs against Pane N-1. */
function computePaneLines(nodes: PromptNode[]): PaneData[] {
  if (nodes.length === 0) return [];

  const result: PaneData[] = [];

  // Pane 0: reference — plain lines, no diff
  const refLines: DiffLine[] = nodes[0].prompt.split('\n').map((text, i) => ({
    type: 'same' as const,
    text,
    lineNumber: i + 1,
  }));
  result.push({ node: nodes[0], lines: refLines });

  // Pane 1+: diff against left neighbor
  for (let i = 1; i < nodes.length; i++) {
    const diff: DiffResult = lineDiff(nodes[i - 1].prompt, nodes[i].prompt);
    result.push({
      node: nodes[i],
      lines: diff.right,
      stats: diff.stats,
    });
    // Update left pane's lines to include ghost alignment from this diff
    result[i - 1] = { ...result[i - 1], lines: diff.left };
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

  const { debates, loadDebate } = useDebateStore(useShallow(s => ({
    debates: s.debates,
    loadDebate: s.loadDebate,
  })));

  // Load debate if needed
  useEffect(() => {
    if (initialDebateId && !(debates ?? []).find(d => d.id === initialDebateId)) {
      void loadDebate(initialDebateId);
    }
  }, [initialDebateId, debates, loadDebate]);

  const debate = (debates ?? []).find(d => d.id === initialDebateId);

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

  const addNode = useCallback((node: PromptNode) => {
    setPaneNodes(prev => {
      // Don't add duplicates
      const key = nodeKey(node.entryId, node.stage, node.attemptIndex);
      if (prev.some(n => nodeKey(n.entryId, n.stage, n.attemptIndex) === key)) return prev;
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

  const panes = useMemo(() => computePaneLines(paneNodes), [paneNodes]);

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
      if (e.key >= '1' && e.key <= '4') {
        const idx = parseInt(e.key) - 1;
        if (idx < paneNodes.length) setFocusedPane(idx);
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
      if (e.ctrlKey && e.key === 'g') {
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
  }, [paneNodes, focusedPane, closePane, syncScroll, outlineBlocks, scrollTop, panes]);

  // Window title
  useEffect(() => {
    if (debate && focusedEntryId) {
      const entry = debate.transcript.find(e => e.id === focusedEntryId);
      if (entry) {
        const idx = debate.transcript.indexOf(entry);
        document.title = `Prompt Diff — S${idx + 1} ${speakerLabel(entry.speaker)} (${entry.type})`;
      }
    }
  }, [debate, focusedEntryId]);

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
              ? nodeKey(paneNodes[paneNodes.length - 1].entryId, paneNodes[paneNodes.length - 1].stage, paneNodes[paneNodes.length - 1].attemptIndex)
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
              Click a prompt in the tree to add it to a pane
            </div>
          )}
          {panes.map((pane, i) => (
            <PromptDiffPane
              key={nodeKey(pane.node.entryId, pane.node.stage, pane.node.attemptIndex)}
              pane={pane}
              paneIndex={i}
              isReference={i === 0}
              isFocused={i === focusedPane}
              onClose={() => closePane(i)}
              onFocus={() => setFocusedPane(i)}
              onScroll={syncScroll ? handleScroll : undefined}
              scrollTop={syncScroll ? scrollTop : undefined}
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
        <span>{panes.length} prompt{panes.length !== 1 ? 's' : ''} loaded</span>
        {diffChain && <span>Diff: {diffChain}</span>}
        <span
          onClick={() => setSyncScroll(p => !p)}
          style={{ cursor: 'pointer', borderBottom: '1px dotted var(--text-muted)' }}
          title="Ctrl+S to toggle"
        >
          Scroll sync: {syncScroll ? 'ON' : 'OFF'}
        </span>
      </div>
    </div>
  );
}
