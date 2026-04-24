// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useDebateStore } from '../hooks/useDebateStore';
import type { ReflectionEdit, ReflectionResult } from '../hooks/useDebateStore';
import { POVER_INFO } from '../types/debate';
import type { PoverId } from '../types/debate';

const EDIT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  revise: { label: 'Revise', color: '#3b82f6' },
  add: { label: 'Add New', color: '#22c55e' },
  qualify: { label: 'Qualify', color: '#f59e0b' },
  deprecate: { label: 'Deprecate', color: '#ef4444' },
};

const CONFIDENCE_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: 'High', color: '#22c55e', bg: '#22c55e22' },
  medium: { label: 'Med', color: '#f59e0b', bg: '#f59e0b22' },
  low: { label: 'Low', color: '#ef4444', bg: '#ef444422' },
};

function EditCard({ edit, pover, editIndex }: {
  edit: ReflectionEdit;
  pover: string;
  editIndex: number;
}) {
  const { applyReflectionEdit, dismissReflectionEdit } = useDebateStore();
  const typeInfo = EDIT_TYPE_LABELS[edit.edit_type] || EDIT_TYPE_LABELS.revise;
  const resolved = edit.status !== 'pending';

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      border: `1px solid ${resolved ? 'var(--border-color)' : typeInfo.color}`,
      background: resolved ? 'var(--bg-secondary)' : 'var(--bg-primary)',
      opacity: resolved ? 0.6 : 1,
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          padding: '1px 6px', borderRadius: 4,
          fontSize: '0.65rem', fontWeight: 700,
          background: `${typeInfo.color}22`, color: typeInfo.color,
        }}>
          {typeInfo.label}
        </span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {edit.category}
        </span>
        {edit.node_id && (
          <code style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{edit.node_id}</code>
        )}
        {edit.confidence && CONFIDENCE_STYLES[edit.confidence] && (
          <span style={{
            padding: '1px 5px', borderRadius: 4,
            fontSize: '0.6rem', fontWeight: 700,
            background: CONFIDENCE_STYLES[edit.confidence].bg,
            color: CONFIDENCE_STYLES[edit.confidence].color,
            border: `1px solid ${CONFIDENCE_STYLES[edit.confidence].color}44`,
          }}>
            {CONFIDENCE_STYLES[edit.confidence].label}
          </span>
        )}
        {edit.status === 'approved' && (
          <span style={{ fontSize: '0.65rem', color: '#22c55e', fontWeight: 600, marginLeft: 'auto' }}>Applied</span>
        )}
        {edit.status === 'dismissed' && (
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>Dismissed</span>
        )}
      </div>

      {/* Label change */}
      <div style={{ fontSize: '0.75rem', marginBottom: 4 }}>
        {edit.current_label && edit.current_label !== edit.proposed_label ? (
          <>
            <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{edit.current_label}</span>
            {' → '}
            <span style={{ fontWeight: 600 }}>{edit.proposed_label}</span>
          </>
        ) : (
          <span style={{ fontWeight: 600 }}>{edit.proposed_label}</span>
        )}
      </div>

      {/* Description diff */}
      {edit.current_description && edit.edit_type !== 'add' && edit.current_description !== edit.proposed_description && (
        <div style={{
          fontSize: '0.7rem', padding: '4px 8px', marginBottom: 4,
          background: 'rgba(239,68,68,0.06)', borderRadius: 4,
          whiteSpace: 'pre-wrap', borderLeft: '3px solid rgba(239,68,68,0.3)',
        }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#ef4444', marginBottom: 2 }}>CURRENT</div>
          {edit.current_description}
        </div>
      )}
      <div style={{
        fontSize: '0.7rem', padding: '4px 8px',
        background: 'rgba(34,197,94,0.06)', borderRadius: 4,
        whiteSpace: 'pre-wrap', marginBottom: 6,
        borderLeft: edit.current_description && edit.edit_type !== 'add' ? '3px solid rgba(34,197,94,0.3)' : undefined,
      }}>
        {edit.current_description && edit.edit_type !== 'add' && edit.current_description !== edit.proposed_description && (
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#22c55e', marginBottom: 2 }}>PROPOSED</div>
        )}
        {edit.proposed_description}
      </div>

      {/* Rationale */}
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 4 }}>
        {edit.rationale}
      </div>

      {/* Evidence entries */}
      {edit.evidence_entries && edit.evidence_entries.length > 0 && (
        <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)', marginBottom: 8 }}>
          Evidence: {edit.evidence_entries.map((e, i) => (
            <code key={i} style={{
              padding: '0 4px', marginRight: 3, borderRadius: 3,
              background: 'var(--bg-secondary)', fontSize: '0.63rem',
            }}>{e}</code>
          ))}
        </div>
      )}

      {/* Actions */}
      {!resolved && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn btn-primary"
            style={{ fontSize: '0.7rem', padding: '3px 12px' }}
            onClick={() => applyReflectionEdit(pover, editIndex)}
          >
            Approve & Apply
          </button>
          <button
            className="btn"
            style={{ fontSize: '0.7rem', padding: '3px 10px' }}
            onClick={() => dismissReflectionEdit(pover, editIndex)}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function PoverReflection({ result }: { result: ReflectionResult }) {
  const info = POVER_INFO[result.pover as Exclude<PoverId, 'user'>];
  const color = info?.color || '#888';
  const pending = result.edits.filter(e => e.status === 'pending').length;
  const approved = result.edits.filter(e => e.status === 'approved').length;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 8, paddingBottom: 6,
        borderBottom: `2px solid ${color}`,
      }}>
        <span style={{ fontWeight: 700, color, fontSize: '0.85rem' }}>{result.label}</span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {result.edits.length} edit{result.edits.length !== 1 ? 's' : ''}
          {approved > 0 && ` (${approved} applied)`}
          {pending > 0 && pending !== result.edits.length && ` (${pending} pending)`}
        </span>
      </div>

      {result.reflection_summary && (
        <div style={{
          fontSize: '0.75rem', lineHeight: 1.5,
          padding: '8px 12px', marginBottom: 10,
          background: `${color}10`, borderLeft: `3px solid ${color}`,
          borderRadius: '0 6px 6px 0',
        }}>
          {result.reflection_summary}
        </div>
      )}

      {result.edits.length === 0 && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          No taxonomy edits proposed.
        </div>
      )}

      {result.edits.map((edit, i) => (
        <EditCard key={i} edit={edit} pover={result.pover} editIndex={i} />
      ))}
    </div>
  );
}

export function ReflectionsPanel({ onClose }: { onClose: () => void }) {
  const { reflections, debateGenerating, requestReflections, applyReflectionEdit, dismissReflectionEdit } = useDebateStore();
  const isGenerating = debateGenerating != null;

  const totalPending = reflections.reduce((sum, r) => sum + r.edits.filter(e => e.status === 'pending').length, 0);
  const totalApproved = reflections.reduce((sum, r) => sum + r.edits.filter(e => e.status === 'approved').length, 0);

  const approveAll = () => {
    for (const r of reflections) {
      r.edits.forEach((e, i) => {
        if (e.status === 'pending') applyReflectionEdit(r.pover, i);
      });
    }
  };

  const dismissAll = () => {
    for (const r of reflections) {
      r.edits.forEach((e, i) => {
        if (e.status === 'pending') dismissReflectionEdit(r.pover, i);
      });
    }
  };

  return (
    <div className="reflections-panel" style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)',
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: '90vw', maxWidth: 800, maxHeight: '85vh',
        background: 'var(--bg-primary)', borderRadius: 12,
        border: '1px solid var(--border-color)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-color)',
        }}>
          <h3 style={{ margin: 0, fontSize: '1rem', flex: 1 }}>Reflections</h3>
          {reflections.length > 0 && totalPending > 0 && (
            <>
              <button className="btn btn-primary" style={{ fontSize: '0.7rem', padding: '3px 10px' }} onClick={approveAll}>
                Approve All ({totalPending})
              </button>
              <button className="btn" style={{ fontSize: '0.7rem', padding: '3px 10px' }} onClick={dismissAll}>
                Dismiss All
              </button>
            </>
          )}
          {totalApproved > 0 && (
            <span style={{ fontSize: '0.7rem', color: '#22c55e' }}>{totalApproved} applied</span>
          )}
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}
          >&times;</button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {reflections.length === 0 && !isGenerating && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
                Ask each debater to reflect on the conversation and propose specific edits to their Beliefs, Desires, and Intentions taxonomy.
              </p>
              <button
                className="btn btn-primary"
                onClick={() => requestReflections()}
                style={{ fontSize: '0.8rem', padding: '8px 24px' }}
              >
                Start Reflections
              </button>
            </div>
          )}

          {isGenerating && reflections.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              Waiting for reflections...
            </div>
          )}

          {reflections.map((r) => (
            <PoverReflection key={r.pover} result={r} />
          ))}
        </div>
      </div>
    </div>
  );
}
