// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import type { AggregatedCrux, CruxSource } from '../../hooks/useTaxonomyStore';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { SearchPreview } from '../edge-browser/SearchPreview';
import { FallacyDetailPanel } from '../analysis/FallacyPanel';
import { PromptDetailPanel } from '../chat/PromptsPanel';
import { ToolbarPaneRenderer, isFullWidthPanel, PhoneToolClose } from '../shared/ToolbarPaneRenderer';
import { LinkedNodePreview } from '../shared/LinkedNodePreview';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import type { PromptCatalogEntry } from '../../data/promptCatalog';
import { PROMPT_CATALOG } from '../../data/promptCatalog';

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
        <div className="list-panel" style={{ width }}>
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
        <div className="list-panel" style={{ width }}>
          <div className="list-panel-header">
            <h2>Cruxes</h2>
            <div className="list-panel-header-actions">
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{filteredCruxes.length} of {cruxes.length}</span>
              <button className="pane-collapse-btn" onClick={() => setListCollapsed(true)} title="Collapse">&lsaquo;</button>
            </div>
          </div>

          {/* Filter bar */}
          <div style={{ padding: '4px 8px', display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid var(--border-color)' }}>
            {(['all', 'empirical', 'values', 'definitional'] as const).map(t => (
              <button
                key={t}
                className={`btn btn-sm${typeFilter === t ? ' btn-primary' : ''}`}
                onClick={() => setTypeFilter(t)}
                style={{ fontSize: '0.7rem', padding: '2px 6px' }}
              >
                {t === 'all' ? 'All' : TYPE_LABELS[t]} ({typeCounts[t]})
              </button>
            ))}
          </div>
          <div style={{ padding: '4px 8px', display: 'flex', gap: 4, borderBottom: '1px solid var(--border-color)' }}>
            {(['all', 'active', 'resolved', 'irreducible'] as const).map(r => (
              <button
                key={r}
                className={`btn btn-sm${resolutionFilter === r ? ' btn-primary' : ''}`}
                onClick={() => setResolutionFilter(r)}
                style={{ fontSize: '0.7rem', padding: '2px 6px', textTransform: 'capitalize' }}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-color)' }}>
            <input
              type="text"
              placeholder="Search cruxes..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ width: '100%', fontSize: '0.8rem', padding: '4px 6px' }}
            />
          </div>

          {/* Crux list */}
          <div className="list-panel-items">
            {filteredCruxes.length === 0 ? (
              <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: '0.8rem' }}>No cruxes match filters</div>
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <button className="pane-collapse-btn" onClick={() => setDetailCollapsed(true)} title="Collapse">&lsaquo;</button>
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

  const rs = crux.resolution_summary;
  const dominantState = rs.resolved > 0 && rs.active === 0 && rs.irreducible === 0
    ? 'resolved'
    : rs.irreducible > 0 && rs.active === 0
      ? 'irreducible'
      : 'active';

  return (
    <div
      ref={ref}
      className={`node-item ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(crux.id)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span
          style={{
            display: 'inline-block',
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: TYPE_COLORS[crux.type],
            flexShrink: 0, marginTop: 5,
          }}
          title={TYPE_LABELS[crux.type]}
        />
        <span style={{ flex: 1, fontSize: '0.8rem', lineHeight: 1.3 }}>
          {crux.statement.length > 120 ? crux.statement.slice(0, 120) + '...' : crux.statement}
        </span>
      </div>
      <div className="node-item-id" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span>{crux.id}</span>
        {crux.frequency > 1 && (
          <span style={{ color: 'var(--color-acc)', fontWeight: 600 }}>×{crux.frequency}</span>
        )}
        <span style={{
          color: dominantState === 'resolved' ? 'var(--color-saf)' : dominantState === 'irreducible' ? 'var(--color-skp)' : 'var(--text-muted)',
        }}>
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
    <div style={{ padding: '0 4px', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
            backgroundColor: TYPE_COLORS[crux.type], color: '#fff',
          }}>
            {TYPE_LABELS[crux.type]}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{crux.id}</span>
          {crux.frequency > 1 && (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-acc)', fontWeight: 600 }}>
              {crux.frequency} debates
            </span>
          )}
        </div>
        <p style={{ fontSize: '0.9rem', lineHeight: 1.5, margin: 0 }}>{crux.statement}</p>
      </div>

      {/* Resolution summary bar */}
      {total > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Resolution Status</div>
          <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: 'var(--bg-tertiary, #333)' }}>
            {rs.resolved > 0 && <div style={{ width: `${(rs.resolved / total) * 100}%`, backgroundColor: 'var(--color-saf, #22c55e)' }} title={`Resolved: ${rs.resolved}`} />}
            {rs.active > 0 && <div style={{ width: `${(rs.active / total) * 100}%`, backgroundColor: 'var(--text-muted, #888)' }} title={`Active: ${rs.active}`} />}
            {rs.irreducible > 0 && <div style={{ width: `${(rs.irreducible / total) * 100}%`, backgroundColor: 'var(--color-skp, #f59e0b)' }} title={`Irreducible: ${rs.irreducible}`} />}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: '0.7rem' }}>
            {rs.resolved > 0 && <span style={{ color: 'var(--color-saf)' }}>Resolved: {rs.resolved}</span>}
            {rs.active > 0 && <span style={{ color: 'var(--text-muted)' }}>Active: {rs.active}</span>}
            {rs.irreducible > 0 && <span style={{ color: 'var(--color-skp)' }}>Irreducible: {rs.irreducible}</span>}
          </div>
        </div>
      )}

      {/* Source debates */}
      {crux.sources.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
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
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
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
      className="btn btn-sm btn-ghost"
      onClick={() => onClick(source.debate_id)}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '6px 8px', marginBottom: 2, fontSize: '0.8rem',
        lineHeight: 1.3,
      }}
      title={`Debate: ${source.debate_topic}\nState: ${source.final_state}`}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {source.debate_topic}
        </span>
        <span style={{ color: stateColor, fontSize: '0.7rem', marginLeft: 8, flexShrink: 0 }}>
          {source.final_state}
        </span>
      </div>
    </button>
  );
}
