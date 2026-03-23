// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { PROMPT_CATALOG, type PromptCatalogEntry } from '../data/promptCatalog';

interface PromptsPanelProps {
  onSelectPrompt: (entry: PromptCatalogEntry | null) => void;
}

export function PromptsPanel({ onSelectPrompt }: PromptsPanelProps) {
  const { selectedNodeId, activeTab } = useTaxonomyStore();
  const selectedNode = useTaxonomyStore((s) => {
    if (!selectedNodeId) return null;
    for (const pov of ['accelerationist', 'safetyist', 'skeptic', 'crossCutting'] as const) {
      const key = pov === 'crossCutting' ? 'cross-cutting' : pov;
      const file = s[key as keyof typeof s] as { nodes: Array<{ id: string; label: string; description: string }> } | null;
      if (file) {
        const node = file.nodes.find(n => n.id === selectedNodeId);
        if (node) return node;
      }
    }
    return null;
  });

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectionTick, setSelectionTick] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const entries = PROMPT_CATALOG;

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, entries.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      }
    };
    const el = listRef.current;
    el?.addEventListener('keydown', handler);
    return () => el?.removeEventListener('keydown', handler);
  }, [entries.length]);

  // Notify parent of selection (selectionTick forces re-fire on re-click)
  useEffect(() => {
    const entry = entries[selectedIndex] ?? null;
    onSelectPrompt(entry);
  }, [selectedIndex, selectionTick, entries, onSelectPrompt]);

  // Auto-focus
  useEffect(() => {
    listRef.current?.focus();
  }, []);

  return (
    <div className="prompts-panel" ref={listRef} tabIndex={0}>
      <div className="prompts-panel-header">
        <span className="prompts-panel-title">Prompts</span>
        <span className="prompts-panel-count">{entries.length}</span>
      </div>
      {selectedNode && (
        <div className="prompts-panel-context">
          Selected: <strong>{selectedNode.label}</strong>
        </div>
      )}
      <div className="prompts-panel-list">
        {entries.map((entry, i) => (
          <div
            key={entry.id}
            className={`prompts-panel-item${i === selectedIndex ? ' selected' : ''}${entry.id === 'research' ? ' prompts-panel-research' : ''}`}
            onClick={() => { setSelectedIndex(i); setSelectionTick(t => t + 1); }}
          >
            <span className="prompts-panel-item-title">{entry.title}</span>
            <span className="prompts-panel-item-source">{entry.source}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface PromptDetailPanelProps {
  entry: PromptCatalogEntry | null;
}

export function PromptDetailPanel({ entry }: PromptDetailPanelProps) {
  const selectedNodeId = useTaxonomyStore((s) => s.selectedNodeId);
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    const s = useTaxonomyStore.getState();
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const file = s[pov];
      if (file) {
        const node = file.nodes.find(n => n.id === selectedNodeId);
        if (node) return node;
      }
    }
    const cc = s['cross-cutting'];
    if (cc) {
      const node = cc.nodes.find(n => n.id === selectedNodeId);
      if (node) return node;
    }
    return null;
  }, [selectedNodeId]);

  const [editText, setEditText] = useState('');
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Generate prompt text based on entry and selected node
  const generatePromptText = useCallback(() => {
    if (!entry) return '';
    if (entry.id === 'research') {
      if (!selectedNode) return '(Select a taxonomy node first, then select Research to generate a prompt)';
      return entry.generate!(selectedNode.label, selectedNode.description);
    }
    if (entry.generate && selectedNode) {
      return entry.generate(selectedNode.label, selectedNode.description);
    }
    return entry.template;
  }, [entry, selectedNode]);

  // Update edit text when entry or node changes; auto-copy & focus for Research
  useEffect(() => {
    const text = generatePromptText();
    setEditText(text);
    setCopied(false);
    // Auto-copy and focus textarea when Research generates a real prompt
    if (entry?.id === 'research' && selectedNode && text && !text.startsWith('(')) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [generatePromptText]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  if (!entry) {
    return <div className="detail-panel-empty">Select a prompt to view</div>;
  }

  return (
    <div className="prompt-detail">
      <div className="prompt-detail-header">
        <h2 className="prompt-detail-title">{entry.title}</h2>
        <div className="prompt-detail-actions">
          <button
            className={`btn btn-sm${copied ? '' : ' btn-ghost'}`}
            onClick={handleCopy}
          >
            {copied ? '\u2713 Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="prompt-detail-desc">{entry.description}</div>
      <div className="prompt-detail-editor">
        <textarea
          ref={textareaRef}
          className="prompt-detail-textarea"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
