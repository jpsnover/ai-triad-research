import { useState } from 'react';
import type { ConflictFile } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { ConflictInstanceForm, newEmptyInstance } from './ConflictInstanceForm';
import { ConflictNoteForm, newEmptyNote } from './ConflictNoteForm';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';

interface ConflictDetailProps {
  conflict: ConflictFile;
  readOnly?: boolean;
  onPin?: () => void;
}

export function ConflictDetail({ conflict, readOnly, onPin }: ConflictDetailProps) {
  const {
    updateConflict,
    deleteConflict,
    addConflictInstance,
    removeConflictInstance,
    updateConflictInstance,
    addConflictNote,
    removeConflictNote,
    updateConflictNote,
    getAllNodeIds,
  } = useTaxonomyStore();
  const [showDelete, setShowDelete] = useState(false);
  const [linkedInput, setLinkedInput] = useState('');

  const allNodeIds = getAllNodeIds();

  const update = (updates: Partial<ConflictFile>) => {
    if (readOnly) return;
    updateConflict(conflict.claim_id, updates);
  };

  const addLinked = () => {
    if (linkedInput && !conflict.linked_taxonomy_nodes.includes(linkedInput)) {
      update({ linked_taxonomy_nodes: [...conflict.linked_taxonomy_nodes, linkedInput] });
      setLinkedInput('');
    }
  };

  const removeLinked = (id: string) => {
    update({ linked_taxonomy_nodes: conflict.linked_taxonomy_nodes.filter(n => n !== id) });
  };

  const noopUpdate = () => {};
  const noopRemove = () => {};

  return (
    <div>
      <div className="detail-header">
        <h2>{conflict.claim_id}</h2>
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

      <div className="form-group">
        <label>Claim Label</label>
        <HighlightedInput
          value={conflict.claim_label}
          onChange={(v) => update({ claim_label: v })}
          readOnly={readOnly}
        />
      </div>

      <div className="form-group">
        <label>Description</label>
        <HighlightedTextarea
          value={conflict.description}
          onChange={(v) => update({ description: v })}
          rows={3}
          readOnly={readOnly}
        />
      </div>

      <div className="form-group">
        <label>Status</label>
        <select
          value={conflict.status}
          onChange={(e) => update({ status: e.target.value as ConflictFile['status'] })}
          disabled={readOnly}
        >
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="wont-fix">Won't Fix</option>
        </select>
      </div>

      <div className="form-group">
        <label>Linked Taxonomy Nodes</label>
        <div className="chip-list">
          {conflict.linked_taxonomy_nodes.map((id) => (
            <span key={id} className="chip">
              {id}
              {!readOnly && <button onClick={() => removeLinked(id)}>x</button>}
            </span>
          ))}
        </div>
        {!readOnly && (
          <div className="chip-input-row">
            <select value={linkedInput} onChange={(e) => setLinkedInput(e.target.value)}>
              <option value="">Add node...</option>
              {allNodeIds
                .filter(id => !conflict.linked_taxonomy_nodes.includes(id))
                .map(id => (
                  <option key={id} value={id}>{id}</option>
                ))}
            </select>
            <button className="btn btn-sm" onClick={addLinked} disabled={!linkedInput}>Add</button>
          </div>
        )}
      </div>

      <div className="form-group">
        <label>
          Instances
          {!readOnly && (
            <button
              className="btn btn-sm"
              style={{ marginLeft: 8 }}
              onClick={() => addConflictInstance(conflict.claim_id, newEmptyInstance())}
            >
              + Add
            </button>
          )}
        </label>
        {conflict.instances.map((inst, i) => (
          <ConflictInstanceForm
            key={i}
            instance={inst}
            index={i}
            onUpdate={readOnly ? noopUpdate : (idx, updates) => updateConflictInstance(conflict.claim_id, idx, updates)}
            onRemove={readOnly ? noopRemove : (idx) => removeConflictInstance(conflict.claim_id, idx)}
            readOnly={readOnly}
          />
        ))}
      </div>

      <div className="form-group">
        <label>
          Human Notes
          {!readOnly && (
            <button
              className="btn btn-sm"
              style={{ marginLeft: 8 }}
              onClick={() => addConflictNote(conflict.claim_id, newEmptyNote())}
            >
              + Add
            </button>
          )}
        </label>
        {conflict.human_notes.map((note, i) => (
          <ConflictNoteForm
            key={i}
            note={note}
            index={i}
            onUpdate={readOnly ? noopUpdate : (idx, updates) => updateConflictNote(conflict.claim_id, idx, updates)}
            onRemove={readOnly ? noopRemove : (idx) => removeConflictNote(conflict.claim_id, idx)}
            readOnly={readOnly}
          />
        ))}
      </div>

      {showDelete && !readOnly && (
        <DeleteConfirmDialog
          itemLabel={conflict.claim_label}
          onConfirm={() => {
            deleteConflict(conflict.claim_id);
            setShowDelete(false);
          }}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}
