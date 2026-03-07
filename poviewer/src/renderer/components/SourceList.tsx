// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useAppStore } from '../store/useAppStore';
import type { SourceStatus, SourceType } from '../types/types';

const TYPE_LABELS: Record<SourceType, string> = {
  docx: 'DOCX',
  pdf: 'PDF',
  url: 'URL',
  markdown: 'MD',
};

function StatusBadge({ status }: { status: SourceStatus }) {
  return <span className={`status-badge ${status}`}>{status}</span>;
}

export default function SourceList() {
  // Subscribe to primitive state for reactivity
  const notebooks = useAppStore(s => s.notebooks);
  const activeNotebookId = useAppStore(s => s.activeNotebookId);
  const selectedSourceId = useAppStore(s => s.selectedSourceId);
  const analyzingSourceId = useAppStore(s => s.analyzingSourceId);
  const enabledSourceIds = useAppStore(s => s.enabledSourceIds);
  const selectSource = useAppStore(s => s.selectSource);
  const toggleSourceEnabled = useAppStore(s => s.toggleSourceEnabled);
  const setAllSourcesEnabled = useAppStore(s => s.setAllSourcesEnabled);

  const notebook = notebooks.find(n => n.id === activeNotebookId) ?? notebooks[0];

  if (notebook.sources.length === 0) {
    return (
      <div className="pane-body">
        <div className="empty-state">
          <div className="empty-state-icon">&#128196;</div>
          <div className="empty-state-text">No sources in this notebook</div>
        </div>
      </div>
    );
  }

  const allChecked = notebook.sources.every(s => enabledSourceIds.includes(s.id));
  const someChecked = notebook.sources.some(s => enabledSourceIds.includes(s.id));

  return (
    <>
      <div className="source-list-header">
        <label>
          <input
            type="checkbox"
            checked={allChecked}
            ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
            onChange={() => setAllSourcesEnabled(!allChecked)}
          />
          Select All
        </label>
      </div>
      <div className="pane-body">
        <ul className="source-list">
          {notebook.sources.map(source => {
            const isViewing = source.id === selectedSourceId || source.id === analyzingSourceId;
            const isEnabled = enabledSourceIds.includes(source.id);
            return (
              <li
                key={source.id}
                className={`source-item${isViewing ? ' selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => {
                    e.stopPropagation();
                    toggleSourceEnabled(source.id);
                  }}
                />
                <span
                  className="source-type-icon"
                  onClick={() => selectSource(source.id)}
                >
                  {TYPE_LABELS[source.sourceType]}
                </span>
                <span
                  className="source-title"
                  onClick={() => selectSource(source.id)}
                >
                  {source.title}
                </span>
                <StatusBadge status={source.status} />
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
