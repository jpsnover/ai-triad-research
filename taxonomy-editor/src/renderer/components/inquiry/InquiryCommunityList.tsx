// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Community view of the Ask a Question tab (t/3678). Thin: all the projection/fetch/copy
// plumbing already exists in useCommunityStore (t/3622) — this renders it via the same
// CommunityCard the standalone Community Library uses, so the two surfaces stay visually and
// behaviorally identical rather than growing a second, divergent card implementation.

import { useEffect, useState } from 'react';
import { useCommunityStore } from '../../hooks/useCommunityStore';
import { CommunityCard } from '../community/CommunityLibrary';
import { useFlag } from '../../hooks/useFeatureFlags';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { mapErrorToUserMessage } from '../../utils/errorMessages';

export function InquiryCommunityList() {
  const { inquiries, loading, fetchInquiries, copyItem, removeItem } = useCommunityStore();
  const isAdmin = useFlag('permission-admin-features');
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => { void fetchInquiries(); }, [fetchInquiries]);

  const handleCopy = async (id: string) => {
    setActionError(null);
    try {
      await copyItem('inquiries', id);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'InquiryCommunityList',
        level: 'error',
        message: 'Failed to copy community inquiry',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setActionError(mapErrorToUserMessage(err));
    }
  };

  const handleRemove = async (id: string, reason: string) => {
    setActionError(null);
    try {
      await removeItem('inquiries', id, reason || undefined);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'InquiryCommunityList',
        level: 'error',
        message: 'Failed to remove community inquiry',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setActionError(mapErrorToUserMessage(err));
    }
  };

  return (
    <div className="inquiry-community">
      {actionError && <p className="inquiry-error" role="alert">{actionError}</p>}
      <div className="community-grid">
        {loading && inquiries.length === 0 && <div className="community-empty">Loading...</div>}
        {!loading && inquiries.length === 0 && (
          <div className="community-empty">No community questions yet. Be the first to submit!</div>
        )}
        {inquiries.map((item) => (
          <CommunityCard
            key={item.id}
            item={item}
            isAdmin={isAdmin}
            onCopy={() => handleCopy(item.id)}
            onRemove={(reason) => void handleRemove(item.id, reason)}
          />
        ))}
      </div>
    </div>
  );
}
