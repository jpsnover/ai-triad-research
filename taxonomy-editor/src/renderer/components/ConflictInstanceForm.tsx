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
      <div className={`form-group ${err('position') ? 'has-error' : ''}`}>
        <label>
          Position
          <FieldHelp text="The location within the document (e.g., section, paragraph, page) where the conflicting claim appears." />
        </label>
        <HighlightedTextarea
          value={instance.position}
          onChange={(v) => onUpdate(index, { position: v })}
          rows={2}
          readOnly={readOnly}
        />
        {err('position') && <div className="error-text">{err('position')}</div>}
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
  return { doc_id: '', position: '', date_flagged: todayISO() };
}
