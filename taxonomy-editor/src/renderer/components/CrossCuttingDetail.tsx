import { useState } from 'react';
import type { CrossCuttingNode } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';

interface CrossCuttingDetailProps {
  node: CrossCuttingNode;
  readOnly?: boolean;
  onPin?: () => void;
}

export function CrossCuttingDetail({ node, readOnly, onPin }: CrossCuttingDetailProps) {
  const { updateCrossCuttingNode, deleteCrossCuttingNode, validationErrors, getAllNodeIds, getAllConflictIds } = useTaxonomyStore();
  const [showDelete, setShowDelete] = useState(false);
  const [linkedInput, setLinkedInput] = useState('');
  const [conflictInput, setConflictInput] = useState('');

  const allPovIds = getAllNodeIds().filter(id => !id.startsWith('cc-'));
  const allConflictIds = getAllConflictIds();

  const update = (updates: Partial<CrossCuttingNode>) => {
    if (readOnly) return;
    updateCrossCuttingNode(node.id, updates);
  };

  const updateInterpretation = (pov: 'accelerationist' | 'safetyist' | 'skeptic', value: string) => {
    update({
      interpretations: { ...node.interpretations, [pov]: value },
    });
  };

  const addLinked = () => {
    if (linkedInput && !node.linked_nodes.includes(linkedInput)) {
      update({ linked_nodes: [...node.linked_nodes, linkedInput] });
      setLinkedInput('');
    }
  };

  const removeLinked = (id: string) => {
    update({ linked_nodes: node.linked_nodes.filter(n => n !== id) });
  };

  const addConflict = () => {
    if (conflictInput && !node.conflict_ids.includes(conflictInput)) {
      update({ conflict_ids: [...node.conflict_ids, conflictInput] });
      setConflictInput('');
    }
  };

  const removeConflict = (id: string) => {
    update({ conflict_ids: node.conflict_ids.filter(c => c !== id) });
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

      <div className="form-group">
        <label>Label</label>
        <HighlightedInput
          value={node.label}
          onChange={(v) => update({ label: v })}
          readOnly={readOnly}
        />
      </div>

      <div className="form-group">
        <label>Description</label>
        <HighlightedTextarea
          value={node.description}
          onChange={(v) => update({ description: v })}
          rows={3}
          readOnly={readOnly}
        />
      </div>

      <div className="form-group">
        <label>Accelerationist Interpretation</label>
        <HighlightedTextarea
          value={node.interpretations.accelerationist}
          onChange={(v) => updateInterpretation('accelerationist', v)}
          rows={2}
          readOnly={readOnly}
          style={{ borderLeftColor: 'var(--color-acc)', borderLeftWidth: 3 }}
        />
      </div>

      <div className="form-group">
        <label>Safetyist Interpretation</label>
        <HighlightedTextarea
          value={node.interpretations.safetyist}
          onChange={(v) => updateInterpretation('safetyist', v)}
          rows={2}
          readOnly={readOnly}
          style={{ borderLeftColor: 'var(--color-saf)', borderLeftWidth: 3 }}
        />
      </div>

      <div className="form-group">
        <label>Skeptic Interpretation</label>
        <HighlightedTextarea
          value={node.interpretations.skeptic}
          onChange={(v) => updateInterpretation('skeptic', v)}
          rows={2}
          readOnly={readOnly}
          style={{ borderLeftColor: 'var(--color-skp)', borderLeftWidth: 3 }}
        />
      </div>

      <div className="form-group">
        <label>Linked Nodes</label>
        <div className="chip-list">
          {node.linked_nodes.map((id) => (
            <span key={id} className="chip">
              {id}
              {!readOnly && <button onClick={() => removeLinked(id)}>x</button>}
            </span>
          ))}
        </div>
        {!readOnly && (
          <div className="chip-input-row">
            <select value={linkedInput} onChange={(e) => setLinkedInput(e.target.value)}>
              <option value="">Add linked node...</option>
              {allPovIds
                .filter(id => !node.linked_nodes.includes(id))
                .map(id => (
                  <option key={id} value={id}>{id}</option>
                ))}
            </select>
            <button className="btn btn-sm" onClick={addLinked} disabled={!linkedInput}>Add</button>
          </div>
        )}
      </div>

      <div className="form-group">
        <label>Conflict IDs</label>
        <div className="chip-list">
          {node.conflict_ids.map((id) => (
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
                .filter(id => !node.conflict_ids.includes(id))
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
            deleteCrossCuttingNode(node.id);
            setShowDelete(false);
          }}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}
