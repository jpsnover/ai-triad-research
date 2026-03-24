// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { CrossCuttingNode } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';
import { TypeaheadSelect } from './TypeaheadSelect';
import { FieldHelp } from './FieldHelp';
import { LinkedChip } from './LinkedChip';
import { GraphAttributesPanel } from './GraphAttributesPanel';
import { generateResearchPrompt } from '../utils/researchPrompt';

interface CrossCuttingDetailProps {
  node: CrossCuttingNode;
  readOnly?: boolean;
  onPin?: () => void;
  onRelated?: () => void;
  onDebate?: () => void;
  chipDepth?: number;
}

export function CrossCuttingDetail({ node, readOnly, onPin, onRelated, onDebate, chipDepth = 0 }: CrossCuttingDetailProps) {
  const { updateCrossCuttingNode, deleteCrossCuttingNode, validationErrors, getAllNodeIds, getAllConflictIds, runAttributeFilter, showAttributeInfo, navigateToLineage } = useTaxonomyStore();
  const [showDelete, setShowDelete] = useState(false);
  const [clipboardState, setClipboardState] = useState<'idle' | 'copied'>('idle');
  const formRef = useRef<HTMLDivElement>(null);

  const handleResearchPrompt = useCallback(async () => {
    const prompt = generateResearchPrompt(node.label, node.description);
    await navigator.clipboard.writeText(prompt);
    setClipboardState('copied');
    setTimeout(() => setClipboardState('idle'), 3000);
  }, [node.label, node.description]);

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
          <button
            className={`btn btn-sm${clipboardState === 'copied' ? ' btn-copied' : ' btn-ghost'}`}
            onClick={handleResearchPrompt}
            title="Generate a research prompt for this concept and copy to clipboard"
          >
            {clipboardState === 'copied' ? '\u2713 Copied!' : <><span className="btn-icon">&#9998;</span> Research</>}
          </button>
          {onDebate && (
            <button className="btn btn-ghost btn-sm" onClick={onDebate} title="Start a structured debate from this cross-cutting concern">
              <span className="btn-icon">&#9881;</span> Debate This
            </button>
          )}
          {onRelated && (
            <button className="btn btn-ghost btn-sm" onClick={onRelated} title="Show all edges connected to this node">
              <span className="btn-icon">&#8596;</span> Related
            </button>
          )}
          {onPin && (
            <button className="btn btn-ghost btn-sm" onClick={onPin} title="Pin for comparison">
              <span className="btn-icon">&#9744;</span> Pin
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
          rows={4}
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
