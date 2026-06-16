// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { useCommunityStore, type Submission } from '../../hooks/useCommunityStore';
import { useUserProfile } from '../../hooks/useAuthStatus';

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
    } catch (err) { setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`); }
    setTimeout(() => setMsg(null), 3000);
  };

  const handleReject = async (id: string) => {
    try {
      await rejectSubmission(id);
      setMsg('Submission rejected');
      void fetchSubmissions(filter || undefined);
    } catch (err) { setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`); }
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
    </div>
  );
}
