// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import type { KeyPoint, PipelineSummary, GraphAttributes } from '../types/types';

const POV_CONFIG: Record<string, { label: string; colorVar: string; bgVar: string }> = {
  accelerationist: { label: 'Accelerationist', colorVar: 'var(--color-acc)', bgVar: 'var(--bg-acc)' },
  safetyist: { label: 'Safetyist', colorVar: 'var(--color-saf)', bgVar: 'var(--bg-saf)' },
  skeptic: { label: 'Skeptic', colorVar: 'var(--color-skp)', bgVar: 'var(--bg-skp)' },
  'cross-cutting': { label: 'Cross-Cutting', colorVar: 'var(--text-secondary)', bgVar: 'var(--bg-secondary)' },
};

const STANCE_LABELS: Record<string, string> = {
  strongly_aligned: 'Strongly Aligned',
  aligned: 'Aligned',
  neutral: 'Neutral',
  opposed: 'Opposed',
  strongly_opposed: 'Strongly Opposed',
};

interface GroupedPoint {
  docId: string;
  docTitle: string;
  index: number;
  keyPoint: KeyPoint;
  stance: string;
  sortLabel: string;
}

interface AggregatedClaim {
  docId: string;
  docTitle: string;
  claim: string;
  doc_position: string;
  potential_conflict_id: string | null;
}

interface AggregatedUnmapped {
  docId: string;
  docTitle: string;
  sourceIndex: number;
  concept: string;
  suggested_label?: string;
  suggested_description?: string;
  suggested_pov: string;
  suggested_category: string;
  reason: string;
  resolved_node_id?: string;
  'Accelerationist Interpretation'?: string;
  'Safetyist Interpretation'?: string;
  'Skeptic Interpretation'?: string;
}

const GA_LABELS: Record<string, string> = {
  epistemic_type: 'Epistemic Type',
  rhetorical_strategy: 'Rhetorical Strategy',
  assumes: 'Assumptions',
  falsifiability: 'Falsifiability',
  audience: 'Audience',
  emotional_register: 'Emotional Register',
  intellectual_lineage: 'Intellectual Lineage',
  steelman_vulnerability: 'Steelman Vulnerability',
};

const GA_BADGE_COLORS: Record<string, string> = {
  normative_prescription: '#7c3aed', empirical_claim: '#2563eb', definitional: '#0891b2',
  strategic_recommendation: '#059669', predictive: '#d97706', interpretive_lens: '#be185d',
  high: '#16a34a', medium: '#ca8a04', low: '#dc2626',
  urgent: '#dc2626', measured: '#2563eb', optimistic: '#16a34a', cautionary: '#d97706',
  defiant: '#be185d', pragmatic: '#475569', alarmed: '#ef4444', dismissive: '#64748b',
  aspirational: '#7c3aed',
};

function fmtVal(v: string) { return v.replace(/_/g, ' '); }

function GaBadge({ value }: { value: string }) {
  const c = GA_BADGE_COLORS[value] || '#475569';
  return <span className="ga-sv-badge" style={{ borderColor: c, color: c }}>{fmtVal(value)}</span>;
}

function GraphAttrBlock({ attrs }: { attrs: GraphAttributes }) {
  return (
    <div className="ga-sv-grid">
      {attrs.epistemic_type && (
        <div className="ga-sv-row">
          <span className="ga-sv-label">{GA_LABELS.epistemic_type}</span>
          <span className="ga-sv-val"><GaBadge value={attrs.epistemic_type} /></span>
        </div>
      )}
      {attrs.rhetorical_strategy && (
        <div className="ga-sv-row">
          <span className="ga-sv-label">{GA_LABELS.rhetorical_strategy}</span>
          <span className="ga-sv-val">
            {attrs.rhetorical_strategy.split(',').map(s => <GaBadge key={s.trim()} value={s.trim()} />)}
          </span>
        </div>
      )}
      {attrs.falsifiability && (
        <div className="ga-sv-row">
          <span className="ga-sv-label">{GA_LABELS.falsifiability}</span>
          <span className="ga-sv-val"><GaBadge value={attrs.falsifiability} /></span>
        </div>
      )}
      {attrs.audience && (
        <div className="ga-sv-row">
          <span className="ga-sv-label">{GA_LABELS.audience}</span>
          <span className="ga-sv-val">
            {attrs.audience.split(',').map(s => <GaBadge key={s.trim()} value={s.trim()} />)}
          </span>
        </div>
      )}
      {attrs.emotional_register && (
        <div className="ga-sv-row">
          <span className="ga-sv-label">{GA_LABELS.emotional_register}</span>
          <span className="ga-sv-val"><GaBadge value={attrs.emotional_register} /></span>
        </div>
      )}
      {attrs.assumes && attrs.assumes.length > 0 && (
        <div className="ga-sv-row ga-sv-row-full">
          <span className="ga-sv-label">{GA_LABELS.assumes}</span>
          <ul className="ga-sv-list">
            {attrs.assumes.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}
      {attrs.intellectual_lineage && attrs.intellectual_lineage.length > 0 && (
        <div className="ga-sv-row ga-sv-row-full">
          <span className="ga-sv-label">{GA_LABELS.intellectual_lineage}</span>
          <ul className="ga-sv-list">
            {attrs.intellectual_lineage.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}
      {attrs.steelman_vulnerability && (
        <div className="ga-sv-row ga-sv-row-full">
          <span className="ga-sv-label">{GA_LABELS.steelman_vulnerability}</span>
          <div className="ga-sv-steelman">{typeof attrs.steelman_vulnerability === 'string' ? attrs.steelman_vulnerability : (
            <>{Object.entries(attrs.steelman_vulnerability).filter(([,v]) => v).map(([k,v]) => (
              <div key={k}><strong>{k.replace('from_', '')}:</strong> {v as string}</div>
            ))}</>
          )}</div>
        </div>
      )}
      {attrs.policy_actions && attrs.policy_actions.length > 0 && (
        <div className="ga-sv-row ga-sv-row-full">
          <span className="ga-sv-label">Policy Actions ({attrs.policy_actions.length})</span>
          <ul className="ga-sv-policy-list">
            {attrs.policy_actions.map((pa, i) => (
              <li key={i} className="ga-sv-policy-item">
                {pa.policy_id && <span className="ga-sv-policy-id">{pa.policy_id}</span>}
                <span className="ga-sv-policy-action">{pa.action}</span>
                {pa.framing && <span className="ga-sv-policy-framing">{pa.framing}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function UnmappedCard({ uc, index, onSelect }: { uc: AggregatedUnmapped; index: number; onSelect: () => void }) {
  const addToTaxonomy = useStore(s => s.addToTaxonomy);
  const runSimilarSearch = useStore(s => s.runSimilarSearch);
  const runPotentialEdges = useStore(s => s.runPotentialEdges);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<{ success: boolean; nodeId?: string; error?: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const handleAdd = useCallback(async () => {
    setAdding(true);
    setResult(null);
    const label = uc.suggested_label || uc.concept.slice(0, 80);
    const description = uc.suggested_description || uc.concept;
    const interpretations = uc.suggested_pov === 'cross-cutting'
      ? {
          accelerationist: uc['Accelerationist Interpretation'] || '',
          safetyist: uc['Safetyist Interpretation'] || '',
          skeptic: uc['Skeptic Interpretation'] || '',
        }
      : undefined;
    const res = await addToTaxonomy(uc.suggested_pov, uc.suggested_category, label, description, interpretations, uc.docId, uc.sourceIndex);
    setResult(res);
    setAdding(false);
    if (res.success) {
      setTimeout(() => setMenuOpen(false), 1500);
    }
  }, [uc, addToTaxonomy]);

  return (
    <div key={`unmapped-${uc.docId}-${index}`} className={`unmapped-card clickable${uc.resolved_node_id ? ' unmapped-resolved' : ''}`} onClick={onSelect}>
      <div className="unmapped-card-header">
        {uc.resolved_node_id && (
          <div className="unmapped-resolved-badge" title={`Added as ${uc.resolved_node_id}`}>
            Mapped to {uc.resolved_node_id}
          </div>
        )}
        {uc.suggested_label && (
          <div className="unmapped-label">{uc.suggested_label}</div>
        )}
        <div className="unmapped-actions">
          <button
            ref={btnRef}
            className="unmapped-menu-btn"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
            title="Actions"
          >
            {'\u22EE'}
          </button>
          {menuOpen && (
            <div ref={menuRef} className="unmapped-popup">
              {!result?.success && (
                <button
                  className="unmapped-popup-item"
                  onClick={handleAdd}
                  disabled={adding}
                >
                  {adding ? 'Adding...' : 'Add to Taxonomy'}
                </button>
              )}
              <button
                className="unmapped-popup-item"
                onClick={() => {
                  runSimilarSearch(uc.suggested_label || uc.concept, uc.suggested_description || uc.concept);
                  setMenuOpen(false);
                }}
              >
                View Similar
              </button>
              <button
                className="unmapped-popup-item"
                onClick={() => {
                  runPotentialEdges({
                    label: uc.suggested_label || uc.concept.slice(0, 80),
                    description: uc.suggested_description || uc.concept,
                    pov: uc.suggested_pov,
                    category: uc.suggested_category,
                  });
                  setMenuOpen(false);
                }}
              >
                Show Potential Edges
              </button>
              {result?.success && (
                <div className="unmapped-popup-success">
                  Added as {result.nodeId}
                </div>
              )}
              {result && !result.success && (
                <div className="unmapped-popup-error">
                  {result.error || 'Failed'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="unmapped-concept">{uc.concept}</div>
      {uc.suggested_description && (
        <div className="unmapped-description">{uc.suggested_description}</div>
      )}
      {uc.suggested_pov === 'cross-cutting' && (
        <div className="unmapped-interpretations">
          {uc['Accelerationist Interpretation'] && (
            <div className="unmapped-interp">
              <span className="unmapped-interp-label" style={{ color: 'var(--color-acc)' }}>Accelerationist:</span>
              <span className="unmapped-interp-text">{uc['Accelerationist Interpretation']}</span>
            </div>
          )}
          {uc['Safetyist Interpretation'] && (
            <div className="unmapped-interp">
              <span className="unmapped-interp-label" style={{ color: 'var(--color-saf)' }}>Safetyist:</span>
              <span className="unmapped-interp-text">{uc['Safetyist Interpretation']}</span>
            </div>
          )}
          {uc['Skeptic Interpretation'] && (
            <div className="unmapped-interp">
              <span className="unmapped-interp-label" style={{ color: 'var(--color-skp)' }}>Skeptic:</span>
              <span className="unmapped-interp-text">{uc['Skeptic Interpretation']}</span>
            </div>
          )}
        </div>
      )}
      <div className="unmapped-meta">
        <span className="unmapped-source">{uc.docTitle}</span>
        <span className="unmapped-pov">{uc.suggested_pov}</span>
        <span className="unmapped-category">{uc.suggested_category}</span>
      </div>
      <div className="unmapped-reason">{uc.reason}</div>
    </div>
  );
}

interface DocGroup {
  docId: string;
  docTitle: string;
  fragments: FragmentGroup[];
}

interface FragmentGroup {
  excerptContext: string;
  points: Array<{
    pov: string;
    index: number;
    keyPoint: KeyPoint;
    stance: string;
    taxNode: { id: string; category: string; label: string; description: string; graph_attributes?: GraphAttributes } | null;
  }>;
}

export default function KeyPointsPane() {
  const selectedSourceIds = useStore(s => s.selectedSourceIds);
  const summaries = useStore(s => s.summaries);
  const sources = useStore(s => s.sources);
  const taxonomy = useStore(s => s.taxonomy);
  const selectedKeyPoint = useStore(s => s.selectedKeyPoint);
  const selectKeyPoint = useStore(s => s.selectKeyPoint);
  const selectDocumentSearch = useStore(s => s.selectDocumentSearch);
  const [viewMode, setViewMode] = useState<'pov' | 'document'>(() => {
    const saved = localStorage.getItem('summaryviewer-view-mode');
    return saved === 'document' ? 'document' : 'pov';
  });
  const [expandedPovs, setExpandedPovs] = useState<Set<string>>(
    new Set(['accelerationist', 'safetyist', 'skeptic'])
  );
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const [expandedFragments, setExpandedFragments] = useState<Set<string>>(new Set());
  const [claimsExpanded, setClaimsExpanded] = useState(true);
  const [unmappedExpanded, setUnmappedExpanded] = useState(true);
  const [unmappedCollapsedPovs, setUnmappedCollapsedPovs] = useState<Set<string>>(new Set());
  const [visibleDescs, setVisibleDescs] = useState<Set<string>>(new Set());
  const [visibleAttrs, setVisibleAttrs] = useState<Set<string>>(new Set());

  const toggleDesc = (key: string) => {
    setVisibleDescs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAttrs = (key: string) => {
    setVisibleAttrs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const handleCardContextMenu = useCallback((e: React.MouseEvent, taxonomyNodeId: string | null | undefined) => {
    if (!taxonomyNodeId) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, nodeId: taxonomyNodeId });
  }, []);

  const handleEditInTaxonomyEditor = useCallback(async () => {
    if (ctxMenu) {
      const nodeId = ctxMenu.nodeId;
      setCtxMenu(null);
      const result = await window.electronAPI.openInTaxonomyEditor(nodeId);
      if (!result.ok) {
        alert(result.error || 'Could not open Taxonomy Editor.');
      }
    }
  }, [ctxMenu]);

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [ctxMenu]);

  const handleViewModeChange = useCallback((mode: 'pov' | 'document') => {
    setViewMode(mode);
    localStorage.setItem('summaryviewer-view-mode', mode);
  }, []);

  const { groupedByPov, factualClaims, unmappedConcepts } = useMemo(() => {
    const groups: Record<string, GroupedPoint[]> = {
      accelerationist: [],
      safetyist: [],
      skeptic: [],
    };
    const claims: AggregatedClaim[] = [];
    const unmapped: AggregatedUnmapped[] = [];

    for (const sourceId of selectedSourceIds) {
      const summary: PipelineSummary | undefined = summaries[sourceId];
      if (!summary) continue;

      const source = sources.find(s => s.id === sourceId);
      const docTitle = source?.title || sourceId;

      // Key points
      if (summary.pov_summaries) {
        for (const [pov, povSummary] of Object.entries(summary.pov_summaries)) {
          if (!groups[pov]) continue;
          povSummary.key_points.forEach((kp, idx) => {
            const taxNode = kp.taxonomy_node_id ? taxonomy[kp.taxonomy_node_id] : null;
            groups[pov].push({
              docId: sourceId,
              docTitle,
              index: idx,
              keyPoint: kp,
              stance: kp.stance || povSummary.stance || 'neutral',
              sortLabel: taxNode?.label || '\uffff',
            });
          });
        }
      }

      // Factual claims
      if (summary.factual_claims) {
        for (const fc of summary.factual_claims) {
          claims.push({ docId: sourceId, docTitle, ...fc });
        }
      }

      // Unmapped concepts
      if (summary.unmapped_concepts) {
        summary.unmapped_concepts.forEach((uc, idx) => {
          unmapped.push({ docId: sourceId, docTitle, sourceIndex: idx, ...uc });
        });
      }
    }

    // Sort each POV group by taxonomy label (alphabetical), unmapped last
    for (const pov of Object.keys(groups)) {
      groups[pov].sort((a, b) => a.sortLabel.localeCompare(b.sortLabel));
    }

    return { groupedByPov: groups, factualClaims: claims, unmappedConcepts: unmapped };
  }, [selectedSourceIds, summaries, sources, taxonomy]);

  const docGroups = useMemo((): DocGroup[] => {
    const groups: DocGroup[] = [];

    for (const sourceId of selectedSourceIds) {
      const summary: PipelineSummary | undefined = summaries[sourceId];
      if (!summary?.pov_summaries) continue;

      const source = sources.find(s => s.id === sourceId);
      const docTitle = source?.title || sourceId;

      // Collect all key points for this doc, grouped by excerpt_context
      const fragmentMap = new Map<string, FragmentGroup['points']>();
      const fragmentOrder: string[] = [];

      for (const [pov, povSummary] of Object.entries(summary.pov_summaries)) {
        if (!POV_CONFIG[pov]) continue;
        povSummary.key_points.forEach((kp, idx) => {
          const ctx = kp.excerpt_context || '(no context)';
          if (!fragmentMap.has(ctx)) {
            fragmentMap.set(ctx, []);
            fragmentOrder.push(ctx);
          }
          fragmentMap.get(ctx)!.push({
            pov,
            index: idx,
            keyPoint: kp,
            stance: kp.stance || povSummary.stance || 'neutral',
            taxNode: kp.taxonomy_node_id ? taxonomy[kp.taxonomy_node_id] || null : null,
          });
        });
      }

      if (fragmentOrder.length > 0) {
        groups.push({
          docId: sourceId,
          docTitle,
          fragments: fragmentOrder.map(ctx => ({
            excerptContext: ctx,
            points: fragmentMap.get(ctx)!,
          })),
        });
      }
    }

    return groups;
  }, [selectedSourceIds, summaries, sources, taxonomy]);

  // Auto-expand all docs and fragments when they first appear
  useEffect(() => {
    if (viewMode !== 'document') return;
    const newDocs = new Set(expandedDocs);
    const newFrags = new Set(expandedFragments);
    let changed = false;
    for (const dg of docGroups) {
      if (!newDocs.has(dg.docId)) {
        newDocs.add(dg.docId);
        changed = true;
      }
      for (const fg of dg.fragments) {
        const fragKey = `${dg.docId}::${fg.excerptContext}`;
        if (!newFrags.has(fragKey)) {
          newFrags.add(fragKey);
          changed = true;
        }
      }
    }
    if (changed) {
      setExpandedDocs(newDocs);
      setExpandedFragments(newFrags);
    }
  }, [docGroups, viewMode]);

  const toggleDoc = (docId: string) => {
    setExpandedDocs(prev => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const toggleFragment = (fragKey: string) => {
    setExpandedFragments(prev => {
      const next = new Set(prev);
      if (next.has(fragKey)) next.delete(fragKey);
      else next.add(fragKey);
      return next;
    });
  };

  const togglePov = (pov: string) => {
    setExpandedPovs(prev => {
      const next = new Set(prev);
      if (next.has(pov)) {
        next.delete(pov);
      } else {
        next.add(pov);
      }
      return next;
    });
  };

  const totalPoints = Object.values(groupedByPov).reduce((sum, arr) => sum + arr.length, 0);

  const hasSelection = selectedSourceIds.size > 0;

  return (
    <>
      <div className="pane-header">
        <h2>Key Points</h2>
        <div className="pane-header-right">
          {hasSelection && (
            <div className="view-mode-toggle">
              <button
                className={`view-mode-btn${viewMode === 'pov' ? ' active' : ''}`}
                onClick={() => handleViewModeChange('pov')}
              >
                POV
              </button>
              <button
                className={`view-mode-btn${viewMode === 'document' ? ' active' : ''}`}
                onClick={() => handleViewModeChange('document')}
              >
                Document
              </button>
            </div>
          )}
          <span className="point-count">{totalPoints} points</span>
        </div>
      </div>
      <div className="pane-body">
        {!hasSelection && (
          <div className="empty-state">
            Select one or more sources to see key points
          </div>
        )}

        {/* === POV View === */}
        {viewMode === 'pov' && Object.entries(POV_CONFIG).map(([pov, config]) => {
          const points = groupedByPov[pov] || [];
          if (!hasSelection || points.length === 0) return null;

          const isExpanded = expandedPovs.has(pov);

          return (
            <div key={pov} className="pov-accordion">
              <button
                className="pov-accordion-header"
                style={{ borderLeftColor: config.colorVar }}
                onClick={() => togglePov(pov)}
              >
                <span className="pov-accordion-arrow">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                <span className="pov-accordion-label" style={{ color: config.colorVar }}>
                  {config.label}
                </span>
                <span className="pov-accordion-count">{points.length}</span>
              </button>

              {isExpanded && (
                <div className="pov-accordion-body">
                  {points.map((gp) => {
                    const isSelected = selectedKeyPoint?.docId === gp.docId &&
                      selectedKeyPoint?.pov === pov &&
                      selectedKeyPoint?.index === gp.index;

                    const taxNode = gp.keyPoint.taxonomy_node_id
                      ? taxonomy[gp.keyPoint.taxonomy_node_id]
                      : null;

                    return (
                      <div
                        key={`${gp.docId}-${pov}-${gp.index}`}
                        className={`key-point-card${isSelected ? ' selected' : ''}`}
                        onClick={() => selectKeyPoint(gp.docId, pov, gp.index)}
                        onContextMenu={(e) => handleCardContextMenu(e, gp.keyPoint.taxonomy_node_id)}
                      >
                        {taxNode && (() => {
                          const attrKey = `pov-${gp.docId}-${pov}-${gp.index}`;
                          const showAttrs = visibleAttrs.has(attrKey);
                          return (
                            <div className="kp-taxonomy">
                              <span className="kp-taxonomy-id">{taxNode.id}</span>
                              <span className="kp-taxonomy-label">{taxNode.label}</span>
                              {taxNode.graph_attributes && (
                                <button
                                  className="kp-desc-toggle"
                                  onClick={(e) => { e.stopPropagation(); toggleAttrs(attrKey); }}
                                  title={showAttrs ? 'Hide graph attributes' : 'Show graph attributes'}
                                >
                                  {showAttrs ? '\u25B4' : '\u25BE'} attrs
                                </button>
                              )}
                              <div className="kp-taxonomy-desc">{taxNode.description}</div>
                              {showAttrs && taxNode.graph_attributes && (
                                <GraphAttrBlock attrs={taxNode.graph_attributes} />
                              )}
                            </div>
                          );
                        })()}
                        {!taxNode && gp.keyPoint.taxonomy_node_id && (
                          <div className="kp-taxonomy">
                            <span className="kp-taxonomy-id">{gp.keyPoint.taxonomy_node_id}</span>
                            <span className="kp-taxonomy-label kp-taxonomy-unknown">Unknown node</span>
                          </div>
                        )}

                        <div className="kp-stance-row">
                          <span className="kp-stance-label">Stance:</span>
                          <span className={`kp-stance-value kp-stance--${gp.stance}`}>
                            {STANCE_LABELS[gp.stance] || gp.stance}
                          </span>
                        </div>

                        <div className="key-point-text">{gp.keyPoint.point}</div>

                        <div className="key-point-meta">
                          <span className="key-point-source">{gp.docTitle}</span>
                          <span
                            className="key-point-category"
                            style={{ background: config.bgVar, color: config.colorVar }}
                          >
                            {gp.keyPoint.category}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* === Document View === */}
        {viewMode === 'document' && hasSelection && docGroups.map((dg) => {
          const isDocExpanded = expandedDocs.has(dg.docId);
          const totalFragPoints = dg.fragments.reduce((s, f) => s + f.points.length, 0);

          return (
            <div key={dg.docId} className="pov-accordion doc-accordion">
              <button
                className="pov-accordion-header doc-accordion-header"
                onClick={() => toggleDoc(dg.docId)}
              >
                <span className="pov-accordion-arrow">{isDocExpanded ? '\u25BC' : '\u25B6'}</span>
                <span className="pov-accordion-label doc-accordion-label">{dg.docTitle}</span>
                <span className="pov-accordion-count">{totalFragPoints} pts / {dg.fragments.length} fragments</span>
              </button>

              {isDocExpanded && (
                <div className="pov-accordion-body">
                  {dg.fragments.map((fg) => {
                    const fragKey = `${dg.docId}::${fg.excerptContext}`;
                    const isFragExpanded = expandedFragments.has(fragKey);

                    return (
                      <div key={fragKey} className="fragment-accordion">
                        <button
                          className="fragment-accordion-header"
                          onClick={() => toggleFragment(fragKey)}
                        >
                          <span className="pov-accordion-arrow">{isFragExpanded ? '\u25BC' : '\u25B6'}</span>
                          <span className="fragment-accordion-label">{fg.excerptContext}</span>
                          <span className="pov-accordion-count">{fg.points.length}</span>
                        </button>

                        {isFragExpanded && (
                          <div className="fragment-accordion-body">
                            {fg.points.map((pt) => {
                              const config = POV_CONFIG[pt.pov];
                              const isSelected = selectedKeyPoint?.docId === dg.docId &&
                                selectedKeyPoint?.pov === pt.pov &&
                                selectedKeyPoint?.index === pt.index;

                              return (
                                <div
                                  key={`${dg.docId}-${pt.pov}-${pt.index}`}
                                  className={`key-point-card${isSelected ? ' selected' : ''}`}
                                  onClick={() => selectKeyPoint(dg.docId, pt.pov, pt.index)}
                                  onContextMenu={(e) => handleCardContextMenu(e, pt.keyPoint.taxonomy_node_id)}
                                >
                                  <div className="kp-pov-badge-row">
                                    <span
                                      className="kp-pov-badge"
                                      style={{ background: config?.bgVar, color: config?.colorVar }}
                                    >
                                      {config?.label || pt.pov}
                                    </span>
                                    <span className={`kp-stance-value kp-stance--${pt.stance}`}>
                                      {STANCE_LABELS[pt.stance] || pt.stance}
                                    </span>
                                  </div>

                                  <div className="key-point-text">{pt.keyPoint.point}</div>

                                  {pt.taxNode && (() => {
                                    const descKey = `${dg.docId}-${pt.pov}-${pt.index}`;
                                    const attrKey = `doc-${dg.docId}-${pt.pov}-${pt.index}`;
                                    const showDesc = visibleDescs.has(descKey);
                                    const showAttrs = visibleAttrs.has(attrKey);
                                    return (
                                      <div className="kp-taxonomy">
                                        <span className="kp-taxonomy-id">{pt.taxNode.id}</span>
                                        <span className="kp-taxonomy-label">{pt.taxNode.label}</span>
                                        {pt.taxNode.description && (
                                          <button
                                            className="kp-desc-toggle"
                                            onClick={(e) => { e.stopPropagation(); toggleDesc(descKey); }}
                                            title={showDesc ? 'Hide description' : 'Show description'}
                                          >
                                            {showDesc ? '\u25B4' : '\u25BE'} desc
                                          </button>
                                        )}
                                        {pt.taxNode.graph_attributes && (
                                          <button
                                            className="kp-desc-toggle"
                                            onClick={(e) => { e.stopPropagation(); toggleAttrs(attrKey); }}
                                            title={showAttrs ? 'Hide graph attributes' : 'Show graph attributes'}
                                          >
                                            {showAttrs ? '\u25B4' : '\u25BE'} attrs
                                          </button>
                                        )}
                                        {showDesc && pt.taxNode.description && (
                                          <div className="kp-taxonomy-desc">{pt.taxNode.description}</div>
                                        )}
                                        {showAttrs && pt.taxNode.graph_attributes && (
                                          <GraphAttrBlock attrs={pt.taxNode.graph_attributes} />
                                        )}
                                      </div>
                                    );
                                  })()}
                                  {!pt.taxNode && pt.keyPoint.taxonomy_node_id && (
                                    <div className="kp-taxonomy">
                                      <span className="kp-taxonomy-id">{pt.keyPoint.taxonomy_node_id}</span>
                                      <span className="kp-taxonomy-label kp-taxonomy-unknown">Unknown node</span>
                                    </div>
                                  )}

                                  <div className="key-point-meta">
                                    <span
                                      className="key-point-category"
                                      style={{ background: config?.bgVar, color: config?.colorVar }}
                                    >
                                      {pt.keyPoint.category}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* === Factual Claims === */}
        {hasSelection && factualClaims.length > 0 && (
          <div className="pov-accordion section-claims">
            <button
              className="pov-accordion-header section-header--claims"
              onClick={() => setClaimsExpanded(v => !v)}
            >
              <span className="pov-accordion-arrow">{claimsExpanded ? '\u25BC' : '\u25B6'}</span>
              <span className="pov-accordion-label section-label--claims">Factual Claims</span>
              <span className="pov-accordion-count">{factualClaims.length}</span>
            </button>

            {claimsExpanded && (
              <div className="pov-accordion-body">
                {factualClaims.map((fc, i) => (
                  <div
                    key={`claim-${fc.docId}-${i}`}
                    className="claim-card clickable"
                    onClick={() => selectDocumentSearch(fc.docId, fc.claim)}
                  >
                    <div className="claim-text">{fc.claim}</div>
                    <div className="claim-meta">
                      <span className="claim-source">{fc.docTitle}</span>
                      <span className={`claim-position claim-position--${fc.doc_position}`}>
                        {fc.doc_position}
                      </span>
                      {fc.potential_conflict_id && (
                        <span className="claim-conflict">{fc.potential_conflict_id}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* === Unmapped Concepts === */}
        {hasSelection && unmappedConcepts.length > 0 && (() => {
          // Group by POV, sort each group by label
          const POV_ORDER = ['accelerationist', 'safetyist', 'skeptic', 'cross-cutting'];
          const byPov = new Map<string, AggregatedUnmapped[]>();
          for (const pov of POV_ORDER) byPov.set(pov, []);
          for (const uc of unmappedConcepts) {
            const key = uc.suggested_pov || 'cross-cutting';
            if (!byPov.has(key)) byPov.set(key, []);
            byPov.get(key)!.push(uc);
          }
          for (const group of byPov.values()) {
            group.sort((a, b) => (a.suggested_label || a.concept || '').localeCompare(b.suggested_label || b.concept || ''));
          }
          const resolved = unmappedConcepts.filter(uc => uc.resolved_node_id).length;
          const countLabel = resolved > 0
            ? `${unmappedConcepts.length - resolved} open / ${unmappedConcepts.length}`
            : String(unmappedConcepts.length);

          return (
            <div className="pov-accordion section-unmapped">
              <button
                className="pov-accordion-header section-header--unmapped"
                onClick={() => setUnmappedExpanded(v => !v)}
              >
                <span className="pov-accordion-arrow">{unmappedExpanded ? '\u25BC' : '\u25B6'}</span>
                <span className="pov-accordion-label section-label--unmapped">Unmapped Concepts</span>
                <span className="pov-accordion-count">{countLabel}</span>
              </button>

              {unmappedExpanded && (
                <div className="pov-accordion-body">
                  {POV_ORDER.map(pov => {
                    const group = byPov.get(pov) || [];
                    if (group.length === 0) return null;
                    const cfg = POV_CONFIG[pov];
                    const povLabel = cfg?.label || pov;
                    const povColor = cfg?.colorVar || 'var(--text-secondary)';
                    const isPovCollapsed = unmappedCollapsedPovs.has(pov);
                    const togglePov = () => {
                      setUnmappedCollapsedPovs(prev => {
                        const next = new Set(prev);
                        if (next.has(pov)) next.delete(pov);
                        else next.add(pov);
                        return next;
                      });
                    };
                    return (
                      <div key={pov} className="unmapped-pov-group">
                        <button className="unmapped-pov-header" style={{ color: povColor }} onClick={togglePov}>
                          <span className="unmapped-pov-arrow">{isPovCollapsed ? '\u25B6' : '\u25BC'}</span>
                          {povLabel} <span className="unmapped-pov-count">({group.length})</span>
                        </button>
                        {!isPovCollapsed && group.map((uc, i) => (
                          <UnmappedCard
                            key={`unmapped-${uc.docId}-${uc.sourceIndex}`}
                            uc={uc}
                            index={i}
                            onSelect={() => selectDocumentSearch(uc.docId, uc.concept)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="kp-context-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          <button className="kp-context-menu-item" onClick={handleEditInTaxonomyEditor}>
            Edit in Taxonomy Editor
          </button>
        </div>
      )}
    </>
  );
}
