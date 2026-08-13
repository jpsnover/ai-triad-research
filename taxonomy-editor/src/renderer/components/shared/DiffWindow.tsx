// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './DiffWindow.css';

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
    <div className="diff-window">
      <div className="diff-window-header">
        <span className="diff-window-filename">{filePath ?? 'Diff Viewer'}</span>
        {diff && (
          <span className="diff-window-stats">
            <span className="diff-window-stats-add">+{addCount}</span>
            {' / '}
            <span className="diff-window-stats-del">-{delCount}</span>
          </span>
        )}
      </div>
      <div className="diff-window-body">
        {loading && <div className="diff-window-loading">Loading diff...</div>}
        {error && <div className="diff-window-error">Error: {error}</div>}
        {diff !== null && !loading && (
          <pre className="diff-window-pre">
            {lines.map((line, i) => {
              let bg = 'transparent';
              let color = 'var(--text-primary, #d4d4d4)';
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
                <div
                  key={i}
                  className="diff-window-line"
                  /* eslint-disable-next-line local/no-inline-style -- background is computed per diff line type */
                  style={{ background: bg }}
                >
                  <span className="diff-window-line-number">{i + 1}</span>
                  <span
                    /* eslint-disable-next-line local/no-inline-style -- color is computed per diff line type */
                    style={{ color }}
                  >{line}</span>
                </div>
              );
            })}
          </pre>
        )}
        {diff !== null && diff.length === 0 && !loading && (
          <div className="diff-window-empty">No changes in this file.</div>
        )}
      </div>
    </div>
  );
}
