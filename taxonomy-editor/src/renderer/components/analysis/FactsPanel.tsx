// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

export interface SourceFact {
  claim: string;
  label: string;
  doc_id: string;
  specificity: string;
  temporal_bound: string | null;
}

type FactsIndex = Record<string, { facts: SourceFact[] }>;

// Module-level cache — loaded once, reused across renders
let _factsCache: FactsIndex | null = null;
let _factsLoading = false;
let _factsListeners: Array<() => void> = [];

async function getFactsIndex(): Promise<FactsIndex> {
  if (_factsCache) return _factsCache;
  if (_factsLoading) {
    return new Promise((resolve) => {
      _factsListeners.push(() => resolve(_factsCache!));
    });
  }
  _factsLoading = true;
  try {
    _factsCache = (await api.loadSourceEvidenceIndex()) as FactsIndex | null ?? {};
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'facts-panel',
      level: 'error',
      message: 'Failed to load source evidence index',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    _factsCache = {};
  }
  _factsLoading = false;
  for (const cb of _factsListeners) cb();
  _factsListeners = [];
  return _factsCache;
}

/** Return the fact count for a node (synchronous — returns 0 until cache is warm). */
export function getFactCount(nodeId: string): number {
  return _factsCache?.[nodeId]?.facts?.length ?? 0;
}

/** Kick off cache loading eagerly (call from parent on mount). */
export function preloadFactsIndex(): void {
  void getFactsIndex();
}

const SPECIFICITY_COLORS: Record<string, { bg: string; fg: string }> = {
  precise: { bg: 'rgba(34,197,94,0.12)', fg: '#16a34a' },
  qualified: { bg: 'rgba(234,179,8,0.12)', fg: '#ca8a04' },
  unknown: { bg: 'rgba(148,163,184,0.12)', fg: '#64748b' },
};

export function FactsPanel({ nodeId }: { nodeId: string }) {
  const [facts, setFacts] = useState<SourceFact[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setExpanded(null);
    void getFactsIndex().then((idx) => {
      if (cancelled) return;
      setFacts(idx[nodeId]?.facts ?? []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [nodeId]);

  if (loading) {
    return <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: '0.8rem' }}>Loading facts...</div>;
  }

  if (!facts || facts.length === 0) {
    return <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: '0.8rem' }}>No source evidence linked to this node.</div>;
  }

  return (
    <div style={{ padding: '8px 0', fontSize: '0.8rem' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: 8, paddingLeft: 4 }}>
        {facts.length} fact{facts.length !== 1 ? 's' : ''} from source documents
      </div>
      {facts.map((f, i) => {
        const isExpanded = expanded === i;
        const spec = SPECIFICITY_COLORS[f.specificity] ?? SPECIFICITY_COLORS.unknown;
        return (
          <div
            key={`${f.doc_id}-${i}`}
            style={{
              marginBottom: 6,
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: isExpanded ? 'var(--bg-secondary)' : 'transparent',
              cursor: 'pointer',
            }}
            onClick={() => setExpanded(isExpanded ? null : i)}
          >
            <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ flexShrink: 0, color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: 2 }}>
                {isExpanded ? '\u25BC' : '\u25B6'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.78rem', lineHeight: 1.3 }}>{f.label}</div>
                {!isExpanded && (
                  <div style={{
                    color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {f.claim}
                  </div>
                )}
              </div>
              <span style={{
                flexShrink: 0, padding: '1px 6px', borderRadius: 10,
                fontSize: '0.6rem', fontWeight: 600,
                background: spec.bg, color: spec.fg,
              }}>
                {f.specificity}
              </span>
            </div>
            {isExpanded && (
              <div style={{ padding: '0 10px 8px 28px', lineHeight: 1.5 }}>
                <div style={{ marginBottom: 6, color: 'var(--text-primary)' }}>{f.claim}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  <span title="Source document"><strong>Doc:</strong> {f.doc_id}</span>
                  {f.temporal_bound && (
                    <span title="Temporal bound"><strong>Period:</strong> {f.temporal_bound}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
