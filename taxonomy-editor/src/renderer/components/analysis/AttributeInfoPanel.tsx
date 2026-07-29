// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { RHETORICAL_STRATEGIES } from '../../data/rhetoricalStrategyInfo';
import { EPISTEMIC_TYPES } from '../../data/epistemicTypeInfo';
import { EMOTIONAL_REGISTERS } from '../../data/emotionalRegisterInfo';
import type { AttributeInfo } from '../../data/epistemicTypeInfo';
import { classifyLineage, getCategoryById, getL2CategoryLabel } from '../../data/lineageCategories';
import { lookupLineage, getAllLineages } from '../../data/lineageLookup';
import { api } from '@bridge';
import './AttributeInfoPanel.css';

interface AttributeInfoPanelProps {
  width?: number;
}

const FIELD_LABELS: Record<string, string> = {
  rhetorical_strategy: 'Rhetorical Strategy',
  epistemic_type: 'Epistemic Type',
  emotional_register: 'Emotional Register',
  intellectual_lineage: 'Intellectual Lineage',
};

function getDataSources(): Record<string, Record<string, AttributeInfo>> {
  return {
    rhetorical_strategy: RHETORICAL_STRATEGIES,
    epistemic_type: EPISTEMIC_TYPES,
    emotional_register: EMOTIONAL_REGISTERS,
    intellectual_lineage: getAllLineages(),
  };
}

function formatValue(val: string): string {
  return val.replace(/_/g, ' ');
}

// Resolve the AttributeInfo for a field/value pair.
// Lineage uses the canonicalizing resolver (strips parens, casing); other
// fields use exact match with a case-insensitive fallback since parenthetical
// variants don't apply. Behavior-preserving extraction of the former inline
// ternary chain (?? is associative, so a ?? (b ?? null) === a ?? b ?? null).
function resolveAttributeInfo(
  field: string,
  value: string,
  dataSource: Record<string, AttributeInfo> | undefined,
): AttributeInfo | null {
  if (field === 'intellectual_lineage') return lookupLineage(value).info;
  if (!dataSource) return null;
  return (
    dataSource[value]
    ?? Object.entries(dataSource).find(([k]) => k.toLowerCase() === value.toLowerCase())?.[1]
    ?? null
  );
}

// Renders a titled list of link-style buttons. Verbatim extraction of the
// repeated `<ul className="strategy-info-links">` sub-tree.
function LinkList({
  label,
  items,
}: {
  label: string;
  items: { key: string; text: string; title: string; onClick: () => void }[];
}) {
  return (
    <div className="strategy-info-section">
      <div className="strategy-info-label">{label}</div>
      <ul className="strategy-info-links">
        {items.map(({ key, text, title, onClick }) => (
          <li key={key}>
            <button className="strategy-info-link" onClick={onClick} title={title}>
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AttributeInfoPanel({ width }: AttributeInfoPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { attributeInfo, clearAttributeInfo, runAttributeFilter, showAttributeInfo } = useTaxonomyStore();

  // "See Also" — related lineage entries in the same category (lineage field only)
  const seeAlso = useMemo(() => {
    if (!attributeInfo || attributeInfo.field !== 'intellectual_lineage') return [];
    const lineages = getAllLineages();
    const currentKey = Object.keys(lineages).find(k =>
      k.toLowerCase() === attributeInfo.value.toLowerCase()
    ) ?? attributeInfo.value;
    const currentCat = classifyLineage(currentKey);
    const siblings: { key: string; label: string }[] = [];
    for (const [key, info] of Object.entries(lineages)) {
      if (key === currentKey) continue;
      if (classifyLineage(key) === currentCat) {
        siblings.push({ key, label: info.label });
      }
    }
    siblings.sort((a, b) => a.label.localeCompare(b.label));
    const l2Label = getL2CategoryLabel(currentKey);
    const fullLabel = getCategoryById(currentCat).label + (l2Label ? ` › ${l2Label}` : '');
    return { categoryLabel: fullLabel, items: siblings };
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
  const dataSource = getDataSources()[field];
  const info = resolveAttributeInfo(field, value, dataSource);
  const fieldLabel = FIELD_LABELS[field] || formatValue(field);

  const handleFindNodes = () => {
    runAttributeFilter(field, value);
  };

  return (
    <div
      className="strategy-info-panel"
      /* eslint-disable-next-line local/no-inline-style -- dynamic: panel width driven by `width` prop */
      style={width ? { width, minWidth: 320 } : undefined}
    >
      <div className="strategy-info-header">
        <div>
          <div className="strategy-info-field-label">{fieldLabel}</div>
          <h3 className="strategy-info-title">
            {info ? info.label : formatValue(value)}
          </h3>
        </div>
        <div className="attrinfo-header-actions">
          <button className="pane-collapse-btn" onClick={() => setCollapsed(true)} title="Collapse" aria-label="Collapse panel">&lsaquo;</button>
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
            <LinkList
              label="Learn More"
              items={info.links.map((link, i) => ({
                key: String(i),
                text: link.label,
                title: link.url,
                onClick: () => api.openExternal(link.url),
              }))}
            />
          )}

          {Array.isArray(seeAlso) ? null : seeAlso.items.length > 0 && (
            <LinkList
              label={`See Also — ${seeAlso.categoryLabel}`}
              items={seeAlso.items.map(({ key, label }) => ({
                key,
                text: label,
                title: `View: ${label}`,
                onClick: () => showAttributeInfo('intellectual_lineage', key),
              }))}
            />
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
