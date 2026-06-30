// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback } from 'react';

declare const __APP_VERSION__: string;

const STORAGE_KEY = 'taxonomy-editor-last-seen-version';

interface WhatsNewToastProps {
  onOpenChangelog: () => void;
}

export function WhatsNewToast({ onOpenChangelog }: WhatsNewToastProps) {
  const [visible, setVisible] = useState(false);

  const dismiss = useCallback(() => {
    setVisible(false);
    localStorage.setItem(STORAGE_KEY, __APP_VERSION__);
  }, []);

  const handleClick = useCallback(() => {
    dismiss();
    onOpenChangelog();
  }, [dismiss, onOpenChangelog]);

  useEffect(() => {
    const lastSeen = localStorage.getItem(STORAGE_KEY);
    if (lastSeen !== __APP_VERSION__) {
      setVisible(true);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      dismiss();
    }, 8000);
    return () => clearTimeout(t);
  }, [visible, dismiss]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        background: 'var(--bg-elevated, #333)', color: 'var(--text-primary, #fff)',
        padding: '10px 16px', borderRadius: 8, fontSize: '0.82rem',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        display: 'flex', alignItems: 'center', gap: 12,
        cursor: 'pointer', maxWidth: 360,
      }}
      onClick={handleClick}
    >
      <span style={{ flex: 1 }}>
        Updated to <strong>v{__APP_VERSION__}</strong> — see What&apos;s New
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); dismiss(); }}
        aria-label="Dismiss"
        style={{
          background: 'none', border: 'none', color: 'inherit',
          cursor: 'pointer', padding: '2px 4px', fontSize: '1rem', opacity: 0.6,
        }}
      >
        &times;
      </button>
    </div>
  );
}
