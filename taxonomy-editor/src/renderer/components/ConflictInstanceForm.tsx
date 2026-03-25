// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { ConflictInstance } from '../types/taxonomy';
import { todayISO } from '../utils/idGenerator';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';

const STANCE_COLORS: Record<string, string> = {
  supports: '#16a34a',
  disputes: '#ef4444',
  neutral: '#6b7280',
  qualifies: '#d97706',
};

interface ConflictInstanceFormProps {
  instance: ConflictInstance;
  index: number;
  onUpdate: (index: number, updates: Partial<ConflictInstance>) => void;
  onRemove: (index: number) => void;
  readOnly?: boolean;
  errorPrefix?: string;
}

export function ConflictInstanceForm({ instance, index, onUpdate, onRemove, readOnly, errorPrefix }: ConflictInstanceFormProps) {
  const { validationErrors } = useTaxonomyStore();
  const err = (field: string) => errorPrefix ? validationErrors[`${errorPrefix}.${field}`] : undefined;

  return (
    <div className="conflict-instance-card">
      <div className="conflict-instance-header">
        <span className="conflict-instance-num">Instance #{index + 1}</span>
        {!readOnly && (
          <button className="conflict-instance-remove" onClick={() => onRemove(index)} title="Remove instance">
            &#128465;
          </button>
        )}
      </div>

      <div className="conflict-instance-row">
        <div className={`form-group conflict-instance-doc ${err('doc_id') ? 'has-error' : ''}`}>
          <label>Document ID</label>
          <HighlightedInput
            value={instance.doc_id}
            onChange={(v) => onUpdate(index, { doc_id: v })}
            readOnly={readOnly}
          />
          {err('doc_id') && <div className="error-text">{err('doc_id')}</div>}
        </div>
        <div className={`form-group conflict-instance-stance ${err('stance') ? 'has-error' : ''}`}>
          <label>Stance</label>
          <select
            className="conflict-stance-select"
            value={instance.stance}
            onChange={(e) => onUpdate(index, { stance: e.target.value as ConflictInstance['stance'] })}
            disabled={readOnly}
            style={{ color: STANCE_COLORS[instance.stance] || undefined, fontWeight: 600 }}
          >
            <option value="supports" style={{ color: STANCE_COLORS.supports }}>Supports</option>
            <option value="disputes" style={{ color: STANCE_COLORS.disputes }}>Disputes</option>
            <option value="neutral" style={{ color: STANCE_COLORS.neutral }}>Neutral</option>
            <option value="qualifies" style={{ color: STANCE_COLORS.qualifies }}>Qualifies</option>
          </select>
          {err('stance') && <div className="error-text">{err('stance')}</div>}
        </div>
      </div>

      <div className={`form-group ${err('assertion') ? 'has-error' : ''}`}>
        <label>Assertion</label>
        <HighlightedTextarea
          value={instance.assertion}
          onChange={(v) => onUpdate(index, { assertion: v })}
          rows={2}
          readOnly={readOnly}
        />
        {err('assertion') && <div className="error-text">{err('assertion')}</div>}
      </div>

      <div className={`form-group ${err('date_flagged') ? 'has-error' : ''}`}>
        <label>Date Flagged</label>
        <HighlightedInput
          type="date"
          value={instance.date_flagged}
          onChange={(v) => onUpdate(index, { date_flagged: v })}
          readOnly={readOnly}
        />
        {err('date_flagged') && <div className="error-text">{err('date_flagged')}</div>}
      </div>
    </div>
  );
}

export function newEmptyInstance(): ConflictInstance {
  return { doc_id: '', stance: 'neutral', assertion: '', date_flagged: todayISO() };
}
