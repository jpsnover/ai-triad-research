import { useState } from 'react';

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

type TabId = 'content' | 'related' | 'attributes';

interface Props {
  nodeId: string;
  node: TaxRefNode | undefined;
  pov: string;
  onClose: () => void;
}

export function TaxonomyRefDetail({ nodeId, node, pov, onClose }: Props) {
  const [tab, setTab] = useState<TabId>('content');
  const ga = node?.graph_attributes;

  const catUpper = node?.category?.toUpperCase();

  const hasRelated = !!(
    (node?.children && node.children.length > 0) ||
    (node?.situation_refs && node.situation_refs.length > 0) ||
    (node?.conflict_ids && node.conflict_ids.length > 0) ||
    (node?.debate_refs && node.debate_refs.length > 0) ||
    node?.interpretations
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
            {tab === 'related' && <RelatedTab node={node} />}
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

function RelatedTab({ node }: { node: TaxRefNode }) {
  return (
    <>
      {node.children && node.children.length > 0 && (
        <>
          <div style={{ ...sectionHeader, marginTop: 0 }}>Children ({node.children.length})</div>
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
          {(['accelerationist', 'safetyist', 'skeptic'] as const).map(p => {
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
