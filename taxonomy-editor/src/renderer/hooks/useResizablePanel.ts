// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useCallback, useRef, useEffect } from 'react';

const STORAGE_KEY = 'taxonomy-editor-panel-width';
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 200;
const MAX_WIDTH = 600;

function getStoredWidth(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const n = parseInt(stored, 10);
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
  } catch { /* ignore */ }
  return DEFAULT_WIDTH;
}

export function useResizablePanel() {
  const [width, setWidth] = useState(getStoredWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth.current + delta));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try { localStorage.setItem(STORAGE_KEY, String(width)); } catch { /* ignore */ }
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [width]);

  return { width, onMouseDown };
}

/* ─── Configurable variant for right-side panels ──────── */

interface RightPanelOptions {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

function getStoredRightWidth(opts: RightPanelOptions): number {
  try {
    const stored = localStorage.getItem(opts.storageKey);
    if (stored) {
      const n = parseInt(stored, 10);
      if (n >= opts.minWidth && n <= opts.maxWidth) return n;
    }
  } catch { /* ignore */ }
  return opts.defaultWidth;
}

export function useResizableRightPanel(opts: RightPanelOptions) {
  const [width, setWidth] = useState(() => getStoredRightWidth(opts));
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      // Dragging left = wider (opposite of left panel)
      const delta = startX.current - e.clientX;
      const newWidth = Math.max(opts.minWidth, Math.min(opts.maxWidth, startWidth.current + delta));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try { localStorage.setItem(opts.storageKey, String(width)); } catch { /* ignore */ }
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [width, opts.storageKey, opts.minWidth, opts.maxWidth]);

  return { width, onMouseDown };
}
