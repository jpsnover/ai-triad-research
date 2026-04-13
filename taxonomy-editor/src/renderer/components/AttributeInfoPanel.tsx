// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { RHETORICAL_STRATEGIES } from '../data/rhetoricalStrategyInfo';
import { EPISTEMIC_TYPES } from '../data/epistemicTypeInfo';
import { EMOTIONAL_REGISTERS } from '../data/emotionalRegisterInfo';
import { INTELLECTUAL_LINEAGES } from '../data/intellectualLineageInfo';
import type { AttributeInfo } from '../data/epistemicTypeInfo';
import { classifyLineage, getCategoryById } from '../data/lineageCategories';
import { lookupLineage } from '../data/lineageLookup';
import { api } from '@bridge';

interface AttributeInfoPanelProps {
  width?: number;
}

const FIELD_LABELS: Record<string, string> = {
  rhetorical_strategy: 'Rhetorical Strategy',
  epistemic_type: 'Epistemic Type',
  emotional_register: 'Emotional Register',
  intellectual_lineage: 'Intellectual Lineage',
};

const DATA_SOURCES: Record<string, Record<string, AttributeInfo>> = {
  rhetorical_strategy: RHETORICAL_STRATEGIES,
  epistemic_type: EPISTEMIC_TYPES,
  emotional_register: EMOTIONAL_REGISTERS,
  intellectual_lineage: INTELLECTUAL_LINEAGES,
};

function formatValue(val: string): string {
  return val.replace(/_/g, ' ');
}

export function AttributeInfoPanel({ width }: AttributeInfoPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { attributeInfo, clearAttributeInfo, runAttributeFilter, showAttributeInfo } = useTaxonomyStore();

  // "See Also" — related lineage entries in the same category (lineage field only)
  const seeAlso = useMemo(() => {
    if (!attributeInfo || attributeInfo.field !== 'intellectual_lineage') return [];
    const currentKey = Object.keys(INTELLECTUAL_LINEAGES).find(k =>
      k.toLowerCase() === attributeInfo.value.toLowerCase()
    ) ?? attributeInfo.value;
    const currentCat = classifyLineage(currentKey);
    const siblings: { key: string; label: string }[] = [];
    for (const [key, info] of Object.entries(INTELLECTUAL_LINEAGES)) {
      if (key === currentKey) continue;
      if (classifyLineage(key) === currentCat) {
        siblings.push({ key, label: info.label });
      }
    }
    siblings.sort((a, b) => a.label.localeCompare(b.label));
    return { categoryLabel: getCategoryById(currentCat).label, items: siblings };
  }, [attributeInfo]);

  if (!attributeInfo) return null;

  if (collapsed) {
    return (
      <div className="pane-collapsed" onClick={() => setCollapsed(false)} title="Expand Attribute Info">
        <span className="pane-collapsed-label">Attribute Info</span>
      </div>
    );
  }

  const { field, value } = attributeInfo;
  const dataSource = DATA_SOURCES[field];
  // Lookup: lineage uses canonicalizing resolver (strips parens, casing); other
  // fields use case-insensitive fallback since parenthetical variants don't apply.
  const info = field === 'intellectual_lineage'
    ? lookupLineage(value).info
    : (dataSource?.[value]
        ?? (dataSource ? Object.entries(dataSource).find(([k]) => k.toLowerCase() === value.toLowerCase())?.[1] ?? null : null));
  const fieldLabel = FIELD_LABELS[field] || formatValue(field);

  const handleFindNodes = () => {
    runAttributeFilter(field, value);
  };

  return (
    <div className="strategy-info-panel" style={width ? { width, minWidth: 320 } : undefined}>
      <div className="strategy-info-header">
        <div>
          <div className="strategy-info-field-label">{fieldLabel}</div>
          <h3 className="strategy-info-title">
            {info ? info.label : formatValue(value)}
          </h3>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button className="pane-collapse-btn" onClick={() => setCollapsed(true)} title="Collapse">&lsaquo;</button>
          <button className="btn btn-ghost btn-sm" onClick={clearAttributeInfo}>
            Close
          </button>
        </div>
      </div>

      {info ? (
        <div className="strategy-info-body">
          <div className="strategy-info-section">
            <div className="strategy-info-label">Description</div>
            <p className="strategy-info-text">{info.summary}</p>
          </div>

          <div className="strategy-info-section">
            <div className="strategy-info-label">Example</div>
            <p className="strategy-info-text strategy-info-example">{info.example}</p>
          </div>

          <div className="strategy-info-section">
            <div className="strategy-info-label">Frequency</div>
            <p className="strategy-info-text">{info.frequency}</p>
          </div>

          {info.links && info.links.length > 0 && (
            <div className="strategy-info-section">
              <div className="strategy-info-label">Learn More</div>
              <ul className="strategy-info-links">
                {info.links.map((link, i) => (
                  <li key={i}>
                    <button
                      className="strategy-info-link"
                      onClick={() => api.openExternal(link.url)}
                      title={link.url}
                    >
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {Array.isArray(seeAlso) ? null : seeAlso.items.length > 0 && (
            <div className="strategy-info-section">
              <div className="strategy-info-label">See Also — {seeAlso.categoryLabel}</div>
              <ul className="strategy-info-links">
                {seeAlso.items.map(({ key, label }) => (
                  <li key={key}>
                    <button
                      className="strategy-info-link"
                      onClick={() => showAttributeInfo('intellectual_lineage', key)}
                      title={`View: ${label}`}
                    >
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="strategy-info-actions">
            <button className="btn btn-sm" onClick={handleFindNodes}>
              Find nodes with this {fieldLabel.toLowerCase()}
            </button>
          </div>
        </div>
      ) : (
        <div className="strategy-info-body">
          <p className="strategy-info-text">
            No description available for <strong>{formatValue(value)}</strong>.
          </p>
          <div className="strategy-info-actions">
            <button className="btn btn-sm" onClick={handleFindNodes}>
              Find nodes with this value
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
