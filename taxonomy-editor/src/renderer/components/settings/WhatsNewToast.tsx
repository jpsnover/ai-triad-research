// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback } from 'react';
import './WhatsNewToast.css';

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
      className="whats-new-toast"
      onClick={handleClick}
    >
      <span className="whats-new-toast-text">
        Updated to <strong>v{__APP_VERSION__}</strong> — see What&apos;s New
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); dismiss(); }}
        aria-label="Dismiss"
        className="whats-new-toast-dismiss"
      >
        &times;
      </button>
    </div>
  );
}
