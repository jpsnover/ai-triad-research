// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo } from 'react';
import { debaterColor } from './constants';

export function DebateExchangeRich({ content }: { content: string }) {
  const segments = useMemo(() => {
    const speakerRe = /^(Accelerationist|Safetyist|Skeptic|Prometheus|Sentinel|Cassandra)\s*(\[[^\]]*\])?:\s*/gm;
    const matches: { index: number; end: number; speaker: string; tag?: string }[] = [];
    let m;
    while ((m = speakerRe.exec(content)) !== null) {
      matches.push({ index: m.index, end: m.index + m[0].length, speaker: m[1], tag: m[2]?.replace(/[[\]]/g, '') });
    }
    if (matches.length === 0) return [{ text: content } as { speaker?: string; tag?: string; text: string }];
    const parts: { speaker?: string; tag?: string; text: string }[] = [];
    if (matches[0].index > 0) {
      const preamble = content.slice(0, matches[0].index).trim();
      if (preamble) parts.push({ text: preamble });
    }
    for (let i = 0; i < matches.length; i++) {
      const textEnd = i + 1 < matches.length ? matches[i + 1].index : content.length;
      parts.push({ speaker: matches[i].speaker, tag: matches[i].tag, text: content.slice(matches[i].end, textEnd).trim() });
    }
    return parts;
  }, [content]);

  if (segments.length <= 1 && !segments[0]?.speaker) {
    return <pre style={{ fontSize: '0.68rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflow: 'auto', margin: '4px 0 8px', padding: '6px 8px', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>{content}</pre>;
  }

  return (
    <div style={{ maxHeight: 300, overflow: 'auto', margin: '4px 0 8px', padding: '6px 8px', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>
      {segments.map((seg, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          {seg.speaker && (
            <div style={{ marginBottom: 3 }}>
              <span style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontSize: '0.72rem',
                color: '#fff', background: debaterColor(seg.speaker),
              }}>
                {seg.speaker}
              </span>
              {seg.tag && (
                <span style={{ marginLeft: 6, fontSize: '0.6rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{seg.tag}</span>
              )}
            </div>
          )}
          <div style={{ fontSize: '0.68rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-primary)', lineHeight: 1.45 }}>
            {seg.text}
          </div>
        </div>
      ))}
    </div>
  );
}
