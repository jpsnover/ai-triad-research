// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Brief Exports section (t/2805, T7 — spec §7). Lists completed exports for a debate
// (date / preset / model / manifest) with per-artifact download. Web-only v1 — the caller
// gates on isElectronMode(); the list read itself asserts presence, not just "renders"
// (ADR-001 graceful-empty: an empty list is shown explicitly, never a silent blank).

import { useCallback, useEffect, useState } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { BRIEF_ARTIFACTS, type BriefArtifactName } from '../../../../../lib/brief/types';
import type { BriefExportRecord } from '../../bridge/types';
import './BriefExportsList.css';

export function BriefExportsList({ debateId, refreshKey }: { debateId: string; refreshKey: number }) {
  const [rows, setRows] = useState<BriefExportRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.listBriefExports(debateId);
        if (!cancelled) { setRows(list); setError(null); }
      } catch (err) {
        if (cancelled) return;
        getGlobalRecorder()?.record({ type: 'system.error', component: 'brief-exports-list', level: 'error', message: 'Failed to load brief exports', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
        setError('Could not load exports.');
        setRows([]);
      }
    })();
    return () => { cancelled = true; };
  }, [debateId, refreshKey]);

  const download = useCallback(async (exportId: string, name: BriefArtifactName) => {
    try {
      const blob = await api.downloadBriefArtifact(exportId, name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'brief-exports-list', level: 'error', message: 'Artifact download failed', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
    }
  }, []);

  if (rows === null) return <div className="bxl-section"><div className="bxl-loading">Loading exports…</div></div>;

  return (
    <div className="bxl-section">
      <div className="bxl-head">Brief exports {rows.length > 0 ? `(${rows.length})` : ''}</div>
      {error && <div className="bxl-error" role="alert">{error}</div>}
      {rows.length === 0 && !error && <div className="bxl-empty">No briefs exported yet.</div>}
      {rows.length > 0 && (
        <ul className="bxl-list">
          {rows.map(r => (
            <li key={r.exportId} className={`bxl-row bxl-row-${r.status}`}>
              <div className="bxl-row-main">
                <span className="bxl-preset">{r.preset}</span>
                <span className="bxl-model">{r.narratorModel}</span>
                <span className="bxl-date">{r.createdAt.slice(0, 10)}</span>
                {r.status === 'failed' && <span className="bxl-failed">failed{r.errorCode ? ` · ${r.errorCode}` : ''}</span>}
              </div>
              {r.status === 'done' && (
                <div className="bxl-dls">
                  {r.artifacts.includes(BRIEF_ARTIFACTS.pptx) && (
                    <button className="bxl-dl" onClick={() => void download(r.exportId, BRIEF_ARTIFACTS.pptx)}>PPTX</button>
                  )}
                  {r.artifacts.includes(BRIEF_ARTIFACTS.manifest) && (
                    <button className="bxl-dl" onClick={() => void download(r.exportId, BRIEF_ARTIFACTS.manifest)}>Manifest</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
