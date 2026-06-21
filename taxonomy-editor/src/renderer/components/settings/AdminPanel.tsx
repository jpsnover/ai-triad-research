// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState, useCallback } from 'react';
import { useCommunityStore, type Submission } from '../../hooks/useCommunityStore';
import { useUserProfile } from '../../hooks/useAuthStatus';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { useDebateStore } from '../../hooks/useDebateStore';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useShallow } from 'zustand/react/shallow';

function formatDate(iso: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function SubmissionRow({ sub, onApprove, onReject }: {
  sub: Submission;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  const handle = async (action: 'approve' | 'reject') => {
    setBusy(action);
    try {
      if (action === 'approve') await onApprove();
      else await onReject();
    } finally { setBusy(null); }
  };

  return (
    <tr className="admin-submission-row">
      <td>{sub.type}</td>
      <td className="admin-submission-id" title={sub.originalId}>{sub.originalId.slice(0, 8)}...</td>
      <td>{sub.submittedBy}</td>
      <td>{formatDate(sub.submittedAt)}</td>
      <td>{sub.note || '—'}</td>
      <td className="admin-submission-actions">
        <button
          className="btn btn-sm btn-primary"
          onClick={() => void handle('approve')}
          disabled={busy !== null}
        >
          {busy === 'approve' ? '...' : 'Approve'}
        </button>
        <button
          className="btn btn-sm btn-danger"
          onClick={() => void handle('reject')}
          disabled={busy !== null}
        >
          {busy === 'reject' ? '...' : 'Reject'}
        </button>
      </td>
    </tr>
  );
}

const POV_KEYS = ['accelerationist', 'safetyist', 'skeptic'] as const;

function EnrichmentRepairSection() {
  const taxState = useTaxonomyStore(useShallow(s => ({
    accelerationist: s.accelerationist,
    safetyist: s.safetyist,
    skeptic: s.skeptic,
  })));
  const { retryEnrichment, enrichmentStatus } = useDebateStore(
    useShallow(s => ({ retryEnrichment: s.retryEnrichment, enrichmentStatus: s.enrichmentStatus })),
  );
  const [repairing, setRepairing] = useState(false);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);

  const pendingNodes: { id: string; label: string; pov: typeof POV_KEYS[number] }[] = [];
  for (const pov of POV_KEYS) {
    const data = taxState[pov];
    if (!data?.nodes) continue;
    for (const node of data.nodes) {
      if (node.graph_attributes?._phrase_regen_pending) {
        pendingNodes.push({ id: node.id, label: node.label, pov });
      }
    }
  }

  const handleRepairAll = useCallback(async () => {
    setRepairing(true);
    setRepairMsg(null);
    let ok = 0;
    let fail = 0;
    const currentTaxState = useTaxonomyStore.getState();
    const pending: { id: string; pov: typeof POV_KEYS[number] }[] = [];
    for (const pov of POV_KEYS) {
      for (const node of currentTaxState[pov]?.nodes ?? []) {
        if (node.graph_attributes?._phrase_regen_pending) pending.push({ id: node.id, pov });
      }
    }
    for (const { id, pov } of pending) {
      try {
        await retryEnrichment(id, pov);
        ok++;
      } catch (err) {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'admin-enrichment-repair', level: 'warn', message: `Batch enrichment repair failed for ${id}`, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        fail++;
      }
    }
    setRepairMsg(`Repair complete: ${ok} succeeded, ${fail} failed`);
    setRepairing(false);
    setTimeout(() => setRepairMsg(null), 5000);
  }, [retryEnrichment]);

  return (
    <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
      <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Enrichment Repair</h3>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
        Nodes with incomplete phrase regeneration ({pendingNodes.length} found):
      </p>
      {pendingNodes.length === 0 ? (
        <div style={{ fontSize: '0.75rem', color: '#22c55e' }}>All nodes are fully enriched.</div>
      ) : (
        <>
          <div style={{ maxHeight: 200, overflow: 'auto', marginBottom: 8 }}>
            {pendingNodes.map(n => {
              const st = enrichmentStatus[n.id];
              return (
                <div key={n.id} style={{ fontSize: '0.7rem', padding: '3px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <code style={{ color: 'var(--text-muted)' }}>{n.id}</code>
                  <span style={{ flex: 1 }}>{n.label}</span>
                  {st?.status === 'pending' && <span style={{ color: '#3b82f6' }}>{'⧗'}</span>}
                  {st?.status === 'success' && <span style={{ color: '#22c55e' }}>{'✓'}</span>}
                  {st?.status === 'error' && <span style={{ color: '#ef4444' }} title={st.error}>{'✗'}</span>}
                  <button
                    className="btn btn-sm"
                    style={{ fontSize: '0.6rem', padding: '1px 6px' }}
                    disabled={repairing || st?.status === 'pending'}
                    onClick={() => void retryEnrichment(n.id, n.pov)}
                  >Retry</button>
                </div>
              );
            })}
          </div>
          <button
            className="btn btn-primary"
            style={{ fontSize: '0.75rem' }}
            disabled={repairing}
            onClick={() => void handleRepairAll()}
          >
            {repairing ? 'Repairing…' : `Repair All (${pendingNodes.length})`}
          </button>
        </>
      )}
      {repairMsg && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>{repairMsg}</div>}
    </div>
  );
}

export function AdminPanel() {
  const { submissions, fetchSubmissions, approveSubmission, rejectSubmission } = useCommunityStore();
  const profile = useUserProfile();
  const [filter, setFilter] = useState<string>('pending');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { void fetchSubmissions(filter || undefined); }, [filter]);

  if (profile && !profile.isAdmin) {
    return (
      <div className="admin-panel">
        <div className="admin-header">
          <button className="btn btn-ghost" onClick={() => { window.location.hash = ''; window.location.reload(); }}>&larr; Back</button>
          <h2>Admin Panel</h2>
        </div>
        <div className="community-empty">You do not have admin access.</div>
      </div>
    );
  }

  const handleApprove = async (id: string) => {
    try {
      await approveSubmission(id);
      setMsg('Submission approved');
      void fetchSubmissions(filter || undefined);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'AdminPanel', level: 'error', message: 'Failed to approve submission', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    setTimeout(() => setMsg(null), 3000);
  };

  const handleReject = async (id: string) => {
    try {
      await rejectSubmission(id);
      setMsg('Submission rejected');
      void fetchSubmissions(filter || undefined);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'AdminPanel', level: 'error', message: 'Failed to reject submission', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    setTimeout(() => setMsg(null), 3000);
  };

  const handleBack = () => { window.location.hash = '#community'; };

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <button className="btn btn-ghost" onClick={handleBack}>&larr; Community</button>
        <h2>Admin — Submissions</h2>
        <select
          className="admin-filter"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
      </div>

      {msg && <div className="community-toast">{msg}</div>}

      {submissions.length === 0 ? (
        <div className="community-empty">No {filter || ''} submissions.</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Item ID</th>
              <th>Submitted By</th>
              <th>Date</th>
              <th>Note</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map(sub => (
              <SubmissionRow
                key={sub.id}
                sub={sub}
                onApprove={() => handleApprove(sub.id)}
                onReject={() => handleReject(sub.id)}
              />
            ))}
          </tbody>
        </table>
      )}

      <EnrichmentRepairSection />
    </div>
  );
}
