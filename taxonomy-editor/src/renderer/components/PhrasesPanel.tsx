// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useMemo } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

interface TrainingPair {
  text: string;
  source: string;
  weight: number;
  metadata?: Record<string, unknown>;
}

const SOURCE_LABELS: Record<string, string> = {
  snapshot_passage: 'Document Passages',
  evidence_fact: 'Evidence Facts',
  pov_keypoint: 'POV Key Points',
  summary_factual_claim: 'Summary Claims',
  assumes: 'Assumptions',
  policy_action: 'Policy Actions',
  edge_propagated_snapshot_passage: 'Edge-Propagated Passages',
  edge_propagated_evidence_fact: 'Edge-Propagated Facts',
  edge_propagated_pov_keypoint: 'Edge-Propagated Key Points',
  edge_propagated_summary_factual_claim: 'Edge-Propagated Claims',
  edge_propagated_assumes: 'Edge-Propagated Assumptions',
  steelman_hard_negative: 'Hard Negatives',
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/_/g, ' ');
}

export function PhrasesPanel({ nodeId }: { nodeId: string }) {
  const [pairs, setPairs] = useState<TrainingPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getTrainingPairs(nodeId)
      .then(result => {
        if (!cancelled) setPairs(result);
      })
      .catch((err: unknown) => {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'phrases-panel',
          level: 'error',
          message: `Failed to load training pairs for ${nodeId}`,
          error: { name: (err as Error).name ?? 'Error', message: String(err) },
        });
        if (!cancelled) setPairs([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [nodeId]);

  const grouped = useMemo(() => {
    const map = new Map<string, TrainingPair[]>();
    for (const p of pairs) {
      const arr = map.get(p.source);
      if (arr) arr.push(p);
      else map.set(p.source, [p]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [pairs]);

  const toggleGroup = (source: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  if (loading) {
    return <div className="phrases-panel-loading">Loading training phrases…</div>;
  }

  if (pairs.length === 0) {
    return <div className="phrases-panel-empty">No training phrases found for this node.</div>;
  }

  return (
    <div className="phrases-panel">
      <div className="phrases-panel-summary">
        {pairs.length} phrases across {grouped.length} source types
      </div>
      {grouped.map(([source, items]) => {
        const isExpanded = expandedGroups.has(source);
        return (
          <div key={source} className="phrases-group">
            <button
              className="phrases-group-header"
              onClick={() => toggleGroup(source)}
            >
              <span className="phrases-group-chevron">{isExpanded ? '▾' : '▸'}</span>
              <span className="phrases-group-label">{sourceLabel(source)}</span>
              <span className="phrases-group-count">{items.length}</span>
            </button>
            {isExpanded && (
              <div className="phrases-group-items">
                {items.map((p, i) => (
                  <div key={i} className="phrases-item">
                    <div className="phrases-item-text">{p.text}</div>
                    {p.metadata?.doc_id && (
                      <div className="phrases-item-meta">
                        Source: {String(p.metadata.doc_id)}
                        {p.metadata.similarity != null && (
                          <> · Similarity: {Number(p.metadata.similarity).toFixed(3)}</>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
