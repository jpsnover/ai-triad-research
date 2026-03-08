// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef } from 'react';
import type { CrossCuttingNode } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';
import { TypeaheadSelect } from './TypeaheadSelect';
import { FieldHelp } from './FieldHelp';
import { LinkedChip } from './LinkedChip';
import { GraphAttributesPanel } from './GraphAttributesPanel';

interface CrossCuttingDetailProps {
  node: CrossCuttingNode;
  readOnly?: boolean;
  onPin?: () => void;
  chipDepth?: number;
}

export function CrossCuttingDetail({ node, readOnly, onPin, chipDepth = 0 }: CrossCuttingDetailProps) {
  const { updateCrossCuttingNode, deleteCrossCuttingNode, validationErrors, getAllNodeIds, getAllConflictIds, runAttributeFilter, showAttributeInfo } = useTaxonomyStore();
  const [showDelete, setShowDelete] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const allPovIds = getAllNodeIds().filter(id => !id.startsWith('cc-'));
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

  const update = (updates: Partial<CrossCuttingNode>) => {
    if (readOnly) return;
    updateCrossCuttingNode(node.id, updates);
  };

  const updateInterpretation = (pov: 'accelerationist' | 'safetyist' | 'skeptic', value: string) => {
    update({
      interpretations: { ...node.interpretations, [pov]: value },
    });
  };

  const addLinked = (id: string) => {
    if (id && !node.linked_nodes.includes(id)) {
      update({ linked_nodes: [...node.linked_nodes, id] });
    }
  };

  const removeLinked = (id: string) => {
    update({ linked_nodes: node.linked_nodes.filter(n => n !== id) });
  };

  const addConflict = (id: string) => {
    if (id && !node.conflict_ids.includes(id)) {
      update({ conflict_ids: [...node.conflict_ids, id] });
    }
  };

  const removeConflict = (id: string) => {
    update({ conflict_ids: node.conflict_ids.filter(c => c !== id) });
  };

  return (
    <div ref={formRef}>
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

      {hasErrors && (
        <div className="validation-banner">
          <span className="validation-banner-icon">!</span>
          Please fix the highlighted fields before saving.
        </div>
      )}

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
          rows={3}
          readOnly={readOnly}
        />
        {err('description') && <div className="error-text">{err('description')}</div>}
      </div>

      <div className={`form-group ${err('interpretations.accelerationist') ? 'has-error' : ''}`}>
        <label>
          Accelerationist Interpretation
          <FieldHelp text="How the Accelerationist perspective understands or frames this cross-cutting concept." />
        </label>
        <HighlightedTextarea
          value={node.interpretations.accelerationist}
          onChange={(v) => updateInterpretation('accelerationist', v)}
          rows={2}
          readOnly={readOnly}
          style={{ borderLeftColor: 'var(--color-acc)', borderLeftWidth: 3 }}
        />
        {err('interpretations.accelerationist') && <div className="error-text">{err('interpretations.accelerationist')}</div>}
      </div>

      <div className={`form-group ${err('interpretations.safetyist') ? 'has-error' : ''}`}>
        <label>
          Safetyist Interpretation
          <FieldHelp text="How the Safetyist perspective understands or frames this cross-cutting concept." />
        </label>
        <HighlightedTextarea
          value={node.interpretations.safetyist}
          onChange={(v) => updateInterpretation('safetyist', v)}
          rows={2}
          readOnly={readOnly}
          style={{ borderLeftColor: 'var(--color-saf)', borderLeftWidth: 3 }}
        />
        {err('interpretations.safetyist') && <div className="error-text">{err('interpretations.safetyist')}</div>}
      </div>

      <div className={`form-group ${err('interpretations.skeptic') ? 'has-error' : ''}`}>
        <label>
          Skeptic Interpretation
          <FieldHelp text="How the Skeptic perspective understands or frames this cross-cutting concept." />
        </label>
        <HighlightedTextarea
          value={node.interpretations.skeptic}
          onChange={(v) => updateInterpretation('skeptic', v)}
          rows={2}
          readOnly={readOnly}
          style={{ borderLeftColor: 'var(--color-skp)', borderLeftWidth: 3 }}
        />
        {err('interpretations.skeptic') && <div className="error-text">{err('interpretations.skeptic')}</div>}
      </div>

      <div className="form-group">
        <label>
          Linked Nodes
          <FieldHelp text="POV-specific nodes that relate to this cross-cutting concept. Links this shared theme to specific perspective claims." />
        </label>
        <div className="chip-list">
          {node.linked_nodes.map((id) => (
            <LinkedChip key={id} id={id} depth={chipDepth} readOnly={readOnly} onRemove={removeLinked} />
          ))}
        </div>
        {!readOnly && (
          <TypeaheadSelect
            options={allPovIds.filter(id => !node.linked_nodes.includes(id))}
            onSelect={addLinked}
            placeholder="Search linked nodes..."
          />
        )}
      </div>

      <div className="form-group">
        <label>
          Conflict IDs
          <FieldHelp text="Links to documented conflicts where this cross-cutting concept is a point of disagreement between perspectives." />
        </label>
        <div className="chip-list">
          {node.conflict_ids.map((id) => (
            <LinkedChip key={id} id={id} depth={chipDepth} readOnly={readOnly} onRemove={removeConflict} />
          ))}
        </div>
        {!readOnly && (
          <TypeaheadSelect
            options={allConflictIds.filter(id => !node.conflict_ids.includes(id))}
            onSelect={addConflict}
            placeholder="Search conflicts..."
          />
        )}
      </div>

      {node.graph_attributes && (
        <GraphAttributesPanel attrs={node.graph_attributes} onBadgeClick={runAttributeFilter} onShowAttributeInfo={showAttributeInfo} />
      )}

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
