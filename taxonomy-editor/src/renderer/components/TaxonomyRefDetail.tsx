import { useState, useMemo, useCallback } from 'react';
import { POV_KEYS } from '@lib/debate/types';

/** Raw node shape as loaded from POV JSON files, used read-only in Diagnostics. */
export interface TaxRefNode {
  id?: string;
  label?: string;
  category?: string;
  description?: string;
  pov?: string;
  parent_id?: string | null;
  parent_relationship?: string | null;
  parent_rationale?: string | null;
  children?: string[];
  situation_refs?: string[];
  conflict_ids?: string[];
  debate_refs?: string[];
  interpretations?: { accelerationist?: unknown; safetyist?: unknown; skeptic?: unknown };
  graph_attributes?: {
    epistemic_type?: string;
    rhetorical_strategy?: string;
    assumes?: string[];
    falsifiability?: string;
    audience?: string;
    emotional_register?: string;
    intellectual_lineage?: string[];
    policy_actions?: { policy_id?: string; action?: string; framing?: string }[];
    steelman_vulnerability?: string | { from_accelerationist?: string; from_safetyist?: string; from_skeptic?: string };
    possible_fallacies?: { fallacy?: string; confidence?: string; explanation?: string }[];
    node_scope?: string;
  };
}

export interface TaxRefEdge {
  source: string;
  target: string;
  type: string;
  bidirectional: boolean;
  confidence: number;
  weight?: number;
  rationale: string;
  status: string;
  strength?: string;
  notes?: string;
}

type TabId = 'content' | 'related' | 'attributes';

interface Props {
  nodeId: string;
  node: TaxRefNode | undefined;
  pov: string;
  onClose: () => void;
  edges?: TaxRefEdge[];
}

export function TaxonomyRefDetail({ nodeId, node, pov, onClose, edges }: Props) {
  const [tab, setTab] = useState<TabId>('content');
  const ga = node?.graph_attributes;

  const catUpper = node?.category?.toUpperCase();

  const hasRelated = !!(
    (node?.children && node.children.length > 0) ||
    (node?.situation_refs && node.situation_refs.length > 0) ||
    (node?.conflict_ids && node.conflict_ids.length > 0) ||
    (node?.debate_refs && node.debate_refs.length > 0) ||
    node?.interpretations ||
    (edges && edges.length > 0)
  );

  const hasAttributes = !!(
    ga?.epistemic_type || ga?.rhetorical_strategy || ga?.falsifiability ||
    ga?.audience || ga?.emotional_register || ga?.node_scope ||
    (ga?.assumes && ga.assumes.length > 0) ||
    (ga?.policy_actions && ga.policy_actions.length > 0) ||
    (ga?.possible_fallacies && ga.possible_fallacies.length > 0)
  );

  return (
    <div
      style={{
        marginTop: 12,
        padding: '12px 16px 16px',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: 4,
        maxHeight: '70vh',
        overflowY: 'auto',
      }}
    >
      {/* Header: big serif title + category pill + pov pill + close */}
      <div className="nd-header" style={{ padding: '0 0 10px' }}>
        <div className="nd-header-title">
          <span className="nd-header-label" style={{ fontSize: '1.4rem' }}>
            {node?.label || nodeId}
          </span>
          {pov && (
            <span style={{
              fontSize: '0.62rem', padding: '2px 10px', borderRadius: 20,
              background: 'rgba(148,163,184,0.15)', color: 'var(--text-muted)',
              fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
              border: '1px solid var(--border)',
            }}>{pov}</span>
          )}
          <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {nodeId}
          </span>
        </div>
        {catUpper && (
          <span className="nd-header-cat" data-cat={catUpper}>{catUpper}</span>
        )}
        <button
          onClick={onClose}
          style={{
            fontSize: '0.65rem', padding: '2px 10px',
            border: '1px solid var(--border)', borderRadius: 4,
            background: 'transparent', color: 'var(--text-muted)',
            cursor: 'pointer', marginLeft: 8,
          }}
          title="Close detail panel"
        >Close</button>
      </div>

      {!node ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', padding: '8px 0' }}>
          Node not found in loaded POV files. (Taxonomy may not be loaded yet, or this id belongs to a non-POV registry.)
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="node-detail-tabs">
            <button
              className={`node-detail-tab ${tab === 'content' ? 'node-detail-tab-active' : ''}`}
              onClick={() => setTab('content')}
            >Content</button>
            <button
              className={`node-detail-tab ${tab === 'related' ? 'node-detail-tab-active' : ''}`}
              onClick={() => setTab('related')}
              disabled={!hasRelated}
              style={{ opacity: hasRelated ? 1 : 0.4, cursor: hasRelated ? 'pointer' : 'not-allowed' }}
            >Related</button>
            <button
              className={`node-detail-tab ${tab === 'attributes' ? 'node-detail-tab-active' : ''}`}
              onClick={() => setTab('attributes')}
              disabled={!hasAttributes}
              style={{ opacity: hasAttributes ? 1 : 0.4, cursor: hasAttributes ? 'pointer' : 'not-allowed' }}
            >Attributes</button>
          </div>

          <div style={{ paddingTop: 12, fontSize: '0.82rem', lineHeight: 1.55 }}>
            {tab === 'content' && <ContentTab node={node} />}
            {tab === 'related' && <RelatedTab node={node} nodeId={nodeId} edges={edges} />}
            {tab === 'attributes' && <AttributesTab node={node} />}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Tab Content ──────────────────────────────────────── */

const sectionHeader: React.CSSProperties = {
  fontSize: '0.95rem', fontWeight: 600, marginTop: 14, marginBottom: 6,
  color: 'var(--text-primary)',
};

const chipStyle: React.CSSProperties = {
  display: 'inline-block', fontSize: '0.72rem',
  padding: '3px 10px', borderRadius: 4,
  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
  border: '1px solid var(--border)',
  marginRight: 6, marginBottom: 4,
};

function ContentTab({ node }: { node: TaxRefNode }) {
  const ga = node.graph_attributes;
  return (
    <>
      {node.description && (
        <div>
          <div style={{ ...sectionHeader, marginTop: 0 }}>Description</div>
          <div style={{
            padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6,
            background: 'var(--bg-secondary)', whiteSpace: 'pre-wrap', fontSize: '0.82rem',
          }}>{node.description}</div>
        </div>
      )}

      {(node.parent_id || (node.children && node.children.length > 0)) && (
        <>
          <div style={sectionHeader}>Hierarchy</div>
          <div>
            {node.parent_id && (
              <span style={chipStyle} title={node.parent_relationship || ''}>
                ▲ {node.parent_id}
              </span>
            )}
            {node.children && node.children.map(c => (
              <span key={c} style={chipStyle}>▼ {c}</span>
            ))}
          </div>
          {node.parent_rationale && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: 4 }}>
              {node.parent_rationale}
            </div>
          )}
        </>
      )}

      {ga?.steelman_vulnerability && (
        <>
          <div style={sectionHeader}>Steelman Vulnerability</div>
          {typeof ga.steelman_vulnerability === 'string' ? (
            <div style={{
              borderLeft: '3px solid #dc2626', paddingLeft: 12,
              fontStyle: 'italic', color: 'var(--text-secondary)', fontSize: '0.82rem',
            }}>{ga.steelman_vulnerability}</div>
          ) : (
            <div style={{ borderLeft: '3px solid #dc2626', paddingLeft: 12 }}>
              {ga.steelman_vulnerability.from_accelerationist && (
                <div style={{ marginBottom: 6 }}>
                  <strong style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>From Accelerationist:</strong>{' '}
                  <span style={{ fontStyle: 'italic' }}>{ga.steelman_vulnerability.from_accelerationist}</span>
                </div>
              )}
              {ga.steelman_vulnerability.from_safetyist && (
                <div style={{ marginBottom: 6 }}>
                  <strong style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>From Safetyist:</strong>{' '}
                  <span style={{ fontStyle: 'italic' }}>{ga.steelman_vulnerability.from_safetyist}</span>
                </div>
              )}
              {ga.steelman_vulnerability.from_skeptic && (
                <div>
                  <strong style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>From Skeptic:</strong>{' '}
                  <span style={{ fontStyle: 'italic' }}>{ga.steelman_vulnerability.from_skeptic}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {ga?.intellectual_lineage && ga.intellectual_lineage.length > 0 && (
        <>
          <div style={sectionHeader}>Intellectual Lineage</div>
          <div>
            {[...ga.intellectual_lineage].sort((a, b) => a.localeCompare(b)).map((l, i) => (
              <span key={i} style={{
                ...chipStyle, background: 'var(--bg-primary)', fontWeight: 600,
              }}>{l}</span>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export const EDGE_TYPE_COLORS: Record<string, string> = {
  SUPPORTS: '#22c55e',
  CONTRADICTS: '#ef4444',
  ASSUMES: '#a78bfa',
  WEAKENS: '#f59e0b',
  RESPONDS_TO: '#3b82f6',
  TENSION_WITH: '#f97316',
  INTERPRETS: '#06b6d4',
};

/* ── POV filter / edge grouping (mirrors RelatedEdgesPanel UX) ─── */

const POV_PREFIXES = ['acc-', 'saf-', 'skp-', 'sit-', 'cc-'] as const;
type PovPrefix = typeof POV_PREFIXES[number];

const POV_LABELS: Record<PovPrefix, string> = {
  'acc-': 'Accelerationist',
  'saf-': 'Safetyist',
  'skp-': 'Skeptic',
  'sit-': 'Situations',
  'cc-': 'Situations',
};
const POV_COLOR: Record<PovPrefix, string> = {
  'acc-': 'var(--color-acc)',
  'saf-': 'var(--color-saf)',
  'skp-': 'var(--color-skp)',
  'sit-': 'var(--color-sit)',
  'cc-': 'var(--color-sit)',
};

const EDGE_TYPE_PRIORITY = [
  'SUPPORTS', 'CONTRADICTS', 'ASSUMES', 'WEAKENS',
  'RESPONDS_TO', 'TENSION_WITH', 'INTERPRETS',
];

function otherNodeId(edge: TaxRefEdge, nodeId: string) {
  return edge.source === nodeId ? edge.target : edge.source;
}

function otherPrefix(edge: TaxRefEdge, nodeId: string): PovPrefix | null {
  const id = otherNodeId(edge, nodeId);
  return POV_PREFIXES.find(p => id.startsWith(p)) ?? null;
}

function TaxRefEdgeGroup({
  edgeType, edges, nodeId,
}: {
  edgeType: string; edges: TaxRefEdge[]; nodeId: string;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const typeColor = EDGE_TYPE_COLORS[edgeType] || 'var(--text-secondary)';

  return (
    <div className="related-edge-group">
      <div className="related-edge-group-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="related-edge-group-toggle">{collapsed ? '\u25B6' : '\u25BC'}</span>
        <span className="related-edge-type-name">{edgeType.replace(/_/g, ' ')}</span>
        <span className="related-edge-type-count">{edges.length}</span>
      </div>
      {!collapsed && edges.map((e, i) => {
        const other = otherNodeId(e, nodeId);
        const direction = e.bidirectional ? '\u2194' : e.source === nodeId ? '\u2192' : '\u2190';
        return (
          <div key={i} style={{
            padding: '6px 10px', borderBottom: '1px solid var(--border)',
            fontSize: '0.78rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{direction}</span>
              <span style={chipStyle}>{other}</span>
              {e.strength && (
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>({e.strength})</span>
              )}
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                c{(e.confidence * 100).toFixed(0)}%
              </span>
            </div>
            {e.rationale && (
              <div style={{ marginTop: 4, color: 'var(--text-secondary)', fontSize: '0.72rem', lineHeight: 1.45 }}>
                {e.rationale}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RelatedTab({ node, nodeId, edges }: { node: TaxRefNode; nodeId: string; edges?: TaxRefEdge[] }) {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.75);
  const [hiddenPovs, setHiddenPovs] = useState<Set<PovPrefix>>(new Set());

  const togglePov = useCallback((prefix: PovPrefix) => {
    setHiddenPovs(prev => {
      const next = new Set(prev);
      if (next.has(prefix)) next.delete(prefix); else next.add(prefix);
      return next;
    });
  }, []);

  // POV counts (after status/confidence filter, before POV filter)
  const povCounts = useMemo(() => {
    const counts: Record<PovPrefix, number> = { 'acc-': 0, 'saf-': 0, 'skp-': 0, 'sit-': 0, 'cc-': 0 };
    if (!edges) return counts;
    for (const e of edges) {
      if (statusFilter && e.status !== statusFilter) continue;
      if (e.confidence < confidenceThreshold) continue;
      const p = otherPrefix(e, nodeId);
      if (p) counts[p]++;
    }
    // Merge cc- into sit-
    counts['sit-'] += counts['cc-'];
    return counts;
  }, [edges, nodeId, statusFilter, confidenceThreshold]);

  // Group edges by type with filters applied
  const { groupedEdges, totalEdges } = useMemo(() => {
    if (!edges) return { groupedEdges: new Map<string, TaxRefEdge[]>(), totalEdges: 0 };
    const groups = new Map<string, TaxRefEdge[]>();
    let total = 0;
    for (const e of edges) {
      if (statusFilter && e.status !== statusFilter) continue;
      if (e.confidence < confidenceThreshold) continue;
      const p = otherPrefix(e, nodeId);
      if (p && (hiddenPovs.has(p) || (p === 'cc-' && hiddenPovs.has('sit-')))) continue;
      const arr = groups.get(e.type);
      if (arr) arr.push(e); else groups.set(e.type, [e]);
      total++;
    }
    // Sort within groups by confidence desc
    for (const arr of groups.values()) arr.sort((a, b) => b.confidence - a.confidence);
    // Sort groups by priority
    const sorted = new Map<string, TaxRefEdge[]>();
    for (const t of EDGE_TYPE_PRIORITY) { const a = groups.get(t); if (a) sorted.set(t, a); }
    for (const [t, a] of groups) { if (!sorted.has(t)) sorted.set(t, a); }
    return { groupedEdges: sorted, totalEdges: total };
  }, [edges, nodeId, statusFilter, confidenceThreshold, hiddenPovs]);

  // De-dup POV prefixes for display (cc- merged into sit-)
  const displayPovs = (['acc-', 'saf-', 'skp-', 'sit-'] as PovPrefix[]).filter(p => povCounts[p] > 0);

  return (
    <>
      {edges && edges.length > 0 && (
        <>
          <div style={{ ...sectionHeader, marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Related Edges
            <span style={{
              fontSize: '0.72rem', padding: '1px 8px', borderRadius: 10,
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            }}>{totalEdges}</span>
          </div>

          {/* POV filter pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {displayPovs.map(prefix => (
              <button
                key={prefix}
                className={`related-edges-pov-btn${hiddenPovs.has(prefix) ? ' related-edges-pov-btn-hidden' : ''}`}
                style={{ '--pov-color': POV_COLOR[prefix] } as React.CSSProperties}
                onClick={() => togglePov(prefix)}
                title={`${hiddenPovs.has(prefix) ? 'Show' : 'Hide'} ${POV_LABELS[prefix]}`}
              >
                {POV_LABELS[prefix]}
                <span className="related-edges-pov-btn-count">{povCounts[prefix]}</span>
              </button>
            ))}
          </div>

          {/* Status + confidence filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, fontSize: '0.75rem' }}>
            <select
              className="related-edges-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="approved">Approved</option>
              <option value="proposed">Proposed</option>
              <option value="rejected">Rejected</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
              Confidence &ge; {Math.round(confidenceThreshold * 100)}%
              <input
                type="range" min="0" max="100"
                value={Math.round(confidenceThreshold * 100)}
                onChange={(e) => setConfidenceThreshold(Number(e.target.value) / 100)}
                className="related-edges-threshold-slider"
              />
            </label>
          </div>

          {/* Grouped edge list */}
          {Array.from(groupedEdges.entries()).map(([edgeType, edgeList]) => (
            <TaxRefEdgeGroup key={edgeType} edgeType={edgeType} edges={edgeList} nodeId={nodeId} />
          ))}

          {totalEdges === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: 8 }}>
              No edges match the current filters.
            </div>
          )}
        </>
      )}

      {node.children && node.children.length > 0 && (
        <>
          <div style={{ ...sectionHeader, marginTop: edges && edges.length > 0 ? 14 : 0 }}>Children ({node.children.length})</div>
          <div>{node.children.map(c => <span key={c} style={chipStyle}>{c}</span>)}</div>
        </>
      )}

      {node.situation_refs && node.situation_refs.length > 0 && (
        <>
          <div style={sectionHeader}>Situation Refs ({node.situation_refs.length})</div>
          <div>{node.situation_refs.map(s => <span key={s} style={chipStyle}>{s}</span>)}</div>
        </>
      )}

      {node.conflict_ids && node.conflict_ids.length > 0 && (
        <>
          <div style={sectionHeader}>Conflicts ({node.conflict_ids.length})</div>
          <div>{node.conflict_ids.map(c => <span key={c} style={chipStyle}>{c}</span>)}</div>
        </>
      )}

      {node.debate_refs && node.debate_refs.length > 0 && (
        <>
          <div style={sectionHeader}>Debate Refs ({node.debate_refs.length})</div>
          <div>{node.debate_refs.map(d => <span key={d} style={chipStyle}>{d}</span>)}</div>
        </>
      )}

      {node.interpretations && (
        <>
          <div style={sectionHeader}>Interpretations</div>
          {POV_KEYS.map(p => {
            const interp = node.interpretations?.[p];
            if (!interp) return null;
            if (typeof interp === 'string') {
              return (
                <div key={p} style={{ marginTop: 6 }}>
                  <strong style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{p}:</strong>{' '}
                  <span>{interp}</span>
                </div>
              );
            }
            const bdi = interp as { belief?: string; desire?: string; intention?: string; summary?: string };
            return (
              <div key={p} style={{
                marginTop: 8, paddingLeft: 12, borderLeft: '2px solid var(--border)',
              }}>
                <div><strong style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{p}</strong></div>
                {bdi.summary && <div style={{ marginTop: 3 }}>{bdi.summary}</div>}
                {bdi.belief && <div style={{ marginTop: 3 }}><em>Belief:</em> {bdi.belief}</div>}
                {bdi.desire && <div style={{ marginTop: 3 }}><em>Desire:</em> {bdi.desire}</div>}
                {bdi.intention && <div style={{ marginTop: 3 }}><em>Intention:</em> {bdi.intention}</div>}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

function AttributesTab({ node }: { node: TaxRefNode }) {
  const ga = node.graph_attributes;
  if (!ga) return null;

  const kv = (label: string, val: string | undefined) => val ? (
    <div style={{ marginBottom: 4 }}>
      <strong style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}:</strong>{' '}
      {val}
    </div>
  ) : null;

  return (
    <>
      {(ga.epistemic_type || ga.rhetorical_strategy || ga.falsifiability ||
        ga.audience || ga.emotional_register || ga.node_scope) && (
        <>
          <div style={{ ...sectionHeader, marginTop: 0 }}>Graph Attributes</div>
          {kv('Epistemic', ga.epistemic_type)}
          {kv('Rhetorical', ga.rhetorical_strategy)}
          {kv('Falsifiability', ga.falsifiability)}
          {kv('Audience', ga.audience)}
          {kv('Register', ga.emotional_register)}
          {kv('Scope', ga.node_scope)}
        </>
      )}

      {ga.assumes && ga.assumes.length > 0 && (
        <>
          <div style={sectionHeader}>Assumes ({ga.assumes.length})</div>
          <ul style={{ margin: '4px 0', paddingLeft: 20, lineHeight: 1.6 }}>
            {ga.assumes.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </>
      )}

      {ga.policy_actions && ga.policy_actions.length > 0 && (
        <>
          <div style={sectionHeader}>Policy Actions ({ga.policy_actions.length})</div>
          {ga.policy_actions.map((p, i) => (
            <div key={i} style={{
              marginTop: 6, paddingLeft: 10, borderLeft: '2px solid var(--border)',
              fontSize: '0.78rem',
            }}>
              {p.policy_id && <span style={chipStyle}>{p.policy_id}</span>}
              {p.action && <div><strong style={{ color: 'var(--text-muted)' }}>Action:</strong> {p.action}</div>}
              {p.framing && <div><strong style={{ color: 'var(--text-muted)' }}>Framing:</strong> {p.framing}</div>}
            </div>
          ))}
        </>
      )}

      {ga.possible_fallacies && ga.possible_fallacies.length > 0 && (
        <>
          <div style={sectionHeader}>Possible Fallacies ({ga.possible_fallacies.length})</div>
          {ga.possible_fallacies.map((f, i) => (
            <div key={i} style={{
              marginTop: 6, paddingLeft: 10, borderLeft: '2px solid var(--border)',
              fontSize: '0.78rem',
            }}>
              {f.fallacy && <div><strong>{f.fallacy}</strong>{f.confidence ? ` (${f.confidence})` : ''}</div>}
              {f.explanation && <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{f.explanation}</div>}
            </div>
          ))}
        </>
      )}
    </>
  );
}
