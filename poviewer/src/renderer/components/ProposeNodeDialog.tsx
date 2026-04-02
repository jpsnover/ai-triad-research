// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import type { PovCamp } from '../types/types';
import { POV_LABELS } from '../types/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ProposeNodeDialog({ open, onClose }: Props) {
  const [camp, setCamp] = useState<PovCamp>('accelerationist');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [saved, setSaved] = useState(false);

  if (!open) return null;

  const handleSave = () => {
    if (!label.trim() || !category.trim()) return;

    // Store proposal in localStorage (not modifying actual taxonomy files)
    const proposals = JSON.parse(localStorage.getItem('poviewer-node-proposals') || '[]');
    proposals.push({
      id: `proposal-${Date.now()}`,
      camp,
      label: label.trim(),
      category: category.trim(),
      description: description.trim(),
      proposedAt: new Date().toISOString(),
    });
    localStorage.setItem('poviewer-node-proposals', JSON.stringify(proposals));

    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      setLabel('');
      setCategory('');
      setDescription('');
      onClose();
    }, 1000);
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-panel" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Propose Taxonomy Node</h3>
          <button className="dialog-close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="dialog-body">
          <label className="dialog-label">
            Camp
            <select
              className="dialog-input"
              value={camp}
              onChange={e => setCamp(e.target.value as PovCamp)}
            >
              {(['accelerationist', 'safetyist', 'skeptic', 'situations'] as PovCamp[]).map(c => (
                <option key={c} value={c}>{POV_LABELS[c]}</option>
              ))}
            </select>
          </label>
          <label className="dialog-label">
            Node Label
            <input
              className="dialog-input"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g., Regulatory Sandboxes"
              autoFocus
            />
          </label>
          <label className="dialog-label">
            Category
            <input
              className="dialog-input"
              value={category}
              onChange={e => setCategory(e.target.value)}
              placeholder="e.g., Governance Mechanisms"
            />
          </label>
          <label className="dialog-label">
            Description (optional)
            <textarea
              className="dialog-input"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of what this node captures..."
              rows={3}
              style={{ resize: 'vertical' }}
            />
          </label>
          {saved && (
            <div className="apikey-status apikey-valid">Proposal saved!</div>
          )}
        </div>
        <div className="dialog-footer">
          <button className="dialog-cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="dialog-add-btn"
            onClick={handleSave}
            disabled={!label.trim() || !category.trim()}
          >
            Save Proposal
          </button>
        </div>
      </div>
    </div>
  );
}
