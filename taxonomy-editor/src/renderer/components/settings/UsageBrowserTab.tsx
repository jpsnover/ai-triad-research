// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState, useMemo } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './UsageBrowserTab.css';

interface UsageEntry {
  description: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  tags?: string[];
  _extends?: string;
}

type SortField = 'id' | 'model' | 'description';
type SortDir = 'asc' | 'desc';

export function UsageBrowserTab() {
  const [registry, setRegistry] = useState<Record<string, UsageEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('id');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    setLoading(true);
    api.getUsageRegistry()
      .then(data => { setRegistry(data as Record<string, UsageEntry>); setError(null); })
      .catch(err => {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'UsageBrowserTab', level: 'error',
          message: 'Failed to load usage registry',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const entry of Object.values(registry)) {
      for (const t of entry.tags ?? []) tags.add(t);
    }
    return [...tags].sort();
  }, [registry]);

  const filtered = useMemo(() => {
    const entries = Object.entries(registry);
    const lowerSearch = search.toLowerCase();
    return entries
      .filter(([id, entry]) => {
        if (lowerSearch && !id.toLowerCase().includes(lowerSearch) && !entry.description.toLowerCase().includes(lowerSearch) && !entry.model.toLowerCase().includes(lowerSearch)) return false;
        if (tagFilter && !(entry.tags ?? []).includes(tagFilter)) return false;
        return true;
      })
      .sort((a, b) => {
        let cmp: number;
        if (sortField === 'id') cmp = a[0].localeCompare(b[0]);
        else if (sortField === 'model') cmp = a[1].model.localeCompare(b[1].model);
        else cmp = a[1].description.localeCompare(b[1].description);
        return sortDir === 'asc' ? cmp : -cmp;
      });
  }, [registry, search, tagFilter, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  if (loading) return <div className="usage-browser-empty">Loading usage registry...</div>;
  if (error) return <div className="usage-browser-empty usage-browser-error">Failed to load: {error}</div>;

  const totalCount = Object.keys(registry).length;

  return (
    <div className="usage-browser">
      <div className="usage-browser-controls">
        <input
          className="usage-browser-search"
          type="text"
          placeholder="Search by ID, description, or model..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {allTags.length > 0 && (
          <select
            className="usage-browser-tag-filter"
            value={tagFilter}
            onChange={e => setTagFilter(e.target.value)}
          >
            <option value="">All tags</option>
            {allTags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <span className="usage-browser-count">
          {filtered.length} of {totalCount} usages
        </span>
      </div>

      <table className="usage-browser-table">
        <thead>
          <tr>
            <th className="usage-browser-sortable" onClick={() => handleSort('id')}>
              UsageID {sortField === 'id' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th className="usage-browser-sortable" onClick={() => handleSort('description')}>
              Description {sortField === 'description' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th className="usage-browser-sortable" onClick={() => handleSort('model')}>
              Model {sortField === 'model' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th>Temp</th>
            <th>Max Tokens</th>
            <th>Tags</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(([id, entry]) => (
            <tr
              key={id}
              className={`usage-browser-row ${expandedId === id ? 'usage-browser-row-expanded' : ''}`}
              onClick={() => setExpandedId(expandedId === id ? null : id)}
            >
              <td className="usage-browser-id">
                <code>{id}</code>
                {entry._extends && <span className="usage-browser-extends" title={`extends ${entry._extends}`}>^</span>}
              </td>
              <td className="usage-browser-desc">{entry.description}</td>
              <td><code>{entry.model}</code></td>
              <td>{entry.temperature != null ? entry.temperature : '—'}</td>
              <td>{entry.maxTokens != null ? entry.maxTokens.toLocaleString() : '—'}</td>
              <td>
                {(entry.tags ?? []).map(t => (
                  <span key={t} className="usage-browser-tag" onClick={e => { e.stopPropagation(); setTagFilter(t); }}>{t}</span>
                ))}
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td colSpan={6} className="usage-browser-empty-row">No matching usages found.</td></tr>
          )}
        </tbody>
      </table>

      {expandedId && registry[expandedId] && (
        <div className="usage-browser-detail">
          <h4>{expandedId}</h4>
          <pre>{JSON.stringify(registry[expandedId], null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
