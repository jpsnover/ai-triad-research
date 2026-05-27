// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import {
  CATEGORY_ORDER,
  classifyLineage, classifyLineageL2, getCategoryById,
  getL2Categories, getL2CategoriesForL1, isLineageDataLoaded,
} from '../data/lineageCategories';
import { getAllLineages, getLineageInfo } from '../data/lineageLookup';

interface LineagePanelProps {
  onSelectValue?: (value: string) => void;
}

export function LineagePanel({ onSelectValue }: LineagePanelProps) {
  const { pendingLineageValue, accelerationist, safetyist, skeptic, situations } = useTaxonomyStore();
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [collapsedL1, setCollapsedL1] = useState<Set<string>>(new Set(CATEGORY_ORDER));
  const [collapsedL2, setCollapsedL2] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hasL2 = isLineageDataLoaded();

  // Merge catalog keys with actual taxonomy lineage values
  const allKeys = useMemo(() => {
    const keys = new Set(Object.keys(getAllLineages()));
    for (const pov of [accelerationist, safetyist, skeptic] as const) {
      if (pov) for (const n of pov.nodes) {
        for (const l of n.graph_attributes?.intellectual_lineage ?? []) { const s = typeof l === 'string' ? l : (l as { name?: string })?.name; if (s) keys.add(s); }
      }
    }
    if (situations) {
      for (const n of situations.nodes) {
        for (const l of n.graph_attributes?.intellectual_lineage ?? []) { const s = typeof l === 'string' ? l : (l as { name?: string })?.name; if (s) keys.add(s); }
      }
    }
    return [...keys].sort();
  }, [accelerationist, safetyist, skeptic, situations]);

  const findKey = useCallback((value: string): string | undefined => {
    const lower = value.toLowerCase();
    return allKeys.find(k => k.toLowerCase() === lower);
  }, [allKeys]);

  // Build L2 label index for filter matching
  const l2LabelIndex = useMemo(() => {
    if (!hasL2) return new Map<string, string>();
    const index = new Map<string, string>(); // l2Id → lowercase label
    for (const catId of CATEGORY_ORDER) {
      for (const l2 of getL2CategoriesForL1(catId)) {
        index.set(l2.id, l2.label.toLowerCase());
      }
    }
    return index;
  }, [hasL2]);

  // L1 category label index for filter matching
  const l1LabelIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const catId of CATEGORY_ORDER) {
      const cat = getCategoryById(catId);
      index.set(catId, cat.label.toLowerCase());
    }
    return index;
  }, []);

  const filtered = useMemo(() => {
    if (!query) return allKeys;
    const q = query.toLowerCase();
    // Pre-compute which L1 categories and L2 clusters match the query
    const matchedL1 = new Set<string>();
    for (const [catId, label] of l1LabelIndex) {
      if (label.includes(q)) matchedL1.add(catId);
    }
    const matchedL2 = new Set<string>();
    for (const [l2Id, label] of l2LabelIndex) {
      if (label.includes(q)) matchedL2.add(l2Id);
    }
    return allKeys.filter(k => {
      // Direct name match
      if (k.toLowerCase().includes(q)) return true;
      // L1 category match — include all items in matching categories
      const l1Id = classifyLineage(k);
      if (matchedL1.has(l1Id)) return true;
      // L2 cluster match — include all items in matching clusters
      if (hasL2) {
        const l2Id = classifyLineageL2(k);
        if (l2Id && matchedL2.has(l2Id)) return true;
      }
      return false;
    });
  }, [query, allKeys, hasL2, l1LabelIndex, l2LabelIndex]);

  const grouped = useMemo(() => {
    const groups = new Map<string, { ungrouped: string[]; l2Groups: Map<string, string[]> }>();
    for (const catId of CATEGORY_ORDER) {
      groups.set(catId, { ungrouped: [], l2Groups: new Map() });
    }
    for (const key of filtered) {
      const l1Id = classifyLineage(key);
      const group = groups.get(l1Id)!;
      const l2Id = hasL2 ? classifyLineageL2(key) : undefined;
      if (l2Id) {
        if (!group.l2Groups.has(l2Id)) group.l2Groups.set(l2Id, []);
        group.l2Groups.get(l2Id)!.push(key);
      } else {
        group.ungrouped.push(key);
      }
    }
    return groups;
  }, [filtered, hasL2]);

  const visibleKeys = useMemo(() => {
    const keys: string[] = [];
    for (const catId of CATEGORY_ORDER) {
      const group = grouped.get(catId);
      if (!group) continue;
      const totalItems = group.ungrouped.length + Array.from(group.l2Groups.values()).reduce((a, b) => a + b.length, 0);
      if (totalItems === 0) continue;
      if (collapsedL1.has(catId)) continue;
      for (const [l2Id, items] of group.l2Groups) {
        if (!collapsedL2.has(l2Id)) keys.push(...items);
      }
      keys.push(...group.ungrouped);
    }
    return keys;
  }, [grouped, collapsedL1, collapsedL2]);

  const selectItem = useCallback((key: string) => {
    setSelectedKey(key);
    onSelectValue?.(key);
    panelRef.current?.focus();
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-lineage-key="${CSS.escape(key)}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest' });
    });
  }, [onSelectValue]);

  // Collapse all L2 clusters initially once data loads
  const l2InitRef = useRef(false);
  useEffect(() => {
    if (l2InitRef.current || !hasL2) return;
    const allL2Ids = getL2Categories().map(c => c.id);
    if (allL2Ids.length > 0) {
      setCollapsedL2(new Set(allL2Ids));
      l2InitRef.current = true;
    }
  }, [hasL2]);

  useEffect(() => {
    if (!pendingLineageValue) return;
    const canonicalKey = findKey(pendingLineageValue);
    if (canonicalKey) {
      const catId = classifyLineage(canonicalKey);
      setCollapsedL1(prev => { if (!prev.has(catId)) return prev; const next = new Set(prev); next.delete(catId); return next; });
      const l2Id = classifyLineageL2(canonicalKey);
      if (l2Id) {
        setCollapsedL2(prev => { if (!prev.has(l2Id)) return prev; const next = new Set(prev); next.delete(l2Id); return next; });
      }
      setSelectedKey(canonicalKey);
      onSelectValue?.(canonicalKey);
      requestAnimationFrame(() => {
        const el = listRef.current?.querySelector(`[data-lineage-key="${CSS.escape(canonicalKey)}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: 'center' });
      });
    }
    useTaxonomyStore.setState({ pendingLineageValue: null });
  }, [pendingLineageValue]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (visibleKeys.length === 0) return;
    const currentIndex = selectedKey ? visibleKeys.indexOf(selectedKey) : -1;
    if (e.key === 'ArrowDown') { e.preventDefault(); selectItem(visibleKeys[Math.min(currentIndex + 1, visibleKeys.length - 1)]); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectItem(visibleKeys[Math.max(currentIndex - 1, 0)]); }
  }, [selectedKey, visibleKeys, selectItem]);

  const toggleL1 = useCallback((catId: string) => {
    setCollapsedL1(prev => { const next = new Set(prev); next.has(catId) ? next.delete(catId) : next.add(catId); return next; });
  }, []);

  const toggleL2 = useCallback((l2Id: string) => {
    setCollapsedL2(prev => { const next = new Set(prev); next.has(l2Id) ? next.delete(l2Id) : next.add(l2Id); return next; });
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
          const group = grouped.get(catId);
          if (!group) return null;
          const totalItems = group.ungrouped.length + Array.from(group.l2Groups.values()).reduce((a, b) => a + b.length, 0);
          if (totalItems === 0) return null;
          const cat = getCategoryById(catId);
          const isCollapsed = collapsedL1.has(catId);
          const l2Cats = hasL2 ? [...getL2CategoriesForL1(catId)].sort((a, b) => a.label.localeCompare(b.label)) : [];

          return (
            <div key={catId} className="lineage-category-group">
              <div className="lineage-category-header" onClick={() => toggleL1(catId)}>
                <span className={`category-toggle${isCollapsed ? ' collapsed' : ''}`}>&#9660;</span>
                <span className="lineage-category-label">{cat.label}</span>
                <span className="lineage-category-count">({totalItems})</span>
              </div>
              {!isCollapsed && (
                <>
                  {l2Cats.map(l2 => {
                    const l2Items = group.l2Groups.get(l2.id);
                    if (!l2Items || l2Items.length === 0) return null;
                    const l2Collapsed = collapsedL2.has(l2.id);
                    return (
                      <div key={l2.id} className="lineage-l2-group">
                        <div className="lineage-l2-header" onClick={() => toggleL2(l2.id)}>
                          <span className={`category-toggle category-toggle-sm${l2Collapsed ? ' collapsed' : ''}`}>&#9660;</span>
                          <span className="lineage-l2-label">{l2.label}</span>
                          <span className="lineage-category-count">({l2Items.length})</span>
                        </div>
                        {!l2Collapsed && l2Items.map(key => {
                          const info = getLineageInfo(key);
                          return (
                            <div key={key} data-lineage-key={key}
                              className={`lineage-panel-item lineage-panel-item-l2-indented${key === selectedKey ? ' selected' : ''}`}
                              onClick={() => selectItem(key)}
                            >{info?.label || key}</div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {group.ungrouped.map(key => {
                    const info = getLineageInfo(key);
                    return (
                      <div key={key} data-lineage-key={key}
                        className={`lineage-panel-item lineage-panel-item-indented${key === selectedKey ? ' selected' : ''}`}
                        onClick={() => selectItem(key)}
                      >{info?.label || key}</div>
                    );
                  })}
                </>
              )}
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
