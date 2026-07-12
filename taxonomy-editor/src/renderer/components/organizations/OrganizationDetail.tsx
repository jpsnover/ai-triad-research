// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useMemo } from 'react';
import type { Organization, OrganizationEdge, OrganizationEdgeType } from '../../bridge/types';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useOrganizationStore } from '../../hooks/useOrganizationStore';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';

const POV_COLORS: Record<string, string> = {
  accelerationist: '#f97316',
  safetyist: '#22c55e',
  skeptic: '#a855f7',
};

const POV_LABELS: Record<string, string> = {
  accelerationist: 'Acc',
  safetyist: 'Saf',
  skeptic: 'Skp',
};

function TypeBadge({ type }: { type?: string }) {
  if (!type) return null;
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 10, fontSize: 'var(--text-2xs)', fontWeight: 600,
      background: 'var(--bg-hover)', color: 'var(--text-secondary)',
    }}>
      {type.replace(/_/g, ' ')}
    </span>
  );
}

function PovAlignmentBar({ alignment }: { alignment?: Organization['pov_alignment'] }) {
  if (!alignment) return <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>No alignment data</span>;
  const povs = ['accelerationist', 'safetyist', 'skeptic'] as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {povs.map((pov) => {
        const stance = alignment[pov];
        if (!stance) return null;
        const score = stance.score;
        const absScore = Math.abs(score);
        const color = POV_COLORS[pov] ?? 'var(--text-muted)';
        return (
          <div key={pov} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
            <span style={{ width: 28, fontWeight: 600, color, flexShrink: 0 }}>{POV_LABELS[pov]}</span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', flexShrink: 0 }}>−1</span>
            <div style={{ flex: 1, height: 10, background: 'var(--bg-tertiary, #1e293b)', borderRadius: 5, position: 'relative' }}>
              <div style={{
                position: 'absolute',
                left: score < 0 ? `${50 - absScore * 50}%` : '50%',
                width: `${absScore * 50}%`,
                height: '100%',
                background: color,
                borderRadius: 5,
                opacity: 0.85,
              }} />
              <div style={{
                position: 'absolute', left: '50%', top: -1, bottom: -1, width: 2,
                background: 'var(--text-muted)', transform: 'translateX(-1px)', zIndex: 1,
              }} />
            </div>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', flexShrink: 0 }}>+1</span>
            <span style={{ width: 40, textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)', flexShrink: 0, fontSize: '0.72rem' }}>
              {score > 0 ? '+' : ''}{score.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const EDGE_GROUP_LABELS: Partial<Record<OrganizationEdgeType, string>> = {
  ALLIED_WITH: 'Allies',
  COMPETES_WITH: 'Competitors',
  FUNDS: 'Funders / Funded',
  ADVOCATES_FOR: 'Advocates For',
  OPPOSES: 'Opposes',
  SUPPORTS_POLICY: 'Supports Policy',
  OPPOSES_POLICY: 'Opposes Policy',
  ENGAGED_WITH: 'Engaged With',
  PUBLISHED: 'Published',
};

function RelationshipSection({ orgId, onSelectOrg }: { orgId: string; onSelectOrg?: (id: string) => void }) {
  const [edges, setEdges] = useState<OrganizationEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const allOrgs = useOrganizationStore((s) => s.organizations);

  const orgNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of allOrgs) map.set(o.id, o.name);
    return map;
  }, [allOrgs]);

  useEffect(() => {
    setLoading(true);
    api.getOrganizationEdges(orgId)
      .then(setEdges)
      .catch((err: unknown) => {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'org-relationships', level: 'error',
          message: 'Failed to load organization edges',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setEdges([]);
      })
      .finally(() => setLoading(false));
  }, [orgId]);

  if (loading) return <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Loading relationships...</span>;
  if (edges.length === 0) return null;

  const grouped = new Map<OrganizationEdgeType, { id: string; rationale?: string }[]>();
  for (const edge of edges) {
    const peer = edge.source === orgId ? edge.target : edge.source;
    const list = grouped.get(edge.type) ?? [];
    list.push({ id: peer, rationale: edge.rationale });
    grouped.set(edge.type, list);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[...grouped.entries()].map(([type, peers]) => (
        <div key={type}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2 }}>
            {EDGE_GROUP_LABELS[type] ?? type}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {peers.map((peer) => (
              <div key={peer.id} style={{ fontSize: '0.78rem' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <button
                    className="btn-xs btn-ghost"
                    style={{ color: 'var(--color-info, #3b82f6)', padding: 0, textDecoration: 'underline', cursor: onSelectOrg ? 'pointer' : 'default', fontWeight: 500 }}
                    onClick={() => onSelectOrg?.(peer.id)}
                    disabled={!onSelectOrg}
                  >
                    {orgNameMap.get(peer.id) ?? peer.id}
                  </button>
                  <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{peer.id}</span>
                </div>
                {peer.rationale && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: 1, paddingLeft: 2 }}>{peer.rationale}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function OrganizationDetail({ org, onSelectOrg }: { org: Organization; onSelectOrg?: (id: string) => void }) {
  const policyRegistry = useTaxonomyStore((s) => s.policyRegistry);
  const situations = useTaxonomyStore((s) => s.situations);

  const policyNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (policyRegistry) {
      for (const p of policyRegistry) map.set(p.id, p.action);
    }
    return map;
  }, [policyRegistry]);

  const situationNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (situations?.nodes) {
      for (const n of situations.nodes) map.set(n.id, n.label);
    }
    return map;
  }, [situations]);

  return (
    <div style={{ padding: 16, overflowY: 'auto', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{org.name}</h2>
          <TypeBadge type={org.type} />
          {org.status && org.status !== 'active' && (
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{org.status}</span>
          )}
        </div>
        {org.short_name && org.short_name !== org.name && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 2 }}>{org.short_name}</div>
        )}
        <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: '0.75rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          {org.headquarters && <span>{org.headquarters}</span>}
          {org.founded && <span>Founded {org.founded}</span>}
          {org.url && (
            <button
              className="btn-xs btn-ghost"
              style={{ color: 'var(--color-info, #3b82f6)', textDecoration: 'underline', padding: 0 }}
              onClick={() => { void api.openExternal(org.url!).catch((err: unknown) => {
                getGlobalRecorder()?.record({
                  type: 'system.error', component: 'org-detail', level: 'error',
                  message: 'Failed to open external URL',
                  error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
                });
              }); }}
            >
              Website
            </button>
          )}
        </div>
      </div>

      {/* Description */}
      {org.description && (
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>About</h3>
          <p style={{ margin: 0, lineHeight: 1.5 }}>{org.description}</p>
        </div>
      )}

      {/* POV Alignment */}
      <div>
        <h3 style={{ margin: '0 0 6px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>POV Alignment</h3>
        <PovAlignmentBar alignment={org.pov_alignment} />
      </div>

      {/* Topic Engagement */}
      {org.topic_engagement && org.topic_engagement.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Topic Engagement</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {org.topic_engagement.map((te, i) => {
              const label = situationNameMap.get(te.topic_ref);
              return (
                <div key={i} style={{ fontSize: '0.78rem' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontWeight: 500 }}>{label ?? te.topic_ref}</span>
                    {te.stance && (
                      <span style={{
                        padding: '1px 6px', borderRadius: 8, fontSize: 'var(--text-2xs)', fontWeight: 600,
                        background: 'var(--bg-hover)', color: 'var(--text-secondary)',
                      }}>
                        {te.stance}
                      </span>
                    )}
                    <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{te.topic_ref}</span>
                  </div>
                  {te.description && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: 1, paddingLeft: 2 }}>{te.description}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Policy Engagement */}
      {org.policy_engagement && org.policy_engagement.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Policy Engagement</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {org.policy_engagement.map((pe, i) => {
              const label = policyNameMap.get(pe.policy_ref);
              return (
                <div key={i} style={{ fontSize: '0.78rem' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontWeight: 500 }}>{label ?? pe.policy_ref}</span>
                    <span style={{
                      padding: '1px 6px', borderRadius: 8, fontSize: 'var(--text-2xs)', fontWeight: 600,
                      background: pe.stance === 'supports' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                      color: pe.stance === 'supports' ? '#22c55e' : '#ef4444',
                    }}>
                      {pe.stance}
                    </span>
                    <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{pe.policy_ref}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Relationships */}
      <div>
        <h3 style={{ margin: '0 0 6px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Relationships</h3>
        <RelationshipSection orgId={org.id} onSelectOrg={onSelectOrg} />
      </div>

      {/* Key Figures */}
      {org.key_figures && org.key_figures.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Key Figures</h3>
          <div style={{ fontSize: '0.78rem' }}>
            {org.key_figures.map((kf, i) => (
              <div key={i}>{typeof kf === 'string' ? kf : JSON.stringify(kf)}</div>
            ))}
          </div>
        </div>
      )}

      {/* External Links */}
      {org.external_links && org.external_links.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>External Links</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {org.external_links.map((link, i) => {
              const url = typeof link === 'string' ? link : (link as Record<string, unknown>)?.url as string | undefined;
              const label = typeof link === 'string' ? link : (link as Record<string, unknown>)?.label as string | undefined;
              if (!url) return null;
              return (
                <button
                  key={i}
                  className="btn-xs btn-ghost"
                  style={{ color: 'var(--color-info, #3b82f6)', textDecoration: 'underline', padding: 0, textAlign: 'left', fontSize: '0.78rem' }}
                  onClick={() => { void api.openExternal(url).catch((err: unknown) => {
                    getGlobalRecorder()?.record({
                      type: 'system.error', component: 'org-detail', level: 'error',
                      message: 'Failed to open external link',
                      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
                    });
                  }); }}
                >
                  {label || url}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Source Refs */}
      {org.source_refs && org.source_refs.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sources</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {org.source_refs.map((ref, i) => (
              <span key={i} style={{ fontFamily: 'monospace', fontSize: '0.7rem', padding: '1px 6px', borderRadius: 4, background: 'var(--bg-tertiary, #1e293b)' }}>
                {ref}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tags */}
      {org.tags && org.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {org.tags.map((tag, i) => (
            <span key={i} style={{ padding: '1px 8px', borderRadius: 10, fontSize: 'var(--text-2xs)', background: 'var(--bg-tertiary, #1e293b)', color: 'var(--text-muted)' }}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* ID + timestamps */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        <span style={{ fontFamily: 'monospace', userSelect: 'all' }}>{org.id}</span>
        {org.created_at && <span style={{ marginLeft: 12 }}>Created: {new Date(org.created_at).toLocaleDateString()}</span>}
        {org.last_modified && <span style={{ marginLeft: 12 }}>Modified: {new Date(org.last_modified).toLocaleDateString()}</span>}
      </div>
    </div>
  );
}
