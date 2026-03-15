// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ConflictFile } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { ConflictInstanceForm, newEmptyInstance } from './ConflictInstanceForm';
import { ConflictNoteForm, newEmptyNote } from './ConflictNoteForm';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';
import { TypeaheadSelect } from './TypeaheadSelect';
import { FieldHelp } from './FieldHelp';
import { LinkedChip } from './LinkedChip';
import { generateConflictResearchPrompt } from '../utils/researchPrompt';

interface ConflictDetailProps {
  conflict: ConflictFile;
  readOnly?: boolean;
  onPin?: () => void;
  chipDepth?: number;
}

export function ConflictDetail({ conflict, readOnly, onPin, chipDepth = 0 }: ConflictDetailProps) {
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
    validationErrors,
  } = useTaxonomyStore();
  const [showDelete, setShowDelete] = useState(false);
  const [clipboardState, setClipboardState] = useState<'idle' | 'copied'>('idle');
  const formRef = useRef<HTMLDivElement>(null);

  const handleResearchPrompt = useCallback(async () => {
    const instances = (conflict.instances || []).map((i) => ({
      doc_id: i.doc_id,
      assertion: i.assertion,
      stance: i.stance,
    }));
    const prompt = generateConflictResearchPrompt(
      conflict.claim_label,
      conflict.description,
      instances,
    );
    await navigator.clipboard.writeText(prompt);
    setClipboardState('copied');
    setTimeout(() => setClipboardState('idle'), 3000);
  }, [conflict.claim_label, conflict.description, conflict.instances]);

  const allNodeIds = getAllNodeIds();

  const prefix = conflict.claim_id;
  const err = (field: string) => validationErrors[`${prefix}.${field}`];
  const hasErrors = Object.keys(validationErrors).some(k => k.startsWith(`${prefix}.`));

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

  const update = (updates: Partial<ConflictFile>) => {
    if (readOnly) return;
    updateConflict(conflict.claim_id, updates);
  };

  const linkedNodes = conflict.linked_taxonomy_nodes || [];

  const addLinked = (id: string) => {
    if (id && !linkedNodes.includes(id)) {
      update({ linked_taxonomy_nodes: [...linkedNodes, id] });
    }
  };

  const removeLinked = (id: string) => {
    update({ linked_taxonomy_nodes: linkedNodes.filter(n => n !== id) });
  };

  const noopUpdate = () => {};
  const noopRemove = () => {};

  return (
    <div ref={formRef}>
      <div className="detail-header">
        <h2>{conflict.claim_id}</h2>
        <div className="detail-header-actions">
          <button
            className={`btn btn-sm${clipboardState === 'copied' ? ' btn-copied' : ' btn-ghost'}`}
            onClick={handleResearchPrompt}
            title="Generate a research prompt for this conflict and copy to clipboard"
          >
            {clipboardState === 'copied' ? '\u2713 Copied! Paste into your AI tool' : 'Research'}
          </button>
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

      <div className={`form-group ${err('claim_label') ? 'has-error' : ''}`}>
        <label>
          Claim Label
          <FieldHelp text="A short, human-readable name for this conflict claim that summarizes the disputed point." />
        </label>
        <HighlightedInput
          value={conflict.claim_label}
          onChange={(v) => update({ claim_label: v })}
          readOnly={readOnly}
        />
        {err('claim_label') && <div className="error-text">{err('claim_label')}</div>}
      </div>

      <div className={`form-group ${err('description') ? 'has-error' : ''}`}>
        <label>Description</label>
        <HighlightedTextarea
          value={conflict.description}
          onChange={(v) => update({ description: v })}
          rows={3}
          readOnly={readOnly}
        />
        {err('description') && <div className="error-text">{err('description')}</div>}
      </div>

      <div className="form-group">
        <label>
          Status
          <FieldHelp text="Open: actively disputed. Resolved: consensus reached. Won't Fix: acknowledged but intentionally unresolved." />
        </label>
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
        <label>
          Linked Taxonomy Nodes
          <FieldHelp text="POV and cross-cutting nodes that are involved in or affected by this conflict." />
        </label>
        <div className="chip-list">
          {linkedNodes.map((id) => (
            <LinkedChip key={id} id={id} depth={chipDepth} readOnly={readOnly} onRemove={removeLinked} />
          ))}
        </div>
        {!readOnly && (
          <TypeaheadSelect
            options={allNodeIds.filter(id => !linkedNodes.includes(id))}
            onSelect={addLinked}
            placeholder="Search nodes..."
          />
        )}
      </div>

      <div className="form-group">
        <label>
          Instances
          <FieldHelp text="Specific occurrences in source documents where this conflict was identified. Each instance records a document's stance and assertion." />
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
            errorPrefix={`${prefix}.instances.${i}`}
          />
        ))}
      </div>

      <div className="form-group">
        <label>
          Human Notes
          <FieldHelp text="Analyst commentary on this conflict: observations, proposed resolutions, or contextual notes." />
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
            errorPrefix={`${prefix}.human_notes.${i}`}
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
