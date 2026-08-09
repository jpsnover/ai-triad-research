// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import { POV_META, type PovMetaKey } from '@lib/electron-shared/povMeta';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import type { Pov } from '../../types/taxonomy';

interface PolicyUsage {
  nodeId: string;
  pov: string;
  framing: string;
}

interface SharedPolicy {
  id: string;
  action: string;
  povs: string[];
  usages: PolicyUsage[];
}


export function PolicyAlignmentPanel() {
  const {
    accelerationist, safetyist, skeptic, situations,
    policyRegistry, setToolbarPanel,
  } = useTaxonomyStore();
  const [filter, setFilter] = useState<'cross-pov' | 'all-shared'>('cross-pov');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Build usage map: policy_id -> usages
  const sharedPolicies = useMemo(() => {
    const usageMap = new Map<string, PolicyUsage[]>();

    const collectFromPov = (pov: string, nodes: { id: string; graph_attributes?: { policy_actions?: { policy_id?: string; framing: string }[] } }[]) => {
      for (const node of nodes) {
        for (const pa of node.graph_attributes?.policy_actions || []) {
          if (!pa.policy_id) continue;
          const list = usageMap.get(pa.policy_id) || [];
          list.push({ nodeId: node.id, pov, framing: pa.framing });
          usageMap.set(pa.policy_id, list);
        }
      }
    };

    if (accelerationist) collectFromPov('accelerationist', accelerationist.nodes);
    if (safetyist) collectFromPov('safetyist', safetyist.nodes);
    if (skeptic) collectFromPov('skeptic', skeptic.nodes);
    if (situations) collectFromPov('situations', situations.nodes);

    // Build shared policy entries
    const result: SharedPolicy[] = [];
    for (const [polId, usages] of usageMap) {
      if (usages.length < 2) continue;
      const povs = [...new Set(usages.map(u => u.pov))].sort();
      const reg = policyRegistry?.find(p => p.id === polId);
      if (!reg) continue;

      result.push({
        id: polId,
        action: reg.action,
        povs,
        usages,
      });
    }

    return result.sort((a, b) => b.povs.length - a.povs.length || b.usages.length - a.usages.length);
  }, [accelerationist, safetyist, skeptic, situations, policyRegistry]);

  const filtered = useMemo(() => {
    let list = sharedPolicies;
    if (filter === 'cross-pov') {
      list = list.filter(p => p.povs.length > 1);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p => p.id.toLowerCase().includes(q) || p.action.toLowerCase().includes(q));
    }
    return list;
  }, [sharedPolicies, filter, searchQuery]);

  const crossPovCount = sharedPolicies.filter(p => p.povs.length > 1).length;

  return (
    <div className="policy-alignment-panel">
      <div className="policy-alignment-header">
        <span className="policy-alignment-title">Policy Alignment</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setToolbarPanel(null)}>Close</button>
      </div>

      <div className="policy-alignment-controls">
        <select
          className="policy-alignment-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'cross-pov' | 'all-shared')}
        >
          <option value="cross-pov">Cross-Perspective ({crossPovCount})</option>
          <option value="all-shared">All Shared ({sharedPolicies.length})</option>
        </select>
        <input
          className="policy-alignment-search"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter policies..."
        />
      </div>

      <div className="policy-alignment-count">{filtered.length} policies</div>

      <div className="policy-alignment-list">
        {filtered.map(pol => {
          const isExpanded = expandedId === pol.id;
          return (
            <div key={pol.id} className="policy-alignment-item">
              <button
                className="policy-alignment-item-header"
                onClick={() => setExpandedId(isExpanded ? null : pol.id)}
              >
                <span className="policy-alignment-arrow">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                <span className="policy-alignment-id">{pol.id}</span>
                <span className="policy-alignment-povs">
                  {pol.povs.map(p => (
                    <span
                      key={p}
                      className="policy-alignment-pov-dot"
                      /* eslint-disable-next-line local/no-inline-style -- dynamic: data-driven POV color */
                      style={{ background: POV_META[p as PovMetaKey]?.cssVar ? `var(${POV_META[p as PovMetaKey].cssVar})` : '#888' }}
                      title={POV_META[p as PovMetaKey]?.label || p}
                    />
                  ))}
                </span>
                <span className="policy-alignment-action">{pol.action}</span>
                <span className="policy-alignment-usage-count">{pol.usages.length}</span>
              </button>

              {isExpanded && (
                <div className="policy-alignment-detail">
                  <div className="policy-alignment-framings">
                    {pol.usages.map((u, i) => (
                      <div key={i} className="policy-alignment-framing">
                        <div className="policy-alignment-framing-header">
                          <span
                            className="policy-alignment-framing-pov"
                            /* eslint-disable-next-line local/no-inline-style -- dynamic: data-driven POV color */
                            style={{ color: POV_META[u.pov as PovMetaKey]?.cssVar ? `var(${POV_META[u.pov as PovMetaKey].cssVar})` : '#888' }}
                          >
                            {POV_META[u.pov as PovMetaKey]?.label || u.pov}
                          </span>
                          <span className="policy-alignment-framing-node">{u.nodeId}</span>
                        </div>
                        <div className="policy-alignment-framing-text">{u.framing || '(no framing)'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
