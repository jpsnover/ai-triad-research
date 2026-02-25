import { useState, useEffect, useRef } from 'react';
import type { Pov, PovNode, Category } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';
import { TypeaheadSelect } from './TypeaheadSelect';
import { FieldHelp } from './FieldHelp';
import { LinkedChip } from './LinkedChip';

interface NodeDetailProps {
  pov: Pov;
  node: PovNode;
  readOnly?: boolean;
  onPin?: () => void;
  onSimilarSearch?: () => void;
  chipDepth?: number;
}

export function NodeDetail({ pov, node, readOnly, onPin, onSimilarSearch, chipDepth = 0 }: NodeDetailProps) {
  const { updatePovNode, deletePovNode, movePovNodeCategory, validationErrors, getAllNodeIds, getAllConflictIds } = useTaxonomyStore();
  const [showDelete, setShowDelete] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const ALL_CATEGORIES: Category[] = ['Goals/Values', 'Data/Facts', 'Methods'];
  const moveTargets = ALL_CATEGORIES.filter(c => c !== node.category);

  const allCcIds = getAllNodeIds().filter(id => id.startsWith('cc-'));
  const allConflictIds = getAllConflictIds();

  const err = (field: string) => validationErrors[`nodes.${node.id}.${field}`];
  const hasErrors = Object.keys(validationErrors).some(k => k.startsWith(`nodes.${node.id}.`));

  useEffect(() => {
    if (hasErrors && formRef.current) {
      const firstError = formRef.current.querySelector('.has-error');
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const input = firstError.querySelector<HTMLElement>('input, textarea');
        input?.focus();
      }
    }
  }, [hasErrors]);

  const update = (updates: Partial<PovNode>) => {
    if (readOnly) return;
    updatePovNode(pov, node.id, updates);
  };

  const addRef = (id: string) => {
    if (id && !node.cross_cutting_refs.includes(id)) {
      update({ cross_cutting_refs: [...node.cross_cutting_refs, id] });
    }
  };

  const removeRef = (ref: string) => {
    update({ cross_cutting_refs: node.cross_cutting_refs.filter(r => r !== ref) });
  };

  const addConflict = (id: string) => {
    if (id && !(node.conflict_ids || []).includes(id)) {
      update({ conflict_ids: [...(node.conflict_ids || []), id] });
    }
  };

  const removeConflict = (id: string) => {
    update({ conflict_ids: (node.conflict_ids || []).filter(c => c !== id) });
  };

  return (
    <div ref={formRef}>
      <div className="detail-header">
        <h2>{node.id}</h2>
        <div className="detail-header-actions">
          {onSimilarSearch && (
            <button className="btn btn-ghost btn-sm" onClick={onSimilarSearch} title="Find similar taxonomy elements">
              Similar Search
            </button>
          )}
          {onPin && (
            <button className="btn btn-ghost btn-sm" onClick={onPin} title="Pin for comparison">
              Pin
            </button>
          )}
          {!readOnly && (
            <select
              className="move-select"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  movePovNodeCategory(pov, node.id, e.target.value as Category);
                }
              }}
            >
              <option value="" disabled>Move to...</option>
              {moveTargets.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          )}
          {!readOnly && (
            <button className="btn btn-danger btn-sm" onClick={() => setShowDelete(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      {hasErrors && (
        <div className="validation-banner">
          <span className="validation-banner-icon">!</span>
          Please fix the highlighted fields before saving.
        </div>
      )}

      <div className="detail-category-banner" data-cat={node.category}>
        {node.category}
      </div>

      <div className={`form-group ${err('label') ? 'has-error' : ''}`}>
        <label>Label</label>
        <HighlightedInput
          value={node.label}
          onChange={(v) => update({ label: v })}
          readOnly={readOnly}
        />
        {err('label') && <div className="error-text">{err('label')}</div>}
      </div>

      <div className={`form-group ${err('description') ? 'has-error' : ''}`}>
        <label>Description</label>
        <HighlightedTextarea
          value={node.description}
          onChange={(v) => update({ description: v })}
          rows={4}
          readOnly={readOnly}
        />
        {err('description') && <div className="error-text">{err('description')}</div>}
      </div>

      <div className="form-group">
        <label>
          Cross-Cutting Refs
          <FieldHelp text="Links to cross-cutting concepts that span all three perspectives. These connect this node to shared themes." />
        </label>
        <div className="chip-list">
          {node.cross_cutting_refs.map((ref) => (
            <LinkedChip key={ref} id={ref} depth={chipDepth} readOnly={readOnly} onRemove={removeRef} />
          ))}
        </div>
        {!readOnly && (
          <TypeaheadSelect
            options={allCcIds.filter(id => !node.cross_cutting_refs.includes(id))}
            onSelect={addRef}
            placeholder="Search cross-cutting refs..."
          />
        )}
      </div>

      <div className="form-group">
        <label>
          Conflict IDs
          <FieldHelp text="Links to documented conflicts where this node's claims are contested or contradicted by other perspectives." />
        </label>
        <div className="chip-list">
          {(node.conflict_ids || []).map((id) => (
            <LinkedChip key={id} id={id} depth={chipDepth} readOnly={readOnly} onRemove={removeConflict} />
          ))}
        </div>
        {!readOnly && (
          <TypeaheadSelect
            options={allConflictIds.filter(id => !(node.conflict_ids || []).includes(id))}
            onSelect={addConflict}
            placeholder="Search conflicts..."
          />
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
