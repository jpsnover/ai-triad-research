// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { POVER_INFO } from '../types/debate';
import type { PoverId } from '../types/debate';

interface NewDebateDialogProps {
  onClose: () => void;
}

const AI_POVERS: Exclude<PoverId, 'user'>[] = ['prometheus', 'sentinel', 'cassandra'];

export function NewDebateDialog({ onClose }: NewDebateDialogProps) {
  const { createDebate, loadDebate, updatePhase } = useDebateStore();
  const [topic, setTopic] = useState('');
  const [selected, setSelected] = useState<Set<PoverId>>(new Set(AI_POVERS));
  const [userIsPover, setUserIsPover] = useState(false);
  const [creating, setCreating] = useState(false);

  const toggle = (id: PoverId) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const canStart = topic.trim().length > 0 && selected.size >= 2;

  const handleStart = async () => {
    if (!canStart || creating) return;
    setCreating(true);
    const povers = Array.from(selected);
    if (userIsPover && !povers.includes('user')) povers.push('user');
    const id = await createDebate(topic.trim(), povers, userIsPover);
    await loadDebate(id);
    useDebateStore.getState().updatePhase('clarification');
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog new-debate-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>New Debate</h2>

        <label className="new-debate-label">Topic</label>
        <textarea
          className="new-debate-topic"
          placeholder="What should we debate?"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={3}
          autoFocus
        />

        <label className="new-debate-label">Debaters</label>
        <div className="new-debate-povers">
          {AI_POVERS.map((id) => {
            const info = POVER_INFO[id];
            return (
              <label key={id} className="new-debate-pover-option">
                <input
                  type="checkbox"
                  checked={selected.has(id)}
                  onChange={() => toggle(id)}
                />
                <span className="new-debate-pover-name" style={{ color: info.color }}>
                  {info.label}
                </span>
                <span className="new-debate-pover-desc">{info.personality}</span>
              </label>
            );
          })}
          <label className="new-debate-pover-option">
            <input
              type="checkbox"
              checked={userIsPover}
              onChange={() => setUserIsPover(!userIsPover)}
            />
            <span className="new-debate-pover-name">You</span>
            <span className="new-debate-pover-desc">Argue a position yourself</span>
          </label>
        </div>

        {selected.size < 2 && (
          <div className="new-debate-hint">Select at least 2 perspectives</div>
        )}

        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleStart} disabled={!canStart || creating}>
            {creating ? 'Creating...' : 'Start Debate'}
          </button>
        </div>
      </div>
    </div>
  );
}
