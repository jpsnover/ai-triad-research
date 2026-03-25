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

const STATUS_COLORS: Record<string, string> = {
  open: '#ef4444',
  resolved: '#16a34a',
  'wont-fix': '#d97706',
};

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

  const raw = conflict.linked_taxonomy_nodes;
  const linkedNodes = Array.isArray(raw) ? raw : raw ? [raw] : [];

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
    <div ref={formRef} className="conflict-detail">
      {/* Pill toolbar — matches POV/CC detail style */}
      <div className="node-detail-toolbar">
        <button
          className={`node-detail-pill${clipboardState === 'copied' ? ' node-detail-pill-active' : ''}`}
          onClick={handleResearchPrompt}
          title="Generate a research prompt and copy to clipboard"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          {clipboardState === 'copied' ? 'Copied!' : 'Research'}
        </button>
        {onPin && (
          <button className="node-detail-pill" onClick={onPin} title="Pin for comparison">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
            Pin
          </button>
        )}
        {!readOnly && (
          <button className="node-detail-pill" onClick={() => setShowDelete(true)} title="Delete conflict" style={{ color: '#dc2626', borderColor: '#dc2626' }}>
            Delete
          </button>
        )}
      </div>

      {hasErrors && (
        <div className="validation-banner">
          <span className="validation-banner-icon">!</span>
          Please fix the highlighted fields before saving.
        </div>
      )}

      {/* Title line — matches POV/CC banner style */}
      <div className="node-detail-title-line" data-cat="Conflict">
        <span className="node-detail-category">CONFLICT</span>
        <span className="node-detail-title-sep"> : </span>
        <span className="node-detail-label-text">{conflict.claim_label}</span>
      </div>

      {/* Body */}
      <div className="conflict-detail-body">
        {!readOnly && (
          <div className={`form-group ${err('claim_label') ? 'has-error' : ''}`}>
            <label>Claim Label</label>
            <HighlightedInput
              value={conflict.claim_label}
              onChange={(v) => update({ claim_label: v })}
            />
            {err('claim_label') && <div className="error-text">{err('claim_label')}</div>}
          </div>
        )}

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

        <div className="conflict-detail-row">
          <div className="form-group conflict-detail-status">
            <label>Status</label>
            <select
              className="conflict-status-select"
              value={conflict.status}
              onChange={(e) => update({ status: e.target.value as ConflictFile['status'] })}
              disabled={readOnly}
              style={{ borderLeftColor: STATUS_COLORS[conflict.status] || '#888', borderLeftWidth: 3 }}
            >
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="wont-fix">Won't Fix</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Linked Taxonomy Nodes</label>
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

        {/* Instances */}
        <div className="form-group">
          <label>
            Instances
            <span className="conflict-count-badge">{conflict.instances.length}</span>
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
          {!readOnly && (
            <button
              className="btn btn-sm conflict-add-btn"
              onClick={() => addConflictInstance(conflict.claim_id, newEmptyInstance())}
            >
              + Add Instance
            </button>
          )}
        </div>

        {/* Human Notes */}
        <div className="form-group">
          <label>Human Notes</label>
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
          {!readOnly && (
            <button
              className="btn btn-sm conflict-add-btn"
              onClick={() => addConflictNote(conflict.claim_id, newEmptyNote())}
            >
              + Add Note
            </button>
          )}
        </div>
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
