// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Pov, PovNode, Category } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';
import { TypeaheadSelect } from './TypeaheadSelect';
import { FieldHelp } from './FieldHelp';
import { LinkedChip } from './LinkedChip';
import { GraphAttributesPanel } from './GraphAttributesPanel';
import { RelatedEdgesPanel } from './RelatedEdgesPanel';
import { EdgeDetailPanel } from './EdgeDetailPanel';
import { INTELLECTUAL_LINEAGES } from '../data/intellectualLineageInfo';
import { researchPrompt } from '../prompts/research';
import { SourcesPanel } from './SourcesPanel';
import { nodeTypeFromId } from '@lib/debate';
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
const ALL_POVS: Pov[] = ['accelerationist', 'safetyist', 'skeptic'];

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
        loadEdges();
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
          <span className="nd-header-label">{node.label}</span>
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
              onAIAnalysis={() => useTaxonomyStore.getState().runNodeCritique(pov, node)}
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
        <button
          className={`node-detail-tab ${activeTab === 'related' ? 'node-detail-tab-active' : ''}`}
          onClick={() => setActiveTab('related')}
        >
          Related
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
            {!readOnly && (
              <div className={`form-group ${err('label') ? 'has-error' : ''}`}>
                <label>Label</label>
                <HighlightedInput
                  value={node.label}
                  onChange={(v) => update({ label: v })}
                />
                {err('label') && <div className="error-text">{err('label')}</div>}
              </div>
            )}

            <div className={`form-group ${err('description') ? 'has-error' : ''}`}>
              <label>
                Description
                <FieldHelp text={`Genus-differentia format: "${CATEGORY_SINGULAR[node.category]} within [POV] discourse that [differentia]. Encompasses: ... Excludes: ..."`} />
              </label>
              <HighlightedTextarea
                value={node.description}
                onChange={(v) => update({ description: v })}
                rows={5}
                readOnly={readOnly}
              />
              {err('description') && <div className="error-text">{err('description')}</div>}
            </div>

            {/* Hierarchy: parent and children */}
            {(node.parent_id || (node.children && node.children.length > 0)) && (
              <div className="form-group">
                <label>Hierarchy</label>
                <div className="hierarchy-section">
                  {node.parent_id && (
                    <span
                      className="hierarchy-chip"
                      onClick={() => setSelectedNodeId(node.parent_id)}
                      title={`Navigate to parent: ${node.parent_id}`}
                    >
                      &#9650; {getLabelForId(node.parent_id) || node.parent_id}
                      {node.parent_relationship && (
                        <span className="hierarchy-chip-label">
                          {node.parent_relationship === 'is_a' ? 'is a' :
                           node.parent_relationship === 'part_of' ? 'part of' :
                           node.parent_relationship}
                        </span>
                      )}
                    </span>
                  )}
                  {node.children && node.children.length > 0 && node.children.map(childId => (
                    <span
                      key={childId}
                      className="hierarchy-chip"
                      onClick={() => setSelectedNodeId(childId)}
                      title={`Navigate to child: ${childId}`}
                    >
                      &#9660; {getLabelForId(childId) || childId}
                    </span>
                  ))}
                </div>
                {node.parent_rationale && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' }}>
                    {node.parent_rationale}
                  </div>
                )}
              </div>
            )}

            {node.graph_attributes?.steelman_vulnerability && (
              <div className="form-group">
                <label>Steelman Vulnerability</label>
                {typeof node.graph_attributes.steelman_vulnerability === 'string' ? (
                  <div className="ga-promoted-text">{node.graph_attributes.steelman_vulnerability}</div>
                ) : (
                  <div className="ga-promoted-text">
                    {node.graph_attributes.steelman_vulnerability.from_accelerationist && (
                      <div><strong style={{ color: 'var(--color-acc)' }}>Accelerationist:</strong> {node.graph_attributes.steelman_vulnerability.from_accelerationist}</div>
                    )}
                    {node.graph_attributes.steelman_vulnerability.from_safetyist && (
                      <div><strong style={{ color: 'var(--color-saf)' }}>Safetyist:</strong> {node.graph_attributes.steelman_vulnerability.from_safetyist}</div>
                    )}
                    {node.graph_attributes.steelman_vulnerability.from_skeptic && (
                      <div><strong style={{ color: 'var(--color-skp)' }}>Skeptic:</strong> {node.graph_attributes.steelman_vulnerability.from_skeptic}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {node.graph_attributes?.intellectual_lineage && node.graph_attributes.intellectual_lineage.length > 0 && (
              <div className="form-group">
                <label>Intellectual Lineage</label>
                <div className="ga-promoted-list">
                  {node.graph_attributes.intellectual_lineage.map((l, i) => (
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
                  const info = INTELLECTUAL_LINEAGES[expandedLineage];
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
                              onClick={(e) => { e.preventDefault(); api.openExternal(link.url); }}
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
            readOnly={readOnly}
            defaultOpen
          />
        )}

        {activeTab === 'sources' && (
          <SourcesPanel nodeId={node.id} />
        )}

        {activeTab === 'research' && (
          <div className="node-detail-research">
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
