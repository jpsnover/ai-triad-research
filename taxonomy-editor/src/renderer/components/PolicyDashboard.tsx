// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useMemo } from 'react';
import { POV_KEYS } from '@lib/debate/types';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { PolicySourcesPanel, getPolicySourceIndex } from './PolicySourcesPanel';
import type { PolicySourceReference } from './PolicySourcesPanel';

const POV_COLORS: Record<string, string> = {
  accelerationist: 'var(--color-acc)',
  safetyist: 'var(--color-saf)',
  skeptic: 'var(--color-skp)',
  'situations': 'var(--color-sit)',
};

type PolicySourceIndex = Record<string, PolicySourceReference[]>;

export function PolicyDashboard() {
  const { policyRegistry, edgesFile, setToolbarPanel } = useTaxonomyStore();
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [policySourceIndex, setPolicySourceIndex] = useState<PolicySourceIndex | null>(null);

  useEffect(() => {
    void getPolicySourceIndex().then(setPolicySourceIndex);
  }, []);

  const stats = useMemo(() => {
    const policies = policyRegistry ?? [];
    const totalCount = policies.length;

    // Cross-POV: policies with source_povs spanning more than one POV
    const crossPovCount = policies.filter(p => p.source_povs && p.source_povs.length > 1).length;

    // Top 10 by member_count
    const top10 = [...policies]
      .sort((a, b) => (b.member_count ?? 0) - (a.member_count ?? 0))
      .slice(0, 10);

    // Tag distribution: count policies per source_pov
    const tagDist = new Map<string, number>();
    for (const p of policies) {
      if (p.source_povs) {
        for (const pov of p.source_povs) {
          tagDist.set(pov, (tagDist.get(pov) ?? 0) + 1);
        }
      }
    }
    const tagEntries = [...tagDist.entries()].sort((a, b) => b[1] - a[1]);
    const maxTag = tagEntries.length > 0 ? tagEntries[0][1] : 1;

    // Contradiction hotspots: count CONTRADICTS edges per policy
    // We need to map node IDs to their policy_actions to connect edges to policies
    const contradictCounts = new Map<string, number>();
    if (edgesFile) {
      // Build a set of node IDs involved in CONTRADICTS edges
      const contradictEdges = edgesFile.edges.filter(e => e.type === 'CONTRADICTS' && e.status === 'approved');

      // We need to find which policies are associated with nodes involved in contradictions
      // Since policies are linked to nodes via graph_attributes.policy_actions, and we have
      // the policy registry, we'll count edges whose source or target nodes are associated
      // with each policy
      const state = useTaxonomyStore.getState();
      const nodeToPolicies = new Map<string, string[]>();

      for (const povKey of [...POV_KEYS, 'situations'] as const) {
        const file = povKey === 'situations' ? state.situations : state[povKey];
        if (!file?.nodes) continue;
        for (const node of file.nodes) {
          const ga = (node as { graph_attributes?: { policy_actions?: { policy_id?: string }[] } }).graph_attributes;
          if (ga?.policy_actions) {
            const policyIds = ga.policy_actions
              .filter(a => a.policy_id)
              .map(a => a.policy_id!);
            if (policyIds.length > 0) {
              nodeToPolicies.set(node.id, policyIds);
            }
          }
        }
      }

      for (const edge of contradictEdges) {
        const sourcePolicies = nodeToPolicies.get(edge.source) ?? [];
        const targetPolicies = nodeToPolicies.get(edge.target) ?? [];
        const allPolicies = [...sourcePolicies, ...targetPolicies];
        for (const polId of allPolicies) {
          contradictCounts.set(polId, (contradictCounts.get(polId) ?? 0) + 1);
        }
      }
    }

    const contradictHotspots = [...contradictCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => {
        const pol = policies.find(p => p.id === id);
        return { id, action: pol?.action ?? id, count };
      });

    return { totalCount, crossPovCount, top10, tagEntries, maxTag, contradictHotspots };
  }, [policyRegistry, edgesFile]);

  // Timeline: sort policies by earliest dateIngested from their sources
  const timeline = useMemo(() => {
    if (!policyRegistry || !policySourceIndex) return [];
    return policyRegistry
      .map((pol) => {
        const refs = policySourceIndex[pol.id] || [];
        const dates = refs
          .map((r) => r.dateIngested)
          .filter((d) => d && d.length > 0)
          .sort();
        const firstDate = dates.length > 0 ? dates[0] : '';
        const firstTitle = refs.length > 0 ? refs[0].title : '';
        return { id: pol.id, action: pol.action, firstDate, firstTitle };
      })
      .filter((item) => item.firstDate.length > 0)
      .sort((a, b) => a.firstDate.localeCompare(b.firstDate));
  }, [policyRegistry, policySourceIndex]);

  if (!policyRegistry || policyRegistry.length === 0) {
    return (
      <div className="policy-dashboard">
        <div className="policy-dashboard-header">
          <span className="policy-dashboard-title">Policy Dashboard</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setToolbarPanel(null)}>Close</button>
        </div>
        <div className="policy-dashboard-empty">
          No policy registry loaded. Run <code>Find-PolicyAction</code> to generate policies.
        </div>
      </div>
    );
  }

  return (
    <div className="policy-dashboard">
      <div className="policy-dashboard-header">
        <span className="policy-dashboard-title">Policy Dashboard</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setToolbarPanel(null)}>Close</button>
      </div>
      <div className="policy-dashboard-content">
        {/* Summary stats */}
        <div className="policy-dashboard-stats">
          <div className="policy-dashboard-stat">
            <div className="policy-dashboard-stat-value">{stats.totalCount}</div>
            <div className="policy-dashboard-stat-label">Total Policies</div>
          </div>
          <div className="policy-dashboard-stat">
            <div className="policy-dashboard-stat-value">{stats.crossPovCount}</div>
            <div className="policy-dashboard-stat-label">Cross-POV</div>
          </div>
        </div>

        {/* Selected policy detail */}
        {selectedPolicyId && (
          <div className="policy-dashboard-section">
            <div className="policy-dashboard-detail-header">
              <h3 className="policy-dashboard-section-title">Sources for {selectedPolicyId}</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedPolicyId(null)}>Back</button>
            </div>
            <PolicySourcesPanel policyId={selectedPolicyId} />
          </div>
        )}

        {/* Top 10 most-referenced */}
        <div className="policy-dashboard-section">
          <h3 className="policy-dashboard-section-title">Top 10 Most-Referenced Policies</h3>
          <div className="policy-dashboard-list">
            {stats.top10.map((p, i) => (
              <div key={p.id} className="policy-dashboard-row policy-dashboard-row-clickable" onClick={() => setSelectedPolicyId(p.id)}>
                <span className="policy-dashboard-rank">{i + 1}.</span>
                <span className="policy-dashboard-id">{p.id}</span>
                <span className="policy-dashboard-action" title={p.action}>{p.action}</span>
                <span className="policy-dashboard-count">{p.member_count ?? 0}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tag distribution */}
        <div className="policy-dashboard-section">
          <h3 className="policy-dashboard-section-title">POV Distribution</h3>
          <div className="policy-dashboard-bars">
            {stats.tagEntries.map(([tag, count]) => (
              <div key={tag} className="policy-dashboard-bar-row">
                <span className="policy-dashboard-bar-label" style={{ color: POV_COLORS[tag] ?? 'var(--text-secondary)' }}>
                  {tag}
                </span>
                <div className="policy-dashboard-bar-track">
                  <div
                    className="policy-dashboard-bar-fill"
                    style={{
                      width: `${(count / stats.maxTag) * 100}%`,
                      backgroundColor: POV_COLORS[tag] ?? 'var(--text-muted)',
                    }}
                  />
                </div>
                <span className="policy-dashboard-bar-count">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Contradiction hotspots */}
        <div className="policy-dashboard-section">
          <h3 className="policy-dashboard-section-title">Contradiction Hotspots</h3>
          {stats.contradictHotspots.length === 0 ? (
            <div className="policy-dashboard-empty-section">No contradiction edges found</div>
          ) : (
            <div className="policy-dashboard-list">
              {stats.contradictHotspots.map((h) => (
                <div key={h.id} className="policy-dashboard-row policy-dashboard-row-hotspot">
                  <span className="policy-dashboard-id">{h.id}</span>
                  <span className="policy-dashboard-action" title={h.action}>{h.action}</span>
                  <span className="policy-dashboard-count policy-dashboard-count-hot">{h.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="policy-dashboard-section">
          <h3 className="policy-dashboard-section-title">Timeline</h3>
          {timeline.length === 0 ? (
            <div className="policy-dashboard-empty-section">No source dates available</div>
          ) : (
            <div className="policy-dashboard-timeline">
              {timeline.map((item) => (
                <div
                  key={item.id}
                  className="policy-timeline-row"
                  onClick={() => setSelectedPolicyId(item.id)}
                >
                  <span className="policy-timeline-date">{item.firstDate}</span>
                  <span className="policy-timeline-id">{item.id}</span>
                  <span className="policy-timeline-action" title={item.action}>{item.action}</span>
                  <span className="policy-timeline-source" title={item.firstTitle}>{item.firstTitle}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
