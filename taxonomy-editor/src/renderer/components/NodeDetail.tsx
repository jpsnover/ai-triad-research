// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Pov, PovNode, Category } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import type { AggregatedCrux } from '../hooks/useTaxonomyStore';
import { useDebateStore } from '../hooks/useDebateStore';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { HighlightedTextarea } from './HighlightedField';
import { TypeaheadSelect } from './TypeaheadSelect';
import { FieldHelp } from './FieldHelp';
import { LinkedChip } from './LinkedChip';
import { GraphAttributesPanel } from './GraphAttributesPanel';
import { RelatedEdgesPanel } from './RelatedEdgesPanel';
import { EdgeDetailPanel } from './EdgeDetailPanel';
import { getLineageInfo } from '../data/lineageLookup';
import { researchPrompt } from '../prompts/research';
import { SourcesPanel } from './SourcesPanel';
import { nodeTypeFromId } from '@lib/debate/nodeIdUtils';
import { POV_KEYS } from '@lib/debate/types';
import { api } from '@bridge';

interface MoveTarget {
  label: string;
  action: () => void;
  isTransfer?: boolean;
}

function OverflowMenu({ moveTargets, onDelete, onAIAnalysis }: {
  moveTargets: MoveTarget[];
  onDelete: () => void;
  onAIAnalysis: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  // Group: same-POV category moves first, then cross-POV transfers
  const categoryMoves = moveTargets.filter(t => !t.isTransfer);
  const transfers = moveTargets.filter(t => t.isTransfer);

  return (
    <div className="overflow-menu-wrapper" ref={menuRef}>
      <button className="btn btn-ghost btn-sm overflow-menu-trigger" onClick={() => setOpen(!open)} title="More actions">&hellip;</button>
      {open && (
        <div className="overflow-menu-dropdown">
          <button className="overflow-menu-item" onClick={() => { onAIAnalysis(); setOpen(false); }}>
            AI Analysis
          </button>
          <div className="overflow-menu-divider" />
          {categoryMoves.map(t => (
            <button key={t.label} className="overflow-menu-item" onClick={() => { t.action(); setOpen(false); }}>
              Move to {t.label}
            </button>
          ))}
          {transfers.length > 0 && (
            <>
              <div className="overflow-menu-divider" />
              <div className="overflow-menu-section-label">Transfer to</div>
              {transfers.map(t => (
                <button key={t.label} className="overflow-menu-item overflow-menu-transfer" onClick={() => { t.action(); setOpen(false); }}>
                  {t.label}
                </button>
              ))}
            </>
          )}
          <div className="overflow-menu-divider" />
          <button className="overflow-menu-item overflow-menu-danger" onClick={() => { onDelete(); setOpen(false); }}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

interface NodeDetailProps {
  pov: Pov;
  node: PovNode;
  readOnly?: boolean;
  onPin?: () => void;
  onSimilarSearch?: () => void;
  onRelated?: () => void;
  chipDepth?: number;
}

const ALL_CATEGORIES: Category[] = ['Desires', 'Beliefs', 'Intentions'];
const ALL_POVS: Pov[] = [...POV_KEYS];

/** BDI layer guidance for each category */
const BDI_GUIDANCE: Record<Category, string> = {
  'Beliefs': 'Beliefs — empirical claims that could be verified or falsified with evidence.',
  'Desires': 'Desires — normative commitments about what should happen or what matters.',
  'Intentions': 'Intentions — reasoning strategies and argumentative approaches for how to think about something.',
};

/** Singular form with article for genus-differentia descriptions */
const CATEGORY_SINGULAR: Record<Category, string> = {
  'Beliefs': 'A Belief',
  'Desires': 'A Desire',
  'Intentions': 'An Intention',
};
const POV_LABELS: Record<Pov, string> = {
  accelerationist: 'Accelerationist',
  safetyist: 'Safetyist',
  skeptic: 'Skeptic',
};

type NodeDetailTabId = 'content' | 'related' | 'attributes' | 'sources' | 'research';

export function NodeDetail({ pov, node, readOnly, onPin, onSimilarSearch, onRelated, chipDepth = 0 }: NodeDetailProps) {
  const { updatePovNode, deletePovNode, movePovNodeCategory, movePovNode, validationErrors, getAllNodeIds, getAllConflictIds, runAttributeFilter, showAttributeInfo, navigateToLineage, setToolbarPanel, selectedEdge, relatedNodeId, loadEdges, edgesFile, setSelectedNodeId, getLabelForId } = useTaxonomyStore();
  const [showDelete, setShowDelete] = useState(false);
  const [activeTab, setActiveTab] = useState<NodeDetailTabId>('content');
  const [expandedLineage, setExpandedLineage] = useState<string | null>(null);
  const [relatedSplitPct, setRelatedSplitPct] = useState(40);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const handleSplitMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const startX = e.clientX;
    const startPct = relatedSplitPct;
    const containerWidth = container.offsetWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const newPct = Math.min(70, Math.max(20, startPct + (dx / containerWidth) * 100));
      setRelatedSplitPct(newPct);
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [relatedSplitPct]);

  // Research prompt state
  const [researchText, setResearchText] = useState('');
  const [researchCopied, setResearchCopied] = useState(false);
  const researchTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Generate research prompt when tab is selected or node changes
  useEffect(() => {
    if (activeTab === 'research') {
      setResearchText(researchPrompt(node.label, node.description));
      setResearchCopied(false);
    }
  }, [activeTab, node.id, node.label, node.description]);

  const handleResearchCopy = async () => {
    try {
      await api.clipboardWriteText(researchText);
      setResearchCopied(true);
      setTimeout(() => setResearchCopied(false), 2000);
    } catch { /* ignore */ }
  };

  // When switching to Related tab, set relatedNodeId and load edges without switching toolbar
  useEffect(() => {
    if (activeTab === 'related') {
      if (relatedNodeId !== node.id) {
        useTaxonomyStore.setState({ relatedNodeId: node.id, selectedEdge: null });
      }
      if (!edgesFile) {
        void loadEdges();
      }
    }
  }, [activeTab, node.id, relatedNodeId, edgesFile, loadEdges]);

  // Same-POV category moves
  const categoryMoveTargets: MoveTarget[] = ALL_CATEGORIES
    .filter(c => c !== node.category)
    .map(c => ({ label: c, action: () => movePovNodeCategory(pov, node.id, c) }));

  // Cross-POV transfers (every other POV × every category)
  const transferTargets: MoveTarget[] = ALL_POVS
    .filter(p => p !== pov)
    .flatMap(p => ALL_CATEGORIES.map(c => ({
      label: `${POV_LABELS[p]} / ${c}`,
      action: () => movePovNode(pov, node.id, p, c),
      isTransfer: true,
    })));

  const moveTargets = [...categoryMoveTargets, ...transferTargets];

  const allCcIds = getAllNodeIds().filter(id => nodeTypeFromId(id) === 'situation');
  const allConflictIds = getAllConflictIds();

  const err = (field: string) => validationErrors[`nodes.${node.id}.${field}`];
  const hasErrors = Object.keys(validationErrors).some(k => k.startsWith(`nodes.${node.id}.`));

  useEffect(() => {
    if (hasErrors && formRef.current) {
      const firstError = formRef.current.querySelector('.has-error');
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const input = firstError.querySelector<HTMLElement>('input, textarea');
        input?.focus();
      }
    }
  }, [hasErrors]);

  const update = (updates: Partial<PovNode>) => {
    if (readOnly) return;
    updatePovNode(pov, node.id, updates);
  };

  const addRef = (id: string) => {
    if (id && !node.situation_refs.includes(id)) {
      update({ situation_refs: [...node.situation_refs, id] });
    }
  };

  const removeRef = (ref: string) => {
    update({ situation_refs: node.situation_refs.filter(r => r !== ref) });
  };

  const addConflict = (id: string) => {
    if (id && !(node.conflict_ids || []).includes(id)) {
      update({ conflict_ids: [...(node.conflict_ids || []), id] });
    }
  };

  const removeConflict = (id: string) => {
    update({ conflict_ids: (node.conflict_ids || []).filter(c => c !== id) });
  };

  const hasGraphAttrs = !!node.graph_attributes;

  return (
    <div ref={formRef} className="node-detail-tabbed">
      <div className="nd-header">
        <div className="nd-header-title">
          {readOnly ? (
            <span className="nd-header-label">{node.label}</span>
          ) : (
            <input
              className={`nd-header-label nd-header-label-editable ${err('label') ? 'has-error' : ''}`}
              value={node.label}
              onChange={(e) => update({ label: e.target.value })}
              placeholder="Label"
              aria-label="Label"
            />
          )}
          <span className="nd-header-id">{node.id}</span>
          <span className="nd-header-cat" data-cat={node.category}>
            {node.category.toUpperCase()}
            <FieldHelp text={BDI_GUIDANCE[node.category]} />
          </span>
        </div>
        <div className="nd-header-actions">
          {onSimilarSearch && (
            <button className="nd-header-btn" onClick={onSimilarSearch} title="Find similar taxonomy elements">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </button>
          )}
          {onPin && (
            <button className="nd-header-btn" onClick={onPin} title="Pin for comparison">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
            </button>
          )}
          {!readOnly && (
            <OverflowMenu
              moveTargets={moveTargets}
              onDelete={() => setShowDelete(true)}
              onAIAnalysis={() => void useTaxonomyStore.getState().runNodeCritique(pov, node)}
            />
          )}
        </div>
      </div>

      {hasErrors && (
        <div className="validation-banner">
          <span className="validation-banner-icon">!</span>
          Please fix the highlighted fields before saving.
        </div>
      )}

      {/* Tab bar */}
      <div className="node-detail-tabs">
        <button
          className={`node-detail-tab ${activeTab === 'content' ? 'node-detail-tab-active' : ''}`}
          onClick={() => setActiveTab('content')}
        >
          Content
        </button>
        {hasGraphAttrs && (
          <button
            className={`node-detail-tab ${activeTab === 'attributes' ? 'node-detail-tab-active' : ''}`}
            onClick={() => setActiveTab('attributes')}
          >
            Attributes
          </button>
        )}
        <button
          className={`node-detail-tab ${activeTab === 'related' ? 'node-detail-tab-active' : ''}`}
          onClick={() => setActiveTab('related')}
        >
          Related
        </button>
        <button
          className={`node-detail-tab ${activeTab === 'sources' ? 'node-detail-tab-active' : ''}`}
          onClick={() => setActiveTab('sources')}
        >
          Sources
        </button>
        <button
          className={`node-detail-tab ${activeTab === 'research' ? 'node-detail-tab-active' : ''}`}
          onClick={() => setActiveTab('research')}
        >
          Research
        </button>
      </div>

      {/* Tab content */}
      <div className="node-detail-tab-content">
        {activeTab === 'content' && (
          <>
            {!readOnly && err('label') && (
              <div className="error-text" style={{ marginBottom: 8 }}>{err('label')}</div>
            )}

            <div className={`form-group ${err('description') ? 'has-error' : ''}`}>
              <label>
                Description
                <FieldHelp text={`Genus-differentia format:\n"${CATEGORY_SINGULAR[node.category]} within [POV] discourse that [differentia].\nEncompasses: ...\nExcludes: ..."\nEncompasses and Excludes must each start on a new line.`} />
              </label>
              <HighlightedTextarea
                value={node.description}
                onChange={(v) => update({ description: v })}
                rows={6}
                readOnly={readOnly}
              />
              {err('description') && <div className="error-text">{err('description')}</div>}
            </div>


            {hasGraphAttrs && (
              <div className="form-group">
                <label>Steelman Vulnerability</label>
                {typeof node.graph_attributes!.steelman_vulnerability === 'string' ? (
                  readOnly ? (
                    <div className="ga-promoted-text">{node.graph_attributes!.steelman_vulnerability}</div>
                  ) : (
                    <textarea
                      className="nd-vulnerability-input"
                      value={node.graph_attributes!.steelman_vulnerability}
                      rows={3}
                      onChange={(e) => {
                        update({ graph_attributes: { ...node.graph_attributes!, steelman_vulnerability: e.target.value } });
                      }}
                    />
                  )
                ) : typeof node.graph_attributes!.steelman_vulnerability === 'object' && node.graph_attributes!.steelman_vulnerability ? (
                  <div className="ga-promoted-text">
                    {(['from_accelerationist', 'from_safetyist', 'from_skeptic'] as const).map(key => {
                      const vuln = node.graph_attributes!.steelman_vulnerability as Record<string, string | undefined>;
                      const colorMap: Record<string, string> = { from_accelerationist: 'var(--color-acc)', from_safetyist: 'var(--color-saf)', from_skeptic: 'var(--color-skp)' };
                      const labelMap: Record<string, string> = { from_accelerationist: 'Accelerationist', from_safetyist: 'Safetyist', from_skeptic: 'Skeptic' };
                      if (!vuln[key] && readOnly) return null;
                      return (
                        <div key={key} style={{ marginBottom: 4 }}>
                          <strong style={{ color: colorMap[key] }}>{labelMap[key]}:</strong>
                          {readOnly ? (
                            <span> {vuln[key]}</span>
                          ) : (
                            <textarea
                              className="nd-vulnerability-input"
                              value={vuln[key] ?? ''}
                              rows={2}
                              onChange={(e) => {
                                update({ graph_attributes: { ...node.graph_attributes!, steelman_vulnerability: { ...vuln, [key]: e.target.value } } });
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : !readOnly ? (
                  <button
                    className="btn btn-sm nd-add-btn"
                    onClick={() => {
                      update({ graph_attributes: { ...node.graph_attributes!, steelman_vulnerability: '' } });
                    }}
                  >+ Add Vulnerability</button>
                ) : (
                  <div className="ga-empty">&mdash;</div>
                )}
              </div>
            )}

            {node.graph_attributes?.intellectual_lineage && node.graph_attributes.intellectual_lineage.length > 0 && (
              <div className="form-group">
                <label>Intellectual Lineage</label>
                <div className="ga-promoted-list">
                  {[...node.graph_attributes.intellectual_lineage].map(v => typeof v === 'string' ? v : (v as { name?: string })?.name).filter((v): v is string => typeof v === 'string' && v.length > 0).sort((a, b) => a.localeCompare(b)).map((l, i) => (
                    <span
                      key={i}
                      className={`ga-promoted-chip ga-promoted-chip-interactive${expandedLineage === l ? ' ga-promoted-chip-selected' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setExpandedLineage(expandedLineage === l ? null : l); }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); showAttributeInfo('intellectual_lineage', l); }}
                      title={`Click to view lineage info: "${l}"`}
                    >
                      {l}
                    </span>
                  ))}
                </div>
                {expandedLineage && (() => {
                  const info = getLineageInfo(expandedLineage);
                  if (!info) return (
                    <div className="lineage-inline-detail">
                      <div className="lineage-inline-header">
                        <span className="lineage-inline-label">{expandedLineage}</span>
                        <button className="lineage-inline-close" onClick={() => setExpandedLineage(null)} title="Close">×</button>
                      </div>
                      <div className="lineage-inline-empty">No detailed information available for this lineage.</div>
                    </div>
                  );
                  return (
                    <div className="lineage-inline-detail">
                      <div className="lineage-inline-header">
                        <span className="lineage-inline-label">{info.label}</span>
                        <button className="lineage-inline-close" onClick={() => setExpandedLineage(null)} title="Close">×</button>
                      </div>
                      <div className="lineage-inline-summary">{info.summary}</div>
                      {info.example && (
                        <div className="lineage-inline-example">
                          <span className="lineage-inline-example-label">Example:</span> {info.example}
                        </div>
                      )}
                      {info.links && info.links.length > 0 && (
                        <div className="lineage-inline-links">
                          {info.links.map((link, li) => (
                            <a
                              key={li}
                              className="lineage-inline-link"
                              href="#"
                              onClick={(e) => { e.preventDefault(); void api.openExternal(link.url); }}
                              title={link.url}
                            >
                              {link.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}

        {activeTab === 'related' && (
          <div className="node-detail-related-split" ref={splitContainerRef}>
            <div className="node-detail-related-list" style={{ width: `${relatedSplitPct}%` }}>
              <RelatedEdgesPanel />
            </div>
            <div className="resize-handle" onMouseDown={handleSplitMouseDown} />
            <div className="node-detail-related-detail" style={{ width: `${100 - relatedSplitPct}%` }}>
              {selectedEdge ? (
                <EdgeDetailPanel width={0} />
              ) : (
                <div className="node-detail-related-empty">Select an edge to view details</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'attributes' && hasGraphAttrs && (
          <GraphAttributesPanel
            attrs={node.graph_attributes!}
            onBadgeClick={runAttributeFilter}
            onShowAttributeInfo={showAttributeInfo}
            onUpdatePolicyActions={readOnly ? undefined : (actions) => updatePovNode(pov, node.id, { graph_attributes: { ...node.graph_attributes!, policy_actions: actions } })}
            onUpdateAssumptions={readOnly ? undefined : (assumes) => updatePovNode(pov, node.id, { graph_attributes: { ...node.graph_attributes!, assumes } })}
            readOnly={readOnly}
            defaultOpen
          />
        )}

        {activeTab === 'sources' && (
          <SourcesPanel nodeId={node.id} />
        )}

        {activeTab === 'research' && (
          <div className="node-detail-research">
            <EvidenceGraphSection nodeId={node.id} />
            <RelatedCruxes nodeId={node.id} />
            <div className="node-detail-research-header">
              <span className="node-detail-research-desc">Research prompt for this position. Edit as needed, then copy to clipboard.</span>
              <button
                className={`btn btn-sm${researchCopied ? '' : ' btn-ghost'}`}
                onClick={handleResearchCopy}
              >
                {researchCopied ? '\u2713 Copied' : 'Copy'}
              </button>
            </div>
            <textarea
              ref={researchTextareaRef}
              className="node-detail-research-textarea"
              value={researchText}
              onChange={(e) => setResearchText(e.target.value)}
              spellCheck={false}
            />
          </div>
        )}
      </div>

      {showDelete && !readOnly && (
        <DeleteConfirmDialog
          itemLabel={node.label}
          onConfirm={() => {
            deletePovNode(pov, node.id);
            setShowDelete(false);
          }}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}

// ── Related Cruxes (shown in Research tab) ──

const CRUX_TYPE_COLORS: Record<string, string> = {
  empirical: 'var(--color-acc, #3b82f6)',
  values: 'var(--color-saf, #ef4444)',
  definitional: 'var(--color-skp, #f59e0b)',
};

function RelatedCruxes({ nodeId }: { nodeId: string }) {
  const { aggregatedCruxes, navigateToNode } = useTaxonomyStore();
  const related = aggregatedCruxes?.filter(c => c.linked_node_ids.includes(nodeId)) ?? [];
  const [expanded, setExpanded] = useState(related.length <= 5);

  if (!aggregatedCruxes || related.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: expanded ? 6 : 0, color: 'var(--text-primary)', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setExpanded(!expanded)}
        title={expanded ? 'Collapse' : 'Expand'}
      >
        <span style={{ display: 'inline-block', width: 14, fontSize: '0.7rem' }}>{expanded ? '▾' : '▸'}</span>
        Related Cruxes ({related.length})
      </div>
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {related.map(crux => (
            <CruxChip key={crux.id} crux={crux} onClick={() => navigateToNode('cruxes', crux.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CruxChip({ crux, onClick }: { crux: AggregatedCrux; onClick: () => void }) {
  const rs = crux.resolution_summary;
  const dominant = rs.resolved > 0 && rs.active === 0 ? 'resolved' : rs.irreducible > 0 && rs.active === 0 ? 'irreducible' : 'active';

  return (
    <button
      className="btn btn-sm btn-ghost"
      onClick={onClick}
      title={`${crux.statement}\n\nType: ${crux.type} | Status: ${dominant}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        textAlign: 'left', padding: '4px 8px', fontSize: '0.75rem',
        lineHeight: 1.3, width: '100%',
      }}
    >
      <span
        style={{
          display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
          backgroundColor: CRUX_TYPE_COLORS[crux.type] ?? 'var(--text-muted)',
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {crux.statement}
      </span>
      <span style={{
        fontSize: '0.65rem', flexShrink: 0,
        color: dominant === 'resolved' ? 'var(--color-saf)' : dominant === 'irreducible' ? 'var(--color-skp)' : 'var(--text-muted)',
      }}>
        {dominant}
      </span>
    </button>
  );
}

// ── Evidence QBAF Graph (shown in Research tab) ──

interface EvidenceItem {
  id: string;
  source_doc_id: string;
  text: string;
  relation: 'support' | 'contradict';
  similarity: number;
}

interface EvidenceGraphData {
  evidence_items: EvidenceItem[];
  computed_strength: number;
  qbaf_iterations: number;
}

function EvidenceGraphSection({ nodeId }: { nodeId: string }) {
  const activeDebate = useDebateStore(s => s.activeDebate);

  const evidenceNodes = useMemo(() => {
    const an = activeDebate?.argument_network;
    if (!an) return [];
    return an.nodes.filter(
      n => n.taxonomy_refs?.includes(nodeId) && n.evidence_graph
    );
  }, [activeDebate, nodeId]);

  if (evidenceNodes.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>
        Evidence Graph ({evidenceNodes.length} claim{evidenceNodes.length !== 1 ? 's' : ''})
      </div>
      {evidenceNodes.map(node => {
        const eg = node.evidence_graph as EvidenceGraphData;
        const sorted = [...eg.evidence_items].sort((a, b) => {
          if (a.relation !== b.relation) return a.relation === 'contradict' ? -1 : 1;
          return b.similarity - a.similarity;
        });
        const supports = sorted.filter(e => e.relation === 'support');
        const contradicts = sorted.filter(e => e.relation === 'contradict');
        const barPct = Math.round(eg.computed_strength * 100);
        const barColor = eg.computed_strength >= 0.7 ? '#22c55e' : eg.computed_strength >= 0.4 ? '#f59e0b' : '#ef4444';
        return (
          <div key={node.id} style={{
            marginBottom: 8, padding: '8px 10px', borderRadius: 6,
            border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
          }}>
            <div style={{ fontSize: '0.75rem', marginBottom: 6, lineHeight: 1.4 }}>
              {node.text}
            </div>
            {/* Strength bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{
                flex: 1, height: 6, borderRadius: 3,
                background: 'var(--bg-primary)',
              }}>
                <div style={{
                  width: `${barPct}%`, height: '100%', borderRadius: 3,
                  background: barColor, transition: 'width 0.3s',
                }} />
              </div>
              <span style={{
                fontSize: '0.7rem', fontWeight: 700, color: barColor, minWidth: 40,
              }}>
                {(eg.computed_strength ?? 0).toFixed(2)}
              </span>
              <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                {eg.qbaf_iterations} iter
              </span>
            </div>
            {/* Evidence items */}
            {sorted.map(item => (
              <div key={item.id} style={{
                marginBottom: 4, padding: '4px 8px', borderRadius: 4,
                borderLeft: `3px solid ${item.relation === 'support' ? '#22c55e' : '#ef4444'}`,
                background: item.relation === 'support' ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{
                    fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                    background: item.relation === 'support' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                    color: item.relation === 'support' ? '#22c55e' : '#ef4444',
                  }}>
                    {item.relation === 'support' ? 'SUPPORTS' : 'CONTRADICTS'}
                  </span>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                    {(item.similarity * 100).toFixed(0)}% sim
                  </span>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.source_doc_id}
                  </span>
                </div>
                <div style={{ fontSize: '0.7rem', lineHeight: 1.4, color: 'var(--text-primary)' }}>
                  {item.text}
                </div>
              </div>
            ))}
            {/* Summary line */}
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 4 }}>
              {supports.length} supporting, {contradicts.length} contradicting
            </div>
          </div>
        );
      })}
    </div>
  );
}
