// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useCallback } from 'react';
import { DiagnosticsWindow } from './DiagnosticsWindow';

export const DIAG_DRAWER_EVENT = 'open-diagnostics-drawer';

export function fireDiagDrawer() {
  window.dispatchEvent(new CustomEvent(DIAG_DRAWER_EVENT));
}

export function DiagnosticsDrawer() {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(DIAG_DRAWER_EVENT, handler);
    return () => window.removeEventListener(DIAG_DRAWER_EVENT, handler);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (dy > 80) close();
  }, [close]);

  return (
    <>
      <div className={`diag-drawer-backdrop${open ? ' open' : ''}`} onClick={close} />
      <div
        ref={drawerRef}
        className={`diag-drawer${open ? ' open' : ''}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="diag-drawer-handle" />
        <div className="diag-drawer-header">
          <h3>Diagnostics</h3>
          <button className="diag-drawer-close" onClick={close}>&times;</button>
        </div>
        <div className="diag-drawer-body">
          {open && <DiagnosticsWindow />}
        </div>
      </div>
    </>
  );
}
