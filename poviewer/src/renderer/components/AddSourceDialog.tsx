// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Source, SourceType } from '../types/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = 'file' | 'url';

function generateId(): string {
  return `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extensionToSourceType(filePath: string): SourceType {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'md') return 'markdown';
  return 'docx';
}

export default function AddSourceDialog({ open, onClose }: Props) {
  const addSource = useAppStore(s => s.addSource);

  const [tab, setTab] = useState<Tab>('file');
  const [title, setTitle] = useState('');
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  if (!open) return null;

  function reset() {
    setTab('file');
    setTitle('');
    setFilePaths([]);
    setUrl('');
    setError('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleBrowse() {
    if (!window.electronAPI) {
      setError('File browsing requires the Electron shell.');
      return;
    }
    const paths = await window.electronAPI.openSourceFileDialog();
    if (paths && paths.length > 0) {
      setFilePaths(paths);
      // Auto-fill title from first filename if blank
      if (!title) {
        const name = paths[0].replace(/\\/g, '/').split('/').pop() ?? '';
        setTitle(name.replace(/\.[^.]+$/, ''));
      }
      setError('');
    }
  }

  async function handleAdd() {
    if (tab === 'file') {
      if (filePaths.length === 0) {
        setError('Please select at least one file.');
        return;
      }
      for (const fp of filePaths) {
        const sourceType = extensionToSourceType(fp);
        const name = fp.replace(/\\/g, '/').split('/').pop() ?? '';
        const sourceTitle = filePaths.length === 1 && title
          ? title
          : name.replace(/\.[^.]+$/, '');
        const id = generateId();

        // Read file content
        let snapshotText = '';
        try {
          if (window.electronAPI?.readSourceFile) {
            snapshotText = await window.electronAPI.readSourceFile(fp);
          }
        } catch (err) {
          setError(`Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`);
          return;
        }

        const source: Source = {
          id,
          title: sourceTitle,
          url: null,
          sourceType,
          status: 'pending',
          snapshotText,
          points: [],
          filePath: fp,
        };

        // Persist metadata on disk if Electron is available
        if (window.electronAPI) {
          await window.electronAPI.addSource({
            id,
            title: sourceTitle,
            sourceType,
            url: null,
            addedAt: new Date().toISOString(),
            status: 'pending',
          });
        }

        addSource(source);
      }
    } else {
      if (!url.trim()) {
        setError('Please enter a URL.');
        return;
      }
      const id = generateId();
      const sourceTitle = title || url.trim();
      const source: Source = {
        id,
        title: sourceTitle,
        url: url.trim(),
        sourceType: 'url',
        status: 'pending',
        snapshotText: '',
        points: [],
      };

      if (window.electronAPI) {
        await window.electronAPI.addSource({
          id,
          title: sourceTitle,
          sourceType: 'url',
          url: url.trim(),
          addedAt: new Date().toISOString(),
          status: 'pending',
        });
      }

      addSource(source);
    }

    handleClose();
  }

  return (
    <div className="dialog-overlay" onClick={handleClose}>
      <div className="dialog-panel" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Add Source</h3>
          <button className="dialog-close-btn" onClick={handleClose}>&times;</button>
        </div>

        <div className="dialog-tabs">
          <button
            className={`dialog-tab${tab === 'file' ? ' active' : ''}`}
            onClick={() => { setTab('file'); setError(''); }}
          >
            File
          </button>
          <button
            className={`dialog-tab${tab === 'url' ? ' active' : ''}`}
            onClick={() => { setTab('url'); setError(''); }}
          >
            URL
          </button>
        </div>

        <div className="dialog-body">
          <label className="dialog-label">
            Title
            <input
              type="text"
              className="dialog-input"
              placeholder={tab === 'file' ? 'Auto-filled from filename' : 'e.g. AI Policy Report'}
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </label>

          {tab === 'file' ? (
            <div className="dialog-field">
              <button className="dialog-browse-btn" onClick={handleBrowse}>
                Browse...
              </button>
              {filePaths.length > 0 && (
                <div className="dialog-file-list">
                  {filePaths.map((fp, i) => (
                    <div key={i} className="dialog-file-item">
                      {fp.replace(/\\/g, '/').split('/').pop()}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <label className="dialog-label">
              URL
              <input
                type="url"
                className="dialog-input"
                placeholder="https://..."
                value={url}
                onChange={e => setUrl(e.target.value)}
              />
            </label>
          )}

          {error && <div className="dialog-error">{error}</div>}
        </div>

        <div className="dialog-footer">
          <button className="dialog-cancel-btn" onClick={handleClose}>Cancel</button>
          <button className="dialog-add-btn" onClick={handleAdd}>Add</button>
        </div>
      </div>
    </div>
  );
}
