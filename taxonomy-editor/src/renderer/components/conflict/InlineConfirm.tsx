// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Inline confirmation for row/card-level destructive actions (t/1559 §3.6).
 * Implements `docs/ux/design-system.md § Inline Confirmation`: replaces the
 * trigger's content with a Cancel/Confirm choice in place — no modal — and
 * returns to normal on Cancel or Escape.
 *
 * Per Design (t/1559#2): focus moves into the confirm group on trigger and
 * returns to the trigger on cancel; Confirm is `--danger`, Cancel neutral; no
 * auto-confirm on timeout. The modal DeleteConfirmDialog stays for the
 * toolbar-level Delete; this is for in-list/in-card deletes.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface InlineConfirmProps {
  onConfirm: () => void;
  /** Render the trigger; call `start` to enter the confirm state. */
  children: (start: () => void) => ReactNode;
  /** Prompt shown beside the choice, e.g. "Delete instance?". */
  label?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function InlineConfirm({
  onConfirm,
  children,
  label = 'Delete?',
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
}: InlineConfirmProps) {
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Move focus into the confirm group (Cancel — the safe default) on trigger.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const reset = () => {
    setConfirming(false);
    triggerRef.current?.focus();
  };

  if (!confirming) {
    return <span ref={triggerRef}>{children(() => setConfirming(true))}</span>;
  }

  return (
    <span
      className="inline-confirm"
      role="group"
      aria-label={label}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); reset(); } }}
    >
      <span className="inline-confirm-label">{label}</span>
      <button ref={cancelRef} type="button" className="btn btn-sm" onClick={reset}>{cancelLabel}</button>
      <button
        type="button"
        className="btn btn-sm btn-danger"
        onClick={() => { setConfirming(false); onConfirm(); }}
      >
        {confirmLabel}
      </button>
    </span>
  );
}
