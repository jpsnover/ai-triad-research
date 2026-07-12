// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useMemo } from 'react';
import { useOrganizationStore } from '../../hooks/useOrganizationStore';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { OrganizationDetail } from './OrganizationDetail';
import type { Organization } from '../../bridge/types';

const POV_COLORS: Record<string, string> = {
  accelerationist: '#f97316',
  safetyist: '#22c55e',
  skeptic: '#a855f7',
};

const TYPE_OPTIONS = ['think_tank', 'advocacy', 'regulatory', 'academic', 'corporate', 'intergovernmental', 'civil_society', 'standards_body', 'research_lab'] as const;
const POV_OPTIONS = ['accelerationist', 'safetyist', 'skeptic'] as const;

function PovDots({ alignment }: { alignment?: Organization['pov_alignment'] }) {
  if (!alignment) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {(['accelerationist', 'safetyist', 'skeptic'] as const).map((pov) => {
        const stance = alignment[pov];
        if (!stance) return null;
        const score = stance.score;
        const color = POV_COLORS[pov] ?? 'var(--text-muted)';
        return (
          <span
            key={pov}
            title={`${pov}: ${score > 0 ? '+' : ''}${score.toFixed(1)}`}
            style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: color, opacity: Math.max(0.3, Math.abs(score)),
            }}
          />
        );
      })}
    </span>
  );
}

export function OrganizationsTab() {
  const {
    organizations, selectedOrg, loading, error,
    searchQuery, filters,
    fetchOrganizations, selectOrganization, clearSelection,
    setFilters, setSearchQuery,
  } = useOrganizationStore();
  const { width, onMouseDown } = useResizablePanel();

  useEffect(() => {
    void fetchOrganizations();
  }, [fetchOrganizations]);

  const filtered = useMemo(() => {
    let list = organizations;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((o) =>
        o.name.toLowerCase().includes(q) ||
        (o.short_name && o.short_name.toLowerCase().includes(q)) ||
        (o.description && o.description.toLowerCase().includes(q)),
      );
    }
    if (filters.type) {
      list = list.filter((o) => o.type === filters.type);
    }
    if (filters.pov) {
      list = list.filter((o) => {
        const stance = o.pov_alignment?.[filters.pov! as import('../../bridge/types').Pov];
        return stance && stance.score > 0;
      });
    }
    return list;
  }, [organizations, searchQuery, filters]);

  return (
    <div className="two-column">
      {/* Left pane: list */}
      <div className="list-panel" style={{ width }}>
        <div className="list-panel-header">
          <h2>Organizations</h2>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {filtered.length}{filtered.length !== organizations.length ? ` / ${organizations.length}` : ''}
          </span>
        </div>

        {/* Search */}
        <div style={{ padding: '4px 8px' }}>
          <input
            type="text"
            placeholder="Search organizations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field"
            style={{ width: '100%', fontSize: '0.8rem', padding: '4px 8px' }}
          />
        </div>

        {/* Filters */}
        <div style={{ padding: '4px 8px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select
            value={filters.type ?? ''}
            onChange={(e) => setFilters({ ...filters, type: e.target.value || undefined })}
            className="input-field"
            style={{ fontSize: '0.72rem', padding: '2px 4px' }}
          >
            <option value="">All types</option>
            {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
          {POV_OPTIONS.map((pov) => (
            <button
              key={pov}
              className={`btn-xs${filters.pov === pov ? '' : ' btn-ghost'}`}
              style={{
                fontSize: 'var(--text-2xs)',
                background: filters.pov === pov ? POV_COLORS[pov] : undefined,
                color: filters.pov === pov ? '#000' : POV_COLORS[pov],
                border: `1px solid ${POV_COLORS[pov]}`,
                borderRadius: 10,
              }}
              onClick={() => setFilters({ ...filters, pov: filters.pov === pov ? undefined : pov })}
            >
              {pov.slice(0, 3).toUpperCase()}
            </button>
          ))}
          {(filters.type || filters.pov || searchQuery) && (
            <button
              className="btn-xs btn-ghost"
              style={{ fontSize: 'var(--text-2xs)' }}
              onClick={() => { setFilters({}); setSearchQuery(''); }}
            >
              Clear
            </button>
          )}
        </div>

        {/* List */}
        <div className="list-panel-items">
          {loading && organizations.length === 0 && (
            <div className="chat-session-empty">Loading organizations...</div>
          )}
          {error && organizations.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center' }}>
              <p style={{ color: 'var(--color-error, #ef4444)', marginBottom: 8, fontSize: '0.8rem' }}>{error}</p>
              <button className="btn btn-sm" onClick={() => void fetchOrganizations()}>Retry</button>
            </div>
          )}
          {!loading && !error && organizations.length === 0 && (
            <div className="chat-session-empty">
              No organizations available yet.
              <br />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Organization data has not been loaded.
              </span>
            </div>
          )}
          {!loading && organizations.length > 0 && filtered.length === 0 && (
            <div className="chat-session-empty">No organizations match your filters.</div>
          )}
          {filtered.map((org) => (
            <div
              key={org.id}
              className={`chat-session-item${selectedOrg?.id === org.id ? ' selected' : ''}`}
              onClick={() => selectOrganization(org.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="chat-session-item-title" style={{ flex: 1 }}>{org.name}</span>
                <PovDots alignment={org.pov_alignment} />
              </div>
              <div className="chat-session-item-meta">
                {org.type && (
                  <span style={{
                    padding: '1px 6px', borderRadius: 8, fontSize: 'var(--text-2xs)', fontWeight: 600,
                    background: 'var(--bg-hover)', color: 'var(--text-secondary)',
                  }}>
                    {org.type.replace(/_/g, ' ')}
                  </span>
                )}
                {org.short_name && org.short_name !== org.name && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{org.short_name}</span>
                )}
                {org.headquarters && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{org.headquarters}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Resize handle */}
      <div className="resize-handle" onMouseDown={onMouseDown} />

      {/* Right pane: detail */}
      <div className="detail-panel">
        {selectedOrg ? (
          <OrganizationDetail org={selectedOrg} onSelectOrg={selectOrganization} />
        ) : (
          <div className="detail-panel-empty">
            {organizations.length > 0
              ? 'Select an organization to view details'
              : 'No organizations loaded'}
          </div>
        )}
      </div>
    </div>
  );
}
