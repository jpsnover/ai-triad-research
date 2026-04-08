// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef } from 'react';
import type { SituationNode } from '../types/taxonomy';
import { interpretationText } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';
import { TypeaheadSelect } from './TypeaheadSelect';
import { FieldHelp } from './FieldHelp';
import { LinkedChip } from './LinkedChip';
import { GraphAttributesPanel } from './GraphAttributesPanel';
import { researchPrompt } from '../prompts/research';
import { SourcesPanel } from './SourcesPanel';
import { nodeTypeFromId } from '@lib/debate';
import { api } from '@bridge';

interface SituationDetailProps {
  node: SituationNode;
  readOnly?: boolean;
  onPin?: () => void;
  onRelated?: () => void;
  onDebate?: () => void;
  chipDepth?: number;
}

type SitTab = 'overview' | 'attributes' | 'sources' | 'research' | 'accelerationist' | 'safetyist' | 'skeptic';

const SIT_TABS: { id: SitTab; label: string; color: string }[] = [
  { id: 'overview', label: 'Overview', color: 'var(--text-primary)' },
  { id: 'attributes', label: 'Attributes', color: 'var(--text-primary)' },
  { id: 'sources', label: 'Sources', color: 'var(--text-primary)' },
  { id: 'research', label: 'Research', color: 'var(--text-primary)' },
  { id: 'accelerationist', label: 'Accelerationist', color: 'var(--color-acc)' },
  { id: 'safetyist', label: 'Safetyist', color: 'var(--color-saf)' },
  { id: 'skeptic', label: 'Skeptic', color: 'var(--color-skp)' },
];

const POV_TITLES: Record<string, string> = {
  accelerationist: 'Accelerationist View: The Path to Progress',
  safetyist: 'Safetyist View: The Case for Caution',
  skeptic: 'Skeptic View: Questioning the Narrative',
};

export function SituationDetail({ node, readOnly, onPin, onRelated, onDebate, chipDepth = 0 }: SituationDetailProps) {
  const { updateSituationNode, deleteSituationNode, validationErrors, getAllNodeIds, getAllConflictIds, runAttributeFilter, showAttributeInfo, navigateToLineage, getLabelForId } = useTaxonomyStore();
  const [showDelete, setShowDelete] = useState(false);
  const [activeTab, setActiveTab] = useState<SitTab>('overview');
  const [researchText, setResearchText] = useState('');
  const [researchCopied, setResearchCopied] = useState(false);
  const researchTextareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

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

  const allPovIds = getAllNodeIds().filter(id => nodeTypeFromId(id) !== 'situation');
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

  const update = (updates: Partial<SituationNode>) => {
    if (readOnly) return;
    updateSituationNode(node.id, updates);
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
    <div ref={formRef} className="sit-detail">
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
      <div className="node-detail-title-line" data-cat="Situations">
        <span className="node-detail-category">SITUATIONS</span>
        <span className="node-detail-title-sep"> : </span>
        <span className="node-detail-label-text">{node.label}</span>
      </div>
      {node.disagreement_type && (
        <div className="sit-detail-disagreement-type" style={{ marginTop: '4px' }}>
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
      <div className="sit-detail-tabs">
        {SIT_TABS.filter(t => t.id !== 'attributes' || node.graph_attributes).map((tab) => (
          <button
            key={tab.id}
            className={`sit-detail-tab ${activeTab === tab.id ? 'sit-detail-tab-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            style={activeTab === tab.id ? { color: tab.color, borderBottomColor: tab.color } : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="sit-detail-tab-content">
        {activeTab === 'overview' && (
          <div className="sit-overview">
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
                <FieldHelp text='Genus-differentia format: "A situation that [differentia]. Encompasses: ... Excludes: ..."' />
              </label>
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
                <FieldHelp text="POV-specific nodes that relate to this situation." />
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

        {activeTab === 'research' && (
          <div className="node-detail-research">
            <div className="node-detail-research-header">
              <span className="node-detail-research-desc">Research prompt for this situation. Edit as needed, then copy to clipboard.</span>
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

        {(activeTab === 'accelerationist' || activeTab === 'safetyist' || activeTab === 'skeptic') && (
          <div className="sit-pov-split">
            {/* Left: Interpretation */}
            <div className="sit-pov-interpretation">
              <h3 className="sit-pov-heading">{POV_TITLES[activeTab]}</h3>
              {(() => {
                const interp = node.interpretations[activeTab];
                const isBdi = typeof interp === 'object' && interp !== null && 'belief' in interp;
                if (isBdi) {
                  const bdi = interp as { belief: string; desire: string; intention: string; summary: string };
                  if (readOnly) {
                    return (
                      <div className="sit-pov-text sit-bdi-breakdown">
                        <div className="sit-bdi-summary">{bdi.summary}</div>
                        <div className="sit-bdi-row"><span className="sit-bdi-label">Belief:</span> {bdi.belief}</div>
                        <div className="sit-bdi-row"><span className="sit-bdi-label">Desire:</span> {bdi.desire}</div>
                        <div className="sit-bdi-row"><span className="sit-bdi-label">Intention:</span> {bdi.intention}</div>
                      </div>
                    );
                  }
                  const updateBdiField = (field: 'summary' | 'belief' | 'desire' | 'intention', value: string) => {
                    update({
                      interpretations: {
                        ...node.interpretations,
                        [activeTab]: { ...bdi, [field]: value },
                      },
                    });
                  };
                  return (
                    <div className="sit-bdi-breakdown sit-bdi-edit">
                      <div className="form-group">
                        <label className="sit-bdi-field-label">Summary</label>
                        <HighlightedTextarea value={bdi.summary} onChange={(v) => updateBdiField('summary', v)} rows={2} />
                      </div>
                      <div className="form-group">
                        <label className="sit-bdi-field-label sit-bdi-label-belief">Belief</label>
                        <HighlightedTextarea value={bdi.belief} onChange={(v) => updateBdiField('belief', v)} rows={2} />
                      </div>
                      <div className="form-group">
                        <label className="sit-bdi-field-label sit-bdi-label-desire">Desire</label>
                        <HighlightedTextarea value={bdi.desire} onChange={(v) => updateBdiField('desire', v)} rows={2} />
                      </div>
                      <div className="form-group">
                        <label className="sit-bdi-field-label sit-bdi-label-intention">Intention</label>
                        <HighlightedTextarea value={bdi.intention} onChange={(v) => updateBdiField('intention', v)} rows={2} />
                      </div>
                    </div>
                  );
                }
                // Legacy plain-string interpretation
                if (readOnly) {
                  return <div className="sit-pov-text">{interpretationText(interp)}</div>;
                }
                return (
                  <div className={`form-group ${err(`interpretations.${activeTab}`) ? 'has-error' : ''}`}>
                    <HighlightedTextarea
                      value={interpretationText(interp)}
                      onChange={(v) => updateInterpretation(activeTab, v)}
                      rows={8}
                    />
                    {err(`interpretations.${activeTab}`) && <div className="error-text">{err(`interpretations.${activeTab}`)}</div>}
                  </div>
                );
              })()}
            </div>

            {/* Right: Supporting Evidence (linked nodes for this POV) */}
            <div className="sit-pov-evidence">
              <h3
                className="sit-pov-evidence-heading"
                style={{ borderBottomColor: SIT_TABS.find(t => t.id === activeTab)?.color }}
              >Supporting Evidence</h3>
              <div className="sit-pov-evidence-list">
                {linkedByPov(activeTab).length > 0 ? (
                  linkedByPov(activeTab).map((id) => (
                    <LinkedChip key={id} id={id} depth={chipDepth} readOnly={readOnly} onRemove={removeLinked} />
                  ))
                ) : (
                  <div className="sit-pov-evidence-empty">No linked nodes for this perspective</div>
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
            deleteSituationNode(node.id);
            setShowDelete(false);
          }}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}

/** @deprecated Use SituationDetail */
export const CrossCuttingDetail = SituationDetail;
