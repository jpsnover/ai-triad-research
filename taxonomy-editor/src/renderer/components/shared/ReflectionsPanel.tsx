// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import './ReflectionsPanel.css';
import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { useShallow } from 'zustand/react/shallow';
import type { ReflectionEdit, ReflectionResult, ConsensusCluster } from '../../hooks/useDebateStore';
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
    <div
      className="rp-edit-card"
      /* eslint-disable-next-line local/no-inline-style -- CSS custom properties carry per-edit-type/resolved-state colors computed from typeInfo/resolved (data-driven, not enumerable as static classes) */
      style={{
        '--rp-card-border': resolved ? 'var(--border-color)' : typeInfo.color,
        '--rp-card-bg': resolved ? 'var(--bg-secondary)' : 'var(--bg-primary)',
        '--rp-card-opacity': resolved ? 0.6 : 1,
      } as React.CSSProperties}
    >
      <div className="rp-edit-card-header-row">
        <span
          className="rp-type-badge"
          // eslint-disable-next-line local/no-inline-style -- badge color derives from EDIT_TYPE_LABELS[edit.edit_type], a data-driven value
          style={{ '--rp-badge-bg': `${typeInfo.color}22`, '--rp-badge-fg': typeInfo.color } as React.CSSProperties}
        >
          {typeInfo.label}
        </span>
        <span className="rp-text-muted-xs">
          {edit.category}
        </span>
        {edit.node_id && edit.edit_type !== 'add' && (
          <code className="rp-text-muted-2xs">{edit.node_id}</code>
        )}
        {edit.confidence && CONFIDENCE_STYLES[edit.confidence] && (
          <span
            className="rp-confidence-badge"
            // eslint-disable-next-line local/no-inline-style -- badge colors derive from CONFIDENCE_STYLES[edit.confidence], a data-driven value
            style={{
              '--rp-conf-bg': CONFIDENCE_STYLES[edit.confidence].bg,
              '--rp-conf-fg': CONFIDENCE_STYLES[edit.confidence].color,
              '--rp-conf-border': `${CONFIDENCE_STYLES[edit.confidence].color}44`,
            } as React.CSSProperties}
          >
            {CONFIDENCE_STYLES[edit.confidence].label}
          </span>
        )}
        {edit.status === 'approved' && (
          <span className="rp-applied-badge">
            Applied
            {edit.edit_type === 'add' && trackedEnrichNodeId && (
              <code
                className="rp-node-chip"
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
          <span className="rp-dismissed-badge">Dismissed</span>
        )}
      </div>

      {/* Label change */}
      <div className="rp-label-row">
        {editing ? (
          <>
            {edit.current_label && (
              <span className="rp-strike-muted">{edit.current_label}{' → '}</span>
            )}
            <input
              type="text"
              value={editedLabel}
              onChange={e => setEditedLabel(e.target.value)}
              className="rp-label-input"
            />
          </>
        ) : edit.current_label && edit.current_label !== edit.proposed_label ? (
          <>
            <span className="rp-strike-muted">{edit.current_label}</span>
            {' → '}
            <span
              className={`rp-editable-label${resolved ? '' : ' rp-editable-label--clickable'}`}
              title={resolved ? undefined : 'Click to edit label'}
              onClick={resolved ? undefined : () => setEditing(true)}
            >{editedLabel}</span>
          </>
        ) : (
          <span
            className={`rp-editable-label${resolved ? '' : ' rp-editable-label--clickable'}`}
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
          <div className="rp-current-desc-box">
            <div className="rp-flexrow-6-2">
              <span className="rp-section-label rp-section-label--current">CURRENT</span>
              <DescriptionToggle
                mode={descMode}
                onToggle={setDescMode}
                hasPlainDescription={!!(currentNode as { plain_description?: string | null } | null)?.plain_description}
              />
            </div>
            {resolved_desc.isGenerating && (
              <div className="rp-generating-note">
                Plain description generating…
              </div>
            )}
            {resolved_desc.text}
          </div>
        );
      })()}

      {editing ? (
        /* Edit mode — editable textarea with blue EDITED styling */
        <div className="rp-edited-desc-box">
          <div className="rp-flexrow-6-2">
            <span className="rp-section-label rp-section-label--edited">EDITED</span>
            {isModified && (
              <span className="rp-modified-badge">Modified</span>
            )}
          </div>
          <textarea
            value={editedDescription}
            onChange={e => setEditedDescription(e.target.value)}
            className="rp-edit-textarea"
          />
        </div>
      ) : (
        /* Review mode — diff-highlighted PROPOSED */
        <div className={`rp-proposed-desc-box${edit.current_description && edit.edit_type !== 'add' ? ' rp-proposed-desc-box--bordered' : ''}`}>
          {edit.current_description && edit.edit_type !== 'add' && edit.current_description !== edit.proposed_description ? (
            <>
              <div className="rp-flexrow-6-2">
                <span className="rp-section-label rp-section-label--proposed">PROPOSED</span>
                {!resolved && (
                  <button
                    className="btn btn-sm btn-ghost rp-edit-btn"
                    onClick={() => setEditing(true)}
                  >&#9998; Edit</button>
                )}
              </div>
              {descMode === 'formal' ? diffWords(edit.current_description, edit.proposed_description).map((seg, i) =>
                seg.type === 'added'
                  ? <mark key={i} className="rp-diff-added">{seg.text}</mark>
                  : <span key={i}>{seg.text}</span>
              ) : edit.proposed_description}
            </>
          ) : (
            <>
              {!resolved && edit.proposed_description && (
                <div className="rp-flexrow-6-2">
                  {edit.edit_type === 'add' && (
                    <DescriptionToggle
                      mode={descMode}
                      onToggle={setDescMode}
                      hasPlainDescription={!!plainPreview}
                    />
                  )}
                  <span className="rp-spacer" />
                  <button
                    className="btn btn-sm btn-ghost rp-edit-btn-inline"
                    onClick={() => setEditing(true)}
                  >&#9998; Edit</button>
                </div>
              )}
              {descMode === 'plain' && edit.edit_type === 'add' ? (
                plainLoading
                  ? <span className="rp-muted-italic">Generating plain description…</span>
                  : plainError
                    ? (
                      <>
                        <div className="rp-plain-error-row">
                          <span>{'⚠'} Couldn&apos;t generate a plain description. Showing formal:</span>
                          <button
                            className="btn btn-sm rp-retry-btn"
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
        <div className={`rp-compliance-box ${complianceErrors.length > 0 ? 'rp-compliance-box--error' : 'rp-compliance-box--warning'}`}>
          <div className={`rp-compliance-header ${complianceErrors.length > 0 ? 'rp-compliance-header--error' : 'rp-compliance-header--warning'}`}>
            DOLCE Compliance ({complianceErrors.length} error{complianceErrors.length !== 1 ? 's' : ''}, {complianceWarnings.length} warning{complianceWarnings.length !== 1 ? 's' : ''})
          </div>
          {complianceViolations.map((v, i) => (
            <div key={i} className="rp-violation-row">
              <span className={`rp-severity-icon ${v.severity === 'error' ? 'rp-severity-icon--error' : 'rp-severity-icon--warning'}`}>
                {v.severity === 'error' ? '✗' : '⚠'}
              </span>
              <span className="rp-violation-message">
                <strong>{v.rule}</strong>: {v.message}
              </span>
            </div>
          ))}
        </div>
      )}
      {complianceViolations.length === 0 && (
        <div className="rp-compliant-ok">
          {'✓'} DOLCE compliant
        </div>
      )}

      {/* Rationale */}
      <div className="rp-rationale">
        {edit.rationale}
      </div>

      {/* Evidence entries */}
      {edit.evidence_entries && edit.evidence_entries.length > 0 && (
        <div className="rp-evidence-container">
          <div>Evidence: {edit.evidence_entries.map((e, i) => (
            <button
              key={i}
              className={`btn btn-sm btn-ghost rp-evidence-btn${expandedEvidence.has(e) ? ' rp-evidence-btn--active' : ''}`}
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
              <div key={e} className="rp-evidence-detail">
                <span className="rp-evidence-id">{e}</span>
                <span className="rp-evidence-speaker">({node.speaker})</span>
                {node.text}
                {node.attribution_text_genus && <div className="claim-attribution-text"><span className="claim-attribution-label">Attribution:</span>{node.attribution_text_genus}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Regenerate phrases toggle — revise/qualify only */}
      {showRegenerateToggle && (
        <label className="rp-regenerate-label">
          <input
            type="checkbox"
            checked={regeneratePhrases}
            onChange={e => setRegeneratePhrases(e.target.checked)}
            className="rp-checkbox-flush"
          />
          Regenerate phrases & embeddings
        </label>
      )}

      {/* Actions */}
      {!resolved && (
        <div className="rp-actions-row">
          <button
            className="btn btn-primary rp-approve-btn"
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
              className="btn rp-secondary-btn"
              onClick={handleReset}
            >
              Reset
            </button>
          )}
          {editing && (
            <button
              className="btn rp-secondary-btn"
              onClick={handleCancel}
            >
              Cancel
            </button>
          )}
          <button
            className="btn rp-secondary-btn"
            onClick={() => dismissReflectionEdit(pover, editIndex)}
          >
            Dismiss
          </button>
        </div>
      )}
      {/* Enrichment status indicator */}
      {enrichStatus?.status === 'pending' && (
        <div className="rp-enrich-pending">
          <span className="rp-pulse-icon">{'⧗'}</span>
          Enriching node — generating attributes & phrases…
        </div>
      )}
      {enrichStatus?.status === 'success' && (
        <div className="rp-enrich-success">
          <span className="rp-flex-gap6">
            {'✓'} Phrases regenerated successfully
            {edit.edit_type === 'add' && trackedEnrichNodeId && (
              <code
                className="rp-node-chip-success"
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
            className="btn btn-sm btn-ghost rp-clear-btn"
            onClick={() => enrichNodeId && clearEnrichmentStatus(enrichNodeId)}
          >{'✕'}</button>
        </div>
      )}
      {enrichStatus?.status === 'error' && (
        <div className="rp-enrich-error">
          <div className="rp-row-between">
            <span>{'✗'} Enrichment failed: {enrichStatus.error}</span>
            <button
              className="btn btn-sm rp-retry-btn-ml"
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
        <div className="rp-apply-error-box">
          <div>{applyError}</div>
          {isIntegrityError && (
            <div className="rp-fixit-row">
              <button
                className="btn btn-sm rp-fixit-btn"
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
              <span className="rp-text-muted-2xs">
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

  return (
    <div
      className="rp-mb-16"
      // eslint-disable-next-line local/no-inline-style -- header/summary accent color comes from POVER_INFO[pover], a data-driven value
      style={{ '--rp-pov-color': color, '--rp-pov-bg': `${color}10` } as React.CSSProperties}
    >
      <div className="rp-pov-header">
        <span className="rp-pov-label">{result.label}</span>
        <span className="rp-text-muted-xs">
          {result.edits.length} edit{result.edits.length !== 1 ? 's' : ''}
          {approved > 0 && ` (${approved} applied)`}
          {pending > 0 && pending !== result.edits.length && ` (${pending} pending)`}
        </span>
      </div>

      {result.reflection_summary && (
        <div className="rp-summary-box">
          {result.reflection_summary}
        </div>
      )}

      {result.edits.length === 0 && (
        <div className="rp-no-edits">
          No taxonomy edits proposed.
        </div>
      )}

      {result.edits.map((edit, i) => (
        <EditCard key={i} edit={edit} pover={result.pover} editIndex={i} />
      ))}
    </div>
  );
}

// ── Consensus cluster card ──────────────────────────────

function ConsensusCard({ cluster }: { cluster: ConsensusCluster }) {
  const { acceptConsensus, rejectConsensus } = useDebateStore(
    useShallow(s => ({ acceptConsensus: s.acceptConsensus, rejectConsensus: s.rejectConsensus }))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    setLoading(true);
    setError(null);
    const result = await acceptConsensus(cluster.id);
    setLoading(false);
    if (!result.ok) setError(result.error || 'Failed');
  };

  if (cluster.status !== 'pending') {
    return (
      <div className={`rp-consensus-resolved ${cluster.status === 'accepted' ? 'rp-consensus-resolved--accepted' : 'rp-consensus-resolved--rejected'}`}>
        Consensus {cluster.status === 'accepted' ? 'accepted — situation node created' : 'rejected — proposals shown individually'}
      </div>
    );
  }

  const scores = Object.entries(cluster.similarityScores)
    .map(([k, v]) => `${k}: ${(v as number).toFixed(2)}`)
    .join(', ');

  return (
    <div className="rp-consensus-card">
      <div className="rp-consensus-header">
        <span className="rp-consensus-title">
          Consensus Detected
        </span>
        <span className="rp-pov-count-badge">
          {cluster.proposals.length} POVs converge
        </span>
        <span className="rp-text-muted-2xs rp-ml-auto">
          similarity: {scores}
        </span>
      </div>

      {/* Side-by-side proposals */}
      <div
        className="rp-consensus-grid"
        /* eslint-disable-next-line local/no-inline-style -- grid-template-columns count derives from cluster.proposals.length at render time */
        style={{ '--rp-grid-cols': `repeat(${cluster.proposals.length}, 1fr)` } as React.CSSProperties}
      >
        {cluster.proposals.map((p, i) => {
          const info = POVER_INFO[p.pov as Exclude<SpeakerId, 'user'>];
          return (
            <div
              key={i}
              className="rp-proposal-card"
              // eslint-disable-next-line local/no-inline-style -- border/label color derives from POVER_INFO[p.pov], a data-driven value
              style={{ '--rp-proposal-border': `${info?.color || '#888'}40`, '--rp-proposal-color': info?.color || '#888' } as React.CSSProperties}
            >
              <div className="rp-proposal-pov-label">
                {info?.label || p.pov}
              </div>
              <div className="rp-proposal-text-label">
                {p.proposed_label}
              </div>
              <div className="rp-proposal-desc">
                {p.proposed_description.slice(0, 200)}{p.proposed_description.length > 200 ? '…' : ''}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rp-consensus-actions">
        <button
          className="btn btn-primary rp-consensus-btn"
          onClick={handleAccept}
          disabled={loading}
        >
          {loading ? 'Creating...' : 'Create Situation Node'}
        </button>
        <button
          className="btn rp-consensus-btn"
          onClick={() => rejectConsensus(cluster.id)}
          disabled={loading}
        >
          Keep Separate
        </button>
        {error && <span className="rp-consensus-error">{error}</span>}
      </div>
    </div>
  );
}

export function ReflectionsPanel({ onClose }: { onClose: () => void }) {
  const { reflections, consensusClusters, debateGenerating, requestReflections, applyReflectionEdit, dismissReflectionEdit } = useDebateStore(
    useShallow(s => ({ reflections: s.reflections, consensusClusters: s.consensusClusters, debateGenerating: s.debateGenerating, requestReflections: s.requestReflections, applyReflectionEdit: s.applyReflectionEdit, dismissReflectionEdit: s.dismissReflectionEdit }))
  );
  const isGenerating = debateGenerating != null;

  const totalPending = reflections.reduce((sum, r) => sum + r.edits.filter(e => e.status === 'pending').length, 0);
  const totalApproved = reflections.reduce((sum, r) => sum + r.edits.filter(e => e.status === 'approved').length, 0);

  const approveAll = async () => {
    for (const r of reflections) {
      for (let i = 0; i < r.edits.length; i++) {
        if (r.edits[i].status === 'pending') await applyReflectionEdit(r.pover, i);
      }
    }
  };

  const dismissAll = () => {
    for (const r of reflections) {
      r.edits.forEach((e, i) => {
        if (e.status === 'pending') dismissReflectionEdit(r.pover, i);
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
    <div className="reflections-panel">
      <div
        className="rp-modal"
        // eslint-disable-next-line local/no-inline-style -- translate offset comes from live drag position state (pos.x/pos.y)
        style={{ '--rp-modal-transform': `translate(${pos.x}px, ${pos.y}px)` } as React.CSSProperties}
      >
        {/* Header — drag handle */}
        <div
          onMouseDown={onMouseDown}
          className={`rp-drag-header${dragRef.current ? ' rp-drag-header--dragging' : ''}`}
        >
          <h3 className="rp-panel-title">Post-Debate Reflections</h3>
          {reflections.length > 0 && totalPending > 0 && (
            <>
              <button className="btn btn-primary rp-secondary-btn" onClick={approveAll}>
                Approve All ({totalPending})
              </button>
              <button className="btn rp-secondary-btn" onClick={dismissAll}>
                Dismiss All
              </button>
            </>
          )}
          {totalApproved > 0 && (
            <span className="rp-applied-count">{totalApproved} applied</span>
          )}
          <button
            onClick={onClose}
            className="rp-close-btn"
          >&times;</button>
        </div>

        {/* Content */}
        <div className="rp-panel-content">
          {reflections.length === 0 && !isGenerating && (
            <div className="rp-empty-state">
              <p className="rp-empty-text">
                Ask each debater to reflect on the conversation and propose specific edits to their Beliefs, Desires, and Intentions taxonomy.
              </p>
              <button
                className="btn btn-primary rp-start-btn"
                onClick={() => requestReflections()}
              >
                Start Post-Debate Reflections
              </button>
            </div>
          )}

          {isGenerating && reflections.length === 0 && (
            <div className="rp-waiting-state">
              Waiting for reflections...
            </div>
          )}

          {consensusClusters.length > 0 && (
            <div className="rp-mb-16">
              {consensusClusters.map(c => (
                <ConsensusCard key={c.id} cluster={c} />
              ))}
            </div>
          )}

          {reflections.length > 1 && (
            <div className="rp-reflection-order">
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
