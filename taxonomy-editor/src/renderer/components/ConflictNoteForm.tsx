import type { ConflictNote } from '../types/taxonomy';
import { todayISO } from '../utils/idGenerator';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';

interface ConflictNoteFormProps {
  note: ConflictNote;
  index: number;
  onUpdate: (index: number, updates: Partial<ConflictNote>) => void;
  onRemove: (index: number) => void;
  readOnly?: boolean;
}

export function ConflictNoteForm({ note, index, onUpdate, onRemove, readOnly }: ConflictNoteFormProps) {
  return (
    <div className="card">
      <div className="card-header">
        <span>Note #{index + 1}</span>
        {!readOnly && <button className="btn btn-danger btn-sm" onClick={() => onRemove(index)}>Remove</button>}
      </div>
      <div className="form-group">
        <label>Author</label>
        <HighlightedInput
          value={note.author}
          onChange={(v) => onUpdate(index, { author: v })}
          readOnly={readOnly}
        />
      </div>
      <div className="form-group">
        <label>Date</label>
        <HighlightedInput
          type="date"
          value={note.date}
          onChange={(v) => onUpdate(index, { date: v })}
          readOnly={readOnly}
        />
      </div>
      <div className="form-group">
        <label>Note</label>
        <HighlightedTextarea
          value={note.note}
          onChange={(v) => onUpdate(index, { note: v })}
          rows={3}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}

export function newEmptyNote(): ConflictNote {
  return { author: '', date: todayISO(), note: '' };
}
