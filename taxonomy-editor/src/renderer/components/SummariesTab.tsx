// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { api } from '@bridge';
import type { Pov, Category } from '../types/taxonomy';

// ── Types ──

interface SourceInfo {
  id: string;
  title: string;
  url: string | null;
  sourceType: string;
  datePublished: string;
  dateIngested: string;
  hasSummary: boolean;
  tags: string[];
  authors: string[];
}

interface KeyPoint {
  stance: string;
  taxonomy_node_id: string | null;
  category: string;
  point: string;
  verbatim?: string;
  excerpt_context?: string;
}

interface PovSummary {
  stance?: string;
  key_points: KeyPoint[];
}

interface FactualClaim {
  claim: string;
  doc_position?: string;
  potential_conflict_id?: string | null;
}

interface UnmappedConcept {
  concept: string;
  suggested_label?: string;
  suggested_description?: string;
  suggested_pov?: string;
  suggested_category?: string;
  reason?: string;
  resolved_node_id?: string;
}

interface Summary {
  doc_id: string;
  taxonomy_version?: string;
  generated_at?: string;
  model_info?: { model?: string; chunk_count?: number };
  pov_summaries: Record<string, PovSummary>;
  factual_claims?: FactualClaim[];
  unmapped_concepts?: UnmappedConcept[];
}

// ── Helpers ──

const POV_COLORS: Record<string, string> = {
  accelerationist: 'var(--color-acc, #22c55e)',
  safetyist: 'var(--color-saf, #ef4444)',
  skeptic: 'var(--color-skp, #f59e0b)',
};

const STANCE_EMOJI: Record<string, string> = {
  strongly_aligned: '++',
  aligned: '+',
  neutral: '~',
  opposed: '-',
  strongly_opposed: '--',
};

function stanceClass(stance: string): string {
  if (stance.includes('strongly_aligned')) return 'stance-strongly-aligned';
  if (stance.includes('aligned')) return 'stance-aligned';
  if (stance.includes('opposed') && stance.includes('strongly')) return 'stance-strongly-opposed';
  if (stance.includes('opposed')) return 'stance-opposed';
  return 'stance-neutral';
}

// ── Component ──

type ViewMode = 'key-points' | 'claims' | 'unmapped' | 'document';
type SortField = 'title' | 'dateIngested' | 'datePublished';

const POV_MAP: Record<string, Pov> = {
  accelerationist: 'accelerationist',
  safetyist: 'safetyist',
  skeptic: 'skeptic',
};

const CATEGORY_MAP: Record<string, Category> = {
  Desires: 'Desires',
  Beliefs: 'Beliefs',
  Intentions: 'Intentions',
};

export function SummariesTab() {
  const { getLabelForId, navigateToNode, setActiveTab, createPovNode, updatePovNode } = useTaxonomyStore();
  const { width: listWidth, onMouseDown } = useResizablePanel();

  // Sources
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [filter, setFilter] = useState('');

  // Selected source
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Document
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  // View
  const [viewMode, setViewMode] = useState<ViewMode>('key-points');
  const [povFilter, setPovFilter] = useState<string | null>(null);

  // Sort
  const [sortField, setSortField] = useState<SortField>('dateIngested');
  const [sortDesc, setSortDesc] = useState(true);

  // Load sources on mount
  useEffect(() => {
    setSourcesLoading(true);
    api.discoverSources()
      .then((data) => setSources((data as SourceInfo[]).filter(s => s.hasSummary)))
      .catch(err => console.error('Failed to load sources:', err))
      .finally(() => setSourcesLoading(false));
  }, []);

  // Load summary when source selected
  useEffect(() => {
    if (!selectedSourceId) { setSummary(null); setSnapshot(null); return; }
    setSummaryLoading(true);
    api.loadSummary(selectedSourceId)
      .then(data => setSummary(data as Summary | null))
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoading(false));
  }, [selectedSourceId]);

  // Load snapshot lazily when document view is shown
  useEffect(() => {
    if (viewMode !== 'document' || !selectedSourceId || snapshot) return;
    setSnapshotLoading(true);
    api.loadSnapshot(selectedSourceId)
      .then(data => setSnapshot(data?.content ?? null))
      .catch(() => setSnapshot(null))
      .finally(() => setSnapshotLoading(false));
  }, [viewMode, selectedSourceId, snapshot]);

  // Reset snapshot when source changes
  useEffect(() => { setSnapshot(null); }, [selectedSourceId]);

  // Filtered and sorted sources
  const filteredSources = useMemo(() => {
    let result = sources;
    if (filter) {
      const q = filter.toLowerCase();
      result = result.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.authors.some(a => a.toLowerCase().includes(q)) ||
        s.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    const sorted = [...result].sort((a, b) => {
      let cmp: number;
      if (sortField === 'title') {
        cmp = a.title.localeCompare(b.title);
      } else {
        const av = a[sortField] || '';
        const bv = b[sortField] || '';
        cmp = av.localeCompare(bv);
      }
      return sortDesc ? -cmp : cmp;
    });
    return sorted;
  }, [sources, filter, sortField, sortDesc]);

  // Aggregated key points
  const keyPoints = useMemo(() => {
    if (!summary) return [];
    const points: (KeyPoint & { pov: string })[] = [];
    for (const [pov, data] of Object.entries(summary.pov_summaries)) {
      for (const kp of data.key_points || []) {
        if (povFilter && pov !== povFilter) continue;
        points.push({ ...kp, pov });
      }
    }
    return points;
  }, [summary, povFilter]);

  const selectedSource = sources.find(s => s.id === selectedSourceId);

  const addUnmappedToTaxonomy = useCallback((uc: UnmappedConcept) => {
    const pov = POV_MAP[uc.suggested_pov || ''];
    const category = CATEGORY_MAP[uc.suggested_category || ''];
    if (!pov || !category) return;
    const newId = createPovNode(pov, category);
    if (!newId) return;
    updatePovNode(pov, newId, {
      label: uc.suggested_label || uc.concept,
      description: uc.suggested_description || uc.concept,
    });
    setActiveTab(pov);
    navigateToNode(pov, newId);
  }, [createPovNode, updatePovNode, setActiveTab, navigateToNode]);

  const handleNodeClick = useCallback((nodeId: string) => {
    // Navigate to the node in the appropriate tab
    if (nodeId.startsWith('acc-')) { setActiveTab('accelerationist'); navigateToNode('accelerationist', nodeId); }
    else if (nodeId.startsWith('saf-')) { setActiveTab('safetyist'); navigateToNode('safetyist', nodeId); }
    else if (nodeId.startsWith('skp-')) { setActiveTab('skeptic'); navigateToNode('skeptic', nodeId); }
    else if (nodeId.startsWith('sit-') || nodeId.startsWith('cc-')) { setActiveTab('situations'); navigateToNode('situations', nodeId); }
    else if (nodeId.startsWith('conflict-')) { setActiveTab('conflicts'); navigateToNode('conflicts', nodeId); }
  }, [setActiveTab, navigateToNode]);

  return (
    <div className="two-column">
      {/* ── Pane 1: Source List ── */}
      <div className="list-panel" style={{ width: listWidth, minWidth: 200 }}>
        <div className="panel-header">
          <h3>Sources ({filteredSources.length})</h3>
        </div>
        <div style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input
            type="text"
            className="search-input"
            placeholder="Filter sources..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.6rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Sort:</span>
            {([['dateIngested', 'Imported'], ['datePublished', 'Published'], ['title', 'Title']] as const).map(([field, label]) => (
              <button
                key={field}
                onClick={() => {
                  if (sortField === field) setSortDesc(d => !d);
                  else { setSortField(field); setSortDesc(field !== 'title'); }
                }}
                style={{
                  padding: '1px 5px', fontSize: '0.6rem', border: 'none', borderRadius: 3, cursor: 'pointer',
                  background: sortField === field ? 'var(--accent-color, #3b82f6)' : 'var(--bg-secondary)',
                  color: sortField === field ? '#fff' : 'var(--text-muted)',
                }}
              >{label}{sortField === field ? (sortDesc ? ' \u25BC' : ' \u25B2') : ''}</button>
            ))}
          </div>
        </div>
        <div className="panel-body" style={{ overflow: 'auto', flex: 1 }}>
          {sourcesLoading ? (
            <div className="panel-empty">Loading sources...</div>
          ) : filteredSources.length === 0 ? (
            <div className="panel-empty">No sources with summaries found.</div>
          ) : (
            <ul className="node-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {filteredSources.map(s => (
                <li
                  key={s.id}
                  className={`node-item${s.id === selectedSourceId ? ' node-item-selected' : ''}`}
                  onClick={() => setSelectedSourceId(s.id)}
                  style={{ cursor: 'pointer', padding: '6px 8px', borderBottom: '1px solid var(--border-color)' }}
                >
                  <div style={{ fontSize: '0.8rem', fontWeight: 500 }}>{s.title}</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {s.tags.map(t => (
                      <span key={t} style={{
                        display: 'inline-block',
                        padding: '0 4px',
                        marginRight: 3,
                        borderRadius: 3,
                        fontSize: '0.6rem',
                        backgroundColor: t === 'accelerationist' ? 'rgba(34,197,94,0.15)' :
                          t === 'safetyist' ? 'rgba(239,68,68,0.15)' :
                          t === 'skeptic' ? 'rgba(245,158,11,0.15)' :
                          'rgba(148,163,184,0.15)',
                        color: t === 'accelerationist' ? 'var(--color-acc, #22c55e)' :
                          t === 'safetyist' ? 'var(--color-saf, #ef4444)' :
                          t === 'skeptic' ? 'var(--color-skp, #f59e0b)' :
                          'var(--text-muted)',
                      }}>{t.slice(0, 3)}</span>
                    ))}
                    {sortField === 'dateIngested' && s.dateIngested
                      ? <span style={{ marginLeft: 4 }}>{s.dateIngested.slice(0, 10)}</span>
                      : s.datePublished && <span style={{ marginLeft: 4 }}>{s.datePublished.slice(0, 10)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Resize Handle ── */}
      <div className="resize-handle" onMouseDown={onMouseDown} />

      {/* ── Pane 2: Summary Detail ── */}
      <div className="detail-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedSourceId ? (
          <div className="panel-empty" style={{ padding: 20 }}>Select a source document to view its summary.</div>
        ) : summaryLoading ? (
          <div className="panel-empty" style={{ padding: 20 }}>Loading summary...</div>
        ) : !summary ? (
          <div className="panel-empty" style={{ padding: 20 }}>No summary found for this source.</div>
        ) : (
          <>
            {/* Header */}
            <div className="panel-header" style={{ flexShrink: 0 }}>
              <h3 style={{ fontSize: '0.85rem', margin: 0 }}>{selectedSource?.title}</h3>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {summary.model_info?.model && <span>Model: {summary.model_info.model}</span>}
                {summary.generated_at && <span style={{ marginLeft: 8 }}>Generated: {summary.generated_at.slice(0, 10)}</span>}
                {summary.model_info?.chunk_count && <span style={{ marginLeft: 8 }}>Chunks: {summary.model_info.chunk_count}</span>}
              </div>
            </div>

            {/* View mode tabs */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-color)', flexShrink: 0, padding: '0 8px' }}>
              {(['key-points', 'claims', 'unmapped', 'document'] as ViewMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.7rem',
                    border: 'none',
                    borderBottom: viewMode === mode ? '2px solid var(--accent-color, #3b82f6)' : '2px solid transparent',
                    background: 'none',
                    color: viewMode === mode ? 'var(--text-primary)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    fontWeight: viewMode === mode ? 600 : 400,
                  }}
                >
                  {mode === 'key-points' ? `Key Points (${keyPoints.length})` :
                   mode === 'claims' ? `Claims (${summary.factual_claims?.length ?? 0})` :
                   mode === 'unmapped' ? `Unmapped (${summary.unmapped_concepts?.length ?? 0})` :
                   'Document'}
                </button>
              ))}

              {/* POV filter */}
              {viewMode === 'key-points' && (
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    onClick={() => setPovFilter(null)}
                    style={{
                      padding: '2px 6px', fontSize: '0.6rem', border: 'none', borderRadius: 3, cursor: 'pointer',
                      background: !povFilter ? 'var(--accent-color, #3b82f6)' : 'var(--bg-secondary)',
                      color: !povFilter ? '#fff' : 'var(--text-muted)',
                    }}
                  >All</button>
                  {Object.keys(summary.pov_summaries).map(pov => (
                    <button
                      key={pov}
                      onClick={() => setPovFilter(pov)}
                      style={{
                        padding: '2px 6px', fontSize: '0.6rem', border: 'none', borderRadius: 3, cursor: 'pointer',
                        background: povFilter === pov ? (POV_COLORS[pov] || '#666') : 'var(--bg-secondary)',
                        color: povFilter === pov ? '#fff' : 'var(--text-muted)',
                      }}
                    >{pov.slice(0, 3)}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
              {viewMode === 'key-points' && (
                <div>
                  {keyPoints.length === 0 ? (
                    <div className="panel-empty">No key points found.</div>
                  ) : keyPoints.map((kp, i) => (
                    <div key={i} style={{
                      padding: '8px 10px',
                      marginBottom: 6,
                      borderRadius: 4,
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-secondary)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '1px 5px',
                          borderRadius: 3,
                          fontSize: '0.6rem',
                          fontWeight: 600,
                          backgroundColor: POV_COLORS[kp.pov] ? `${POV_COLORS[kp.pov]}22` : 'var(--bg-tertiary)',
                          color: POV_COLORS[kp.pov] || 'var(--text-muted)',
                        }}>{kp.pov.slice(0, 3)}</span>
                        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{kp.category}</span>
                        <span style={{ fontSize: '0.6rem', fontWeight: 600 }} className={stanceClass(kp.stance)}>
                          {STANCE_EMOJI[kp.stance] || '~'} {kp.stance.replace(/_/g, ' ')}
                        </span>
                        {kp.taxonomy_node_id && (
                          <button
                            onClick={() => handleNodeClick(kp.taxonomy_node_id!)}
                            style={{
                              marginLeft: 'auto', padding: '1px 6px', fontSize: '0.6rem',
                              border: '1px solid var(--border-color)', borderRadius: 3,
                              background: 'var(--bg-primary)', color: 'var(--accent-color, #3b82f6)',
                              cursor: 'pointer',
                            }}
                            title={kp.taxonomy_node_id}
                          >
                            {getLabelForId(kp.taxonomy_node_id) || kp.taxonomy_node_id}
                          </button>
                        )}
                      </div>
                      <div style={{ fontSize: '0.75rem', lineHeight: 1.5 }}>{kp.point}</div>
                      {kp.verbatim && (
                        <div style={{
                          fontSize: '0.7rem', marginTop: 4, padding: '4px 8px',
                          borderLeft: '2px solid var(--border-color)',
                          color: 'var(--text-muted)', fontStyle: 'italic',
                        }}>
                          "{kp.verbatim}"
                        </div>
                      )}
                      {kp.excerpt_context && (
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          {kp.excerpt_context}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {viewMode === 'claims' && (
                <div>
                  {!summary.factual_claims?.length ? (
                    <div className="panel-empty">No factual claims extracted.</div>
                  ) : summary.factual_claims.map((claim, i) => (
                    <div key={i} style={{
                      padding: '6px 10px', marginBottom: 4, borderRadius: 4,
                      border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)',
                    }}>
                      <div style={{ fontSize: '0.75rem' }}>{claim.claim}</div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 8 }}>
                        {claim.doc_position && <span>{claim.doc_position}</span>}
                        {claim.potential_conflict_id && (
                          <button
                            onClick={() => handleNodeClick(claim.potential_conflict_id!)}
                            style={{
                              padding: '0 4px', fontSize: '0.6rem', border: 'none', background: 'none',
                              color: 'var(--accent-color, #3b82f6)', cursor: 'pointer', textDecoration: 'underline',
                            }}
                          >
                            {claim.potential_conflict_id}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {viewMode === 'unmapped' && (
                <div>
                  {!summary.unmapped_concepts?.length ? (
                    <div className="panel-empty">No unmapped concepts.</div>
                  ) : summary.unmapped_concepts.map((uc, i) => (
                    <div key={i} style={{
                      padding: '8px 10px', marginBottom: 6, borderRadius: 4,
                      border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{uc.suggested_label || uc.concept}</span>
                        {uc.resolved_node_id && (
                          <span style={{
                            padding: '1px 5px', borderRadius: 3, fontSize: '0.6rem',
                            backgroundColor: 'rgba(34,197,94,0.15)', color: '#22c55e',
                          }}>mapped</span>
                        )}
                      </div>
                      {uc.suggested_description && (
                        <div style={{ fontSize: '0.7rem', marginTop: 4, color: 'var(--text-secondary)' }}>{uc.suggested_description}</div>
                      )}
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 8 }}>
                        {uc.suggested_pov && <span>Perspective: {uc.suggested_pov}</span>}
                        {uc.suggested_category && <span>Category: {uc.suggested_category}</span>}
                      </div>
                      {uc.reason && (
                        <div style={{ fontSize: '0.65rem', marginTop: 4, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          {uc.reason}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        {uc.resolved_node_id && (
                          <button
                            onClick={() => handleNodeClick(uc.resolved_node_id!)}
                            style={{
                              padding: '2px 8px', fontSize: '0.6rem',
                              border: '1px solid var(--border-color)', borderRadius: 3,
                              background: 'var(--bg-primary)', color: 'var(--accent-color, #3b82f6)',
                              cursor: 'pointer',
                            }}
                          >
                            Go to {getLabelForId(uc.resolved_node_id) || uc.resolved_node_id}
                          </button>
                        )}
                        {!uc.resolved_node_id && uc.suggested_pov && POV_MAP[uc.suggested_pov] && uc.suggested_category && CATEGORY_MAP[uc.suggested_category] && (
                          <button
                            onClick={() => addUnmappedToTaxonomy(uc)}
                            style={{
                              padding: '2px 8px', fontSize: '0.6rem',
                              border: '1px solid var(--border-color)', borderRadius: 3,
                              background: 'var(--bg-primary)', color: '#22c55e',
                              cursor: 'pointer', fontWeight: 500,
                            }}
                            title={`Add as ${uc.suggested_pov} ${uc.suggested_category} node`}
                          >
                            + Add to Taxonomy
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {viewMode === 'document' && (
                <div>
                  {snapshotLoading ? (
                    <div className="panel-empty">Loading document...</div>
                  ) : !snapshot ? (
                    import.meta.env.VITE_TARGET === 'web' ? (
                      <div className="panel-empty" style={{ maxWidth: 480, margin: '2rem auto', textAlign: 'center' }}>
                        <strong>Document snapshots are available in the desktop app.</strong>
                        <p style={{ marginTop: '0.5rem', opacity: 0.8 }}>
                          Key points and claims from this source are shown in the other tabs.
                        </p>
                      </div>
                    ) : (
                      <div className="panel-empty">No document snapshot available.</div>
                    )
                  ) : (
                    <pre style={{
                      whiteSpace: 'pre-wrap', wordWrap: 'break-word',
                      fontSize: '0.75rem', lineHeight: 1.6,
                      fontFamily: 'var(--font-mono, monospace)',
                      margin: 0,
                    }}>{snapshot}</pre>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
