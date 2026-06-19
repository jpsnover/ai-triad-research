// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useRef, useState } from 'react';
import { nodePovFromId } from '@lib/debate/nodeIdUtils';
import { api } from '@bridge';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import type { Edge } from '../../types/taxonomy';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

interface EdgeDetailPanelProps {
  width?: number;
}

const POV_COLOR: Record<string, string> = {
  'acc-': 'var(--color-acc)',
  'saf-': 'var(--color-saf)',
  'skp-': 'var(--color-skp)',
  'cc-': 'var(--color-sit)',
};

function nodeColor(id: string): string {
  for (const [prefix, color] of Object.entries(POV_COLOR)) {
    if (id.startsWith(prefix)) return color;
  }
  return 'var(--text-muted)';
}

const POV_LABEL: Record<string, string> = {
  accelerationist: 'Accelerationist',
  safetyist: 'Safetyist',
  skeptic: 'Skeptic',
  situations: 'Situations',
};

function povLabel(id: string): string {
  const pov = nodePovFromId(id);
  return (pov && POV_LABEL[pov]) || 'Unknown';
}

/**
 * Resolve an edge's rationale on demand. Rationale is stripped from the edges list
 * response (lazy loading, t/672), so when a selected edge lacks it we fetch the full
 * edge via `api.getEdgeDetail(index)`. Results are cached by edge identity so
 * re-selecting the same edge doesn't refetch.
 *
 * `rationale` is `undefined` while resolution is pending, `''` when the edge has no
 * rationale, or the rationale text.
 */
function useEdgeRationale(
  selectedEdge: Edge | null,
  edges: Edge[] | undefined,
): { rationale: string | undefined; loading: boolean } {
  const cacheRef = useRef<Map<string, string>>(new Map());
  const [rationale, setRationale] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedEdge) {
      setRationale(undefined);
      setLoading(false);
      return;
    }

    // Already carried inline (e.g. ?include=rationale) — nothing to fetch.
    if (selectedEdge.rationale != null && selectedEdge.rationale !== '') {
      setRationale(selectedEdge.rationale);
      setLoading(false);
      return;
    }

    const cacheKey = `${selectedEdge.source} ${selectedEdge.target} ${selectedEdge.type}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      setRationale(cached);
      setLoading(false);
      return;
    }

    // Resolve the edge's position in the full edges array for the detail fetch.
    // indexOf works for the live reference; the triple fallback covers edges whose
    // reference broke across an edgesFile reload.
    let index = edges ? edges.indexOf(selectedEdge) : -1;
    if (index < 0 && edges) {
      index = edges.findIndex(
        (e) => e.source === selectedEdge.source && e.target === selectedEdge.target && e.type === selectedEdge.type,
      );
    }
    if (index < 0) {
      setRationale('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setRationale(undefined);
    setLoading(true);
    void (async () => {
      try {
        const detail = (await api.getEdgeDetail(index)) as Edge | null;
        if (cancelled) return;
        const text = detail?.rationale ?? '';
        cacheRef.current.set(cacheKey, text);
        setRationale(text);
      } catch (err) {
        if (cancelled) return;
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'edge-detail-panel',
          level: 'error',
          message: 'Edge rationale fetch failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setRationale('');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedEdge, edges]);

  return { rationale, loading };
}

function RationaleSection({ inlineRationale, fetchedRationale, loading, clamped, onToggleClamp }: {
  inlineRationale: string | undefined;
  fetchedRationale: string | undefined;
  loading: boolean;
  clamped: boolean;
  onToggleClamp: () => void;
}) {
  // Prefer an inline value (e.g. ?include=rationale); otherwise show the fetched value.
  const hasInline = inlineRationale != null && inlineRationale !== '';
  const text = hasInline ? inlineRationale : fetchedRationale;
  const pending = !hasInline && (loading || fetchedRationale === undefined);
  return (
    <div className="edge-detail-section">
      <div className="edge-detail-section-label">Rationale</div>
      {pending ? (
        <div className="edge-detail-rationale" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Loading rationale&hellip;
        </div>
      ) : text ? (
        <>
          <div className={`edge-detail-rationale${clamped ? ' clamped' : ''}`}>{text}</div>
          {text.length > 200 && (
            <button className="edge-detail-rationale-toggle" onClick={onToggleClamp}>
              {clamped ? 'Show more' : 'Show less'}
            </button>
          )}
        </>
      ) : (
        <div className="edge-detail-rationale" style={{ color: 'var(--text-muted)' }}>&mdash;</div>
      )}
    </div>
  );
}

export function EdgeDetailPanel({ width }: EdgeDetailPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [rationaleClamped, setRationaleClamped] = useState(true);
  const { selectedEdge, selectEdge, getLabelForId, edgesFile, setActiveTab, setSelectedNodeId, showRelatedEdges } = useTaxonomyStore();

  const { rationale: resolvedRationale, loading: rationaleLoading } = useEdgeRationale(selectedEdge, edgesFile?.edges);

  // Reset clamp when the selected edge changes.
  useEffect(() => { setRationaleClamped(true); }, [selectedEdge]);

  if (!selectedEdge) return null;

  if (collapsed) {
    return (
      <div className="pane-collapsed" onClick={() => setCollapsed(false)} title="Expand Edge Detail">
        <span className="pane-collapsed-label">Edge Detail</span>
      </div>
    );
  }

  const edge = selectedEdge;
  const sourceLabel = getLabelForId(edge.source);
  const targetLabel = getLabelForId(edge.target);
  const pct = Math.round(edge.confidence * 100);
  const wPct = edge.weight != null ? Math.round(edge.weight * 100) : null;

  // Find the edge type definition
  const typeDef = edgesFile?.edge_types.find((t) => t.type === edge.type);

  const handleNavigate = (nodeId: string) => {
    const pov = nodePovFromId(nodeId);
    const tab = (pov as 'accelerationist' | 'safetyist' | 'skeptic' | 'situations') || 'situations';
    setActiveTab(tab);
    setSelectedNodeId(nodeId);
    showRelatedEdges(nodeId);
  };

  return (
    <div className="edge-detail-panel" style={{ flex: 1, minWidth: 280 }}>
      <div className="edge-detail-header">
        <h3>Edge Detail</h3>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button className="pane-collapse-btn" onClick={() => setCollapsed(true)} title="Collapse">&lsaquo;</button>
          <button
            className="edge-detail-close"
            onClick={() => selectEdge(null)}
            title="Close"
          >
            &times;
          </button>
        </div>
      </div>

      <div className="edge-detail-body">
        {/* Edge type */}
        <div className="edge-detail-type-banner">
          <span className="edge-detail-type-name">{edge.type.replace(/_/g, ' ')}</span>
          {edge.bidirectional && <span className="edge-detail-bidir" title="Bidirectional">&harr;</span>}
        </div>
        {typeDef && (
          <div className="edge-detail-type-def">{typeDef.definition}</div>
        )}

        {/* Source → Target */}
        <div className="edge-detail-endpoints">
          <div className="edge-detail-endpoint">
            <div className="edge-detail-endpoint-role">Source</div>
            <div
              className="edge-detail-endpoint-label"
              style={{ color: nodeColor(edge.source) }}
              onClick={() => handleNavigate(edge.source)}
            >
              {sourceLabel}
            </div>
            <div className="edge-detail-endpoint-id">{edge.source}</div>
          </div>

          <div className="edge-detail-arrow">
            {edge.bidirectional ? '↔' : '→'}
          </div>

          <div className="edge-detail-endpoint">
            <div className="edge-detail-endpoint-role">Target</div>
            <div
              className="edge-detail-endpoint-label"
              style={{ color: nodeColor(edge.target) }}
              onClick={() => handleNavigate(edge.target)}
            >
              {targetLabel}
            </div>
            <div className="edge-detail-endpoint-id">{edge.target}</div>
          </div>
        </div>

        {/* Rationale */}
        <RationaleSection
          inlineRationale={edge.rationale}
          fetchedRationale={resolvedRationale}
          loading={rationaleLoading}
          clamped={rationaleClamped}
          onToggleClamp={() => setRationaleClamped(!rationaleClamped)}
        />

        {/* Weight & Confidence */}
        <div className="edge-detail-section">
          <div className="edge-detail-section-label" title="Weight: how strong the relationship is. Confidence: how certain the edge exists.">Weight &amp; Confidence</div>
          {wPct != null && (
            <div className="edge-detail-confidence" style={{ marginBottom: 4 }}>
              <span className="edge-detail-wc-label">w</span>
              <div className="edge-detail-confidence-track">
                <div className="edge-detail-confidence-fill edge-detail-weight-fill" style={{ width: `${wPct}%` }} />
              </div>
              <span className="edge-detail-confidence-pct">{wPct}%</span>
            </div>
          )}
          <div className="edge-detail-confidence">
            <span className="edge-detail-wc-label">c</span>
            <div className="edge-detail-confidence-track">
              <div className="edge-detail-confidence-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="edge-detail-confidence-pct">{pct}%</span>
          </div>
        </div>

        {/* Status — only show if not approved */}
        {edge.status !== 'approved' && (
          <div className="edge-detail-section">
            <div className="edge-detail-section-label">Status</div>
            <span className={`edge-detail-status-badge status-${edge.status}`}>
              {edge.status === 'rejected' ? '✗ ' : '● '}{edge.status}
            </span>
          </div>
        )}

        {/* Strength */}
        {edge.strength && (
          <div className="edge-detail-section">
            <div className="edge-detail-section-label">Strength</div>
            <span className="edge-detail-strength-badge">{edge.strength}</span>
          </div>
        )}

        {/* Notes */}
        {edge.notes && (
          <div className="edge-detail-section">
            <div className="edge-detail-section-label">Notes</div>
            <div className="edge-detail-notes">{edge.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}
