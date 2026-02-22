import { useState } from 'react';
import type { Pov, PovNode } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';

interface NodeDetailProps {
  pov: Pov;
  node: PovNode;
  readOnly?: boolean;
  onPin?: () => void;
}

export function NodeDetail({ pov, node, readOnly, onPin }: NodeDetailProps) {
  const { updatePovNode, deletePovNode, validationErrors, getAllNodeIds, getAllConflictIds } = useTaxonomyStore();
  const [showDelete, setShowDelete] = useState(false);
  const [refInput, setRefInput] = useState('');
  const [conflictInput, setConflictInput] = useState('');

  const allCcIds = getAllNodeIds().filter(id => id.startsWith('cc-'));
  const allConflictIds = getAllConflictIds();

  const update = (updates: Partial<PovNode>) => {
    if (readOnly) return;
    updatePovNode(pov, node.id, updates);
  };

  const addRef = () => {
    if (refInput && !node.cross_cutting_refs.includes(refInput)) {
      update({ cross_cutting_refs: [...node.cross_cutting_refs, refInput] });
      setRefInput('');
    }
  };

  const removeRef = (ref: string) => {
    update({ cross_cutting_refs: node.cross_cutting_refs.filter(r => r !== ref) });
  };

  const addConflict = () => {
    if (conflictInput && !(node.conflict_ids || []).includes(conflictInput)) {
      update({ conflict_ids: [...(node.conflict_ids || []), conflictInput] });
      setConflictInput('');
    }
  };

  const removeConflict = (id: string) => {
    update({ conflict_ids: (node.conflict_ids || []).filter(c => c !== id) });
  };

  return (
    <div>
      <div className="detail-header">
        <h2>{node.id}</h2>
        <div className="detail-header-actions">
          {onPin && (
            <button className="btn btn-ghost btn-sm" onClick={onPin} title="Pin for comparison">
              Pin
            </button>
          )}
          {!readOnly && (
            <button className="btn btn-danger btn-sm" onClick={() => setShowDelete(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="detail-category-banner" data-cat={node.category}>
        {node.category}
      </div>

      <div className={`form-group ${validationErrors[`nodes.${node.id}.label`] ? 'has-error' : ''}`}>
        <label>Label</label>
        <HighlightedInput
          value={node.label}
          onChange={(v) => update({ label: v })}
          readOnly={readOnly}
        />
        {validationErrors[`nodes.${node.id}.label`] && (
          <div className="error-text">{validationErrors[`nodes.${node.id}.label`]}</div>
        )}
      </div>

      <div className={`form-group ${validationErrors[`nodes.${node.id}.description`] ? 'has-error' : ''}`}>
        <label>Description</label>
        <HighlightedTextarea
          value={node.description}
          onChange={(v) => update({ description: v })}
          rows={4}
          readOnly={readOnly}
        />
        {validationErrors[`nodes.${node.id}.description`] && (
          <div className="error-text">{validationErrors[`nodes.${node.id}.description`]}</div>
        )}
      </div>

      <div className="form-group">
        <label>Cross-Cutting Refs</label>
        <div className="chip-list">
          {node.cross_cutting_refs.map((ref) => (
            <span key={ref} className="chip">
              {ref}
              {!readOnly && <button onClick={() => removeRef(ref)}>x</button>}
            </span>
          ))}
        </div>
        {!readOnly && (
          <div className="chip-input-row">
            <select value={refInput} onChange={(e) => setRefInput(e.target.value)}>
              <option value="">Add reference...</option>
              {allCcIds
                .filter(id => !node.cross_cutting_refs.includes(id))
                .map(id => (
                  <option key={id} value={id}>{id}</option>
                ))}
            </select>
            <button className="btn btn-sm" onClick={addRef} disabled={!refInput}>Add</button>
          </div>
        )}
      </div>

      <div className="form-group">
        <label>Conflict IDs</label>
        <div className="chip-list">
          {(node.conflict_ids || []).map((id) => (
            <span key={id} className="chip">
              {id}
              {!readOnly && <button onClick={() => removeConflict(id)}>x</button>}
            </span>
          ))}
        </div>
        {!readOnly && (
          <div className="chip-input-row">
            <select value={conflictInput} onChange={(e) => setConflictInput(e.target.value)}>
              <option value="">Add conflict...</option>
              {allConflictIds
                .filter(id => !(node.conflict_ids || []).includes(id))
                .map(id => (
                  <option key={id} value={id}>{id}</option>
                ))}
            </select>
            <button className="btn btn-sm" onClick={addConflict} disabled={!conflictInput}>Add</button>
          </div>
        )}
      </div>

      {showDelete && !readOnly && (
        <DeleteConfirmDialog
          itemLabel={node.label}
          onConfirm={() => {
            deletePovNode(pov, node.id);
            setShowDelete(false);
          }}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}
