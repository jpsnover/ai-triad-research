// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ConflictFile, ConflictQbaf, DialecticTrace, DialecticTraceStep } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { ConflictInstanceForm, newEmptyInstance } from './ConflictInstanceForm';
import { ConflictNoteForm, newEmptyNote } from './ConflictNoteForm';
import { HighlightedInput, HighlightedTextarea } from './HighlightedField';
import { TypeaheadSelect } from './TypeaheadSelect';
import { FieldHelp } from './FieldHelp';
import { LinkedChip } from './LinkedChip';
import { generateConflictResearchPrompt } from '../utils/researchPrompt';
import { api } from '@bridge';

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
    await api.clipboardWriteText(prompt);
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

  // Derive related policies from linked taxonomy nodes
  const { policyRegistry } = useTaxonomyStore();
  const relatedPolicies = useMemo(() => {
    if (linkedNodes.length === 0) return [];
    const state = useTaxonomyStore.getState();
    const policyIdSet = new Set<string>();

    for (const povKey of ['accelerationist', 'safetyist', 'skeptic', 'situations'] as const) {
      const file = povKey === 'situations' ? state.situations : state[povKey];
      if (!file?.nodes) continue;
      for (const node of file.nodes) {
        if (!linkedNodes.includes(node.id)) continue;
        const ga = (node as { graph_attributes?: { policy_actions?: { policy_id?: string }[] } }).graph_attributes;
        if (ga?.policy_actions) {
          for (const action of ga.policy_actions) {
            if (action.policy_id) policyIdSet.add(action.policy_id);
          }
        }
      }
    }

    const policies: { id: string; action: string }[] = [];
    for (const id of policyIdSet) {
      const pol = policyRegistry?.find(p => p.id === id);
      policies.push({ id, action: pol?.action ?? id });
    }
    return policies.sort((a, b) => a.id.localeCompare(b.id));
  }, [linkedNodes, policyRegistry]);

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

        {/* Related Policies (derived from linked nodes) */}
        {relatedPolicies.length > 0 && (
          <div className="form-group">
            <label>Related Policies</label>
            <div className="conflict-related-policies">
              {relatedPolicies.map((pol) => (
                <span key={pol.id} className="conflict-policy-badge" title={pol.action}>
                  <span className="conflict-policy-badge-id">{pol.id}</span>
                  <span className="conflict-policy-badge-action">{pol.action}</span>
                </span>
              ))}
            </div>
          </div>
        )}

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

      {/* QBAF Analysis (Q-15a) — shown when qbaf field present and feature flag on */}
      {conflict.qbaf && useTaxonomyStore.getState().qbafEnabled && (
        <QbafConflictPanel qbaf={conflict.qbaf} />
      )}

      {/* Dialectic Trace — shown when verdict has a trace */}
      {conflict.verdict?.dialectic_trace && (
        <DialecticTracePanel trace={conflict.verdict.dialectic_trace} />
      )}

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

/** Mini QBAF argument map + resolution card for conflict detail */
function QbafConflictPanel({ qbaf }: { qbaf: ConflictQbaf }) {
  const { graph, resolution } = qbaf;

  function strengthBand(score: number): { label: string; cls: string } {
    if (score >= 0.8) return { label: 'Strong', cls: 'qbaf-strong' };
    if (score >= 0.5) return { label: 'Moderate', cls: 'qbaf-moderate' };
    if (score >= 0.3) return { label: 'Weak', cls: 'qbaf-weak' };
    return { label: 'Very Weak', cls: 'qbaf-very-weak' };
  }

  return (
    <div className="conflict-qbaf-panel">
      <div className="conflict-qbaf-header">QBAF Analysis</div>

      {/* Mini argument map — claims with strength badges */}
      <div className="conflict-qbaf-claims">
        {graph.nodes.map(node => {
          const band = strengthBand(node.computed_strength);
          const delta = node.computed_strength - node.base_strength;
          const isPrevailing = resolution?.prevailing_claim === node.id;
          return (
            <div key={node.id} className={`conflict-qbaf-claim ${isPrevailing ? 'conflict-qbaf-prevailing' : ''}`}>
              <span className="conflict-qbaf-pov">{node.source_pov.slice(0, 3).toUpperCase()}</span>
              {node.bdi_category && <span className="conflict-qbaf-bdi">{node.bdi_category[0].toUpperCase()}</span>}
              <span className="conflict-qbaf-text">{node.text.slice(0, 100)}{node.text.length > 100 ? '...' : ''}</span>
              <span className={`qbaf-badge ${band.cls}`} style={{ opacity: 0.3 + node.computed_strength * 0.7 }}>
                {band.label}
                {Math.abs(delta) > 0.1 && (
                  <span className={`qbaf-delta ${delta > 0 ? 'qbaf-delta-up' : 'qbaf-delta-down'}`}>
                    {delta > 0 ? '+' : ''}{delta.toFixed(2)}
                  </span>
                )}
              </span>
              {node.bdi_sub_scores && (
                <span className="conflict-qbaf-subscores" title={Object.entries(node.bdi_sub_scores).filter(([,v]) => v != null).map(([k,v]) => `${k}: ${v}`).join(', ')}>
                  [{Object.values(node.bdi_sub_scores).filter(v => v != null).map(v => (v as number).toFixed(1)).join('/')}]
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Edges */}
      {graph.edges.length > 0 && (
        <div className="conflict-qbaf-edges">
          {graph.edges.map((edge, i) => (
            <div key={i} className="conflict-qbaf-edge">
              <span className={`conflict-qbaf-edge-type ${edge.type === 'attacks' ? 'conflict-qbaf-attack' : 'conflict-qbaf-support'}`}>
                {edge.type === 'attacks' ? '\u2694' : '\u2764'} {edge.attack_type ?? edge.type}
              </span>
              <span className="conflict-qbaf-edge-weight">weight: {edge.weight.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Resolution card */}
      {resolution && (
        <div className="conflict-qbaf-resolution">
          <div className="conflict-qbaf-resolution-header">Resolution Analysis</div>
          <div className="conflict-qbaf-resolution-body">
            <span>Prevailing: <strong>{graph.nodes.find(n => n.id === resolution.prevailing_claim)?.text.slice(0, 60) ?? resolution.prevailing_claim}</strong></span>
            <span>Strength: {resolution.prevailing_strength.toFixed(2)} (margin: {resolution.margin.toFixed(2)})</span>
            <span>Criterion: {resolution.criterion.replace(/_/g, ' ')}</span>
          </div>
        </div>
      )}

      <div className="conflict-qbaf-meta">
        {qbaf.algorithm} &middot; {qbaf.iterations} iterations &middot; {new Date(qbaf.computed_at).toLocaleDateString()}
      </div>
    </div>
  );
}

/** Dialectic trace panel — shows the argument chain explaining why a position prevailed */
function DialecticTracePanel({ trace }: { trace: DialecticTrace }) {
  const ACTION_ICONS: Record<DialecticTraceStep['action'], string> = {
    asserted: '\u25B6',   // ▶
    attacked: '\u2694',   // ⚔
    supported: '\u2764',  // ❤
    conceded: '\u2714',   // ✔
    unaddressed: '\u2026', // …
  };

  const ACTION_COLORS: Record<DialecticTraceStep['action'], string> = {
    asserted: 'var(--text-secondary)',
    attacked: '#dc2626',
    supported: '#16a34a',
    conceded: '#d97706',
    unaddressed: 'var(--text-muted)',
  };

  return (
    <div className="conflict-trace-panel">
      <div className="conflict-trace-header">Dialectic Trace</div>
      <div className="conflict-trace-verdict">
        <span>Prevailing: <strong>{trace.prevailing}</strong></span>
        <span className="conflict-trace-criterion">{trace.criterion.replace(/_/g, ' ')}</span>
      </div>

      <div className="conflict-trace-steps">
        {trace.steps.map((step, i) => (
          <div key={i} className="conflict-trace-step">
            <div className="conflict-trace-step-gutter">
              <span className="conflict-trace-step-num">{step.step}</span>
              <span className="conflict-trace-connector" />
            </div>
            <div className="conflict-trace-step-body">
              <div className="conflict-trace-step-header">
                <span
                  className="conflict-trace-action"
                  style={{ color: ACTION_COLORS[step.action] }}
                >
                  {ACTION_ICONS[step.action]} {step.action}
                </span>
                <span className="conflict-trace-speaker">{step.speaker}</span>
                {step.scheme && (
                  <span className="conflict-trace-scheme">{step.scheme}</span>
                )}
                {step.attack_type && (
                  <span className="conflict-trace-attack-type">{step.attack_type}</span>
                )}
                {step.strength != null && (
                  <span className="conflict-trace-strength">{step.strength.toFixed(2)}</span>
                )}
              </div>
              <div className="conflict-trace-claim">{step.claim}</div>
              {step.responds_to && (
                <div className="conflict-trace-responds-to">responds to {step.responds_to}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="conflict-trace-meta">
        debate {trace.debate_id.slice(0, 12)} &middot; {new Date(trace.generated_at).toLocaleDateString()}
      </div>
    </div>
  );
}
