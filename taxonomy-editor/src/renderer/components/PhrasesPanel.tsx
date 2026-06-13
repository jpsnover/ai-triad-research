// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useMemo } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

interface SyntheticClaim {
  text: string;
  node_id: string;
  source: string;
  weight: number;
  metadata?: { pov?: string; bdi_category?: string };
}

interface CorpusFile {
  pairs: SyntheticClaim[];
}

let _corpusCache: SyntheticClaim[] | null = null;
let _corpusLoading = false;
let _corpusListeners: Array<() => void> = [];

async function loadCorpus(): Promise<SyntheticClaim[]> {
  if (_corpusCache) return _corpusCache;
  if (_corpusLoading) {
    return new Promise(resolve => {
      _corpusListeners.push(() => resolve(_corpusCache!));
    });
  }
  _corpusLoading = true;
  try {
    const data = await api.readResearchFile('comp-linguist/debate_claims_corpus.json') as CorpusFile | null;
    _corpusCache = data?.pairs ?? [];
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'phrases-panel',
      level: 'error',
      message: 'Failed to load synthetic phrases corpus',
      error: { name: (err as Error).name ?? 'Error', message: String(err) },
    });
    _corpusCache = [];
  }
  _corpusLoading = false;
  for (const cb of _corpusListeners) cb();
  _corpusListeners = [];
  return _corpusCache;
}

export function PhrasesPanel({ nodeId }: { nodeId: string }) {
  const [corpus, setCorpus] = useState<SyntheticClaim[]>(_corpusCache ?? []);
  const [loading, setLoading] = useState(!_corpusCache);

  useEffect(() => {
    if (_corpusCache) { setCorpus(_corpusCache); return; }
    let cancelled = false;
    loadCorpus()
      .then(data => { if (!cancelled) setCorpus(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const phrases = useMemo(
    () => corpus.filter(p => p.node_id === nodeId),
    [corpus, nodeId],
  );

  if (loading) {
    return <div className="phrases-panel-loading">Loading synthetic phrases…</div>;
  }

  if (phrases.length === 0) {
    return <div className="phrases-panel-empty">No synthetic phrases for this node.</div>;
  }

  return (
    <div className="phrases-panel">
      <div className="phrases-panel-summary">
        {phrases.length} synthetic {phrases.length === 1 ? 'phrase' : 'phrases'}
      </div>
      <div className="phrases-list">
        {phrases.map((p, i) => (
          <div key={i} className="phrases-item">
            <div className="phrases-item-text">{p.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
