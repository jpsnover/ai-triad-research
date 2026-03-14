// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { ConflictInstance } from '../types/taxonomy';
import { todayISO } from '../utils/idGenerator';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';
import { FieldHelp } from './FieldHelp';

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
    <div className="card">
      <div className="card-header">
        <span>Instance #{index + 1}</span>
        {!readOnly && <button className="btn btn-danger btn-sm" onClick={() => onRemove(index)}>Remove</button>}
      </div>
      <div className={`form-group ${err('doc_id') ? 'has-error' : ''}`}>
        <label>
          Document ID
          <FieldHelp text="The identifier of the source document where this conflict instance was found." />
        </label>
        <HighlightedInput
          value={instance.doc_id}
          onChange={(v) => onUpdate(index, { doc_id: v })}
          readOnly={readOnly}
        />
        {err('doc_id') && <div className="error-text">{err('doc_id')}</div>}
      </div>
      <div className={`form-group ${err('stance') ? 'has-error' : ''}`}>
        <label>
          Stance
          <FieldHelp text="How this document relates to the conflict claim: supports, disputes, neutral, or qualifies (partially agrees with caveats)." />
        </label>
        <select
          value={instance.stance}
          onChange={(e) => onUpdate(index, { stance: e.target.value as ConflictInstance['stance'] })}
          disabled={readOnly}
        >
          <option value="supports">Supports</option>
          <option value="disputes">Disputes</option>
          <option value="neutral">Neutral</option>
          <option value="qualifies">Qualifies</option>
        </select>
        {err('stance') && <div className="error-text">{err('stance')}</div>}
      </div>
      <div className={`form-group ${err('assertion') ? 'has-error' : ''}`}>
        <label>
          Assertion
          <FieldHelp text="What this document specifically claims about the conflict topic." />
        </label>
        <HighlightedTextarea
          value={instance.assertion}
          onChange={(v) => onUpdate(index, { assertion: v })}
          rows={2}
          readOnly={readOnly}
        />
        {err('assertion') && <div className="error-text">{err('assertion')}</div>}
      </div>
      <div className={`form-group ${err('date_flagged') ? 'has-error' : ''}`}>
        <label>
          Date Flagged
          <FieldHelp text="The date this conflict instance was identified. Format: YYYY-MM-DD." />
        </label>
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
