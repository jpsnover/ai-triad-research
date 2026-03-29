// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { CrossCuttingNode } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';
import { TypeaheadSelect } from './TypeaheadSelect';
import { FieldHelp } from './FieldHelp';
import { LinkedChip } from './LinkedChip';
import { GraphAttributesPanel } from './GraphAttributesPanel';
import { generateResearchPrompt } from '../utils/researchPrompt';
import { SourcesPanel } from './SourcesPanel';

interface CrossCuttingDetailProps {
  node: CrossCuttingNode;
  readOnly?: boolean;
  onPin?: () => void;
  onRelated?: () => void;
  onDebate?: () => void;
  chipDepth?: number;
}

type CCTab = 'overview' | 'attributes' | 'sources' | 'accelerationist' | 'safetyist' | 'skeptic';

const CC_TABS: { id: CCTab; label: string; color: string }[] = [
  { id: 'overview', label: 'Overview', color: 'var(--text-primary)' },
  { id: 'attributes', label: 'Attributes', color: 'var(--text-primary)' },
  { id: 'sources', label: 'Sources', color: 'var(--text-primary)' },
  { id: 'accelerationist', label: 'Accelerationist', color: 'var(--color-acc)' },
  { id: 'safetyist', label: 'Safetyist', color: 'var(--color-saf)' },
  { id: 'skeptic', label: 'Skeptic', color: 'var(--color-skp)' },
];

const POV_TITLES: Record<string, string> = {
  accelerationist: 'Accelerationist View: The Path to Progress',
  safetyist: 'Safetyist View: The Case for Caution',
  skeptic: 'Skeptic View: Questioning the Narrative',
};

export function CrossCuttingDetail({ node, readOnly, onPin, onRelated, onDebate, chipDepth = 0 }: CrossCuttingDetailProps) {
  const { updateCrossCuttingNode, deleteCrossCuttingNode, validationErrors, getAllNodeIds, getAllConflictIds, runAttributeFilter, showAttributeInfo, navigateToLineage, getLabelForId } = useTaxonomyStore();
  const [showDelete, setShowDelete] = useState(false);
  const [activeTab, setActiveTab] = useState<CCTab>('overview');
  const formRef = useRef<HTMLDivElement>(null);

  const allPovIds = getAllNodeIds().filter(id => !id.startsWith('cc-'));
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

  const update = (updates: Partial<CrossCuttingNode>) => {
    if (readOnly) return;
    updateCrossCuttingNode(node.id, updates);
  };

  const updateInterpretation = (pov: 'accelerationist' | 'safetyist' | 'skeptic', value: string) => {
    update({
      interpretations: { ...node.interpretations, [pov]: value },
    });
  };

  const addLinked = (id: string) => {
    if (id && !node.linked_nodes.includes(id)) {
      update({ linked_nodes: [...node.linked_nodes, id] });
    }
  };

  const removeLinked = (id: string) => {
    update({ linked_nodes: node.linked_nodes.filter(n => n !== id) });
  };

  // Filter linked nodes by POV prefix for the supporting evidence sidebar
  const linkedByPov = (pov: string) => {
    const prefix = pov === 'accelerationist' ? 'acc-' : pov === 'safetyist' ? 'saf-' : 'skp-';
    return node.linked_nodes.filter(id => id.startsWith(prefix));
  };

  return (
    <div ref={formRef} className="cc-detail">
      {/* Action pill toolbar — matches POV detail style */}
      <div className="node-detail-toolbar">
        {onDebate && (
          <button className="node-detail-pill" onClick={onDebate} title="Start a structured debate">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Debate
          </button>
        )}
        {onPin && (
          <button className="node-detail-pill" onClick={onPin} title="Pin for comparison">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
            Pin
          </button>
        )}
      </div>

      {hasErrors && (
        <div className="validation-banner">
          <span className="validation-banner-icon">!</span>
          Please fix the highlighted fields before saving.
        </div>
      )}

      {/* Title line — matches POV detail category:label style */}
      <div className="node-detail-title-line" data-cat="Cross-Cutting">
        <span className="node-detail-category">CROSS-CUTTING</span>
        <span className="node-detail-title-sep"> : </span>
        <span className="node-detail-label-text">{node.label}</span>
      </div>
      {node.disagreement_type && (
        <div className="cc-detail-disagreement-type" style={{ marginTop: '4px' }}>
          <span
            className="ga-badge"
            style={{
              backgroundColor: {
                definitional: '#0891b2',
                interpretive: '#7c3aed',
                structural: '#d97706',
              }[node.disagreement_type] || '#64748b',
              color: '#fff',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            {node.disagreement_type.replace(/_/g, ' ')}
          </span>
        </div>
      )}

      {/* Tab bar */}
      <div className="cc-detail-tabs">
        {CC_TABS.filter(t => t.id !== 'attributes' || node.graph_attributes).map((tab) => (
          <button
            key={tab.id}
            className={`cc-detail-tab ${activeTab === tab.id ? 'cc-detail-tab-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            style={activeTab === tab.id ? { color: tab.color, borderBottomColor: tab.color } : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="cc-detail-tab-content">
        {activeTab === 'overview' && (
          <div className="cc-overview">
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
              <label>Description</label>
              <HighlightedTextarea
                value={node.description}
                onChange={(v) => update({ description: v })}
                rows={4}
                readOnly={readOnly}
              />
              {err('description') && <div className="error-text">{err('description')}</div>}
            </div>

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
                      className="ga-promoted-chip ga-promoted-chip-interactive"
                      onClick={(e) => { e.stopPropagation(); navigateToLineage(l); }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); showAttributeInfo('intellectual_lineage', l); }}
                      title={`Click to view lineage info: "${l}"`}
                    >
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="form-group">
              <label>
                Linked Nodes
                <FieldHelp text="POV-specific nodes that relate to this cross-cutting concept." />
              </label>
              <div className="chip-list">
                {node.linked_nodes.map((id) => (
                  <LinkedChip key={id} id={id} depth={chipDepth} readOnly={readOnly} onRemove={removeLinked} />
                ))}
              </div>
              {!readOnly && (
                <TypeaheadSelect
                  options={allPovIds.filter(id => !node.linked_nodes.includes(id))}
                  onSelect={addLinked}
                  placeholder="Search linked nodes..."
                />
              )}
            </div>

          </div>
        )}

        {activeTab === 'attributes' && node.graph_attributes && (
          <GraphAttributesPanel
            attrs={node.graph_attributes}
            onBadgeClick={runAttributeFilter}
            onShowAttributeInfo={showAttributeInfo}
            defaultOpen
          />
        )}

        {activeTab === 'sources' && (
          <SourcesPanel nodeId={node.id} />
        )}

        {(activeTab === 'accelerationist' || activeTab === 'safetyist' || activeTab === 'skeptic') && (
          <div className="cc-pov-split">
            {/* Left: Interpretation */}
            <div className="cc-pov-interpretation">
              <h3 className="cc-pov-heading">{POV_TITLES[activeTab]}</h3>
              {readOnly ? (
                <div className="cc-pov-text">{node.interpretations[activeTab]}</div>
              ) : (
                <div className={`form-group ${err(`interpretations.${activeTab}`) ? 'has-error' : ''}`}>
                  <HighlightedTextarea
                    value={node.interpretations[activeTab]}
                    onChange={(v) => updateInterpretation(activeTab, v)}
                    rows={8}
                  />
                  {err(`interpretations.${activeTab}`) && <div className="error-text">{err(`interpretations.${activeTab}`)}</div>}
                </div>
              )}
            </div>

            {/* Right: Supporting Evidence (linked nodes for this POV) */}
            <div className="cc-pov-evidence">
              <h3
                className="cc-pov-evidence-heading"
                style={{ borderBottomColor: CC_TABS.find(t => t.id === activeTab)?.color }}
              >Supporting Evidence</h3>
              <div className="cc-pov-evidence-list">
                {linkedByPov(activeTab).length > 0 ? (
                  linkedByPov(activeTab).map((id) => (
                    <LinkedChip key={id} id={id} depth={chipDepth} readOnly={readOnly} onRemove={removeLinked} />
                  ))
                ) : (
                  <div className="cc-pov-evidence-empty">No linked nodes for this perspective</div>
                )}
              </div>
              {!readOnly && (
                <TypeaheadSelect
                  options={allPovIds.filter(id => {
                    const prefix = activeTab === 'accelerationist' ? 'acc-' : activeTab === 'safetyist' ? 'saf-' : 'skp-';
                    return id.startsWith(prefix) && !node.linked_nodes.includes(id);
                  })}
                  onSelect={addLinked}
                  placeholder={`Add ${activeTab} node...`}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {showDelete && !readOnly && (
        <DeleteConfirmDialog
          itemLabel={node.label}
          onConfirm={() => {
            deleteCrossCuttingNode(node.id);
            setShowDelete(false);
          }}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}
