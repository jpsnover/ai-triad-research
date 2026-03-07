// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ExportDialog({ open, onClose }: Props) {
  const notebooks = useAppStore(s => s.notebooks);
  const activeNotebookId = useAppStore(s => s.activeNotebookId);
  const enabledSourceIds = useAppStore(s => s.enabledSourceIds);
  const selectedSourceId = useAppStore(s => s.selectedSourceId);

  const [scope, setScope] = useState<'selected' | 'enabled'>('enabled');
  const [format, setFormat] = useState<'zip' | 'markdown'>('zip');
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const notebook = notebooks.find(n => n.id === activeNotebookId) ?? notebooks[0];
  const analyzedSourceIds = notebook.sources
    .filter(s => s.status === 'analyzed')
    .map(s => s.id);

  if (!open) return null;

  const handleExport = async () => {
    setExporting(true);
    setResult(null);

    const sourceIds = scope === 'selected' && selectedSourceId
      ? [selectedSourceId]
      : enabledSourceIds.filter(id => analyzedSourceIds.includes(id));

    try {
      const path = await window.electronAPI.exportBundle(sourceIds, format);
      if (path) {
        setResult(`Exported to: ${path}`);
      }
    } catch (err) {
      setResult(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-panel" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Export Analysis</h3>
          <button className="dialog-close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="dialog-body">
          <label className="dialog-label">
            Scope
            <select
              className="dialog-input"
              value={scope}
              onChange={e => setScope(e.target.value as 'selected' | 'enabled')}
            >
              <option value="enabled">All enabled sources ({enabledSourceIds.filter(id => analyzedSourceIds.includes(id)).length} analyzed)</option>
              {selectedSourceId && (
                <option value="selected">Selected source only</option>
              )}
            </select>
          </label>

          <label className="dialog-label">
            Format
            <select
              className="dialog-input"
              value={format}
              onChange={e => setFormat(e.target.value as 'zip' | 'markdown')}
            >
              <option value="zip">ZIP Bundle (JSON + Markdown)</option>
              <option value="markdown">Markdown Report Only</option>
            </select>
          </label>

          {result && (
            <div className={`apikey-status ${result.startsWith('Exported') ? 'apikey-valid' : 'apikey-invalid'}`}>
              {result}
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <button className="dialog-cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="dialog-add-btn"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
