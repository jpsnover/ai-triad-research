// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useResizableVerticalSplit } from '../hooks/useResizablePanel';
import type { Pov } from '../types/taxonomy';
import { NodeDetail } from './NodeDetail';
import { SituationDetail } from './SituationDetail';
import { nodeTypeFromId } from '@lib/debate/nodeIdUtils';
import { POV_KEYS } from '@lib/debate/types';

const LABEL_MAP: Record<string, string> = {
  epistemic_type: 'Epistemic Type',
  rhetorical_strategy: 'Rhetorical Strategy',
  falsifiability: 'Falsifiability',
  audience: 'Audience',
  emotional_register: 'Emotional Register',
  intellectual_lineage: 'Intellectual Lineage',
};

/** Controlled vocabularies per field (from attribute-extraction.prompt), sorted alphabetically by display name */
const FIELD_OPTIONS: Record<string, string[]> = {
  epistemic_type: [
    'definitional', 'empirical_claim', 'interpretive_lens',
    'normative_prescription', 'predictive', 'strategic_recommendation',
  ],
  rhetorical_strategy: [
    'analogical_reasoning', 'appeal_to_authority', 'appeal_to_evidence',
    'cost_benefit_analysis', 'inevitability_framing', 'moral_imperative',
    'precautionary_framing', 'reductio_ad_absurdum', 'structural_critique',
    'techno_optimism',
  ],
  falsifiability: ['high', 'low', 'medium'],
  audience: [
    'academic_community', 'civil_society', 'general_public',
    'industry_leaders', 'policymakers', 'technical_researchers',
  ],
  emotional_register: [
    'alarmed', 'aspirational', 'cautionary', 'defiant', 'dismissive',
    'measured', 'optimistic', 'pragmatic', 'urgent',
  ],
};

function formatValue(val: string): string {
  return val.replace(/_/g, ' ');
}

interface AttributeFilterPanelProps {
  width?: number;
}

export function AttributeFilterPanel({ width }: AttributeFilterPanelProps) {
  const { attributeFilter, clearAttributeFilter, runAttributeFilter, navigateToNode } = useTaxonomyStore();
  const [collapsed, setCollapsed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // ~30px per row, 5 rows = 155px default
  const { height: listHeight, onMouseDown: onSplitResize } = useResizableVerticalSplit({
    storageKey: 'taxonomy-editor-attr-split-height',
    defaultHeight: 155,
    minHeight: 60,
    maxHeight: 500,
  });

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedId(null);
    setSelectedIndex(-1);
  }, [attributeFilter?.field, attributeFilter?.value]);

  const selectByIndex = useCallback((index: number) => {
    if (!attributeFilter || index < 0 || index >= attributeFilter.results.length) return;
    setSelectedIndex(index);
    setSelectedId(attributeFilter.results[index].id);
    panelRef.current?.focus();
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [attributeFilter]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!attributeFilter) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectByIndex(Math.min(selectedIndex + 1, attributeFilter.results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectByIndex(Math.max(selectedIndex - 1, 0));
    }
  }, [selectedIndex, attributeFilter, selectByIndex]);

  if (!attributeFilter) return null;

  if (collapsed) {
    return (
      <div className="pane-collapsed" onClick={() => setCollapsed(false)} title="Expand Attribute Filter">
        <span className="pane-collapsed-label">Attribute Filter</span>
      </div>
    );
  }

  const { field, value, results } = attributeFilter;
  const fieldLabel = LABEL_MAP[field] || formatValue(field);
  const options = FIELD_OPTIONS[field];

  const handleValueChange = (newValue: string) => {
    runAttributeFilter(field, newValue);
  };

  // Resolve detail node for the selected ID
  const getDetailView = () => {
    if (!selectedId) return null;
    const state = useTaxonomyStore.getState();

    if (nodeTypeFromId(selectedId) === 'situation') {
      const node = state.situations?.nodes.find(n => n.id === selectedId);
      if (node) return <SituationDetail node={node} readOnly chipDepth={0} />;
    } else {
      for (const pov of POV_KEYS) {
        const file = state[pov];
        if (file) {
          const node = file.nodes.find(n => n.id === selectedId);
          if (node) return <NodeDetail pov={pov} node={node} readOnly chipDepth={0} />;
        }
      }
    }
    return null;
  };

  const handleDoubleClick = (id: string, pov: string) => {
    const tab = pov === 'situations' ? 'situations' as const : pov as Pov;
    navigateToNode(tab, id);
  };

  const povColor = (pov: string) => {
    switch (pov) {
      case 'accelerationist': return 'var(--color-acc)';
      case 'safetyist': return 'var(--color-saf)';
      case 'skeptic': return 'var(--color-skp)';
      case 'situations': return 'var(--color-sit)';
      default: return 'var(--text-muted)';
    }
  };

  return (
    <div className="attr-filter-panel" style={width ? { width, minWidth: 320 } : undefined} tabIndex={0} ref={panelRef} onKeyDown={handleKeyDown}>
      <div className="attr-filter-header">
        <div className="attr-filter-title">
          <select
            className="attr-filter-field-select"
            value={field}
            onChange={(e) => {
              const newField = e.target.value;
              const firstValue = FIELD_OPTIONS[newField]?.[0] || '';
              if (firstValue) runAttributeFilter(newField, firstValue);
            }}
          >
            {Object.entries(LABEL_MAP).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <span className="attr-filter-eq">=</span>
          {options ? (
            <select
              className="attr-filter-select"
              value={value}
              onChange={(e) => handleValueChange(e.target.value)}
            >
              {options.map((opt) => (
                <option key={opt} value={opt}>{formatValue(opt)}</option>
              ))}
            </select>
          ) : (
            <span className="attr-filter-value">{formatValue(value)}</span>
          )}
          <span className="attr-filter-count">{results.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button className="pane-collapse-btn" onClick={() => setCollapsed(true)} title="Collapse">&lsaquo;</button>
          <button className="btn btn-ghost btn-sm" onClick={clearAttributeFilter}>
            Close
          </button>
        </div>
      </div>

      <div className="attr-filter-split">
        {/* Top: list with resizable height */}
        <div className="attr-filter-list" ref={listRef} style={{ height: listHeight, flex: 'none' }}>
          {results.length === 0 ? (
            <div className="attr-filter-empty">No matching nodes</div>
          ) : (
            results.map((r, i) => (
              <div
                key={r.id}
                className={`attr-filter-row ${selectedId === r.id ? 'selected' : ''}`}
                onClick={() => selectByIndex(i)}
                onDoubleClick={() => handleDoubleClick(r.id, r.pov)}
                title="Double-click to navigate"
              >
                <span className="attr-filter-row-pov" style={{ color: povColor(r.pov) }}>
                  {r.pov.slice(0, 3)}
                </span>
                <span className="attr-filter-row-id">{r.id}</span>
                <span className="attr-filter-row-label">{r.label}</span>
              </div>
            ))
          )}
        </div>

        {/* Resize handle */}
        <div className="attr-filter-resize-handle" onMouseDown={onSplitResize} />

        {/* Bottom: detail */}
        <div className="attr-filter-detail">
          {selectedId ? (
            getDetailView() || <div className="attr-filter-empty">Node not found</div>
          ) : (
            <div className="attr-filter-empty">Select a node above to view details</div>
          )}
        </div>
      </div>
    </div>
  );
}
