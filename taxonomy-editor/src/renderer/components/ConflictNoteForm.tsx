import type { ConflictNote } from '../types/taxonomy';
import { todayISO } from '../utils/idGenerator';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';
import { FieldHelp } from './FieldHelp';

interface ConflictNoteFormProps {
  note: ConflictNote;
  index: number;
  onUpdate: (index: number, updates: Partial<ConflictNote>) => void;
  onRemove: (index: number) => void;
  readOnly?: boolean;
  errorPrefix?: string;
}

export function ConflictNoteForm({ note, index, onUpdate, onRemove, readOnly, errorPrefix }: ConflictNoteFormProps) {
  const { validationErrors } = useTaxonomyStore();
  const err = (field: string) => errorPrefix ? validationErrors[`${errorPrefix}.${field}`] : undefined;

  return (
    <div className="card">
      <div className="card-header">
        <span>Note #{index + 1}</span>
        {!readOnly && <button className="btn btn-danger btn-sm" onClick={() => onRemove(index)}>Remove</button>}
      </div>
      <div className={`form-group ${err('author') ? 'has-error' : ''}`}>
        <label>
          Author
          <FieldHelp text="The person or system that authored this note." />
        </label>
        <HighlightedInput
          value={note.author}
          onChange={(v) => onUpdate(index, { author: v })}
          readOnly={readOnly}
        />
        {err('author') && <div className="error-text">{err('author')}</div>}
      </div>
      <div className={`form-group ${err('date') ? 'has-error' : ''}`}>
        <label>
          Date
          <FieldHelp text="When this note was written. Format: YYYY-MM-DD." />
        </label>
        <HighlightedInput
          type="date"
          value={note.date}
          onChange={(v) => onUpdate(index, { date: v })}
          readOnly={readOnly}
        />
        {err('date') && <div className="error-text">{err('date')}</div>}
      </div>
      <div className={`form-group ${err('note') ? 'has-error' : ''}`}>
        <label>
          Note
          <FieldHelp text="The content of the analyst's observation or commentary on this conflict." />
        </label>
        <HighlightedTextarea
          value={note.note}
          onChange={(v) => onUpdate(index, { note: v })}
          rows={3}
          readOnly={readOnly}
        />
        {err('note') && <div className="error-text">{err('note')}</div>}
      </div>
    </div>
  );
}

export function newEmptyNote(): ConflictNote {
  return { author: '', date: todayISO(), note: '' };
}
