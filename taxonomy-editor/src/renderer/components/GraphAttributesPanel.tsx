// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useMemo } from 'react';
import type { GraphAttributes, PossibleFallacy } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import type { PolicyRegistryEntry } from '../hooks/useTaxonomyStore';
import { FALLACY_CATALOG } from '../data/fallacyInfo';
import { api } from '@bridge';

interface GraphAttributesPanelProps {
  attrs: GraphAttributes;
  onBadgeClick?: (field: string, value: string) => void;
  onShowAttributeInfo?: (field: string, value: string) => void;
  onUpdatePolicyActions?: (actions: GraphAttributes['policy_actions']) => void;
  onUpdateAssumptions?: (assumes: string[]) => void;
  readOnly?: boolean;
  defaultOpen?: boolean;
}

const LABEL_MAP: Record<string, string> = {
  epistemic_type: 'Epistemic Type',
  node_scope: 'Node Scope',
  rhetorical_strategy: 'Rhetorical Strategy',
  assumes: 'Assumptions',
  falsifiability: 'Falsifiability',
  audience: 'Audience',
  emotional_register: 'Emotional Register',
  policy_actions: 'Policy Actions',
  intellectual_lineage: 'Intellectual Lineage',
  steelman_vulnerability: 'Steelman Vulnerability',
};

const BADGE_COLORS: Record<string, string> = {
  // epistemic_type
  normative_prescription: '#7c3aed',
  empirical_claim: '#2563eb',
  definitional: '#0891b2',
  strategic_recommendation: '#059669',
  predictive: '#d97706',
  interpretive_lens: '#be185d',
  // node_scope
  claim: '#16a34a',
  scheme: '#2563eb',
  bridging: '#d97706',
  // emotional_register
  urgent: '#dc2626',
  measured: '#2563eb',
  optimistic: '#16a34a',
  cautionary: '#d97706',
  defiant: '#be185d',
  pragmatic: '#475569',
  alarmed: '#ef4444',
  dismissive: '#64748b',
  aspirational: '#7c3aed',
};

/** Fields that support "About..." right-click info */
const INFO_FIELDS = new Set([
  'rhetorical_strategy',
  'epistemic_type',
  'emotional_register',
  'intellectual_lineage',
]);

/** Map low/medium/high to a 1-5 scale position */
const HARDNESS_LEVELS: Record<string, { score: number; label: string }> = {
  low:    { score: 1, label: 'Low' },
  medium: { score: 3, label: 'Med' },
  high:   { score: 5, label: 'High' },
};

function formatValue(val: string): string {
  return val.replace(/_/g, ' ');
}

/** 5-point hardness meter for falsifiability */
function HardnessMeter({ field, value, onClick }: {
  field: string;
  value: string;
  onClick?: (field: string, value: string) => void;
}) {
  const level = HARDNESS_LEVELS[value] || { score: 0, label: value };
  const segments = 5;
  return (
    <div
      className={`ga-meter${onClick ? ' ga-meter-clickable' : ''}`}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(field, value); } : undefined}
      title={onClick ? `Find all nodes with ${formatValue(field)} = ${value}` : `${formatValue(field)}: ${value}`}
    >
      <div className="ga-meter-track">
        {Array.from({ length: segments }, (_, i) => (
          <div
            key={i}
            className={`ga-meter-seg${i < level.score ? ' ga-meter-filled' : ''}`}
            data-level={value}
          />
        ))}
      </div>
      <span className="ga-meter-label">{level.label}</span>
    </div>
  );
}

function Badge({ field, value, onClick, onContextMenu }: {
  field: string;
  value: string;
  onClick?: (field: string, value: string) => void;
  onContextMenu?: (e: React.MouseEvent, field: string, value: string) => void;
}) {
  const color = BADGE_COLORS[value] || '#475569';
  return (
    <span
      className={`ga-badge ${onClick ? 'ga-badge-clickable' : ''}`}
      style={{ borderColor: color, color }}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(field, value); } : undefined}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, field, value); } : undefined}
      title={onClick ? `Find all nodes with ${formatValue(field)} = ${formatValue(value)}` : undefined}
    >
      {formatValue(value)}
    </span>
  );
}

export function GraphAttributesPanel({ attrs, onBadgeClick, onShowAttributeInfo, onUpdatePolicyActions, onUpdateAssumptions, readOnly, defaultOpen }: GraphAttributesPanelProps) {
  const { policyRegistry, edgesFile } = useTaxonomyStore();
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [expandedPolicyId, setExpandedPolicyId] = useState<string | null>(null);
  const [policySearchQuery, setPolicySearchQuery] = useState('');
  const [showPolicyPicker, setShowPolicyPicker] = useState(false);
  const [editingAssumptions, setEditingAssumptions] = useState(false);

  // Filter registry for typeahead
  const filteredPolicies = useMemo(() => {
    if (!policyRegistry || !policySearchQuery.trim()) return [];
    const q = policySearchQuery.toLowerCase();
    const currentIds = new Set((attrs.policy_actions || []).map(pa => pa.policy_id).filter(Boolean));
    return policyRegistry
      .filter(p => !currentIds.has(p.id) && (p.id.toLowerCase().includes(q) || p.action.toLowerCase().includes(q)))
      .slice(0, 20);
  }, [policyRegistry, policySearchQuery, attrs.policy_actions]);

  const handleAddPolicy = (pol: PolicyRegistryEntry) => {
    if (!onUpdatePolicyActions) return;
    const existing = attrs.policy_actions || [];
    onUpdatePolicyActions([...existing, { policy_id: pol.id, action: pol.action, framing: '' }]);
    setPolicySearchQuery('');
    setShowPolicyPicker(false);
  };

  const handleRemovePolicy = (index: number) => {
    if (!onUpdatePolicyActions) return;
    const existing = attrs.policy_actions || [];
    onUpdatePolicyActions(existing.filter((_, i) => i !== index));
  };

  const handleUpdateFraming = (index: number, framing: string) => {
    if (!onUpdatePolicyActions) return;
    const existing = [...(attrs.policy_actions || [])];
    existing[index] = { ...existing[index], framing };
    onUpdatePolicyActions(existing);
  };

  // Build policy edge lookup
  const policyEdges = useMemo(() => {
    if (!edgesFile) return new Map<string, { type: string; target: string; targetAction: string }[]>();
    const map = new Map<string, { type: string; target: string; targetAction: string }[]>();
    for (const edge of edgesFile.edges) {
      if (!edge.source.startsWith('pol-') && !edge.target.startsWith('pol-')) continue;
      const addEdge = (polId: string, otherId: string, type: string) => {
        const list = map.get(polId) || [];
        const reg = policyRegistry?.find(p => p.id === otherId);
        list.push({ type, target: otherId, targetAction: reg?.action || otherId });
        map.set(polId, list);
      };
      if (edge.source.startsWith('pol-')) addEdge(edge.source, edge.target, edge.type);
      if (edge.target.startsWith('pol-')) addEdge(edge.target, edge.source, edge.type);
    }
    return map;
  }, [edgesFile, policyRegistry]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; field: string; value: string } | null>(null);

  // Close context menu on Escape or outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    const handleClick = () => setContextMenu(null);
    document.addEventListener('keydown', handleKey);
    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('click', handleClick);
    };
  }, [contextMenu]);

  const handleBadgeContextMenu = (e: React.MouseEvent, field: string, value: string) => {
    if (INFO_FIELDS.has(field)) {
      setContextMenu({ x: e.clientX, y: e.clientY, field, value });
    }
  };

  const contextMenuHandler = onShowAttributeInfo ? handleBadgeContextMenu : undefined;

  return (
    <div className="ga-panel">
      {!defaultOpen && (
        <button
          className="ga-toggle"
          onClick={() => setOpen(!open)}
          type="button"
        >
          <span className={`ga-chevron ${open ? 'ga-chevron-open' : ''}`}>&#9654;</span>
          Graph Attributes
        </button>
      )}
      {open && (
        <div className="ga-grid-3col">
          {/* Row 1: Assumptions | Epistemic Type + Falsifiability | Rhetorical Strategy */}
          <div className="ga-cell">
            <div className="ga-label">
              {LABEL_MAP.assumes}
              {!readOnly && onUpdateAssumptions && !editingAssumptions && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 6, fontSize: '0.6rem', padding: '1px 5px' }}
                  onClick={() => setEditingAssumptions(true)}
                >Edit</button>
              )}
              {editingAssumptions && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 6, fontSize: '0.6rem', padding: '1px 5px' }}
                  onClick={() => setEditingAssumptions(false)}
                >Done</button>
              )}
            </div>
            {editingAssumptions && onUpdateAssumptions ? (
              <>
                <ul className="ga-list">
                  {(attrs.assumes ?? []).map((a, i) => (
                    <li key={i} className="nd-editable-list-item">
                      <textarea
                        className="nd-assumption-input"
                        value={a}
                        rows={2}
                        onChange={(e) => {
                          const updated = [...(attrs.assumes ?? [])];
                          updated[i] = e.target.value;
                          onUpdateAssumptions(updated);
                        }}
                      />
                      <button
                        className="nd-remove-btn"
                        title="Remove assumption"
                        onClick={() => {
                          onUpdateAssumptions((attrs.assumes ?? []).filter((_, j) => j !== i));
                        }}
                      >&times;</button>
                    </li>
                  ))}
                </ul>
                <button
                  className="btn btn-sm nd-add-btn"
                  onClick={() => onUpdateAssumptions([...(attrs.assumes ?? []), ''])}
                >+ Add Assumption</button>
              </>
            ) : attrs.assumes && attrs.assumes.length > 0 ? (
              <ul className="ga-list">
                {attrs.assumes.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            ) : <div className="ga-empty">&mdash;</div>}
          </div>

          <div className="ga-cell">
            <div className="ga-label">{LABEL_MAP.epistemic_type}</div>
            {attrs.epistemic_type ? (
              <div className="ga-value">
                <Badge field="epistemic_type" value={attrs.epistemic_type} onClick={onBadgeClick} onContextMenu={contextMenuHandler} />
              </div>
            ) : <div className="ga-empty">&mdash;</div>}
            {attrs.falsifiability && (
              <div className="ga-cell-sub">
                <div className="ga-label">{LABEL_MAP.falsifiability}</div>
                <HardnessMeter field="falsifiability" value={attrs.falsifiability} onClick={onBadgeClick} />
              </div>
            )}
            {attrs.node_scope && (
              <div className="ga-cell-sub">
                <div className="ga-label">{LABEL_MAP.node_scope}</div>
                <div className="ga-value">
                  <Badge field="node_scope" value={attrs.node_scope} onClick={onBadgeClick} />
                </div>
              </div>
            )}
          </div>

          <div className="ga-cell">
            <div className="ga-label">{LABEL_MAP.rhetorical_strategy}</div>
            {attrs.rhetorical_strategy ? (
              <div className="ga-value">
                {attrs.rhetorical_strategy.split(',').map((s) => (
                  <Badge
                    key={s.trim()}
                    field="rhetorical_strategy"
                    value={s.trim()}
                    onClick={onBadgeClick}
                    onContextMenu={contextMenuHandler}
                  />
                ))}
              </div>
            ) : <div className="ga-empty">&mdash;</div>}
          </div>

          {/* Row 2: Audience | Emotional Register | Policy Actionability */}
          <div className="ga-cell">
            <div className="ga-label">{LABEL_MAP.audience}</div>
            {attrs.audience ? (
              <div className="ga-value">
                {attrs.audience.split(',').map(s => s.trim()).sort((a, b) => a.localeCompare(b)).map((s) => (
                  <Badge key={s} field="audience" value={s} onClick={onBadgeClick} />
                ))}
              </div>
            ) : <div className="ga-empty">&mdash;</div>}
          </div>

          <div className="ga-cell">
            <div className="ga-label">{LABEL_MAP.emotional_register}</div>
            {attrs.emotional_register ? (
              <div className="ga-value">
                <Badge field="emotional_register" value={attrs.emotional_register} onClick={onBadgeClick} onContextMenu={contextMenuHandler} />
              </div>
            ) : <div className="ga-empty">&mdash;</div>}
          </div>

          <div className="ga-cell">
            <div className="ga-label">Policy Actions</div>
            {attrs.policy_actions && attrs.policy_actions.length > 0 ? (
              <div className="ga-policy-actions-compact">
                {attrs.policy_actions.length} action{attrs.policy_actions.length !== 1 ? 's' : ''}
              </div>
            ) : <div className="ga-empty">&mdash;</div>}
          </div>

          {/* Policy Actions — full width */}
          {attrs.policy_actions && attrs.policy_actions.length > 0 && (
            <div className="ga-cell ga-cell-full">
              <div className="ga-label">Policy Actions</div>
              <ul className="ga-policy-actions-list">
                {attrs.policy_actions.map((pa, i) => {
                  const reg = policyRegistry?.find(p => p.id === pa.policy_id);
                  const edges = pa.policy_id ? policyEdges.get(pa.policy_id) : undefined;
                  const edgeCount = edges?.length || 0;
                  const isExpanded = expandedPolicyId === pa.policy_id;
                  const contradicts = edges?.filter(e => e.type === 'CONTRADICTS') || [];
                  const complements = edges?.filter(e => e.type === 'COMPLEMENTS') || [];
                  const tensions = edges?.filter(e => e.type === 'TENSION_WITH') || [];
                  return (
                    <li key={i} className="ga-policy-action-item">
                      {pa.policy_id && (
                        <div className="ga-policy-action-header">
                          <span className="ga-policy-action-id">{pa.policy_id}</span>
                          {reg && reg.member_count > 1 && (
                            <span className="ga-policy-action-reuse" title={`Used by ${reg.member_count} nodes across ${reg.source_povs.join(', ')}`}>
                              {reg.member_count} nodes &middot; {reg.source_povs.map(p => p.slice(0, 3)).join(', ')}
                            </span>
                          )}
                          {edgeCount > 0 && (
                            <button
                              className="ga-policy-edges-toggle"
                              onClick={() => setExpandedPolicyId(isExpanded ? null : pa.policy_id!)}
                              title={`${edgeCount} policy relationships`}
                            >
                              {isExpanded ? '\u25BC' : '\u25B6'} {edgeCount} edge{edgeCount !== 1 ? 's' : ''}
                            </button>
                          )}
                        </div>
                      )}
                      <div className="ga-policy-action-text">{pa.action}</div>
                      {!readOnly && onUpdatePolicyActions ? (
                        <textarea
                          className="ga-policy-action-framing-input"
                          value={pa.framing}
                          onChange={(e) => handleUpdateFraming(i, e.target.value)}
                          placeholder="POV-specific framing..."
                          rows={2}
                        />
                      ) : (
                        <div className="ga-policy-action-framing">{pa.framing}</div>
                      )}
                      {!readOnly && onUpdatePolicyActions && (
                        <button className="ga-policy-action-remove" onClick={() => handleRemovePolicy(i)} title="Remove policy">&times;</button>
                      )}
                      {isExpanded && edges && edges.length > 0 && (
                        <div className="ga-policy-edges">
                          {contradicts.length > 0 && (
                            <div className="ga-policy-edge-group">
                              <div className="ga-policy-edge-type ga-policy-edge-contradicts">Contradicts</div>
                              {contradicts.map((e, ei) => (
                                <div key={ei} className="ga-policy-edge-item">
                                  <span className="ga-policy-edge-id">{e.target}</span> {e.targetAction}
                                </div>
                              ))}
                            </div>
                          )}
                          {complements.length > 0 && (
                            <div className="ga-policy-edge-group">
                              <div className="ga-policy-edge-type ga-policy-edge-complements">Complements</div>
                              {complements.map((e, ei) => (
                                <div key={ei} className="ga-policy-edge-item">
                                  <span className="ga-policy-edge-id">{e.target}</span> {e.targetAction}
                                </div>
                              ))}
                            </div>
                          )}
                          {tensions.length > 0 && (
                            <div className="ga-policy-edge-group">
                              <div className="ga-policy-edge-type ga-policy-edge-tension">Tension With</div>
                              {tensions.map((e, ei) => (
                                <div key={ei} className="ga-policy-edge-item">
                                  <span className="ga-policy-edge-id">{e.target}</span> {e.targetAction}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Policy Action Picker */}
          {!readOnly && onUpdatePolicyActions && policyRegistry && (
            <div className="ga-cell ga-cell-full">
              {!showPolicyPicker ? (
                <button className="btn btn-sm" onClick={() => setShowPolicyPicker(true)}>
                  + Add Policy Action
                </button>
              ) : (
                <div className="ga-policy-picker">
                  <input
                    className="ga-policy-picker-input"
                    type="text"
                    value={policySearchQuery}
                    onChange={(e) => setPolicySearchQuery(e.target.value)}
                    placeholder="Search policies by ID or text..."
                    autoFocus
                  />
                  {filteredPolicies.length > 0 && (
                    <div className="ga-policy-picker-results">
                      {filteredPolicies.map(pol => (
                        <button
                          key={pol.id}
                          className="ga-policy-picker-item"
                          onClick={() => handleAddPolicy(pol)}
                        >
                          <span className="ga-policy-picker-id">{pol.id}</span>
                          <span className="ga-policy-picker-text">{pol.action}</span>
                          {pol.member_count > 1 && (
                            <span className="ga-policy-picker-reuse">{pol.member_count} nodes</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {policySearchQuery && filteredPolicies.length === 0 && (
                    <div className="ga-policy-picker-empty">No matching policies</div>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => { setShowPolicyPicker(false); setPolicySearchQuery(''); }}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Possible Fallacies — full width */}
          {attrs.possible_fallacies && attrs.possible_fallacies.length > 0 && (
            <div className="ga-cell ga-cell-full">
              <div className="ga-label">Possible Fallacies</div>
              <ul className="ga-fallacy-list">
                {attrs.possible_fallacies.map((f: PossibleFallacy, i: number) => {
                  const info = FALLACY_CATALOG[f.fallacy];
                  const label = info ? info.label : f.fallacy.replace(/_/g, ' ');
                  return (
                    <li key={i} className="ga-fallacy-item">
                      <div className="ga-fallacy-header">
                        <span className={`ga-fallacy-badge ga-fallacy-${f.confidence}`}>
                          {label}
                        </span>
                        {f.type ? (
                          <span className="ga-fallacy-type" title={`Fallacy tier: ${f.type.replace(/_/g, ' ')}`}>
                            {f.type.replace(/_/g, ' ')}
                          </span>
                        ) : (
                          <span className="ga-fallacy-type ga-fallacy-type-missing" title="Missing fallacy tier — run attribute extraction to populate">
                            no tier
                          </span>
                        )}
                        <span className="ga-fallacy-confidence">{f.confidence}</span>
                        {info && (
                          <button
                            className="ga-fallacy-about"
                            onClick={() => api.openExternal(info.wikiUrl)}
                            title={`Open Wikipedia article: ${label}`}
                          >
                            About
                          </button>
                        )}
                      </div>
                      <div className="ga-fallacy-explanation">{f.explanation}</div>
                      {info && (
                        <details className="ga-fallacy-details">
                          <summary>What is this fallacy?</summary>
                          <div className="ga-fallacy-description">{info.description}</div>
                          {info.example && <div className="ga-fallacy-example"><strong>Example:</strong> {info.example}</div>}
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              onShowAttributeInfo?.(contextMenu.field, contextMenu.value);
              setContextMenu(null);
            }}
          >
            About {formatValue(contextMenu.value)}
          </button>
          {onBadgeClick && (
            <button
              className="context-menu-item"
              onClick={() => {
                onBadgeClick(contextMenu.field, contextMenu.value);
                setContextMenu(null);
              }}
            >
              Find nodes with this {formatValue(contextMenu.field)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
