// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useStore } from '../store/useStore';
import type { Theme, SourceInfo } from '../types/types';

type SortField = 'name' | 'importTime' | 'sourceTime';

const POV_COLORS: Record<string, string> = {
  accelerationist: 'var(--color-acc)',
  safetyist: 'var(--color-saf)',
  skeptic: 'var(--color-skp)',
};

function ThemeSwitcher() {
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);

  const options: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'bkc', label: 'BKC' },
    { value: 'system', label: 'Auto' },
  ];

  return (
    <div className="theme-switcher">
      {options.map(o => (
        <button
          key={o.value}
          className={`theme-btn${theme === o.value ? ' active' : ''}`}
          onClick={() => setTheme(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TaxonomyDirSwitcher() {
  const [dirs, setDirs] = useState<string[]>([]);
  const [activeDir, setActiveDir] = useState('Origin');
  const loadSources = useStore(s => s.loadSources);

  useEffect(() => {
    if (!window.electronAPI?.getTaxonomyDirs) return;
    window.electronAPI.getTaxonomyDirs().then(setDirs);
    window.electronAPI.getActiveTaxonomyDir().then(setActiveDir);
  }, []);

  const handleChange = useCallback(async (dirName: string) => {
    await window.electronAPI.setTaxonomyDir(dirName);
    setActiveDir(dirName);
    await loadSources();
  }, [loadSources]);

  if (dirs.length <= 1) return null;

  return (
    <div className="taxonomy-dir-bar">
      <label className="taxonomy-dir-label">Taxonomy:</label>
      <select
        className="taxonomy-dir-select"
        value={activeDir}
        onChange={(e) => handleChange(e.target.value)}
      >
        {dirs.map((dir) => (
          <option key={dir} value={dir}>{dir}</option>
        ))}
      </select>
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function sortSources(sources: SourceInfo[], field: SortField): SourceInfo[] {
  return [...sources].sort((a, b) => {
    switch (field) {
      case 'name':
        return a.title.localeCompare(b.title);
      case 'importTime':
        return (b.importTime || '').localeCompare(a.importTime || '');
      case 'sourceTime':
        return (b.sourceTime || '').localeCompare(a.sourceTime || '');
    }
  });
}

function filterSources(sources: SourceInfo[], query: string): SourceInfo[] {
  if (!query.trim()) return sources;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return sources.filter(s => {
    const haystack = [
      s.title,
      s.oneLiner,
      s.id,
      ...s.povTags,
      ...s.topicTags,
      ...s.authors,
    ].join(' ').toLowerCase();
    return terms.every(t => haystack.includes(t));
  });
}

export default function SourcesPane() {
  const sources = useStore(s => s.sources);
  const selectedSourceIds = useStore(s => s.selectedSourceIds);
  const toggleSource = useStore(s => s.toggleSource);
  const toggleAll = useStore(s => s.toggleAll);
  const [sortField, setSortField] = useState<SortField>(() => {
    return (localStorage.getItem('summaryviewer-sort') as SortField) || 'name';
  });
  const [searchQuery, setSearchQuery] = useState('');

  const handleSortChange = useCallback((field: SortField) => {
    setSortField(field);
    localStorage.setItem('summaryviewer-sort', field);
  }, []);

  const filtered = useMemo(() => filterSources(sources, searchQuery), [sources, searchQuery]);
  const sorted = useMemo(() => sortSources(filtered, sortField), [filtered, sortField]);

  const allSelected = filtered.length > 0 && filtered.every(s => selectedSourceIds.has(s.id));
  const someSelected = filtered.some(s => selectedSourceIds.has(s.id));

  return (
    <>
      <div className="pane-header">
        <h2>Sources</h2>
        <ThemeSwitcher />
      </div>
      <TaxonomyDirSwitcher />
      <div className="source-sort-bar">
        <label className="source-sort-label">Sort:</label>
        <div className="source-sort-toggle">
          <button
            className={`source-sort-btn${sortField === 'name' ? ' active' : ''}`}
            onClick={() => handleSortChange('name')}
          >
            Name
          </button>
          <button
            className={`source-sort-btn${sortField === 'importTime' ? ' active' : ''}`}
            onClick={() => handleSortChange('importTime')}
          >
            Imported
          </button>
          <button
            className={`source-sort-btn${sortField === 'sourceTime' ? ' active' : ''}`}
            onClick={() => handleSortChange('sourceTime')}
          >
            Published
          </button>
        </div>
      </div>
      <div className="source-search-bar">
        <input
          type="text"
          className="source-search-input"
          placeholder="Search sources..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            className="source-search-clear"
            onClick={() => setSearchQuery('')}
            title="Clear search"
          >
            {'\u2715'}
          </button>
        )}
      </div>
      <div className="pane-body">
        <label className="select-all-row">
          <input
            type="checkbox"
            checked={allSelected}
            ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
            onChange={() => toggleAll(filtered.map(s => s.id))}
          />
          <span className="select-all-label">
            {searchQuery ? `Select ${filtered.length} of ${sources.length}` : `Select All (${sources.length})`}
          </span>
        </label>

        <ul className="source-list">
          {sorted.map(source => (
            <li
              key={source.id}
              className={`source-item${selectedSourceIds.has(source.id) ? ' selected' : ''}`}
            >
              <label className="source-row">
                <input
                  type="checkbox"
                  checked={selectedSourceIds.has(source.id)}
                  onChange={() => toggleSource(source.id)}
                />
                <div className="source-info">
                  <div className="source-title">{source.title}</div>
                  <div className="source-dates">
                    {sortField === 'importTime' && source.importTime && (
                      <span className="source-date">imported {formatDate(source.importTime)}</span>
                    )}
                    {sortField === 'sourceTime' && source.sourceTime && (
                      <span className="source-date">published {formatDate(source.sourceTime)}</span>
                    )}
                  </div>
                  {source.povTags.length > 0 && (
                    <div className="source-tags">
                      {source.povTags.map(tag => (
                        <span
                          key={tag}
                          className="pov-chip"
                          style={{ borderColor: POV_COLORS[tag] || 'var(--text-muted)', color: POV_COLORS[tag] || 'var(--text-muted)' }}
                        >
                          {tag.slice(0, 3).toUpperCase()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
