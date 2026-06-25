// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useRef } from 'react';
import { useFlag } from '../../hooks/useFeatureFlags';

interface CommunityShareBannerProps {
  itemType: 'chat' | 'debate';
  compact?: boolean;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 8_000;

export function CommunityShareBanner({ itemType, compact, onDismiss }: CommunityShareBannerProps) {
  const isAdmin = useFlag('permission-admin-features');
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    timerRef.current = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timerRef.current);
  }, [onDismiss]);

  if (isAdmin) {
    return (
      <span role="status" style={{ color: 'var(--green, #22c55e)', fontSize: '0.75rem' }}>
        {'✓ Shared to community'}
      </span>
    );
  }

  if (compact) {
    return (
      <div
        role="status"
        style={{
          background: 'var(--bg-secondary, #f5f5f5)',
          borderLeft: '3px solid var(--green, #22c55e)',
          borderRadius: 6,
          padding: '6px 12px',
          marginTop: 6,
          fontSize: '0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ color: 'var(--green, #22c55e)', flexShrink: 0 }}>{'✓'}</span>
        <span style={{ color: 'var(--text-secondary, #666)', flex: 1 }}>
          {'Submitted for review — your ' + itemType + ' will appear in the community library once reviewed and approved.'}
        </span>
        <button
          onClick={onDismiss}
          className="btn btn-sm"
          style={{ fontSize: '0.7rem', padding: '1px 8px', flexShrink: 0 }}
        >
          OK
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      style={{
        background: 'var(--bg-secondary, #f5f5f5)',
        borderLeft: '3px solid var(--green, #22c55e)',
        borderRadius: 6,
        padding: '8px 12px',
        marginTop: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ color: 'var(--green, #22c55e)', flexShrink: 0 }}>{'✓'}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '0.78rem' }}>Submitted for review</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #666)', marginTop: 2 }}>
            {'Your ' + itemType + ' will appear in the community library once it has been reviewed and approved.'}
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="btn btn-sm"
          style={{ fontSize: '0.7rem', padding: '1px 8px', flexShrink: 0, alignSelf: 'flex-end' }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
