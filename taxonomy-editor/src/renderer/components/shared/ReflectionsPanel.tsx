// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { useShallow } from 'zustand/react/shallow';
import type { ReflectionEdit, ReflectionResult } from '../../hooks/useDebateStore';
import type { NewPovItemProposal } from '@lib/debate/types/session';
import { POVER_INFO } from '../../types/debate';
import type { SpeakerId } from '../../types/debate';
import { checkDolceCompliance, type ComplianceViolation } from '../../utils/dolceCompliance';
import { DescriptionToggle, resolveDescription, useDescriptionMode } from './DescriptionToggle';
import { generatePlainPreview } from '../../utils/regeneratePlainDescription';

const PREFIX_TO_POV: Record<string, 'accelerationist' | 'safetyist' | 'skeptic'> = { acc: 'accelerationist', saf: 'safetyist', skp: 'skeptic' };

/** Scroll the debate transcript to the referenced evidence entry (e.g. "S13" or "Moderator Round 4"). */
function scrollToEvidence(entry: string) {
  // Try direct statement ID first (e.g. "S13")
  const el = document.getElementById(`stmt-${entry}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.outline = '2px solid var(--color-acc, #3b82f6)';
    setTimeout(() => { el.style.outline = ''; }, 2000);
    return;
  }
  // Try parsing "Speaker Round N" format → find the Nth statement by that speaker
  const match = entry.match(/^(.+?)\s+Round\s+(\d+)$/i);
  if (match) {
    const speaker = match[1].toLowerCase();
    const round = parseInt(match[2], 10);
    const cards = document.querySelectorAll<HTMLElement>('[data-entry-id]');
    let count = 0;
    for (const card of cards) {
      const speakerEl = card.querySelector('.debate-statement-speaker');
      if (speakerEl && speakerEl.textContent?.toLowerCase().includes(speaker)) {
        count++;
        if (count === round) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.style.outline = '2px solid var(--color-acc, #3b82f6)';
          setTimeout(() => { card.style.outline = ''; }, 2000);
          return;
        }
      }
    }
  }
}

const EDIT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  revise: { label: 'Revise', color: '#3b82f6' },
  add: { label: 'Add New', color: '#22c55e' },
  qualify: { label: 'Qualify', color: '#f59e0b' },
  deprecate: { label: 'Deprecate', color: '#ef4444' },
};

function diffWords(oldText: string, newText: string): Array<{ text: string; type: 'same' | 'added' }> {
  const oldTokens = oldText.split(/(\s+)/);
  const newTokens = newText.split(/(\s+)/);
  const m = oldTokens.length, n = newTokens.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldTokens[i - 1] === newTokens[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);

  const raw: Array<{ text: string; type: 'same' | 'added' | 'removed' }> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      raw.push({ text: newTokens[j - 1], type: 'same' });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ text: newTokens[j - 1], type: 'added' });
      j--;
    } else {
      raw.push({ text: oldTokens[i - 1], type: 'removed' });
      i--;
    }
  }
  raw.reverse();

  const merged: Array<{ text: string; type: 'same' | 'added' }> = [];
  for (const seg of raw) {
    if (seg.type === 'removed') continue;
    const last = merged.length > 0 ? merged[merged.length - 1] : null;
    if (last && last.type === seg.type) last.text += seg.text;
    else merged.push({ text: seg.text, type: seg.type });
  }
  return merged;
}

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
  const { applyReflectionEdit, retryReflectionEditAfterFix, dismissReflectionEdit, retryEnrichment, clearEnrichmentStatus, anNodes, enrichmentStatus } = useDebateStore(
    useShallow(s => ({
      applyReflectionEdit: s.applyReflectionEdit,
      retryReflectionEditAfterFix: s.retryReflectionEditAfterFix,
      dismissReflectionEdit: s.dismissReflectionEdit,
      retryEnrichment: s.retryEnrichment,
      clearEnrichmentStatus: s.clearEnrichmentStatus,
      anNodes: (s.activeDebate as unknown as Record<string, unknown> | null)?.argument_network
        ? ((s.activeDebate as unknown as Record<string, unknown>).argument_network as { nodes: { id: string; text: string; speaker: string; attribution_text_genus?: string }[] }).nodes
        : [],
      enrichmentStatus: s.enrichmentStatus,
    }))
  );
  const [trackedEnrichNodeId, setTrackedEnrichNodeId] = useState<string | null>(null);
  const enrichNodeId = trackedEnrichNodeId ?? (edit.edit_type !== 'add' ? edit.node_id : null);
  const enrichStatus = enrichNodeId ? enrichmentStatus[enrichNodeId] : undefined;
  const typeInfo = EDIT_TYPE_LABELS[edit.edit_type] || EDIT_TYPE_LABELS.revise;
  const resolved = edit.status !== 'pending';

  const [expandedEvidence, setExpandedEvidence] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [editedLabel, setEditedLabel] = useState(edit.proposed_label);
  const [editedDescription, setEditedDescription] = useState(edit.proposed_description);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  // AC2 (t/1563): honor the app-wide description-mode preference (defaults to plain,
  // remembers the user's choice) instead of hard-coding 'formal'.
  const [descMode, setDescMode] = useDescriptionMode();
  const currentNode = useTaxonomyStore(useShallow(s => {
    if (!edit.node_id || edit.edit_type === 'add') return null;
    const prefix = edit.node_id.split('-')[0];
    const pov = PREFIX_TO_POV[prefix];
    if (!pov) return null;
    const file = s[pov];
    return file?.nodes?.find((n: { id: string }) => n.id === edit.node_id) ?? null;
  }));
  const [fixing, setFixing] = useState(false);
  // Integrity failures (e.g. dangling CONVERGES_WITH edges) are auto-fixable via "Fix it".
  const isIntegrityError = !!applyError && applyError.startsWith('Integrity check failed');
  const [regeneratePhrases, setRegeneratePhrases] = useState(false);
  const showRegenerateToggle = !resolved && (edit.edit_type === 'revise' || edit.edit_type === 'qualify');
  const [plainPreview, setPlainPreview] = useState<string | null>(null);
  const [plainLoading, setPlainLoading] = useState(false);
  const [plainError, setPlainError] = useState(false);
  const navigateToNode = useTaxonomyStore(s => s.navigateToNode);

  // AC1/AC3 (t/1563): generate the plain (vernacular) preview for a NEW ('add')
  // proposal on demand. Used both by the on-render effect and the Retry button.
  // generatePlainPreview() returns null on AI/vernacular-model failure — surface
  // that as plainError rather than silently falling back to the formal text.
  const plainSource = editing ? editedDescription : edit.proposed_description;
  const runPlainPreview = useCallback(async () => {
    setPlainLoading(true);
    setPlainError(false);
    try {
      const preview = await generatePlainPreview(plainSource);
      if (preview == null) setPlainError(true);
      else setPlainPreview(preview);
    } catch (err) {
      setPlainError(true);
      getGlobalRecorder()?.record({ type: 'system.error', component: 'reflections-panel', level: 'warn', message: 'Plain preview generation failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    } finally {
      setPlainLoading(false);
    }
  }, [plainSource]);

  // AC1 (t/1563): trigger generation when a new proposal is *displayed* in plain
  // mode — not only on an explicit toggle click. Skips if already generated, in
  // flight, or previously failed (Retry clears plainError to re-arm this).
  useEffect(() => {
    if (edit.edit_type === 'add' && descMode === 'plain' && !resolved
        && !plainPreview && !plainLoading && !plainError) {
      void runPlainPreview();
    }
  }, [edit.edit_type, descMode, resolved, plainPreview, plainLoading, plainError, runPlainPreview]);

  const isModified = editedLabel !== edit.proposed_label
                  || editedDescription !== edit.proposed_description;

  const complianceViolations = useMemo(
    () => checkDolceCompliance(editing ? editedDescription : edit.proposed_description, edit.node_id || ''),
    [editing, editedDescription, edit.proposed_description, edit.node_id],
  );
  const complianceErrors = complianceViolations.filter(v => v.severity === 'error');
  const complianceWarnings = complianceViolations.filter(v => v.severity === 'warning');

  const handleReset = () => {
    setEditedLabel(edit.proposed_label);
    setEditedDescription(edit.proposed_description);
    setRegeneratePhrases(false);
  };

  const handleCancel = () => {
    handleReset();
    setEditing(false);
  };

  const isEmpty = editing && (
    (edit.edit_type === 'add' && !editedLabel.trim()) || !editedDescription.trim()
  );

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
          fontSize: 'var(--text-2xs)', fontWeight: 700,
          background: `${typeInfo.color}22`, color: typeInfo.color,
        }}>
          {typeInfo.label}
        </span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {edit.category}
        </span>
        {edit.node_id && edit.edit_type !== 'add' && (
          <code style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{edit.node_id}</code>
        )}
        {edit.confidence && CONFIDENCE_STYLES[edit.confidence] && (
          <span style={{
            padding: '1px 5px', borderRadius: 4,
            fontSize: 'var(--text-2xs)', fontWeight: 700,
            background: CONFIDENCE_STYLES[edit.confidence].bg,
            color: CONFIDENCE_STYLES[edit.confidence].color,
            border: `1px solid ${CONFIDENCE_STYLES[edit.confidence].color}44`,
          }}>
            {CONFIDENCE_STYLES[edit.confidence].label}
          </span>
        )}
        {edit.status === 'approved' && (
          <span style={{ fontSize: 'var(--text-2xs)', color: '#22c55e', fontWeight: 600, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            Applied
            {edit.edit_type === 'add' && trackedEnrichNodeId && (
              <code
                style={{ fontSize: 'var(--text-2xs)', padding: '1px 5px', borderRadius: 3, background: '#22c55e22', cursor: 'pointer' }}
                title={`Navigate to ${trackedEnrichNodeId}`}
                onClick={() => {
                  const prefix = trackedEnrichNodeId.split('-')[0];
                  const tab = PREFIX_TO_POV[prefix];
                  if (tab) navigateToNode(tab, trackedEnrichNodeId);
                }}
              >{trackedEnrichNodeId}</code>
            )}
          </span>
        )}
        {edit.status === 'dismissed' && (
          <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginLeft: 'auto' }}>Dismissed</span>
        )}
      </div>

      {/* Label change */}
      <div style={{ fontSize: '0.75rem', marginBottom: 4 }}>
        {editing ? (
          <>
            {edit.current_label && (
              <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{edit.current_label}{' → '}</span>
            )}
            <input
              type="text"
              value={editedLabel}
              onChange={e => setEditedLabel(e.target.value)}
              style={{
                fontSize: '0.75rem', fontWeight: 600,
                padding: '2px 6px', borderRadius: 4,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)', color: 'var(--text-primary)',
                width: '60%',
              }}
            />
          </>
        ) : edit.current_label && edit.current_label !== edit.proposed_label ? (
          <>
            <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{edit.current_label}</span>
            {' → '}
            <span
              style={{ fontWeight: 600, cursor: resolved ? undefined : 'pointer', borderBottom: resolved ? undefined : '1px dashed var(--text-muted)' }}
              title={resolved ? undefined : 'Click to edit label'}
              onClick={resolved ? undefined : () => setEditing(true)}
            >{editedLabel}</span>
          </>
        ) : (
          <span
            style={{ fontWeight: 600, cursor: resolved ? undefined : 'pointer', borderBottom: resolved ? undefined : '1px dashed var(--text-muted)' }}
            title={resolved ? undefined : 'Click to edit label'}
            onClick={resolved ? undefined : () => setEditing(true)}
          >{editedLabel}</span>
        )}
      </div>

      {/* Description diff */}
      {edit.current_description && edit.edit_type !== 'add' && edit.current_description !== edit.proposed_description && (() => {
        const resolved_desc = resolveDescription(
          currentNode ? { description: edit.current_description, plain_description: (currentNode as { plain_description?: string | null }).plain_description } : { description: edit.current_description },
          descMode,
        );
        return (
          <div style={{
            fontSize: '0.7rem', padding: '4px 8px', marginBottom: 4,
            background: 'rgba(239,68,68,0.06)', borderRadius: 4,
            whiteSpace: 'pre-wrap', borderLeft: '3px solid rgba(239,68,68,0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: '#ef4444' }}>CURRENT</span>
              <DescriptionToggle
                mode={descMode}
                onToggle={setDescMode}
                hasPlainDescription={!!(currentNode as { plain_description?: string | null } | null)?.plain_description}
              />
            </div>
            {resolved_desc.isGenerating && (
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 2 }}>
                Plain description generating…
              </div>
            )}
            {resolved_desc.text}
          </div>
        );
      })()}

      {editing ? (
        /* Edit mode — editable textarea with blue EDITED styling */
        <div style={{
          fontSize: '0.7rem', padding: '4px 8px',
          background: 'rgba(59,130,246,0.06)', borderRadius: 4,
          marginBottom: 6,
          borderLeft: '3px solid rgba(59,130,246,0.3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: '#3b82f6' }}>EDITED</span>
            {isModified && (
              <span style={{
                padding: '0 4px', borderRadius: 4,
                fontSize: 'var(--text-2xs)', fontWeight: 600,
                background: '#3b82f6', color: '#fff',
              }}>Modified</span>
            )}
          </div>
          <textarea
            value={editedDescription}
            onChange={e => setEditedDescription(e.target.value)}
            style={{
              width: '100%', minHeight: 60, maxHeight: 300,
              fontSize: '0.7rem', padding: '4px 6px',
              border: '1px solid var(--border-color)', borderRadius: 4,
              background: 'var(--bg-primary)', color: 'var(--text-primary)',
              resize: 'vertical', fontFamily: 'inherit',
              lineHeight: 1.5,
            }}
          />
        </div>
      ) : (
        /* Review mode — diff-highlighted PROPOSED */
        <div style={{
          fontSize: '0.7rem', padding: '4px 8px',
          background: 'rgba(34,197,94,0.06)', borderRadius: 4,
          whiteSpace: 'pre-wrap', marginBottom: 6,
          borderLeft: edit.current_description && edit.edit_type !== 'add' ? '3px solid rgba(34,197,94,0.3)' : undefined,
        }}>
          {edit.current_description && edit.edit_type !== 'add' && edit.current_description !== edit.proposed_description ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: '#22c55e' }}>PROPOSED</span>
                {!resolved && (
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ fontSize: 'var(--text-2xs)', padding: '0 4px', marginLeft: 'auto' }}
                    onClick={() => setEditing(true)}
                  >&#9998; Edit</button>
                )}
              </div>
              {descMode === 'formal' ? diffWords(edit.current_description, edit.proposed_description).map((seg, i) =>
                seg.type === 'added'
                  ? <mark key={i} style={{ background: 'rgba(34,197,94,0.25)', color: 'inherit', borderRadius: 2, padding: '0 1px' }}>{seg.text}</mark>
                  : <span key={i}>{seg.text}</span>
              ) : edit.proposed_description}
            </>
          ) : (
            <>
              {!resolved && edit.proposed_description && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  {edit.edit_type === 'add' && (
                    <DescriptionToggle
                      mode={descMode}
                      onToggle={setDescMode}
                      hasPlainDescription={!!plainPreview}
                    />
                  )}
                  <span style={{ flex: 1 }} />
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ fontSize: 'var(--text-2xs)', padding: '0 4px' }}
                    onClick={() => setEditing(true)}
                  >&#9998; Edit</button>
                </div>
              )}
              {descMode === 'plain' && edit.edit_type === 'add' ? (
                plainLoading
                  ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Generating plain description…</span>
                  : plainError
                    ? (
                      <>
                        <div style={{ color: '#ef4444', fontSize: 'var(--text-2xs)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{'⚠'} Couldn&apos;t generate a plain description. Showing formal:</span>
                          <button
                            className="btn btn-sm"
                            style={{ fontSize: 'var(--text-2xs)', padding: '0 8px' }}
                            onClick={() => { void runPlainPreview(); }}
                          >Retry</button>
                        </div>
                        {edit.proposed_description}
                      </>
                    )
                    : (plainPreview ?? edit.proposed_description)
              ) : edit.proposed_description}
            </>
          )}
        </div>
      )}

      {/* DOLCE compliance */}
      {complianceViolations.length > 0 && (
        <div style={{
          fontSize: 'var(--text-2xs)', padding: '4px 8px', marginBottom: 6,
          background: complianceErrors.length > 0 ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)',
          borderRadius: 4,
          borderLeft: `3px solid ${complianceErrors.length > 0 ? 'rgba(239,68,68,0.4)' : 'rgba(245,158,11,0.4)'}`,
        }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--text-2xs)', color: complianceErrors.length > 0 ? '#ef4444' : '#f59e0b', marginBottom: 3 }}>
            DOLCE Compliance ({complianceErrors.length} error{complianceErrors.length !== 1 ? 's' : ''}, {complianceWarnings.length} warning{complianceWarnings.length !== 1 ? 's' : ''})
          </div>
          {complianceViolations.map((v, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'baseline', marginBottom: 1 }}>
              <span style={{ color: v.severity === 'error' ? '#ef4444' : '#f59e0b', fontWeight: 700, flexShrink: 0 }}>
                {v.severity === 'error' ? '\u2717' : '\u26A0'}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                <strong>{v.rule}</strong>: {v.message}
              </span>
            </div>
          ))}
        </div>
      )}
      {complianceViolations.length === 0 && (
        <div style={{
          fontSize: 'var(--text-2xs)', padding: '3px 8px', marginBottom: 6,
          color: '#22c55e', fontWeight: 600,
        }}>
          {'\u2713'} DOLCE compliant
        </div>
      )}

      {/* Rationale */}
      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-primary)', fontStyle: 'italic', marginBottom: 4 }}>
        {edit.rationale}
      </div>

      {/* Evidence entries */}
      {edit.evidence_entries && edit.evidence_entries.length > 0 && (
        <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 8 }}>
          <div>Evidence: {edit.evidence_entries.map((e, i) => (
            <button
              key={i}
              className="btn btn-sm btn-ghost"
              style={{
                padding: '0 4px', marginRight: 3, borderRadius: 3,
                background: expandedEvidence.has(e) ? 'var(--color-acc, #3b82f6)' : 'var(--bg-secondary)',
                color: expandedEvidence.has(e) ? '#fff' : 'var(--color-acc, #3b82f6)',
                fontSize: 'var(--text-2xs)',
                fontFamily: 'monospace', cursor: 'pointer',
                textDecoration: expandedEvidence.has(e) ? 'none' : 'underline',
              }}
              title={expandedEvidence.has(e) ? `Hide ${e} text` : `Show ${e} text (Shift+click to scroll)`}
              onClick={(ev) => {
                if (ev.shiftKey) { scrollToEvidence(e); return; }
                setExpandedEvidence(prev => {
                  const next = new Set(prev);
                  if (next.has(e)) next.delete(e); else next.add(e);
                  return next;
                });
              }}
            >{e}</button>
          ))}</div>
          {edit.evidence_entries.filter(e => expandedEvidence.has(e)).map(e => {
            const node = anNodes.find(n => n.id === e);
            if (!node) return null;
            return (
              <div key={e} style={{
                marginTop: 4, padding: '4px 8px', borderRadius: 4,
                background: 'var(--bg-secondary)', borderLeft: '3px solid var(--color-acc, #3b82f6)',
                fontSize: 'var(--text-2xs)', lineHeight: 1.4, color: 'var(--text-primary)',
              }}>
                <span style={{ fontWeight: 700, fontFamily: 'monospace', marginRight: 4 }}>{e}</span>
                <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>({node.speaker})</span>
                {node.text}
                {node.attribution_text_genus && <div className="claim-attribution-text"><span className="claim-attribution-label">Attribution:</span>{node.attribution_text_genus}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Regenerate phrases toggle — revise/qualify only */}
      {showRegenerateToggle && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={regeneratePhrases}
            onChange={e => setRegeneratePhrases(e.target.checked)}
            style={{ margin: 0 }}
          />
          Regenerate phrases & embeddings
        </label>
      )}

      {/* Actions */}
      {!resolved && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn btn-primary"
            style={{ fontSize: '0.7rem', padding: '3px 12px' }}
            disabled={isEmpty || applying}
            onClick={async () => {
              setApplying(true);
              setApplyError(null);
              try {
                const result = await applyReflectionEdit(pover, editIndex,
                  editing && isModified ? { label: editedLabel, description: editedDescription } : undefined,
                  { regeneratePhrases },
                );
                if (!result.ok) {
                  setApplyError(result.error ?? 'Save failed — check SaveBar for details');
                } else if (result.enrichNodeId) {
                  setTrackedEnrichNodeId(result.enrichNodeId);
                }
              } catch (err) {
                getGlobalRecorder()?.record({ type: 'system.error', component: 'reflections-panel', level: 'error', message: 'reflection edit apply failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
                setApplyError(String(err));
              } finally {
                setApplying(false);
              }
            }}
          >
            {applying ? 'Saving…' : 'Approve & Apply'}
          </button>
          {editing && isModified && (
            <button
              className="btn"
              style={{ fontSize: '0.7rem', padding: '3px 10px' }}
              onClick={handleReset}
            >
              Reset
            </button>
          )}
          {editing && (
            <button
              className="btn"
              style={{ fontSize: '0.7rem', padding: '3px 10px' }}
              onClick={handleCancel}
            >
              Cancel
            </button>
          )}
          <button
            className="btn"
            style={{ fontSize: '0.7rem', padding: '3px 10px' }}
            onClick={() => dismissReflectionEdit(pover, editIndex)}
          >
            Dismiss
          </button>
        </div>
      )}
      {/* Enrichment status indicator */}
      {enrichStatus?.status === 'pending' && (
        <div style={{ fontSize: 'var(--text-2xs)', color: '#3b82f6', marginTop: 4, padding: '4px 8px', background: 'rgba(59,130,246,0.06)', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ animation: 'pulse 1.5s infinite', display: 'inline-block' }}>{'⧗'}</span>
          Enriching node — generating attributes & phrases…
        </div>
      )}
      {enrichStatus?.status === 'success' && (
        <div style={{ fontSize: 'var(--text-2xs)', color: '#22c55e', marginTop: 4, padding: '4px 8px', background: 'rgba(34,197,94,0.06)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {'✓'} Phrases regenerated successfully
            {edit.edit_type === 'add' && trackedEnrichNodeId && (
              <code
                style={{ fontSize: 'var(--text-2xs)', padding: '1px 6px', borderRadius: 4, background: '#22c55e22', color: '#22c55e', cursor: 'pointer', fontWeight: 600 }}
                title={`Navigate to ${trackedEnrichNodeId}`}
                onClick={() => {
                  const prefix = trackedEnrichNodeId.split('-')[0];
                  const tab = PREFIX_TO_POV[prefix];
                  if (tab) navigateToNode(tab, trackedEnrichNodeId);
                }}
              >{trackedEnrichNodeId}</code>
            )}
          </span>
          <button
            className="btn btn-sm btn-ghost"
            style={{ fontSize: 'var(--text-2xs)', padding: '0 4px', color: 'var(--text-muted)' }}
            onClick={() => enrichNodeId && clearEnrichmentStatus(enrichNodeId)}
          >{'✕'}</button>
        </div>
      )}
      {enrichStatus?.status === 'error' && (
        <div style={{ fontSize: 'var(--text-2xs)', color: '#ef4444', marginTop: 4, padding: '4px 8px', background: 'rgba(239,68,68,0.06)', borderRadius: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{'✗'} Enrichment failed: {enrichStatus.error}</span>
            <button
              className="btn btn-sm"
              style={{ fontSize: 'var(--text-2xs)', padding: '1px 8px', marginLeft: 8 }}
              onClick={() => {
                if (!enrichNodeId) return;
                const povKey = pover as 'accelerationist' | 'safetyist' | 'skeptic';
                void retryEnrichment(enrichNodeId, povKey);
              }}
            >Retry</button>
          </div>
        </div>
      )}
      {applyError && (
        <div style={{ color: '#ef4444', fontSize: '0.7rem', marginTop: 4, padding: '6px 8px', background: 'rgba(239,68,68,0.08)', borderRadius: 4, whiteSpace: 'pre-line' }}>
          <div>{applyError}</div>
          {isIntegrityError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <button
                className="btn btn-sm"
                style={{ fontSize: 'var(--text-2xs)', padding: '2px 10px' }}
                disabled={fixing}
                title="Remove the dangling references blocking this save, then retry"
                onClick={async () => {
                  setFixing(true);
                  try {
                    const result = await retryReflectionEditAfterFix(pover, editIndex);
                    if (result.ok) setApplyError(null);
                    else setApplyError(result.error ?? 'Fix failed — check SaveBar for details');
                  } catch (err) {
                    getGlobalRecorder()?.record({ type: 'system.error', component: 'reflections-panel', level: 'error', message: 'fix-it retry failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
                    setApplyError(String(err));
                  } finally {
                    setFixing(false);
                  }
                }}
              >
                {fixing ? 'Fixing…' : 'Fix it'}
              </button>
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>
                Removes edges that point to nonexistent nodes, then saves.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PoverReflection({ result }: { result: ReflectionResult }) {
  const info = POVER_INFO[result.pover as Exclude<SpeakerId, 'user'>];
  const color = info?.color || '#888';
  const pending = result.edits.filter(e => e.status === 'pending').length;
  const approved = result.edits.filter(e => e.status === 'approved').length;
  const proposals = result.new_item_proposals ?? [];

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
          {proposals.length > 0 && ` · ${proposals.length} new item${proposals.length !== 1 ? 's' : ''}`}
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

      {result.edits.length === 0 && proposals.length === 0 && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          No taxonomy edits proposed.
        </div>
      )}

      {result.edits.map((edit, i) => (
        <EditCard key={i} edit={edit} pover={result.pover} editIndex={i} />
      ))}

      {proposals.map((p, i) => (
        <ProposalCard key={`prop-${i}`} proposal={p} pover={result.pover} proposalIndex={i} />
      ))}
    </div>
  );
}

// ── Propose-new item card (t/1773) ──────────────────────
// Renders a `NewPovItemProposal`: the new node's fields + its proposed edges, with
// Approve/Dismiss. Exclusive vs edit_existing (this is the sole new-node path; add is
// retired). Applying it creates the node AND persists its edges atomically (ruling B).

const NEW_ITEM_COLOR = '#22c55e';

function ProposalCard({ proposal, pover, proposalIndex }: {
  proposal: NewPovItemProposal;
  pover: string;
  proposalIndex: number;
}) {
  const { applyReflectionProposal, dismissReflectionProposal, status } = useDebateStore(
    useShallow(s => ({
      applyReflectionProposal: s.applyReflectionProposal,
      dismissReflectionProposal: s.dismissReflectionProposal,
      status: s.newItemProposalStatus[`${pover}#${proposalIndex}`],
    }))
  );
  const navigateToNode = useTaxonomyStore(s => s.navigateToNode);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [createdNodeId, setCreatedNodeId] = useState<string | null>(null);
  const resolved = status === 'approved' || status === 'dismissed';
  const info = POVER_INFO[proposal.pov as Exclude<SpeakerId, 'user'>];

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      border: `1px solid ${resolved ? 'var(--border-color)' : NEW_ITEM_COLOR}`,
      background: resolved ? 'var(--bg-secondary)' : 'var(--bg-primary)',
      opacity: resolved ? 0.6 : 1,
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          padding: '1px 6px', borderRadius: 4,
          fontSize: 'var(--text-2xs)', fontWeight: 700,
          background: `${NEW_ITEM_COLOR}22`, color: NEW_ITEM_COLOR,
        }}>New Item</span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{proposal.category}</span>
        <span style={{ fontSize: 'var(--text-2xs)', color: info?.color || 'var(--text-muted)', fontWeight: 600 }}>
          {info?.label || proposal.pov}
        </span>
        {status === 'approved' && (
          <span style={{ fontSize: 'var(--text-2xs)', color: '#22c55e', fontWeight: 600, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            Applied
            {createdNodeId && (
              <code
                style={{ fontSize: 'var(--text-2xs)', padding: '1px 5px', borderRadius: 3, background: '#22c55e22', cursor: 'pointer' }}
                title={`Navigate to ${createdNodeId}`}
                onClick={() => {
                  const tab = PREFIX_TO_POV[createdNodeId.split('-')[0]];
                  if (tab) navigateToNode(tab, createdNodeId);
                }}
              >{createdNodeId}</code>
            )}
          </span>
        )}
        {status === 'dismissed' && (
          <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginLeft: 'auto' }}>Dismissed</span>
        )}
      </div>

      {/* Label */}
      <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>{proposal.label}</div>

      {/* Description */}
      <div style={{
        fontSize: '0.7rem', padding: '4px 8px',
        background: 'rgba(34,197,94,0.06)', borderRadius: 4,
        whiteSpace: 'pre-wrap', marginBottom: 6,
        borderLeft: '3px solid rgba(34,197,94,0.3)',
      }}>{proposal.description}</div>

      {/* Proposed edges — the new node is always connected (anti-orphan, t/1725) */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 3 }}>
          Proposed edges ({proposal.proposed_edges.length})
        </div>
        {proposal.proposed_edges.map((e, i) => (
          <div key={i} style={{
            fontSize: 'var(--text-2xs)', padding: '3px 8px', marginBottom: 3,
            background: 'var(--bg-secondary)', borderRadius: 4,
            borderLeft: '3px solid var(--color-acc, #3b82f6)',
          }}>
            <div style={{ fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {e.new_node_role === 'source' ? (
                <>
                  <span style={{ fontWeight: 700 }}>[new item]</span>
                  <span style={{ color: 'var(--color-acc, #3b82f6)' }}>—{e.edge_type}→</span>
                  <code>{e.target_node_id}</code>
                </>
              ) : (
                <>
                  <code>{e.target_node_id}</code>
                  <span style={{ color: 'var(--color-acc, #3b82f6)' }}>—{e.edge_type}→</span>
                  <span style={{ fontWeight: 700 }}>[new item]</span>
                </>
              )}
            </div>
            {e.rationale && (
              <div style={{ color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>{e.rationale}</div>
            )}
          </div>
        ))}
      </div>

      {/* Rationale */}
      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-primary)', fontStyle: 'italic', marginBottom: 6 }}>
        {proposal.rationale}
      </div>

      {/* Actions */}
      {!resolved && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn btn-primary"
            style={{ fontSize: '0.7rem', padding: '3px 12px' }}
            disabled={applying}
            onClick={async () => {
              setApplying(true);
              setApplyError(null);
              try {
                const result = await applyReflectionProposal(pover, proposalIndex);
                if (!result.ok) setApplyError(result.error ?? 'Save failed — check SaveBar for details');
                else if (result.createdNodeId) setCreatedNodeId(result.createdNodeId);
              } catch (err) {
                getGlobalRecorder()?.record({ type: 'system.error', component: 'reflections-panel', level: 'error', message: 'reflection proposal apply failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
                setApplyError(String(err));
              } finally {
                setApplying(false);
              }
            }}
          >{applying ? 'Saving…' : 'Approve & Apply'}</button>
          <button
            className="btn"
            style={{ fontSize: '0.7rem', padding: '3px 10px' }}
            onClick={() => dismissReflectionProposal(pover, proposalIndex)}
          >Dismiss</button>
        </div>
      )}
      {applyError && (
        <div style={{ color: '#ef4444', fontSize: '0.7rem', marginTop: 4, padding: '6px 8px', background: 'rgba(239,68,68,0.08)', borderRadius: 4, whiteSpace: 'pre-line' }}>
          {applyError}
        </div>
      )}
    </div>
  );
}

export function ReflectionsPanel({ onClose }: { onClose: () => void }) {
  const { reflections, newItemProposalStatus, debateGenerating, requestReflections, applyReflectionEdit, dismissReflectionEdit, applyReflectionProposal, dismissReflectionProposal } = useDebateStore(
    useShallow(s => ({ reflections: s.reflections, newItemProposalStatus: s.newItemProposalStatus, debateGenerating: s.debateGenerating, requestReflections: s.requestReflections, applyReflectionEdit: s.applyReflectionEdit, dismissReflectionEdit: s.dismissReflectionEdit, applyReflectionProposal: s.applyReflectionProposal, dismissReflectionProposal: s.dismissReflectionProposal }))
  );
  const isGenerating = debateGenerating != null;

  // Pending/applied counts span both edit_existing edits and propose_new proposals (t/1773).
  const proposalIsPending = (pover: string, i: number) => !newItemProposalStatus[`${pover}#${i}`];
  const totalPending = reflections.reduce((sum, r) =>
    sum + r.edits.filter(e => e.status === 'pending').length
        + (r.new_item_proposals ?? []).filter((_, i) => proposalIsPending(r.pover, i)).length, 0);
  const totalApproved = reflections.reduce((sum, r) =>
    sum + r.edits.filter(e => e.status === 'approved').length
        + (r.new_item_proposals ?? []).filter((_, i) => newItemProposalStatus[`${r.pover}#${i}`] === 'approved').length, 0);

  const approveAll = async () => {
    for (const r of reflections) {
      for (let i = 0; i < r.edits.length; i++) {
        if (r.edits[i].status === 'pending') await applyReflectionEdit(r.pover, i);
      }
      const proposals = r.new_item_proposals ?? [];
      for (let i = 0; i < proposals.length; i++) {
        if (proposalIsPending(r.pover, i)) await applyReflectionProposal(r.pover, i);
      }
    }
  };

  const dismissAll = () => {
    for (const r of reflections) {
      r.edits.forEach((e, i) => {
        if (e.status === 'pending') dismissReflectionEdit(r.pover, i);
      });
      (r.new_item_proposals ?? []).forEach((_, i) => {
        if (proposalIsPending(r.pover, i)) dismissReflectionProposal(r.pover, i);
      });
    }
  };

  // Drag state
  const [pos, setPos] = useState({ x: 0, y: 0 }); // offset from center
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag from header area, not buttons
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  }, [pos.x, pos.y]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
      });
    };
    const onMouseUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <div className="reflections-panel" style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <div style={{
        width: 800, height: '85vh',
        minWidth: 400, minHeight: 300,
        maxWidth: '95vw', maxHeight: '95vh',
        resize: 'both', overflow: 'hidden',
        background: 'var(--bg-primary)', borderRadius: 12,
        border: '1px solid var(--border-color)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
        pointerEvents: 'auto',
        transform: `translate(${pos.x}px, ${pos.y}px)`,
      }}>
        {/* Header — drag handle */}
        <div
          onMouseDown={onMouseDown}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color)',
            cursor: dragRef.current ? 'grabbing' : 'grab',
            userSelect: 'none',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '1rem', flex: 1 }}>Post-Debate Reflections</h3>
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
                Start Post-Debate Reflections
              </button>
            </div>
          )}

          {isGenerating && reflections.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              Waiting for reflections...
            </div>
          )}

          {reflections.length > 1 && (
            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 8, padding: '4px 8px', background: 'var(--bg-subtle)', borderRadius: 4 }}>
              Reflection order: {reflections.map((r, i) => r.label).join(' → ')}. Each camp sees prior camps&apos; proposals to avoid duplicating the same concept.
            </div>
          )}
          {reflections.map((r, ri) => (
            <PoverReflection key={r.pover} result={r} />
          ))}
        </div>
      </div>
    </div>
  );
}
