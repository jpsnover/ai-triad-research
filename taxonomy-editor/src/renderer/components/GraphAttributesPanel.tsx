// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useMemo } from 'react';
import type { GraphAttributes, PossibleFallacy } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import type { PolicyRegistryEntry } from '../hooks/useTaxonomyStore';
import { FALLACY_CATALOG } from '../data/fallacyInfo';

interface GraphAttributesPanelProps {
  attrs: GraphAttributes;
  onBadgeClick?: (field: string, value: string) => void;
  onShowAttributeInfo?: (field: string, value: string) => void;
  defaultOpen?: boolean;
}

const LABEL_MAP: Record<string, string> = {
  epistemic_type: 'Epistemic Type',
  rhetorical_strategy: 'Rhetorical Strategy',
  assumes: 'Assumptions',
  falsifiability: 'Falsifiability',
  audience: 'Audience',
  emotional_register: 'Emotional Register',
  policy_actionability: 'Policy Actionability',
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

/** 5-point hardness meter for falsifiability and policy_actionability */
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

export function GraphAttributesPanel({ attrs, onBadgeClick, onShowAttributeInfo, defaultOpen }: GraphAttributesPanelProps) {
  const { policyRegistry } = useTaxonomyStore();
  const [open, setOpen] = useState(defaultOpen ?? false);
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
            <div className="ga-label">{LABEL_MAP.assumes}</div>
            {attrs.assumes && attrs.assumes.length > 0 ? (
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
            <div className="ga-label">Policy Actionability</div>
            {attrs.policy_actions && attrs.policy_actions.length > 0 ? (
              <div className="ga-policy-actions-compact">
                {attrs.policy_actions.length} action{attrs.policy_actions.length !== 1 ? 's' : ''}
              </div>
            ) : attrs.policy_actionability ? (
              <HardnessMeter field="policy_actionability" value={attrs.policy_actionability} onClick={onBadgeClick} />
            ) : <div className="ga-empty">&mdash;</div>}
          </div>

          {/* Policy Actions — full width */}
          {attrs.policy_actions && attrs.policy_actions.length > 0 && (
            <div className="ga-cell ga-cell-full">
              <div className="ga-label">Policy Actions</div>
              <ul className="ga-policy-actions-list">
                {attrs.policy_actions.map((pa, i) => {
                  const reg = policyRegistry?.find(p => p.id === pa.policy_id);
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
                        </div>
                      )}
                      <div className="ga-policy-action-text">{pa.action}</div>
                      <div className="ga-policy-action-framing">{pa.framing}</div>
                    </li>
                  );
                })}
              </ul>
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
                        <span className="ga-fallacy-confidence">{f.confidence}</span>
                        {info && (
                          <button
                            className="ga-fallacy-about"
                            onClick={() => window.electronAPI.openExternal(info.wikiUrl)}
                            title={`Open Wikipedia article: ${label}`}
                          >
                            About
                          </button>
                        )}
                      </div>
                      <div className="ga-fallacy-explanation">{f.explanation}</div>
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
