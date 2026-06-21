// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState, useRef } from 'react';
import { useCommunityStore, type CommunityChat, type CommunityDebate } from '../../hooks/useCommunityStore';
import { useUserProfile } from '../../hooks/useAuthStatus';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

type Tab = 'chats' | 'debates';

function formatDate(iso: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

function RemoveConfirmPopover({ item, onConfirm, onCancel }: {
  item: CommunityChat | CommunityDebate;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onCancel]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div className="community-remove-popover" ref={ref}>
      <div className="community-remove-popover-title">Remove from Community Library?</div>
      <div className="community-remove-popover-detail">
        <strong>{item.title}</strong>
        {item.community_metadata?.submitted_by_display && (
          <span> by {item.community_metadata.submitted_by_display}</span>
        )}
      </div>
      <textarea
        className="community-remove-reason"
        rows={2}
        maxLength={200}
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Reason (optional)"
        autoFocus
      />
      <div className="community-remove-actions">
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-sm btn-danger" onClick={() => onConfirm(reason.trim())}>Remove</button>
      </div>
    </div>
  );
}

function CommunityCard({ item, isAdmin, onCopy, onRemove }: {
  item: CommunityChat | CommunityDebate;
  isAdmin: boolean;
  onCopy: () => void;
  onRemove: (reason: string) => void;
}) {
  const [copying, setCopying] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);

  const handleCopy = async () => {
    setCopying(true);
    try { await onCopy(); } finally { setCopying(false); }
  };

  return (
    <div className={`community-card${removing ? ' community-card-removing' : ''}`}>
      <div className="community-card-header">
        <div className="community-card-title">{item.title}</div>
        {isAdmin && (
          <button
            className="btn btn-icon btn-ghost community-card-remove"
            onClick={() => setShowConfirm(true)}
            aria-label="Remove from community"
            title="Remove from community"
          >
            &#x2715;
          </button>
        )}
      </div>
      <div className="community-card-meta">
        {item.community_metadata?.submitted_by_display && (
          <span>by {item.community_metadata.submitted_by_display}</span>
        )}
        <span>{formatDate(item.updated_at || item.created_at)}</span>
        {'phase' in item && item.phase && <span className="community-card-badge">{item.phase}</span>}
        {'mode' in item && item.mode && <span className="community-card-badge">{item.mode}</span>}
      </div>
      <button
        className="btn btn-sm btn-primary community-card-copy"
        onClick={() => void handleCopy()}
        disabled={copying}
      >
        {copying ? 'Copying...' : 'Copy to My Library'}
      </button>
      {showConfirm && (
        <RemoveConfirmPopover
          item={item}
          onCancel={() => setShowConfirm(false)}
          onConfirm={(reason) => {
            setShowConfirm(false);
            setRemoving(true);
            onRemove(reason);
          }}
        />
      )}
    </div>
  );
}

export function CommunityLibrary() {
  const { chats, debates, loading, error, fetchChats, fetchDebates, copyItem, removeItem } = useCommunityStore();
  const profile = useUserProfile();
  const [tab, setTab] = useState<Tab>('debates');
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'info' | 'error' } | null>(null);
  const isAdmin = !!profile?.isAdmin;

  useEffect(() => { void fetchChats(); void fetchDebates(); }, []);

  const showToast = (text: string, type: 'info' | 'error' = 'info', durationMs = 3000) => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), durationMs);
  };

  const handleCopy = async (type: 'chats' | 'debates', id: string) => {
    try {
      await copyItem(type, id);
      showToast('Copied to your library!');
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'CommunityLibrary', level: 'error', message: 'Failed to copy community item', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, 'error', 5000);
    }
  };

  const handleRemove = async (type: 'chats' | 'debates', id: string, reason: string) => {
    try {
      await removeItem(type, id, reason || undefined);
      showToast('Removed from community library.');
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'CommunityLibrary', level: 'error', message: 'Failed to remove community item', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      showToast(`Removal failed: ${err instanceof Error ? err.message : String(err)}`, 'error', 5000);
    }
  };

  const handleBack = () => { window.location.hash = ''; window.location.reload(); };

  const items = tab === 'chats' ? chats : debates;

  return (
    <div className="community-library">
      <div className="community-header">
        <button className="btn btn-ghost" onClick={handleBack}>&larr; Back</button>
        <h2>Community Library</h2>
        {isAdmin && (
          <button
            className="btn btn-ghost"
            onClick={() => { window.location.hash = '#admin'; }}
          >
            Admin Panel
          </button>
        )}
      </div>

      <div className="community-tabs">
        <button
          className={`community-tab ${tab === 'debates' ? 'active' : ''}`}
          onClick={() => setTab('debates')}
        >
          Debates ({debates.length})
        </button>
        <button
          className={`community-tab ${tab === 'chats' ? 'active' : ''}`}
          onClick={() => setTab('chats')}
        >
          Chats ({chats.length})
        </button>
      </div>

      {toastMsg && (
        <div className={`community-toast${toastMsg.type === 'error' ? ' community-toast-error' : ''}`}>
          {toastMsg.text}
        </div>
      )}
      {error && <div className="community-error">{error}</div>}

      <div className="community-grid">
        {loading && items.length === 0 && <div className="community-empty">Loading...</div>}
        {!loading && items.length === 0 && <div className="community-empty">No community {tab} yet. Be the first to submit!</div>}
        {items.map(item => (
          <CommunityCard
            key={item.id}
            item={item}
            isAdmin={isAdmin}
            onCopy={() => handleCopy(tab, item.id)}
            onRemove={(reason) => void handleRemove(tab, item.id, reason)}
          />
        ))}
      </div>
    </div>
  );
}
