// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { useCommunityStore, type CommunityChat, type CommunityDebate } from '../../hooks/useCommunityStore';
import { useUserProfile } from '../../hooks/useAuthStatus';

type Tab = 'chats' | 'debates';

function formatDate(iso: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

function CommunityCard({ item, onCopy }: { item: CommunityChat | CommunityDebate; onCopy: () => void }) {
  const [copying, setCopying] = useState(false);

  const handleCopy = async () => {
    setCopying(true);
    try { await onCopy(); } finally { setCopying(false); }
  };

  return (
    <div className="community-card">
      <div className="community-card-title">{item.title}</div>
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
    </div>
  );
}

export function CommunityLibrary() {
  const { chats, debates, loading, error, fetchChats, fetchDebates, copyItem } = useCommunityStore();
  const profile = useUserProfile();
  const [tab, setTab] = useState<Tab>('debates');
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  useEffect(() => { void fetchChats(); void fetchDebates(); }, []);

  const handleCopy = async (type: 'chats' | 'debates', id: string) => {
    try {
      await copyItem(type, id);
      setCopyMsg('Copied to your library!');
      setTimeout(() => setCopyMsg(null), 3000);
    } catch (err) {
      setCopyMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setTimeout(() => setCopyMsg(null), 5000);
    }
  };

  const handleBack = () => { window.location.hash = ''; window.location.reload(); };

  const items = tab === 'chats' ? chats : debates;

  return (
    <div className="community-library">
      <div className="community-header">
        <button className="btn btn-ghost" onClick={handleBack}>&larr; Back</button>
        <h2>Community Library</h2>
        {profile?.isAdmin && (
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

      {copyMsg && <div className="community-toast">{copyMsg}</div>}
      {error && <div className="community-error">{error}</div>}

      <div className="community-grid">
        {loading && items.length === 0 && <div className="community-empty">Loading...</div>}
        {!loading && items.length === 0 && <div className="community-empty">No community {tab} yet. Be the first to submit!</div>}
        {items.map(item => (
          <CommunityCard
            key={item.id}
            item={item}
            onCopy={() => handleCopy(tab, item.id)}
          />
        ))}
      </div>
    </div>
  );
}
