// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';

interface ApiKeyDialogProps {
  onClose: () => void;
}

export function ApiKeyDialog({ onClose }: ApiKeyDialogProps) {
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!key.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await window.electronAPI.setApiKey(key.trim());
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Configure API Key</h3>
        <p>
          Semantic search uses the Gemini gemini-embedding-001 model.
          Enter your Google Gemini API key below. It will be stored encrypted on this machine.
        </p>
        <div className="form-group">
          <label>API Key</label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="AIza..."
            autoFocus
          />
        </div>
        {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!key.trim() || saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
