// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect } from 'react';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { getLineageInfo, getAllLineages } from '../../data/lineageLookup';
import { getCategoryLabel, classifyLineage, getL2CategoryLabel } from '../../data/lineageCategories';
import { POV_META, type PovMetaKey } from '@lib/electron-shared/povMeta';
import { POV_KEYS } from '@lib/debate/types';
import type { PovNode } from '../../types/taxonomy';
import { useDescriptionMode, resolveDescription } from './DescriptionToggle';

// ── See Also helpers ──

const SEE_ALSO_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'by', 'for',
  'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'this', 'that', 'these', 'those', 'it', 'its', 'into', 'which', 'who',
  'not', 'no', 'but', 'if', 'then', 'than', 'so', 'also', 'such', 'other',
  'about', 'their', 'they', 'them', 'theory', 'view', 'based',
]);

function tokenize(s: string): Set<string> {
  const tokens = s.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  return new Set(tokens.filter(t => !SEE_ALSO_STOPWORDS.has(t)));
}

function computeSeeAlso(
  rawKey: string,
  info: { label: string; summary: string } | null,
): { key: string; label: string }[] {
  const lineages = getAllLineages();
  const currentKey = Object.keys(lineages).find(k =>
    k.toLowerCase() === rawKey.toLowerCase()
  ) ?? rawKey;
  const currentCat = classifyLineage(currentKey);
  const currentTokens = tokenize(`${info?.label ?? currentKey} ${info?.summary ?? ''}`);

  type Scored = { key: string; label: string; score: number };
  const scored: Scored[] = [];
  for (const [key, inf] of Object.entries(lineages)) {
    if (key === currentKey) continue;
    const cand = tokenize(`${inf.label} ${inf.summary}`);
    let overlap = 0;
    for (const t of cand) if (currentTokens.has(t)) overlap++;
    if (overlap === 0) continue;
    const sameCat = classifyLineage(key) === currentCat ? 2 : 0;
    scored.push({ key, label: inf.label, score: overlap + sameCat });
  }
  scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const top = scored.filter(s => s.score >= 2).slice(0, 6);
  return top.length >= 2 ? top : scored.slice(0, Math.min(6, scored.length));
}

// ── Component ──

interface LineageDetailViewProps {
  value: string | null;
  onSelectValue: (value: string | null) => void;
  onOpenLink?: (url: string) => void;
}

const POV_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(POV_META).map(([k, v]) => [k, v.label])),
  cross_cutting: 'Cross-cutting',
};

export function LineageDetailView({ value, onSelectValue, onOpenLink }: LineageDetailViewProps) {
  const [descMode] = useDescriptionMode();
  const [secondaryValue, setSecondaryValue] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [refPreviewNodeId, setRefPreviewNodeId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; key: string } | null>(null);
  const [refPovFilter, setRefPovFilter] = useState<string | null>(null);
  const navigateToLineage = useTaxonomyStore(s => s.navigateToLineage);

  useEffect(() => { setLinkUrl(null); setSecondaryValue(null); setRefPreviewNodeId(null); setRefPovFilter(null); }, [value]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [ctxMenu]);

  if (!value) return <div className="detail-panel-empty">Select a lineage value to view details</div>;

  const info = getLineageInfo(value);
  const seeAlsoItems = computeSeeAlso(value, info);

  const normalizedValue = value.toLowerCase();
  const referencingNodes: { id: string; label: string; pov: string; category?: string }[] = [];
  const state = useTaxonomyStore.getState();
  for (const p of POV_KEYS) {
    const povFile = state[p];
    if (!povFile) continue;
    for (const node of povFile.nodes) {
      if (node.graph_attributes?.intellectual_lineage?.some(v => {
        const s = typeof v === 'string' ? v : (v as { name?: string })?.name;
        return s?.toLowerCase() === normalizedValue;
      })) {
        referencingNodes.push({ id: node.id, label: node.label, pov: p, category: node.category });
      }
    }
  }

  const povCounts: Record<string, number> = {};
  for (const ref of referencingNodes) {
    povCounts[ref.pov] = (povCounts[ref.pov] ?? 0) + 1;
  }
  const filteredRefNodes = refPovFilter
    ? referencingNodes.filter(r => r.pov === refPovFilter)
    : referencingNodes;

  const renderReferencedBy = () => referencingNodes.length > 0 && (
    <div className="lineage-detail-section">
      <div className="lineage-detail-label" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>Referenced By ({referencingNodes.length})</span>
        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            className={`btn btn-xs${!refPovFilter ? '' : ' btn-ghost'}`}
            onClick={() => setRefPovFilter(null)}
            style={{ fontSize: '0.7rem', padding: '1px 6px' }}
          >All</button>
          {Object.entries(povCounts).map(([pov, count]) => (
            <button
              key={pov}
              className={`btn btn-xs${refPovFilter === pov ? '' : ' btn-ghost'}`}
              onClick={() => setRefPovFilter(refPovFilter === pov ? null : pov)}
              style={{ fontSize: '0.7rem', padding: '1px 6px' }}
            >
              <span className={`pov-badge pov-badge-${pov.slice(0, 3)}`} style={{ fontSize: '0.65rem', marginRight: 3 }}>{pov.slice(0, 3).toUpperCase()}</span>
              {POV_LABELS[pov] ?? pov} ({count})
            </button>
          ))}
        </span>
      </div>
      <div className="lineage-detail-links">
        {filteredRefNodes.map(ref => (
          <button
            key={ref.id}
            className={`btn btn-sm${refPreviewNodeId === ref.id ? '' : ' btn-ghost'} lineage-ref-item`}
            onClick={() => setRefPreviewNodeId(refPreviewNodeId === ref.id ? null : ref.id)}
            title={`Preview ${ref.id}`}
          >
            <span className={`pov-badge pov-badge-${ref.pov.slice(0, 3)}`}>{ref.pov.slice(0, 3).toUpperCase()}</span>
            <span className="lineage-ref-label">{ref.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const renderSeeAlso = () => seeAlsoItems.length > 0 && (
    <div className="lineage-detail-section">
      <div className="lineage-detail-label">See Also</div>
      <div className="lineage-detail-links" style={{ position: 'relative' }}>
        {seeAlsoItems.map(({ key, label }) => (
          <button
            key={key}
            className={`btn btn-sm${secondaryValue === key ? '' : ' btn-ghost'}`}
            onClick={() => setSecondaryValue(secondaryValue === key ? null : key)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, key }); }}
            title={`Preview: ${label} (right-click → Go To)`}
          >
            {label}
          </button>
        ))}
        {ctxMenu && (
          <div
            style={{
              position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999,
              background: 'var(--bg-primary, #1a1a2e)', border: '1px solid var(--border, #333)',
              borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', padding: '2px 0',
              minWidth: 160,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              style={{
                display: 'block', width: '100%', padding: '6px 14px', border: 'none',
                background: 'transparent', color: 'var(--text-primary)', fontSize: '0.78rem',
                textAlign: 'left', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--accent, #3b82f6)'; (e.target as HTMLElement).style.color = '#fff'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; (e.target as HTMLElement).style.color = 'var(--text-primary)'; }}
              onClick={() => { navigateToLineage(ctxMenu.key); setCtxMenu(null); }}
            >
              Go To in Lineage Panel
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderSecondary = () => {
    if (!secondaryValue) return null;
    const secInfo = getLineageInfo(secondaryValue);
    return (
      <div className="lineage-detail-secondary">
        <div className="lineage-detail-secondary-header">
          <div>
            <div className="lineage-detail-secondary-eyebrow">See Also</div>
            <h3 className="lineage-detail-secondary-title">{secInfo?.label ?? secondaryValue}</h3>
            <div className="lineage-category-badge">{getCategoryLabel(secondaryValue)}{getL2CategoryLabel(secondaryValue) ? ` › ${getL2CategoryLabel(secondaryValue)}` : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => { onSelectValue(secondaryValue); }}
              title="Open as primary"
            >Open</button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setSecondaryValue(null)}
              title="Close secondary pane"
            >Close</button>
          </div>
        </div>
        {secInfo ? (
          <>
            <div className="lineage-detail-section">
              <div className="lineage-detail-label">Summary</div>
              <p className="lineage-detail-text">{secInfo.summary}</p>
            </div>
            <div className="lineage-detail-section">
              <div className="lineage-detail-label">Example</div>
              <p className="lineage-detail-text">{secInfo.example}</p>
            </div>
            <div className="lineage-detail-section">
              <div className="lineage-detail-label">Frequency</div>
              <p className="lineage-detail-text">{secInfo.frequency}</p>
            </div>
            {secInfo.links && secInfo.links.length > 0 && (
              <div className="lineage-detail-section">
                <div className="lineage-detail-label">Links</div>
                <div className="lineage-detail-links">
                  {secInfo.links.map((link, i) => (
                    <button
                      key={i}
                      className={`btn btn-sm${linkUrl === link.url ? '' : ' btn-ghost'}`}
                      onClick={() => setLinkUrl(link.url)}
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="lineage-detail-section">
            <p className="lineage-detail-text" style={{ color: 'var(--text-muted)' }}>No detailed information available.</p>
          </div>
        )}
      </div>
    );
  };

  const renderRefPreview = () => {
    if (!refPreviewNodeId) return null;
    const st = useTaxonomyStore.getState();
    let refNode: (PovNode & { pov: string }) | null = null;
    for (const p of POV_KEYS) {
      const found = st[p]?.nodes.find(n => n.id === refPreviewNodeId);
      if (found) { refNode = { ...found, pov: p }; break; }
    }
    if (!refNode) return null;

    const sv = refNode.graph_attributes?.steelman_vulnerability;
    const svText = typeof sv === 'string' ? sv : sv
      ? Object.entries(sv).map(([k, v]) => `${k}: ${v}`).join('\n')
      : null;
    const lineageItems = refNode.graph_attributes?.intellectual_lineage ?? [];

    return (
      <div className="lineage-detail-secondary">
        <div className="lineage-detail-secondary-header">
          <div>
            <div className="lineage-detail-secondary-eyebrow">Referenced By</div>
            <h3 className="lineage-detail-secondary-title">
              <span className={`pov-badge pov-badge-${refNode.pov.slice(0, 3)}`}>{refNode.pov.slice(0, 3).toUpperCase()}</span>
              {' '}{refNode.category && <span className="lineage-category-badge">{refNode.category}</span>}
            </h3>
            <h3 className="lineage-detail-secondary-title">{refNode.label}</h3>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>{refNode.id}</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => void useTaxonomyStore.getState().navigateToNode(refNode!.pov as any, refNode!.id)}
              title="Go to this node"
            >Go to</button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setRefPreviewNodeId(null)}
              title="Close preview"
            >Close</button>
          </div>
        </div>
        <div className="lineage-detail-section">
          <div className="lineage-detail-label">Description</div>
          <p className="lineage-detail-text">{resolveDescription(refNode, descMode).text}</p>
        </div>
        {svText && (
          <div className="lineage-detail-section">
            <div className="lineage-detail-label">Steelman Vulnerability</div>
            <p className="lineage-detail-text">{svText}</p>
          </div>
        )}
        {lineageItems.length > 0 && (
          <div className="lineage-detail-section">
            <div className="lineage-detail-label">Intellectual Lineage</div>
            <div className="lineage-detail-links">
              {lineageItems.map((v, i) => {
                const s = typeof v === 'string' ? v : (v as { name?: string })?.name;
                if (!s) return null;
                return (
                  <button
                    key={i}
                    className="btn btn-sm btn-ghost"
                    onClick={() => onSelectValue(s)}
                    title={`View lineage: ${s}`}
                  >{s}</button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!info) return (
    <div className="lineage-detail">
      <h2 className="lineage-detail-title">{value}</h2>
      <div className="lineage-category-badge">{getCategoryLabel(value)}{getL2CategoryLabel(value) ? ` › ${getL2CategoryLabel(value)}` : ''}</div>
      <div className="lineage-detail-section">
        <p className="lineage-detail-text" style={{ color: 'var(--text-muted)' }}>No detailed information available for this lineage value.</p>
      </div>
      {renderReferencedBy()}
      {renderRefPreview()}
      {renderSeeAlso()}
      {renderSecondary()}
    </div>
  );

  return (
    <div className="lineage-detail">
      <h2 className="lineage-detail-title">{info.label}</h2>
      <div className="lineage-category-badge">{getCategoryLabel(value)}{getL2CategoryLabel(value) ? ` › ${getL2CategoryLabel(value)}` : ''}</div>
      <div className="lineage-detail-section">
        <div className="lineage-detail-label">Summary</div>
        <p className="lineage-detail-text">{info.summary}</p>
      </div>
      <div className="lineage-detail-section">
        <div className="lineage-detail-label">Example</div>
        <p className="lineage-detail-text">{info.example}</p>
      </div>
      <div className="lineage-detail-section">
        <div className="lineage-detail-label">Frequency</div>
        <p className="lineage-detail-text">{info.frequency}</p>
      </div>
      {info.links && info.links.length > 0 && (
        <div className="lineage-detail-section">
          <div className="lineage-detail-label">Links</div>
          <div className="lineage-detail-links">
            {info.links.map((link, i) => (
              <button
                key={i}
                className={`btn btn-sm${linkUrl === link.url ? '' : ' btn-ghost'}`}
                onClick={() => { setLinkUrl(link.url); onOpenLink?.(link.url); }}
              >
                {link.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {renderReferencedBy()}
      {renderRefPreview()}
      {renderSeeAlso()}
      {renderSecondary()}
    </div>
  );
}
