// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { INTELLECTUAL_LINEAGES } from '../data/intellectualLineageInfo';

interface LineagePanelProps {
  onSelectValue?: (value: string) => void;
}

const catalogKeys = new Set(Object.keys(INTELLECTUAL_LINEAGES));

export function LineagePanel({ onSelectValue }: LineagePanelProps) {
  const { pendingLineageValue, accelerationist, safetyist, skeptic, crossCutting } = useTaxonomyStore();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const panelRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Merge catalog keys with actual taxonomy lineage values
  const allKeys = useMemo(() => {
    const keys = new Set(catalogKeys);
    for (const pov of [accelerationist, safetyist, skeptic] as const) {
      if (pov) for (const n of pov.nodes) {
        for (const l of n.graph_attributes?.intellectual_lineage ?? []) keys.add(l);
      }
    }
    if (crossCutting) {
      for (const n of crossCutting.nodes) {
        for (const l of n.graph_attributes?.intellectual_lineage ?? []) keys.add(l);
      }
    }
    return [...keys].sort();
  }, [accelerationist, safetyist, skeptic, crossCutting]);

  /** Case-insensitive key lookup */
  const findKey = useCallback((value: string): string | undefined => {
    const lower = value.toLowerCase();
    return allKeys.find(k => k.toLowerCase() === lower);
  }, [allKeys]);

  const filtered = useMemo(() => {
    if (!query) return allKeys;
    const q = query.toLowerCase();
    return allKeys.filter(k => k.toLowerCase().includes(q));
  }, [query, allKeys]);

  const selectItem = useCallback((index: number) => {
    if (index < 0 || index >= filtered.length) return;
    setSelectedIndex(index);
    onSelectValue?.(filtered[index]);
    panelRef.current?.focus();
    const el = resultsRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [filtered, onSelectValue]);

  // Auto-select when navigated to from a lineage chip click
  useEffect(() => {
    // console.log('[LineagePanel] useEffect fired. pendingLineageValue:', pendingLineageValue);
    if (!pendingLineageValue) return;
    const canonicalKey = findKey(pendingLineageValue);
    // console.log('[LineagePanel] canonicalKey:', canonicalKey, '| filtered.length:', filtered.length);
    if (canonicalKey) {
      const index = filtered.indexOf(canonicalKey);
      // console.log('[LineagePanel] index in filtered:', index);
      if (index >= 0) {
        setSelectedIndex(index);
        // console.log('[LineagePanel] calling onSelectValue with:', canonicalKey, '| onSelectValue defined:', !!onSelectValue);
        onSelectValue?.(canonicalKey);
        requestAnimationFrame(() => {
          const el = resultsRef.current?.children[index] as HTMLElement | undefined;
          el?.scrollIntoView({ block: 'center' });
        });
      }
    } else {
      // console.log('[LineagePanel] No canonical key found. pendingLineageValue:', JSON.stringify(pendingLineageValue), '| allKeys sample:', allKeys.slice(0, 5));
    }
    useTaxonomyStore.setState({ pendingLineageValue: null });
  }, [pendingLineageValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectItem(Math.min(selectedIndex + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectItem(Math.max(selectedIndex - 1, 0));
    }
  }, [selectedIndex, filtered.length, selectItem]);

  return (
    <div className="lineage-panel" ref={panelRef} tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="lineage-panel-header">
        <span className="lineage-panel-title">Intellectual Lineage</span>
        <span className="lineage-panel-count">{filtered.length}</span>
      </div>
      <div className="lineage-panel-search">
        <input
          className="search-panel-text-input"
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIndex(-1); }}
          placeholder="Filter lineage values..."
        />
      </div>
      <div className="lineage-panel-list" ref={resultsRef}>
        {filtered.map((key, i) => {
          const info = INTELLECTUAL_LINEAGES[key];
          return (
            <div
              key={key}
              className={`lineage-panel-item${i === selectedIndex ? ' selected' : ''}`}
              onClick={() => selectItem(i)}
            >
              {info?.label || key}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="search-panel-empty">No matching lineage values</div>
        )}
      </div>
    </div>
  );
}
