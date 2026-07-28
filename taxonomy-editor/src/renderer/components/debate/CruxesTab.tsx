// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { api, isElectronMode } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import type { AggregatedCrux, CruxSource, CruxExternalEvidence } from '../../hooks/useTaxonomyStore';
import { useFlag } from '../../hooks/useFeatureFlags';
import { todayISO } from '../../utils/idGenerator';
import './CruxesTab.css';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { SearchWithHistory } from '../shared/SearchWithHistory';
import { SearchPreview } from '../edge-browser/SearchPreview';
import { FallacyDetailPanel } from '../analysis/FallacyPanel';
import { PromptDetailPanel } from '../chat/PromptsPanel';
import { ToolbarPaneRenderer, isFullWidthPanel, PhoneToolClose } from '../shared/ToolbarPaneRenderer';
import { LinkedNodePreview } from '../shared/LinkedNodePreview';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import type { PromptCatalogEntry } from '../../data/promptCatalog';
import { PROMPT_CATALOG } from '../../data/promptCatalog';
import { cruxDominantState } from './cruxState';

type CruxType = 'empirical' | 'values' | 'definitional';
type ResolutionFilter = 'all' | 'active' | 'resolved' | 'irreducible';

const TYPE_COLORS: Record<CruxType, string> = {
  empirical: 'var(--color-acc, #3b82f6)',
  values: 'var(--color-saf, #ef4444)',
  definitional: 'var(--color-skp, #f59e0b)',
};

const TYPE_LABELS: Record<CruxType, string> = {
  empirical: 'Empirical',
  values: 'Values',
  definitional: 'Definitional',
};

export function CruxesTab() {
  const {
    aggregatedCruxes, selectedNodeId, setSelectedNodeId, toolbarPanel, navigateToNode,
  } = useTaxonomyStore();

  const [typeFilter, setTypeFilter] = useState<CruxType | 'all'>('all');
  const [resolutionFilter, setResolutionFilter] = useState<ResolutionFilter>('all');
  const [searchText, setSearchText] = useState('');
  const [listCollapsed, setListCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [searchPreviewId, setSearchPreviewId] = useState<string | null>(null);
  const [selectedPromptEntry, setSelectedPromptEntry] = useState<PromptCatalogEntry | null>(PROMPT_CATALOG[0]);
  const [promptInspectorActive, setPromptInspectorActive] = useState(false);
  const { width, onMouseDown } = useResizablePanel();
  const breakpoint = useBreakpoint();
  const isPhone = breakpoint === 'phone' || breakpoint === 'phone-lg';

  const cruxes = aggregatedCruxes ?? [];

  const filteredCruxes = useMemo(() => {
    let result = cruxes;
    if (typeFilter !== 'all') {
      result = result.filter(c => c.type === typeFilter);
    }
    if (resolutionFilter !== 'all') {
      result = result.filter(c => {
        const rs = c.resolution_summary;
        switch (resolutionFilter) {
          case 'active': return rs.active > 0;
          case 'resolved': return rs.resolved > 0;
          case 'irreducible': return rs.irreducible > 0;
          default: return true;
        }
      });
    }
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = result.filter(c => c.statement.toLowerCase().includes(q));
    }
    // Sort by frequency desc, then alphabetically
    return [...result].sort((a, b) => b.frequency - a.frequency || a.statement.localeCompare(b.statement));
  }, [cruxes, typeFilter, resolutionFilter, searchText]);

  const orderedIds = useMemo(() => filteredCruxes.map(c => c.id), [filteredCruxes]);

  useKeyboardNav(orderedIds, selectedNodeId, setSelectedNodeId);

  // Auto-select first crux on load
  useEffect(() => {
    if (!selectedNodeId && orderedIds.length > 0) {
      setSelectedNodeId(orderedIds[0]);
    }
  }, []);

  const selectedCrux = cruxes.find(c => c.id === selectedNodeId) ?? null;

  const fullWidth = isFullWidthPanel(toolbarPanel, promptInspectorActive);

  const handleDebateClick = useCallback((debateId: string) => {
    navigateToNode('debate', debateId);
  }, [navigateToNode]);

  // Type counts for filter badges
  const typeCounts = useMemo(() => {
    const counts = { all: cruxes.length, empirical: 0, values: 0, definitional: 0 };
    for (const c of cruxes) counts[c.type]++;
    return counts;
  }, [cruxes]);

  return (
    <div className={`two-column${isPhone ? ' phone-mode' : ''}${isPhone && selectedNodeId && !toolbarPanel ? ' has-selection' : ''}`}>
      {fullWidth ? (
        <div className="list-panel list-panel-full">
            {isPhone && <PhoneToolClose />}
          <ToolbarPaneRenderer
            panel={toolbarPanel}
            onSelectResult={setSearchPreviewId}
            onSelectPrompt={setSelectedPromptEntry}
            onInspectorToggle={setPromptInspectorActive}
          />
        </div>
      ) : toolbarPanel ? (
        <div
          className="list-panel"
          // eslint-disable-next-line local/no-inline-style -- dynamic: width from useResizablePanel
          style={{ width }}
        >
            {isPhone && <PhoneToolClose />}
          <ToolbarPaneRenderer
            panel={toolbarPanel}
            onSelectResult={setSearchPreviewId}
            onSelectPrompt={setSelectedPromptEntry}
            onInspectorToggle={setPromptInspectorActive}
          />
        </div>
      ) : listCollapsed ? (
        <div className="pane-collapsed pane-collapsed-list" onClick={() => setListCollapsed(false)} title="Expand list">
          <span className="pane-collapsed-label">Cruxes</span>
        </div>
      ) : (
        <div
          className="list-panel"
          // eslint-disable-next-line local/no-inline-style -- dynamic: width from useResizablePanel
          style={{ width }}
        >
          <div className="list-panel-header">
            <h2>Cruxes</h2>
            <div className="list-panel-header-actions">
              <span className="crux-count-label">{filteredCruxes.length} of {cruxes.length}</span>
              <button className="pane-collapse-btn" onClick={() => setListCollapsed(true)} title="Collapse" aria-label="Collapse panel">&lsaquo;</button>
            </div>
          </div>

          {/* Filter bar */}
          <div className="crux-filter-bar">
            {(['all', 'empirical', 'values', 'definitional'] as const).map(t => (
              <button
                key={t}
                className={`btn btn-sm crux-filter-btn${typeFilter === t ? ' btn-primary' : ''}`}
                onClick={() => setTypeFilter(t)}
              >
                {t === 'all' ? 'All' : TYPE_LABELS[t]} ({typeCounts[t]})
              </button>
            ))}
          </div>
          <div className="crux-resolution-filter-bar">
            {(['all', 'active', 'resolved', 'irreducible'] as const).map(r => (
              <button
                key={r}
                className={`btn btn-sm crux-resolution-filter-btn${resolutionFilter === r ? ' btn-primary' : ''}`}
                onClick={() => setResolutionFilter(r)}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="crux-search-bar">
            <SearchWithHistory
              area="cruxes"
              placeholder="Search cruxes..."
              value={searchText}
              onChange={setSearchText}
              className="search-panel-text-input"
            />
          </div>

          {/* Crux list */}
          <div className="list-panel-items">
            {filteredCruxes.length === 0 ? (
              <div className="crux-empty">No cruxes match filters</div>
            ) : (
              filteredCruxes.map(crux => (
                <CruxListItem
                  key={crux.id}
                  crux={crux}
                  isSelected={selectedNodeId === crux.id}
                  onSelect={setSelectedNodeId}
                />
              ))
            )}
          </div>
        </div>
      )}

      {!fullWidth && <div className="resize-handle" onMouseDown={onMouseDown} />}

      {fullWidth ? null : toolbarPanel === 'search' ? (
        <div className="detail-panel">
          <SearchPreview searchPreviewId={searchPreviewId} onClear={() => setSearchPreviewId(null)} />
        </div>
      ) : (toolbarPanel === 'prompts' && !promptInspectorActive) ? (
        <div className="detail-panel">
          <PromptDetailPanel entry={selectedPromptEntry} />
        </div>
      ) : detailCollapsed ? (
        <div className="pane-collapsed pane-collapsed-detail" onClick={() => setDetailCollapsed(false)} title="Expand detail">
          <span className="pane-collapsed-label">Detail</span>
        </div>
      ) : (
        <div className="detail-panel">
          {isPhone && selectedNodeId ? (
            <div className="phone-detail-header">
              <button className="phone-detail-back" onClick={() => setSelectedNodeId('')}>
                &larr; Cruxes
              </button>
            </div>
          ) : (
            <div className="crux-detail-collapse-row">
              <button className="pane-collapse-btn" onClick={() => setDetailCollapsed(true)} title="Collapse" aria-label="Collapse panel">&lsaquo;</button>
            </div>
          )}
          {selectedCrux ? (
            <CruxDetail crux={selectedCrux} onDebateClick={handleDebateClick} />
          ) : (
            <div className="detail-panel-empty">Select a crux to view details</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── List Item ──

function CruxListItem({ crux, isSelected, onSelect }: {
  crux: AggregatedCrux;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSelected && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' });
    }
  }, [isSelected]);

  const dominantState = cruxDominantState(crux.resolution_summary);

  return (
    <div
      ref={ref}
      className={`node-item ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(crux.id)}
    >
      <div className="crux-list-item-row">
        <span
          // eslint-disable-next-line local/no-inline-style -- dynamic: backgroundColor from TYPE_COLORS
          style={{
            display: 'inline-block',
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: TYPE_COLORS[crux.type],
            flexShrink: 0, marginTop: 5,
          }}
          title={TYPE_LABELS[crux.type]}
        />
        <span className="crux-list-item-statement">
          {crux.statement.length > 120 ? crux.statement.slice(0, 120) + '...' : crux.statement}
        </span>
      </div>
      <div className="node-item-id crux-list-item-meta">
        <span>{crux.id}</span>
        {crux.frequency > 1 && (
          <span className="crux-frequency-badge">×{crux.frequency}</span>
        )}
        <span
          // eslint-disable-next-line local/no-inline-style -- dynamic: color depends on dominantState
          style={{
            color: dominantState === 'resolved' ? 'var(--color-saf)' : dominantState === 'irreducible' ? 'var(--color-skp)' : 'var(--text-muted)',
          }}
        >
          [{dominantState}]
        </span>
      </div>
    </div>
  );
}

// ── Detail Panel ──

export function CruxDetail({ crux, onDebateClick }: {
  crux: AggregatedCrux;
  onDebateClick: (id: string) => void;
}) {
  const rs = crux.resolution_summary;
  const total = rs.resolved + rs.active + rs.irreducible;
  // Linked nodes and conflicts expand inline (read-only) instead of navigating away.
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) => setExpandedNodes(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="crux-detail">
      {/* Header */}
      <div className="crux-detail-header">
        <div className="crux-detail-header-row">
          <span
            // eslint-disable-next-line local/no-inline-style -- dynamic: backgroundColor from TYPE_COLORS
            style={{
              padding: '2px 8px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
              backgroundColor: TYPE_COLORS[crux.type], color: '#fff',
            }}
          >
            {TYPE_LABELS[crux.type]}
          </span>
          <span className="crux-count-label">{crux.id}</span>
          {crux.frequency > 1 && (
            <span className="crux-detail-frequency">
              {crux.frequency} debates
            </span>
          )}
        </div>
        <p className="crux-statement">{crux.statement}</p>
      </div>

      {/* Resolution summary bar */}
      {total > 0 && (
        <div className="crux-section">
          <div className="crux-resolution-label">Resolution Status</div>
          <div className="crux-resolution-track">
            {/* eslint-disable-next-line local/no-inline-style -- dynamic: width is a computed percentage */}
            {rs.resolved > 0 && <div style={{ width: `${(rs.resolved / total) * 100}%`, backgroundColor: 'var(--color-saf, #22c55e)' }} title={`Resolved: ${rs.resolved}`} />}
            {/* eslint-disable-next-line local/no-inline-style -- dynamic: width is a computed percentage */}
            {rs.active > 0 && <div style={{ width: `${(rs.active / total) * 100}%`, backgroundColor: 'var(--text-muted, #888)' }} title={`Active: ${rs.active}`} />}
            {/* eslint-disable-next-line local/no-inline-style -- dynamic: width is a computed percentage */}
            {rs.irreducible > 0 && <div style={{ width: `${(rs.irreducible / total) * 100}%`, backgroundColor: 'var(--color-skp, #f59e0b)' }} title={`Irreducible: ${rs.irreducible}`} />}
          </div>
          <div className="crux-resolution-legend">
            {rs.resolved > 0 && <span className="crux-legend-resolved">Resolved: {rs.resolved}</span>}
            {rs.active > 0 && <span className="crux-legend-active">Active: {rs.active}</span>}
            {rs.irreducible > 0 && <span className="crux-legend-irreducible">Irreducible: {rs.irreducible}</span>}
          </div>
        </div>
      )}

      {/* Source debates */}
      {crux.sources.length > 0 && (
        <div className="crux-section">
          <div className="crux-section-heading">
            Source Debates ({crux.sources.length})
          </div>
          {crux.sources.map((src, i) => (
            <SourceDebateItem key={i} source={src} onClick={onDebateClick} />
          ))}
        </div>
      )}

      {/* Linked taxonomy nodes — expand inline (read-only) */}
      <ExpandableLinkList
        label="Linked Nodes"
        ids={crux.linked_node_ids}
        expanded={expandedNodes}
        onToggle={toggleExpanded}
      />

      {/* Linked conflicts — expand inline (read-only) */}
      <ExpandableLinkList
        label="Linked Conflicts"
        ids={crux.linked_conflict_ids ?? []}
        expanded={expandedNodes}
        onToggle={toggleExpanded}
      />

      {/* External evidence — reviewer-entered, display-only metadata (t/1541) */}
      <ExternalEvidenceSection crux={crux} />
    </div>
  );
}

// ── External Evidence ──

/**
 * Reviewer-entered pointers to real-world evidence found while investigating a
 * crux (t/1541) — the "handoff to reality" the framing paper describes. This is
 * append-only, CL-owned DISPLAY-ONLY metadata: it must never be read by any
 * scoring, sort-key, or tier-computation code (register entry 1584553e). Editing
 * is gated to admins/reviewers; everyone else sees the list read-only.
 *
 * The bridge add/remove methods return void, so we optimistically update local
 * state (the server stamps added_at; we mirror it with todayISO for display).
 */
function ExternalEvidenceSection({ crux }: { crux: AggregatedCrux }) {
  const adminFeatures = useFlag('permission-admin-features');
  const canEdit = isElectronMode() || adminFeatures;

  const [entries, setEntries] = useState<CruxExternalEvidence[]>(crux.external_evidence ?? []);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [addedBy, setAddedBy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset local state when switching cruxes.
  useEffect(() => {
    setEntries(crux.external_evidence ?? []);
    setUrl(''); setNote(''); setError(null);
  }, [crux.id, crux.external_evidence]);

  const urlValid = /^https?:\/\//i.test(url.trim());
  const canSubmit = canEdit && !busy && urlValid && addedBy.trim().length > 0;

  const handleAdd = async () => {
    if (!canSubmit) return;
    setBusy(true); setError(null);
    const entry = { url: url.trim(), note: note.trim() || undefined, added_by: addedBy.trim() };
    try {
      await api.addCruxEvidence(crux.id, entry);
      setEntries(prev => [...prev, { ...entry, added_at: todayISO() }]);
      setUrl(''); setNote(''); // keep addedBy for consecutive entries
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'crux-external-evidence', level: 'error',
        message: 'Failed to add crux external evidence',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setError('Could not save evidence. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (index: number) => {
    setBusy(true); setError(null);
    try {
      await api.removeCruxEvidence(crux.id, index);
      setEntries(prev => prev.filter((_, i) => i !== index));
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'crux-external-evidence', level: 'error',
        message: 'Failed to remove crux external evidence',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setError('Could not remove evidence. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Nothing to show and no way to add — render nothing (matches ExpandableLinkList).
  if (entries.length === 0 && !canEdit) return null;

  return (
    <div className="crux-evidence">
      <div className="crux-section-label">
        External Evidence{entries.length > 0 ? ` (${entries.length})` : ''}
      </div>

      {entries.length === 0 && (
        <div className="crux-evidence-empty">No external evidence recorded yet.</div>
      )}

      {entries.map((e, i) => {
        const display = e.url.replace(/^https?:\/\//, '');
        return (
          <div key={i} className="crux-evidence-item">
            <div className="crux-evidence-item-head">
              <a
                className="crux-evidence-url"
                href="#"
                title={e.url}
                onClick={(ev) => { ev.preventDefault(); void api.openExternal(e.url); }}
              >
                {display.slice(0, 60)}{display.length > 60 ? '…' : ''}
              </a>
              {canEdit && (
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void handleRemove(i)}>
                  Remove
                </button>
              )}
            </div>
            {e.note && <div className="crux-evidence-note">{e.note}</div>}
            <div className="crux-evidence-meta">
              {e.added_by}{e.added_at ? ` · ${e.added_at}` : ''}
            </div>
          </div>
        );
      })}

      {canEdit && (
        <div className="card crux-evidence-form">
          <div className="form-group">
            <label>Evidence URL</label>
            <input type="url" value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Note (optional)</label>
            <textarea value={note} rows={2} placeholder="What this shows, in your words" onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Added by</label>
            <input type="text" value={addedBy} placeholder="Your name or reviewer id" onChange={(e) => setAddedBy(e.target.value)} />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary btn-sm" disabled={!canSubmit} onClick={() => void handleAdd()}>
            {busy ? 'Saving…' : 'Add Evidence'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Expandable Link List ──

/** Renders linked entity ids as chips that toggle an inline read-only preview. */
function ExpandableLinkList({ label, ids, expanded, onToggle }: {
  label: string;
  ids: string[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (ids.length === 0) return null;
  return (
    <div className="crux-section">
      <div className="crux-section-heading">
        {label} ({ids.length})
      </div>
      <div className="chip-list">
        {ids.map(id => (
          <span key={id} className={`chip${expanded.has(id) ? ' chip-expanded' : ''}`}>
            <span
              className="chip-content"
              onClick={() => onToggle(id)}
              title="Click to expand content"
            >
              <span className="chip-id">{id}</span>
              <span className="chip-expand-indicator">{expanded.has(id) ? '▲' : '▼'}</span>
            </span>
          </span>
        ))}
      </div>
      {ids.filter(id => expanded.has(id)).map(id => (
        <LinkedNodePreview key={id} nodeId={id} />
      ))}
    </div>
  );
}

// ── Source Debate Item ──

function SourceDebateItem({ source, onClick }: {
  source: CruxSource;
  onClick: (id: string) => void;
}) {
  const stateColor = source.final_state === 'resolved'
    ? 'var(--color-saf, #22c55e)'
    : source.final_state === 'irreducible'
      ? 'var(--color-skp, #f59e0b)'
      : 'var(--text-muted)';

  return (
    <button
      className="btn btn-sm btn-ghost crux-source-btn"
      onClick={() => onClick(source.debate_id)}
      title={`Debate: ${source.debate_topic}\nState: ${source.final_state}`}
    >
      <div className="crux-source-row">
        <span className="crux-source-topic">
          {source.debate_topic}
        </span>
        <span
          // eslint-disable-next-line local/no-inline-style -- dynamic: color from stateColor
          style={{ color: stateColor, fontSize: '0.7rem', marginLeft: 8, flexShrink: 0 }}
        >
          {source.final_state}
        </span>
      </div>
    </button>
  );
}
