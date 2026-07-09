// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import { useTaxonomyStore } from '../../../../hooks/useTaxonomyStore';

export function TensionsListDetail({ content }: { content: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [rationaleExpanded, setRationaleExpanded] = useState(false);

  const { accelerationist, safetyist, skeptic, edgesFile } = useTaxonomyStore();

  const nodeLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const pov of [accelerationist, safetyist, skeptic]) {
      if (!pov?.nodes) continue;
      for (const n of pov.nodes) map.set(n.id, n.label);
    }
    return map;
  }, [accelerationist, safetyist, skeptic]);

  const nodeWeights = useMemo(() => {
    const map = new Map<string, { confidence?: number; priority?: number; operationality?: number; category?: string }>();
    for (const pov of [accelerationist, safetyist, skeptic]) {
      if (!pov?.nodes) continue;
      for (const n of pov.nodes) map.set(n.id, { confidence: n.confidence, priority: n.priority, operationality: n.operationality, category: n.category });
    }
    return map;
  }, [accelerationist, safetyist, skeptic]);

  const edgeRationale = useMemo(() => {
    const map = new Map<string, string>();
    if (!edgesFile?.edges) return map;
    for (const e of edgesFile.edges) {
      map.set(`${e.source ?? ''}|${e.target ?? ''}|${e.type}`, e.rationale ?? '');
      if (e.bidirectional) map.set(`${e.target ?? ''}|${e.source ?? ''}|${e.type}`, e.rationale ?? '');
    }
    return map;
  }, [edgesFile]);

  const tensions = useMemo(() => {
    const re = /^(\S+)\s+(TENSION_WITH|CONTRADICTS|SUPPORTS)\s+(\S+)\s+\(confidence:\s*([\d.]+)\)/gm;
    const items: { source: string; relation: string; target: string; confidence: number; raw: string }[] = [];
    let m;
    while ((m = re.exec(content)) !== null) {
      items.push({ source: m[1], relation: m[2], target: m[3], confidence: parseFloat(m[4]), raw: m[0] });
    }
    return items;
  }, [content]);

  if (tensions.length === 0) {
    return <pre style={{ fontSize: 'var(--text-2xs)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflow: 'auto', margin: '4px 0 8px', padding: '6px 8px', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>{content}</pre>;
  }

  const sel = selected != null ? tensions[selected] : null;
  const relationColor = (r: string) => r === 'CONTRADICTS' ? 'var(--danger)' : r === 'TENSION_WITH' ? 'var(--warning)' : 'var(--success)';
  const relationIcon = (r: string) => r === 'TENSION_WITH' ? '⟷' : r === 'CONTRADICTS' ? '✕' : '✓';
  const sourcePov = (id: string) => id.startsWith('acc-') ? 'acc' : id.startsWith('saf-') ? 'saf' : id.startsWith('skp-') ? 'skp' : id.startsWith('sit-') ? 'sit' : '';
  const povColor = (id: string) => {
    const p = sourcePov(id);
    return p === 'acc' ? 'var(--color-acc)' : p === 'saf' ? 'var(--color-saf)' : p === 'skp' ? 'var(--color-skp)' : p === 'sit' ? 'var(--success)' : '#888';
  };

  const selRationale = sel ? edgeRationale.get(`${sel.source}|${sel.target}|${sel.relation}`) : undefined;
  const RATIONALE_TRUNCATE = 200;

  return (
    <div style={{ display: 'flex', gap: 8, margin: '4px 0 8px' }}>
      <div style={{ flex: '1 1 45%', maxHeight: 340, overflow: 'auto', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
        {tensions.map((t, i) => (
          <div key={i} onClick={() => { setSelected(i); setRationaleExpanded(false); }} style={{
            padding: '4px 8px', cursor: 'pointer', fontSize: 'var(--text-2xs)',
            background: selected === i ? 'color-mix(in srgb, var(--color-acc) 12%, transparent)' : 'transparent',
            borderLeft: selected === i ? '3px solid var(--color-acc)' : '3px solid transparent',
            borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ color: povColor(t.source), fontWeight: 600 }}>{t.source}</span>
            <span style={{ color: relationColor(t.relation), fontSize: 'var(--text-2xs)', fontWeight: 700, margin: '0 4px' }}>
              {relationIcon(t.relation)}
            </span>
            <span style={{ color: povColor(t.target), fontWeight: 600 }}>{t.target}</span>
            <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>{(t.confidence ?? 0).toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: '1 1 55%', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-primary)', fontSize: '0.7rem', minHeight: 80, overflow: 'auto' }}>
        {sel ? (
          <>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
              <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 4, background: `${relationColor(sel.relation)}18`, color: relationColor(sel.relation), fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase' }}>
                {sel.relation.replace(/_/g, ' ')}
              </span>
              <span style={{ marginLeft: 8, color: relationColor(sel.relation), fontSize: '0.8rem' }}>
                {relationIcon(sel.relation)}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 12px 8px', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: 2 }}>Source</div>
                <div style={{ fontWeight: 600, color: povColor(sel.source), fontSize: '0.78rem', lineHeight: 1.3 }}>
                  {nodeLabel.get(sel.source) || sel.source}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2 }}>{sel.source}</div>
              </div>
              <div style={{ color: relationColor(sel.relation), fontSize: '1rem', fontWeight: 700, flexShrink: 0, padding: '0 4px' }}>
                {relationIcon(sel.relation)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: 2 }}>Target</div>
                <div style={{ fontWeight: 600, color: povColor(sel.target), fontSize: '0.78rem', lineHeight: 1.3 }}>
                  {nodeLabel.get(sel.target) || sel.target}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2 }}>{sel.target}</div>
              </div>
            </div>

            {selRationale && (
              <div style={{ padding: '8px 12px 12px' }}>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, marginBottom: 6 }}>Rationale</div>
                <div style={{ borderLeft: '3px solid var(--color-saf)', paddingLeft: 10, fontSize: '0.72rem', color: 'var(--text-primary)', lineHeight: 1.5, background: 'var(--bg-secondary)', borderRadius: '0 4px 4px 0', padding: '8px 10px 8px 12px' }}>
                  {!rationaleExpanded && selRationale.length > RATIONALE_TRUNCATE
                    ? selRationale.slice(0, RATIONALE_TRUNCATE) + '...'
                    : selRationale}
                </div>
                {selRationale.length > RATIONALE_TRUNCATE && (
                  <div
                    onClick={() => setRationaleExpanded(!rationaleExpanded)}
                    style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-saf)', cursor: 'pointer', marginTop: 4 }}
                  >
                    {rationaleExpanded ? 'Show less' : 'Show more'}
                  </div>
                )}
              </div>
            )}

            <div style={{ padding: '4px 12px 8px', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
              Confidence: {(sel.confidence ?? 0).toFixed(2)}
            </div>
          </>
        ) : (
          <div style={{ padding: '8px 10px', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 'var(--text-2xs)' }}>Select a tension to see details</div>
        )}
      </div>
    </div>
  );
}
