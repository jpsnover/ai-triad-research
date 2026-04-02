// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useCallback, useRef } from 'react';
import { FALLACY_CATALOG, type FallacyEntry } from '../data/fallacyInfo';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';

const CATEGORY_LABELS: Record<string, string> = {
  informal: 'Informal',
  formal: 'Formal',
  cognitive_bias: 'Cognitive Bias',
};

const CATEGORY_ORDER = ['informal', 'formal', 'cognitive_bias'];

function formatKey(key: string): string {
  return key.replace(/_/g, ' ');
}

/** Collect nodes that have a given fallacy in their possible_fallacies */
function getNodesWithFallacy(fallacyKey: string): { id: string; label: string; pov: string; confidence: string; explanation: string }[] {
  const state = useTaxonomyStore.getState();
  const results: { id: string; label: string; pov: string; confidence: string; explanation: string }[] = [];

  const check = (attrs: Record<string, unknown> | undefined, nodeId: string, nodeLabel: string, pov: string) => {
    const pf = attrs?.possible_fallacies;
    if (!Array.isArray(pf)) return;
    for (const entry of pf) {
      if (entry && typeof entry === 'object' && (entry as { fallacy: string }).fallacy === fallacyKey) {
        results.push({
          id: nodeId,
          label: nodeLabel,
          pov,
          confidence: (entry as { confidence: string }).confidence || '',
          explanation: (entry as { explanation: string }).explanation || '',
        });
      }
    }
  };

  for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
    const file = state[pov];
    if (file) for (const n of file.nodes) check(n.graph_attributes as unknown as Record<string, unknown>, n.id, n.label, pov);
  }
  if (state.situations) {
    for (const n of state.situations.nodes) check(n.graph_attributes as unknown as Record<string, unknown>, n.id, n.label, 'situations');
  }
  return results;
}

const POV_COLOR: Record<string, string> = {
  accelerationist: 'var(--color-acc)',
  safetyist: 'var(--color-saf)',
  skeptic: 'var(--color-skp)',
  'situations': 'var(--color-sit)',
};

interface FallacyPanelProps {
  onSelectFallacy?: (key: string | null) => void;
}

/** Count how many taxonomy nodes reference each fallacy key */
function getFallacyCounts(): Map<string, number> {
  const state = useTaxonomyStore.getState();
  const counts = new Map<string, number>();

  const tally = (attrs: Record<string, unknown> | undefined) => {
    const pf = attrs?.possible_fallacies;
    if (!Array.isArray(pf)) return;
    for (const entry of pf) {
      if (entry && typeof entry === 'object') {
        const key = (entry as { fallacy: string }).fallacy;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  };

  for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
    const file = state[pov];
    if (file) for (const n of file.nodes) tally(n.graph_attributes as unknown as Record<string, unknown>);
  }
  if (state.situations) {
    for (const n of state.situations.nodes) tally(n.graph_attributes as unknown as Record<string, unknown>);
  }
  return counts;
}

export function FallacyPanel({ onSelectFallacy }: FallacyPanelProps) {
  const { setToolbarPanel } = useTaxonomyStore();
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const listRef = useRef<HTMLDivElement>(null);

  const fallacyCounts = useMemo(() => getFallacyCounts(), []);

  const allEntries = useMemo(() => {
    return Object.entries(FALLACY_CATALOG)
      .map(([key, entry]) => ({ key, ...entry, count: fallacyCounts.get(key) || 0 }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [fallacyCounts]);

  const filtered = useMemo(() => {
    let items = allEntries;
    if (categoryFilter) {
      items = items.filter(e => e.category === categoryFilter);
    }
    if (query) {
      const q = query.toLowerCase();
      items = items.filter(e =>
        e.label.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.key.toLowerCase().includes(q),
      );
    }
    return items;
  }, [allEntries, query, categoryFilter]);

  const handleSelect = useCallback((key: string) => {
    setSelectedKey(key);
    onSelectFallacy?.(key);
  }, [onSelectFallacy]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const idx = selectedKey ? filtered.findIndex(f => f.key === selectedKey) : -1;
    let next: number;
    if (e.key === 'ArrowDown') {
      next = idx < filtered.length - 1 ? idx + 1 : 0;
    } else {
      next = idx > 0 ? idx - 1 : filtered.length - 1;
    }
    if (filtered[next]) {
      handleSelect(filtered[next].key);
      const el = listRef.current?.children[next] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [filtered, selectedKey, handleSelect]);

  const handleClose = () => {
    setToolbarPanel(null);
  };

  return (
    <div className="fallacy-panel" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="fallacy-panel-header">
        <span className="fallacy-panel-title">Possible Fallacies</span>
        <button className="btn btn-ghost btn-sm" onClick={handleClose}>Close</button>
      </div>

      <div className="fallacy-panel-controls">
        <input
          className="fallacy-panel-search"
          type="text"
          placeholder="Search fallacies..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="fallacy-panel-category"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All categories</option>
          {CATEGORY_ORDER.map(c => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </div>

      <div className="fallacy-panel-count">{filtered.length} fallac{filtered.length === 1 ? 'y' : 'ies'}</div>

      <div className="fallacy-panel-list" ref={listRef}>
        {filtered.map(entry => (
          <div
            key={entry.key}
            className={`fallacy-panel-item${selectedKey === entry.key ? ' selected' : ''}`}
            onClick={() => handleSelect(entry.key)}
          >
            <div className="fallacy-panel-item-header">
              <span className="fallacy-panel-item-label">{entry.label}</span>
              {entry.count > 0 && (
                <span className="fallacy-panel-item-count">{entry.count}</span>
              )}
              <span className={`fallacy-panel-item-cat cat-${entry.category}`}>
                {CATEGORY_LABELS[entry.category]}
              </span>
            </div>
            <div className="fallacy-panel-item-desc">{entry.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Detail view for pane 2 when a fallacy is selected */
export function FallacyDetailPanel({ fallacyKey }: { fallacyKey: string | null }) {
  if (!fallacyKey) {
    return <div className="detail-panel-empty">Select a fallacy to view details</div>;
  }

  const entry = FALLACY_CATALOG[fallacyKey];
  if (!entry) {
    return <div className="detail-panel-empty">Unknown fallacy: {fallacyKey}</div>;
  }

  const nodes = getNodesWithFallacy(fallacyKey);

  return (
    <div className="fallacy-detail">
      <h2 className="fallacy-detail-title">{entry.label}</h2>
      <div className="fallacy-detail-meta">
        <span className={`fallacy-panel-item-cat cat-${entry.category}`}>
          {CATEGORY_LABELS[entry.category]}
        </span>
        {entry.wikiUrl && (
          <a
            className="fallacy-detail-wiki"
            href="#"
            onClick={(e) => { e.preventDefault(); window.electronAPI.openExternal(entry.wikiUrl); }}
          >
            Wikipedia
          </a>
        )}
      </div>

      <div className="fallacy-detail-section">
        <div className="fallacy-detail-label">Description</div>
        <p className="fallacy-detail-text">{entry.description}</p>
      </div>

      {entry.example && (
        <div className="fallacy-detail-section">
          <div className="fallacy-detail-label">Example (AI Policy)</div>
          <p className="fallacy-detail-text" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>{entry.example}</p>
        </div>
      )}

      {nodes.length > 0 && (
        <div className="fallacy-detail-section">
          <div className="fallacy-detail-label">Taxonomy Nodes ({nodes.length})</div>
          <div className="fallacy-detail-nodes">
            {nodes.map((n, i) => (
              <div key={`${n.id}-${i}`} className="fallacy-detail-node">
                <div className="fallacy-detail-node-header">
                  <span className="fallacy-detail-node-pov" style={{ color: POV_COLOR[n.pov] || 'var(--text-muted)' }}>
                    {n.pov.slice(0, 3)}
                  </span>
                  <span className="fallacy-detail-node-id">{n.id}</span>
                  <span className={`fallacy-detail-confidence conf-${n.confidence}`}>{n.confidence}</span>
                </div>
                <div className="fallacy-detail-node-label">{n.label}</div>
                {n.explanation && (
                  <div className="fallacy-detail-node-explanation">{n.explanation}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
