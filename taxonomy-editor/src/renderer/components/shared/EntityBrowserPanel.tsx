// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Entity browser side panel (t/1884 §7). The "show me all entities / find one / scan
// by type" counterpart to Organizations/Vocabulary. Lists entity SUMMARIES from
// api.listEntities (client-side filter/sort v1, TL t/1766#7 Q6); selecting a row opens
// the SHARED DetailPane (§5, t/1882) — the browser is the list, DetailPane is the detail,
// one renderer reused (no forked entity detail). DetailPane is mounted here locally
// because the toolbar panel sits outside the per-workspace DetailPane mounts.

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { api } from '@bridge';
import type { EntitySummary, EntityRef, EntityType, Entity } from '@lib/entities/types';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { TypeBadge } from './DetailPrimitives';
import { coerceStringArray } from '@lib/entities/entityResolve';
import { DetailPane } from './DetailPane';
import { EmptyState } from './EmptyState';
import './EntityBrowserPanel.css';

type SortKey = 'name' | 'type' | 'status' | 'confidence' | 'modified';
type EntityStatus = Entity['status'];

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; entities: EntitySummary[] }
  | { status: 'error'; message: string };

const ENTITY_TYPES: readonly EntityType[] = ['person', 'artifact', 'event', 'legislation', 'institution'];
const STATUSES: readonly EntityStatus[] = ['proposed', 'approved', 'deprecated'];

const SORT_OPTIONS: readonly { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name A–Z' },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'modified', label: 'Recently modified' },
];

/** Status dot glyph; color comes from the `.ebp-dot-{status}` class (AA in all themes). */
const STATUS_DOT: Record<EntityStatus, string> = { proposed: '○', approved: '●', deprecated: '×' };

function matchesSearch(e: EntitySummary, q: string): boolean {
  if (!q) return true;
  return (
    e.name.toLowerCase().includes(q) ||
    e.id.toLowerCase().includes(q) ||
    e.entity_type.toLowerCase().includes(q) ||
    // aliases is polymorphic in real data (array | string | null) despite the string[]
    // type — coerce (t/1884#4); server normalization (t/1964) is the load-bearing fix.
    coerceStringArray(e.aliases).some(a => a.toLowerCase().includes(q))
  );
}

/** Null-safe locale compare — real data can carry null in string-typed fields (t/2389, cf. the t/2385 title crash). */
const cmpStr = (a?: string | null, b?: string | null): number => (a ?? '').localeCompare(b ?? '');

function compareEntities(a: EntitySummary, b: EntitySummary, sort: SortKey): number {
  switch (sort) {
    case 'type': return cmpStr(a.entity_type, b.entity_type) || cmpStr(a.name, b.name);
    case 'status': return cmpStr(a.status, b.status) || cmpStr(a.name, b.name);
    case 'confidence': return (b.confidence ?? -1) - (a.confidence ?? -1) || cmpStr(a.name, b.name);
    case 'modified': return cmpStr(b.last_modified, a.last_modified) || cmpStr(a.name, b.name);
    case 'name':
    default: return cmpStr(a.name, b.name);
  }
}

/** One entity row — role=option; compact name + type badge + status dot + muted alias line. */
function EntityRow({ entity, selected, onSelect }: { entity: EntitySummary; selected: boolean; onSelect: () => void }) {
  const alias = coerceStringArray(entity.aliases)[0]; // aliases is polymorphic (array|string|null) — coerce, so a bare string isn't sliced to its first char (t/1884#4)
  return (
    <li
      id={`ebp-opt-${entity.id}`}
      role="option"
      aria-selected={selected}
      className={`ebp-row${selected ? ' ebp-row-active' : ''}${entity.status === 'deprecated' ? ' ebp-row-deprecated' : ''}`}
      onClick={onSelect}
    >
      <div className="ebp-row-main">
        <span className={`ebp-dot ebp-dot-${entity.status}`} title={entity.status} aria-hidden="true">{STATUS_DOT[entity.status]}</span>
        <span className="ebp-row-name">{entity.name}</span>
        <TypeBadge type={entity.entity_type} />
      </div>
      {alias && <div className="ebp-row-alias">also: {alias}</div>}
    </li>
  );
}

/** Collapsible facet group (type or status) with per-option live counts; multi-select. */
function FacetGroup<T extends string>({ label, options, counts, selected, onToggle }: {
  label: string; options: readonly T[]; counts: Record<string, number>;
  selected: ReadonlySet<T>; onToggle: (value: T) => void;
}) {
  return (
    <div className="ebp-facet-group">
      <span className="ebp-facet-label">{label}</span>
      <div className="ebp-facet-chips">
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            className={`ebp-facet-chip${selected.has(opt) ? ' ebp-facet-chip-on' : ''}`}
            aria-pressed={selected.has(opt)}
            onClick={() => onToggle(opt)}
          >
            {opt.replace(/_/g, ' ')} <span className="ebp-facet-count">{counts[opt] ?? 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function EntityBrowserPanel() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [typeFilters, setTypeFilters] = useState<ReadonlySet<EntityType>>(new Set());
  const [statusFilters, setStatusFilters] = useState<ReadonlySet<EntityStatus>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    void (async () => {
      try {
        const entities = await api.listEntities();
        if (!cancelled) setLoad({ status: 'ready', entities });
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'EntityBrowserPanel', level: 'error',
          message: 'Failed to load entities',
          error: { name: err instanceof Error ? err.name : 'Error', message, stack: err instanceof Error ? err.stack : undefined },
        });
        setLoad({ status: 'error', message });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const all = load.status === 'ready' ? load.entities : [];
  const q = search.trim().toLowerCase();

  // Search first; facet counts reflect the searched set so they stay meaningful as the
  // user narrows. Facet filters then apply; finally sort.
  const searched = useMemo(() => all.filter(e => matchesSearch(e, q)), [all, q]);
  const typeCounts = useMemo(() => tally(searched, e => e.entity_type), [searched]);
  const statusCounts = useMemo(() => tally(searched, e => e.status), [searched]);
  const rows = useMemo(() => searched
    .filter(e => (typeFilters.size === 0 || typeFilters.has(e.entity_type)) && (statusFilters.size === 0 || statusFilters.has(e.status)))
    .slice()
    .sort((a, b) => compareEntities(a, b, sort)),
  [searched, typeFilters, statusFilters, sort]);

  // Keep the active descendant in range as the filtered set changes.
  useEffect(() => { setActiveIndex(i => Math.min(i, Math.max(0, rows.length - 1))); }, [rows.length]);

  const selectedRef: EntityRef | null = selectedId ? { kind: 'entity', id: selectedId } : null;

  const openRow = useCallback((id: string) => setSelectedId(id), []);
  const closeDetail = useCallback(() => { setSelectedId(null); listRef.current?.focus(); }, []);

  const toggleType = useCallback((t: EntityType) => setTypeFilters(prev => toggle(prev, t)), []);
  const toggleStatus = useCallback((s: EntityStatus) => setStatusFilters(prev => toggle(prev, s)), []);

  const onListKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, rows.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const row = rows[activeIndex];
      if (row) openRow(row.id);
      return;
    }
    // Type-to-search: a printable key jumps focus to the search box (§7.5).
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      searchRef.current?.focus();
    }
  }, [rows, activeIndex, openRow]);

  const activeId = rows[activeIndex]?.id;
  const total = all.length;
  const countLabel = rows.length === total ? `${total} entities` : `${rows.length} of ${total}`;

  return (
    <div className="entity-browser-panel">
      <div className="ebp-list-col">
        <div className="ebp-header">
          <h3 className="ebp-title">Entities</h3>
        </div>

        <div className="ebp-controls">
          <input
            ref={searchRef}
            type="text"
            className="ebp-search"
            placeholder="Search name, alias, type…"
            aria-label="Search entities"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setSearch(''); }}
          />
          <label className="ebp-sort">
            <span className="ebp-sort-label">Sort</span>
            <select value={sort} onChange={e => setSort(e.target.value as SortKey)} aria-label="Sort entities">
              {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
          <FacetGroup label="Type" options={ENTITY_TYPES} counts={typeCounts} selected={typeFilters} onToggle={toggleType} />
          <FacetGroup label="Status" options={STATUSES} counts={statusCounts} selected={statusFilters} onToggle={toggleStatus} />
        </div>

        <div className="ebp-count" aria-live="polite">{load.status === 'ready' ? countLabel : ''}</div>

        <div className="ebp-list-wrap">
          {load.status === 'loading' && <div className="ebp-loading">Loading…</div>}
          {load.status === 'error' && (
            <EmptyState headline="Couldn’t load entities" direction={load.message} />
          )}
          {load.status === 'ready' && rows.length === 0 && (
            <EmptyState headline="No entities match" direction="Adjust the search or filters." />
          )}
          {load.status === 'ready' && rows.length > 0 && (
            <ul
              ref={listRef}
              className="ebp-list"
              role="listbox"
              aria-label="Entities"
              tabIndex={0}
              aria-activedescendant={activeId ? `ebp-opt-${activeId}` : undefined}
              onKeyDown={onListKeyDown}
            >
              {rows.map(e => (
                <EntityRow key={e.id} entity={e} selected={e.id === selectedId} onSelect={() => openRow(e.id)} />
              ))}
            </ul>
          )}
        </div>
      </div>

      {selectedRef && (
        <DetailPane
          className="ebp-detail-pane"
          selectedRef={selectedRef}
          onSelectRef={ref => setSelectedId(ref.id)}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}

/** Count occurrences of a derived key over a list. */
function tally<T>(items: T[], keyOf: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) { const k = keyOf(item); out[k] = (out[k] ?? 0) + 1; }
  return out;
}

/** Immutable toggle of a value in a Set. */
function toggle<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}
