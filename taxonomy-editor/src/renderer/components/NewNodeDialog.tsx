import { useState } from 'react';
import type { Category } from '../types/taxonomy';

interface NewNodeDialogProps {
  onConfirm: (category: Category) => void;
  onCancel: () => void;
}

const CATEGORIES: Category[] = ['Goals/Values', 'Data/Facts', 'Methods'];

export function NewNodeDialog({ onConfirm, onCancel }: NewNodeDialogProps) {
  const [category, setCategory] = useState<Category>('Goals/Values');

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>New Node</h3>
        <div className="form-group">
          <label>Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="dialog-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onConfirm(category)}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
