// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

export function DiffWindow() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const file = params.get('file');
    if (!file) {
      setError('No file path specified');
      setLoading(false);
      return;
    }
    setFilePath(file);
    api.getFileDiff(file)
      .then(d => setDiff(d))
      .catch((err) => {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'DiffWindow', level: 'error', message: 'Failed to load file diff', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        setError(String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  const lines = diff?.split('\n') ?? [];
  let addCount = 0;
  let delCount = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) addCount++;
    else if (line.startsWith('-') && !line.startsWith('---')) delCount++;
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg, #1e1e1e)', color: 'var(--text, #d4d4d4)' }}>
      <div style={{
        padding: '8px 16px',
        borderBottom: '1px solid var(--border, #333)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
        background: 'var(--bg-secondary, #252526)',
      }}>
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{filePath ?? 'Diff Viewer'}</span>
        {diff && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)' }}>
            <span style={{ color: '#4ec569' }}>+{addCount}</span>
            {' / '}
            <span style={{ color: '#f14c4c' }}>-{delCount}</span>
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0' }}>
        {loading && <div style={{ padding: 20, color: 'var(--text-muted, #888)' }}>Loading diff...</div>}
        {error && <div style={{ padding: 20, color: '#f14c4c' }}>Error: {error}</div>}
        {diff !== null && !loading && (
          <pre style={{
            margin: 0,
            padding: '8px 0',
            fontSize: '0.8rem',
            fontFamily: 'Consolas, "Courier New", monospace',
            lineHeight: 1.5,
            whiteSpace: 'pre',
            overflowX: 'auto',
          }}>
            {lines.map((line, i) => {
              let bg = 'transparent';
              let color = 'var(--text, #d4d4d4)';
              if (line.startsWith('+') && !line.startsWith('+++')) {
                bg = 'rgba(78, 197, 105, 0.15)';
                color = '#4ec569';
              } else if (line.startsWith('-') && !line.startsWith('---')) {
                bg = 'rgba(241, 76, 76, 0.15)';
                color = '#f14c4c';
              } else if (line.startsWith('@@')) {
                color = '#6796e6';
              } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
                color = 'var(--text-muted, #888)';
              }
              return (
                <div key={i} style={{ background: bg, padding: '0 16px', minHeight: '1.5em' }}>
                  <span style={{ display: 'inline-block', width: 48, color: 'var(--text-muted, #555)', textAlign: 'right', marginRight: 16, userSelect: 'none' }}>{i + 1}</span>
                  <span style={{ color }}>{line}</span>
                </div>
              );
            })}
          </pre>
        )}
        {diff !== null && diff.length === 0 && !loading && (
          <div style={{ padding: 20, color: 'var(--text-muted, #888)' }}>No changes in this file.</div>
        )}
      </div>
    </div>
  );
}
