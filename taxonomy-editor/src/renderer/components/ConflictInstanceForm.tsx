import type { ConflictInstance } from '../types/taxonomy';
import { todayISO } from '../utils/idGenerator';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';

interface ConflictInstanceFormProps {
  instance: ConflictInstance;
  index: number;
  onUpdate: (index: number, updates: Partial<ConflictInstance>) => void;
  onRemove: (index: number) => void;
  readOnly?: boolean;
}

export function ConflictInstanceForm({ instance, index, onUpdate, onRemove, readOnly }: ConflictInstanceFormProps) {
  return (
    <div className="card">
      <div className="card-header">
        <span>Instance #{index + 1}</span>
        {!readOnly && <button className="btn btn-danger btn-sm" onClick={() => onRemove(index)}>Remove</button>}
      </div>
      <div className="form-group">
        <label>Document ID</label>
        <HighlightedInput
          value={instance.doc_id}
          onChange={(v) => onUpdate(index, { doc_id: v })}
          readOnly={readOnly}
        />
      </div>
      <div className="form-group">
        <label>Position</label>
        <HighlightedTextarea
          value={instance.position}
          onChange={(v) => onUpdate(index, { position: v })}
          rows={2}
          readOnly={readOnly}
        />
      </div>
      <div className="form-group">
        <label>Date Flagged</label>
        <HighlightedInput
          type="date"
          value={instance.date_flagged}
          onChange={(v) => onUpdate(index, { date_flagged: v })}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}

export function newEmptyInstance(): ConflictInstance {
  return { doc_id: '', position: '', date_flagged: todayISO() };
}
