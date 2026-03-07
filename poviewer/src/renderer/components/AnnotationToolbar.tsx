// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import type { Point } from '../types/types';
import type { AnnotationAction } from '../types/annotations';

interface Props {
  point: Point;
  onAnnotate: (action: AnnotationAction, value: unknown, mappingIndex?: number) => void;
}

export default function AnnotationToolbar({ point, onAnnotate }: Props) {
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState('');

  const handleAddNote = () => {
    if (noteText.trim()) {
      onAnnotate('add_note', noteText.trim());
      setNoteText('');
      setShowNote(false);
    }
  };

  return (
    <div className="annotation-toolbar">
      <div className="annotation-toolbar-actions">
        <button
          className="annotation-btn"
          onClick={() => onAnnotate('dismiss_point', true)}
          title="Dismiss this point"
        >
          Dismiss
        </button>
        <button
          className="annotation-btn"
          onClick={() => onAnnotate('flag_collision', true)}
          title="Flag as vocabulary collision"
        >
          Flag Collision
        </button>
        <button
          className="annotation-btn"
          onClick={() => setShowNote(!showNote)}
          title="Add a note"
        >
          Add Note
        </button>
      </div>

      {point.mappings.map((m, i) => (
        <div key={i} className="annotation-mapping-actions">
          <span className="annotation-mapping-label">{m.nodeLabel}:</span>
          <button
            className="annotation-btn-sm"
            onClick={() => onAnnotate(
              'change_alignment',
              m.alignment === 'agrees' ? 'contradicts' : 'agrees',
              i,
            )}
            title="Toggle alignment"
          >
            {m.alignment === 'agrees' ? 'Set Contradicts' : 'Set Agrees'}
          </button>
          <select
            className="annotation-strength-select"
            value=""
            onChange={e => {
              if (e.target.value) {
                onAnnotate('change_strength', e.target.value, i);
                e.target.value = '';
              }
            }}
          >
            <option value="">Strength...</option>
            <option value="strong">Strong</option>
            <option value="moderate">Moderate</option>
            <option value="weak">Weak</option>
          </select>
          <button
            className="annotation-btn-sm annotation-btn-danger"
            onClick={() => onAnnotate('dismiss_mapping', true, i)}
            title="Dismiss this mapping"
          >
            Dismiss
          </button>
        </div>
      ))}

      {showNote && (
        <div className="annotation-note-input">
          <textarea
            className="annotation-note-textarea"
            placeholder="Add a note about this point..."
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            rows={2}
            autoFocus
          />
          <div className="annotation-note-actions">
            <button className="dialog-cancel-btn" onClick={() => setShowNote(false)}>Cancel</button>
            <button className="dialog-add-btn" onClick={handleAddNote} disabled={!noteText.trim()}>
              Save Note
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
