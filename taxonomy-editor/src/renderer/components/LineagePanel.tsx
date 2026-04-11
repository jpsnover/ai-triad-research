// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { INTELLECTUAL_LINEAGES } from '../data/intellectualLineageInfo';
import {
  LINEAGE_CATEGORIES, UNCATEGORIZED, CATEGORY_ORDER,
  classifyLineage, getCategoryById,
} from '../data/lineageCategories';

interface LineagePanelProps {
  onSelectValue?: (value: string) => void;
}

const catalogKeys = new Set(Object.keys(INTELLECTUAL_LINEAGES));

export function LineagePanel({ onSelectValue }: LineagePanelProps) {
  const { pendingLineageValue, accelerationist, safetyist, skeptic, situations } = useTaxonomyStore();
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set(CATEGORY_ORDER));
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Merge catalog keys with actual taxonomy lineage values
  const allKeys = useMemo(() => {
    const keys = new Set(catalogKeys);
    for (const pov of [accelerationist, safetyist, skeptic] as const) {
      if (pov) for (const n of pov.nodes) {
        for (const l of n.graph_attributes?.intellectual_lineage ?? []) keys.add(l);
      }
    }
    if (situations) {
      for (const n of situations.nodes) {
        for (const l of n.graph_attributes?.intellectual_lineage ?? []) keys.add(l);
      }
    }
    return [...keys].sort();
  }, [accelerationist, safetyist, skeptic, situations]);

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

  // Group filtered keys by category
  const grouped = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const catId of CATEGORY_ORDER) {
      groups.set(catId, []);
    }
    for (const key of filtered) {
      const catId = classifyLineage(key);
      groups.get(catId)!.push(key);
    }
    return groups;
  }, [filtered]);

  // Flat list for keyboard navigation (respects collapsed state)
  const visibleKeys = useMemo(() => {
    const keys: string[] = [];
    for (const catId of CATEGORY_ORDER) {
      const items = grouped.get(catId);
      if (!items || items.length === 0) continue;
      if (!collapsedCategories.has(catId)) {
        keys.push(...items);
      }
    }
    return keys;
  }, [grouped, collapsedCategories]);

  const selectItem = useCallback((key: string) => {
    setSelectedKey(key);
    onSelectValue?.(key);
    panelRef.current?.focus();
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-lineage-key="${CSS.escape(key)}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest' });
    });
  }, [onSelectValue]);

  // Auto-select when navigated to from a lineage chip click
  useEffect(() => {
    if (!pendingLineageValue) return;
    const canonicalKey = findKey(pendingLineageValue);
    if (canonicalKey) {
      // Ensure the category is expanded
      const catId = classifyLineage(canonicalKey);
      setCollapsedCategories(prev => {
        if (!prev.has(catId)) return prev;
        const next = new Set(prev);
        next.delete(catId);
        return next;
      });
      setSelectedKey(canonicalKey);
      onSelectValue?.(canonicalKey);
      requestAnimationFrame(() => {
        const el = listRef.current?.querySelector(`[data-lineage-key="${CSS.escape(canonicalKey)}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: 'center' });
      });
    }
    useTaxonomyStore.setState({ pendingLineageValue: null });
  }, [pendingLineageValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (visibleKeys.length === 0) return;
    const currentIndex = selectedKey ? visibleKeys.indexOf(selectedKey) : -1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(currentIndex + 1, visibleKeys.length - 1);
      selectItem(visibleKeys[next]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(currentIndex - 1, 0);
      selectItem(visibleKeys[next]);
    }
  }, [selectedKey, visibleKeys, selectItem]);

  const toggleCategory = useCallback((catId: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }, []);

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
          onChange={(e) => { setQuery(e.target.value); setSelectedKey(null); }}
          placeholder="Filter lineage values..."
        />
      </div>
      <div className="lineage-panel-list" ref={listRef}>
        {CATEGORY_ORDER.map((catId) => {
          const items = grouped.get(catId);
          if (!items || items.length === 0) return null;
          const cat = getCategoryById(catId);
          const isCollapsed = collapsedCategories.has(catId);
          return (
            <div key={catId} className="lineage-category-group">
              <div
                className="lineage-category-header"
                onClick={() => toggleCategory(catId)}
              >
                <span className={`category-toggle${isCollapsed ? ' collapsed' : ''}`}>&#9660;</span>
                <span className="lineage-category-label">{cat.label}</span>
                <span className="lineage-category-count">({items.length})</span>
              </div>
              {!isCollapsed && items.map((key) => {
                const info = INTELLECTUAL_LINEAGES[key];
                return (
                  <div
                    key={key}
                    data-lineage-key={key}
                    className={`lineage-panel-item lineage-panel-item-indented${key === selectedKey ? ' selected' : ''}`}
                    onClick={() => selectItem(key)}
                  >
                    {info?.label || key}
                  </div>
                );
              })}
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
