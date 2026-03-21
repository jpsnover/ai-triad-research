// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Pov, PovNode, Category } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';
import { TypeaheadSelect } from './TypeaheadSelect';
import { FieldHelp } from './FieldHelp';
import { LinkedChip } from './LinkedChip';
import { GraphAttributesPanel } from './GraphAttributesPanel';
import { generateResearchPrompt } from '../utils/researchPrompt';

function OverflowMenu({ moveTargets, onMove, onDelete }: {
  moveTargets: string[];
  onMove: (cat: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="overflow-menu-wrapper" ref={menuRef}>
      <button className="btn btn-ghost btn-sm overflow-menu-trigger" onClick={() => setOpen(!open)} title="More actions">&hellip;</button>
      {open && (
        <div className="overflow-menu-dropdown">
          {moveTargets.map(cat => (
            <button key={cat} className="overflow-menu-item" onClick={() => { onMove(cat); setOpen(false); }}>
              Move to {cat}
            </button>
          ))}
          <div className="overflow-menu-divider" />
          <button className="overflow-menu-item overflow-menu-danger" onClick={() => { onDelete(); setOpen(false); }}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

interface NodeDetailProps {
  pov: Pov;
  node: PovNode;
  readOnly?: boolean;
  onPin?: () => void;
  onSimilarSearch?: () => void;
  onRelated?: () => void;
  chipDepth?: number;
}

export function NodeDetail({ pov, node, readOnly, onPin, onSimilarSearch, onRelated, chipDepth = 0 }: NodeDetailProps) {
  const { updatePovNode, deletePovNode, movePovNodeCategory, validationErrors, getAllNodeIds, getAllConflictIds, runAttributeFilter, showAttributeInfo } = useTaxonomyStore();
  const [showDelete, setShowDelete] = useState(false);
  const [clipboardState, setClipboardState] = useState<'idle' | 'copied'>('idle');
  const formRef = useRef<HTMLDivElement>(null);

  const handleResearchPrompt = useCallback(async () => {
    const prompt = generateResearchPrompt(node.label, node.description);
    await navigator.clipboard.writeText(prompt);
    setClipboardState('copied');
    setTimeout(() => setClipboardState('idle'), 3000);
  }, [node.label, node.description]);

  const ALL_CATEGORIES: Category[] = ['Goals/Values', 'Data/Facts', 'Methods/Arguments'];
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
          <button
            className={`btn btn-sm${clipboardState === 'copied' ? ' btn-copied' : ' btn-ghost'}`}
            onClick={handleResearchPrompt}
            title="Generate a research prompt for this position and copy to clipboard"
          >
            {clipboardState === 'copied' ? '\u2713 Copied! Paste into your AI tool' : 'Research'}
          </button>
          {onRelated && (
            <button className="btn btn-ghost btn-sm" onClick={onRelated} title="Show all edges connected to this node">
              Related
            </button>
          )}
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
            <OverflowMenu
              moveTargets={moveTargets}
              onMove={(cat) => movePovNodeCategory(pov, node.id, cat as Category)}
              onDelete={() => setShowDelete(true)}
            />
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

      {node.graph_attributes && (
        <GraphAttributesPanel attrs={node.graph_attributes} onBadgeClick={runAttributeFilter} onShowAttributeInfo={showAttributeInfo} />
      )}

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
