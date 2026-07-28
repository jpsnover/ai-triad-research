// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useMemo } from 'react';
import './OrganizationsTab.css';
import { useOrganizationStore } from '../../hooks/useOrganizationStore';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { OrganizationDetail, OrgLogo } from './OrganizationDetail';
import type { Organization, PovStance, PovAlignmentTier } from '../../bridge/types';

const POV_COLORS: Record<string, string> = {
  accelerationist: '#f97316',
  safetyist: '#22c55e',
  skeptic: '#a855f7',
};

const TIER_TO_SCORE: Record<PovAlignmentTier, number> = {
  opposes: -1.0, leans_against: -0.5, mixed_or_silent: 0, leans_toward: 0.5, champions: 1.0,
};
function tierScore(stance: PovStance): number { return TIER_TO_SCORE[stance.tier] ?? 0; }

const TYPE_OPTIONS = ['think_tank', 'advocacy', 'regulatory', 'academic', 'corporate', 'intergovernmental', 'civil_society', 'standards_body', 'research_lab'] as const;
const POV_OPTIONS = ['accelerationist', 'safetyist', 'skeptic'] as const;

function PovDots({ alignment }: { alignment?: Organization['pov_alignment'] }) {
  if (!alignment) return null;
  return (
    <span className="orgs-tab-pov-dots">
      {(['accelerationist', 'safetyist', 'skeptic'] as const).map((pov) => {
        const stance = alignment[pov];
        if (!stance) return null;
        const score = tierScore(stance);
        const color = POV_COLORS[pov] ?? 'var(--text-muted)';
        return (
          <span
            key={pov}
            title={`${pov}: ${stance.tier.replace('_', ' ')}`}
            className="orgs-tab-pov-dot"
            // eslint-disable-next-line local/no-inline-style -- background/opacity computed from pov + stance score
            style={{ background: color, opacity: Math.max(0.3, Math.abs(score)) }}
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
        return stance && (stance.tier === 'leans_toward' || stance.tier === 'champions');
      });
    }
    return list.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [organizations, searchQuery, filters]);

  return (
    <div className="two-column">
      {/* Left pane: list */}
      <div
        className="list-panel"
        // eslint-disable-next-line local/no-inline-style -- width is resizable-panel state
        style={{ width }}
      >
        <div className="list-panel-header">
          <h2>Organizations</h2>
          <span className="orgs-tab-muted-075">
            {filtered.length}{filtered.length !== organizations.length ? ` / ${organizations.length}` : ''}
          </span>
        </div>

        {/* Search */}
        <div className="orgs-tab-search-wrap">
          <input
            type="text"
            placeholder="Search organizations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field orgs-tab-search-input"
          />
        </div>

        {/* Filters */}
        <div className="orgs-tab-filters-row">
          <select
            value={filters.type ?? ''}
            onChange={(e) => setFilters({ ...filters, type: e.target.value || undefined })}
            className="input-field orgs-tab-type-select"
          >
            <option value="">All types</option>
            {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
          {POV_OPTIONS.map((pov) => (
            <button
              key={pov}
              className={`btn-xs orgs-tab-pov-btn${filters.pov === pov ? '' : ' btn-ghost'}`}
              // eslint-disable-next-line local/no-inline-style -- background/color/border depend on selected pov filter
              style={{
                background: filters.pov === pov ? POV_COLORS[pov] : undefined,
                color: filters.pov === pov ? '#000' : POV_COLORS[pov],
                border: `1px solid ${POV_COLORS[pov]}`,
              }}
              onClick={() => setFilters({ ...filters, pov: filters.pov === pov ? undefined : pov })}
            >
              {pov.slice(0, 3).toUpperCase()}
            </button>
          ))}
          {(filters.type || filters.pov || searchQuery) && (
            <button
              className="btn-xs btn-ghost orgs-tab-fs-2xs"
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
            <div className="orgs-tab-empty-state">
              <p className="orgs-tab-error-text">{error}</p>
              <button className="btn btn-sm" onClick={() => void fetchOrganizations()}>Retry</button>
            </div>
          )}
          {!loading && !error && organizations.length === 0 && (
            <div className="chat-session-empty">
              No organizations available yet.
              <br />
              <span className="orgs-tab-muted-075">
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
              <div className="orgs-tab-item-header">
                <OrgLogo name={org.name} url={org.url} size={20} />
                <span className="chat-session-item-title orgs-tab-flex-1">{org.name}</span>
                <PovDots alignment={org.pov_alignment} />
              </div>
              <div className="chat-session-item-meta">
                {org.type && (
                  <span className="orgs-tab-type-badge">
                    {org.type.replace(/_/g, ' ')}
                  </span>
                )}
                {org.short_name && org.short_name !== org.name && (
                  <span className="orgs-tab-muted-072">{org.short_name}</span>
                )}
                {org.headquarters && (
                  <span className="orgs-tab-muted-072">{org.headquarters}</span>
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
