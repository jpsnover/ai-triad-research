// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef } from 'react';
import { POV_META } from '@lib/electron-shared/povMeta';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type { SituationNode } from '../../types/taxonomy';
import { interpretationText } from '../../types/taxonomy';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { DeleteConfirmDialog } from '../shared/DeleteConfirmDialog';
import { HighlightedTextarea } from '../shared/HighlightedField';
import { TypeaheadSelect } from '../shared/TypeaheadSelect';
import { EmptyState } from '../shared/EmptyState';
import { FieldHelp } from '../shared/FieldHelp';
import { LinkedChip } from '../shared/LinkedChip';
import { GraphAttributesPanel } from '../taxonomy/GraphAttributesPanel';
import { getLineageInfo } from '../../data/lineageLookup';
import { researchPrompt } from '../../prompts/research';
import { SourcesPanel } from '../policy/SourcesPanel';
import { SituationDebatePanel } from './SituationDebatePanel';
import { nodeTypeFromId } from '@lib/debate/nodeIdUtils';
import { api } from '@bridge';
import { triggerSituationNodeRegeneration } from '../../utils/regeneratePlainDescription';
import { useDescriptionMode, DescriptionToggle } from '../shared/DescriptionToggle';
import { StakeholderSection } from '../organizations/StakeholderSection';

interface SituationDetailProps {
  node: SituationNode;
  readOnly?: boolean;
  onPin?: () => void;
  onRelated?: () => void;
  onDebate?: () => void;
  chipDepth?: number;
}

type SitTab = 'overview' | 'attributes' | 'accelerationist' | 'safetyist' | 'skeptic' | 'debate' | 'sources' | 'research';

const SIT_TABS: { id: SitTab; label: string; color: string }[] = [
  { id: 'overview', label: 'Overview', color: 'var(--text-primary)' },
  { id: 'attributes', label: 'Attributes', color: 'var(--text-primary)' },
  { id: 'accelerationist', label: POV_META.accelerationist.label, color: `var(${POV_META.accelerationist.cssVar})` },
  { id: 'safetyist', label: POV_META.safetyist.label, color: `var(${POV_META.safetyist.cssVar})` },
  { id: 'skeptic', label: POV_META.skeptic.label, color: `var(${POV_META.skeptic.cssVar})` },
  { id: 'debate', label: 'Debate', color: `var(${POV_META.situations.cssVar})` },
  { id: 'sources', label: 'Sources', color: 'var(--text-primary)' },
  { id: 'research', label: 'Research', color: 'var(--text-primary)' },
];

const POV_TITLES: Record<string, string> = {
  accelerationist: 'Accelerationist View: The Path to Progress',
  safetyist: 'Safetyist View: The Case for Caution',
  skeptic: 'Skeptic View: Questioning the Narrative',
};

export function SituationDetail({ node, readOnly, onPin, onRelated, onDebate, chipDepth = 0 }: SituationDetailProps) {
  const { updateSituationNode, deleteSituationNode, validationErrors, getAllNodeIds, getAllConflictIds, runAttributeFilter, showAttributeInfo, getLabelForId } = useTaxonomyStore();
  const [descMode, setDescMode] = useDescriptionMode();
  const [showDelete, setShowDelete] = useState(false);
  const [activeTab, setActiveTab] = useState<SitTab>('overview');
  const [editing, setEditing] = useState(false);
  const [expandedLineage, setExpandedLineage] = useState<string | null>(null);
  const [researchText, setResearchText] = useState('');
  const [researchCopied, setResearchCopied] = useState(false);
  const researchTextareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // Reset edit mode when switching tabs or nodes
  useEffect(() => {
    setEditing(false);
  }, [activeTab, node.id]);

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
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'situation-detail', level: 'warn', message: 'clipboard write failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
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
    <div ref={formRef} className="sit-detail node-detail-tabbed">
      {/* Header — matches POV detail layout (editable label + category badge + icon actions) */}
      <div className="nd-header">
        <div className="nd-header-title">
          {readOnly ? (
            <span className="nd-header-label" title={node.label}>{node.label}</span>
          ) : (
            <input
              className={`nd-header-label nd-header-label-editable ${err('label') ? 'has-error' : ''}`}
              value={node.label}
              onChange={(e) => update({ label: e.target.value })}
              placeholder="Label"
              aria-label="Label"
              title={node.label}
            />
          )}
          <span className="nd-header-id">{node.id}</span>
          <span className="nd-header-cat" data-cat="SITUATIONS">SITUATIONS</span>
        </div>
        <div className="nd-header-actions">
          {onDebate && (
            <button className="nd-header-btn" onClick={onDebate} title="Start a structured debate">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </button>
          )}
          {onPin && (
            <button className="nd-header-btn" onClick={onPin} title="Pin for comparison">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
            </button>
          )}
        </div>
      </div>

      {hasErrors && (
        <div className="validation-banner">
          <span className="validation-banner-icon">!</span>
          Please fix the highlighted fields before saving.
        </div>
      )}

      {!readOnly && err('label') && (
        <div className="error-text" style={{ padding: '0 14px 4px' }}>{err('label')}</div>
      )}

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
            <div className={`form-group ${err('description') ? 'has-error' : ''}`}>
              <div className="description-header">
                <label>
                  Description
                  <FieldHelp text={'Genus-differentia format:\n"A situation that [differentia].\nEncompasses: ...\nExcludes: ..."\nEncompasses and Excludes must each start on a new line.'} />
                </label>
                <DescriptionToggle mode={descMode} onToggle={setDescMode} hasPlainDescription={!!node.plain_description} />
              </div>
              {descMode === 'formal' ? (
                <>
                  <HighlightedTextarea
                    value={node.description}
                    onChange={(v) => update({ description: v })}
                    rows={4}
                    readOnly={readOnly}
                  />
                  {err('description') && <div className="error-text">{err('description')}</div>}
                </>
              ) : (
                <>
                  {node.plain_description === null ? (
                    <div className="plain-description-box plain-description-generating">Regenerating…</div>
                  ) : (
                    <div className="plain-description-box">{node.plain_description ?? node.description}</div>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      className="plain-description-regen"
                      disabled={node.plain_description === null}
                      onClick={() => triggerSituationNodeRegeneration(node.id, node.description, updateSituationNode)}
                    >
                      ↻ Regenerate
                    </button>
                  )}
                </>
              )}
            </div>

            {node.interpretation_divergence != null && (() => {
              const div = node.interpretation_divergence;
              const color = div > 0.40 ? '#22c55e' : div >= 0.20 ? '#f59e0b' : '#ef4444';
              const label = div > 0.40 ? 'High divergence' : div >= 0.20 ? 'Moderate divergence' : 'Low divergence';
              return (
                <div className="form-group">
                  <label>Interpretation Divergence</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                    <span style={{ fontWeight: 600, fontSize: '1.05rem', fontFamily: 'monospace', color }}>{div.toFixed(2)}</span>
                    <div style={{ flex: 1, height: 8, background: 'var(--bg-tertiary, var(--border))', borderRadius: 4, overflow: 'hidden', maxWidth: 160 }}>
                      <div style={{ width: `${Math.round(div * 100)}%`, height: '100%', background: color, borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                    Mean pairwise cosine distance across the three POV interpretation embeddings.
                    {div > 0.40 ? ' Perspectives disagree strongly on this situation.'
                      : div >= 0.20 ? ' Perspectives partially overlap on this situation.'
                      : ' Perspectives are near-consensus on this situation.'}
                  </div>
                </div>
              );
            })()}

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

            <div className="form-group">
              <label>
                Linked Nodes
                <FieldHelp text="POV-specific nodes that relate to this situation." />
              </label>
              <div className="chip-list">
                {(node.linked_nodes ?? []).map((id) => (
                  <LinkedChip key={id} id={id} depth={chipDepth} readOnly={readOnly} onRemove={removeLinked} />
                ))}
              </div>
              {!readOnly && (
                <TypeaheadSelect
                  options={allPovIds.filter(id => !(node.linked_nodes ?? []).includes(id))}
                  onSelect={addLinked}
                  placeholder="Search linked nodes..."
                />
              )}
            </div>

            <StakeholderSection nodeId={node.id} queryType="topic" />

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

        {activeTab === 'debate' && (
          <SituationDebatePanel node={node} onLaunched={() => {}} />
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
                  const bdiFields: { key: 'summary' | 'belief' | 'desire' | 'intention'; label: string }[] = [
                    { key: 'summary', label: 'Summary' },
                    { key: 'belief', label: 'Belief' },
                    { key: 'desire', label: 'Desire' },
                    { key: 'intention', label: 'Intention' },
                  ];
                  return (
                    <>
                      {!editing && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {bdiFields.map(({ key, label }) => (
                            <div key={key}>
                              <div style={{ fontSize: 'var(--text-xs)', letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', marginBottom: 4 }}>
                                {label}
                              </div>
                              <div
                                style={{ fontSize: 'var(--text-md)', lineHeight: 1.5, color: 'var(--text-primary)', cursor: 'pointer' }}
                                onClick={() => setEditing(true)}
                                onKeyDown={(e) => { if (e.key === 'Enter') setEditing(true); }}
                                tabIndex={0}
                                role="button"
                                aria-label={`Edit ${label}`}
                              >
                                {bdi[key] || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No {label.toLowerCase()} recorded</span>}
                              </div>
                            </div>
                          ))}
                          <div>
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={() => setEditing(true)}
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      )}
                      {editing && (
                        <>
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
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <button className="btn btn-sm btn-primary" onClick={() => setEditing(false)}>Done</button>
                            <button className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
                          </div>
                        </>
                      )}
                    </>
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
                  <EmptyState
                    headline="No supporting evidence yet"
                    direction={`Link a ${activeTab} node to ground this perspective.`}
                  />
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
