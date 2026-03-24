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

interface MoveTarget {
  label: string;
  action: () => void;
  isTransfer?: boolean;
}

function OverflowMenu({ moveTargets, onDelete }: {
  moveTargets: MoveTarget[];
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

  // Group: same-POV category moves first, then cross-POV transfers
  const categoryMoves = moveTargets.filter(t => !t.isTransfer);
  const transfers = moveTargets.filter(t => t.isTransfer);

  return (
    <div className="overflow-menu-wrapper" ref={menuRef}>
      <button className="btn btn-ghost btn-sm overflow-menu-trigger" onClick={() => setOpen(!open)} title="More actions">&hellip;</button>
      {open && (
        <div className="overflow-menu-dropdown">
          {categoryMoves.map(t => (
            <button key={t.label} className="overflow-menu-item" onClick={() => { t.action(); setOpen(false); }}>
              Move to {t.label}
            </button>
          ))}
          {transfers.length > 0 && (
            <>
              <div className="overflow-menu-divider" />
              <div className="overflow-menu-section-label">Transfer to</div>
              {transfers.map(t => (
                <button key={t.label} className="overflow-menu-item overflow-menu-transfer" onClick={() => { t.action(); setOpen(false); }}>
                  {t.label}
                </button>
              ))}
            </>
          )}
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

const ALL_CATEGORIES: Category[] = ['Goals/Values', 'Data/Facts', 'Methods/Arguments'];
const ALL_POVS: Pov[] = ['accelerationist', 'safetyist', 'skeptic'];
const POV_LABELS: Record<Pov, string> = {
  accelerationist: 'Accelerationist',
  safetyist: 'Safetyist',
  skeptic: 'Skeptic',
};

export function NodeDetail({ pov, node, readOnly, onPin, onSimilarSearch, onRelated, chipDepth = 0 }: NodeDetailProps) {
  const { updatePovNode, deletePovNode, movePovNodeCategory, movePovNode, validationErrors, getAllNodeIds, getAllConflictIds, runAttributeFilter, showAttributeInfo, navigateToLineage, setToolbarPanel } = useTaxonomyStore();
  const [showDelete, setShowDelete] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const setSelectedNodeId = useTaxonomyStore((s) => s.setSelectedNodeId);
  const handleResearchPrompt = useCallback(() => {
    setSelectedNodeId(node.id);
    setToolbarPanel('prompts');
  }, [node.id, setSelectedNodeId, setToolbarPanel]);

  // Same-POV category moves
  const categoryMoveTargets: MoveTarget[] = ALL_CATEGORIES
    .filter(c => c !== node.category)
    .map(c => ({ label: c, action: () => movePovNodeCategory(pov, node.id, c) }));

  // Cross-POV transfers (every other POV × every category)
  const transferTargets: MoveTarget[] = ALL_POVS
    .filter(p => p !== pov)
    .flatMap(p => ALL_CATEGORIES.map(c => ({
      label: `${POV_LABELS[p]} / ${c}`,
      action: () => movePovNode(pov, node.id, p, c),
      isTransfer: true,
    })));

  const moveTargets = [...categoryMoveTargets, ...transferTargets];

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
            className="btn btn-ghost btn-sm"
            onClick={handleResearchPrompt}
            title="Open research prompt editor for this position"
          >
            <span className="btn-icon">&#9998;</span> Research
          </button>
          {onRelated && (
            <button className="btn btn-ghost btn-sm" onClick={onRelated} title="Show all edges connected to this node">
              <span className="btn-icon">&#8596;</span> Related
            </button>
          )}
          {onSimilarSearch && (
            <button className="btn btn-ghost btn-sm" onClick={onSimilarSearch} title="Find similar taxonomy elements">
              <span className="btn-icon">&#8981;</span> Similar Search
            </button>
          )}
          {onPin && (
            <button className="btn btn-ghost btn-sm" onClick={onPin} title="Pin for comparison">
              <span className="btn-icon">&#9744;</span> Pin
            </button>
          )}
          {!readOnly && (
            <OverflowMenu
              moveTargets={moveTargets}
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
          rows={5}
          readOnly={readOnly}
        />
        {err('description') && <div className="error-text">{err('description')}</div>}
      </div>

      {node.graph_attributes?.steelman_vulnerability && (
        <div className="form-group">
          <label>Steelman Vulnerability</label>
          <div className="ga-promoted-text">{node.graph_attributes.steelman_vulnerability}</div>
        </div>
      )}

      {node.graph_attributes?.intellectual_lineage && node.graph_attributes.intellectual_lineage.length > 0 && (
        <div className="form-group">
          <label>Intellectual Lineage</label>
          <div className="ga-promoted-list">
            {node.graph_attributes.intellectual_lineage.map((l, i) => (
              <span
                key={i}
                className="ga-promoted-chip ga-promoted-chip-interactive"
                onClick={(e) => { e.stopPropagation(); navigateToLineage(l); }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); showAttributeInfo('intellectual_lineage', l); }}
                title={`Click to view lineage info: "${l}"`}
              >
                {l}
              </span>
            ))}
          </div>
        </div>
      )}

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
