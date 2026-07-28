// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useRef } from 'react';
import { useFlag } from '../../hooks/useFeatureFlags';
import './CommunityShareBanner.css';

interface CommunityShareBannerProps {
  itemType: 'chat' | 'debate';
  compact?: boolean;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 8_000;

export function CommunityShareBanner({ itemType, compact, onDismiss }: CommunityShareBannerProps) {
  const isAdmin = useFlag('permission-admin-features');
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    timerRef.current = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timerRef.current);
  }, [onDismiss]);

  if (isAdmin) {
    return (
      <span role="status" className="community-share-banner-admin">
        {'✓ Shared to community'}
      </span>
    );
  }

  if (compact) {
    return (
      <div
        role="status"
        className="community-share-banner-compact"
      >
        <span className="community-share-banner-compact-icon">{'✓'}</span>
        <span className="community-share-banner-compact-text">
          {'Submitted for review — your ' + itemType + ' will appear in the community library once reviewed and approved.'}
        </span>
        <button
          onClick={onDismiss}
          className="btn btn-sm community-share-banner-compact-btn"
        >
          OK
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="community-share-banner"
    >
      <div className="community-share-banner-row">
        <span className="community-share-banner-icon">{'✓'}</span>
        <div className="community-share-banner-body">
          <div className="community-share-banner-title">Submitted for review</div>
          <div className="community-share-banner-subtitle">
            {'Your ' + itemType + ' will appear in the community library once it has been reviewed and approved.'}
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="btn btn-sm community-share-banner-btn"
        >
          OK
        </button>
      </div>
    </div>
  );
}
