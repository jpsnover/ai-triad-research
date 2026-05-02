// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useCallback, useEffect, useRef } from 'react';

const DEFAULT_WIDTHS = [23, 44, 33];
const MIN_WIDTH_PCT = 15;

export function useResizablePanes(storageKey: string) {
  const [widths, setWidths] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === 3) return parsed;
      }
    } catch { /* use defaults */ }
    return DEFAULT_WIDTHS;
  });

  const draggingRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(widths));
  }, [storageKey, widths]);

  const onMouseDown = useCallback((handleIndex: number) => {
    draggingRef.current = handleIndex;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (draggingRef.current === null || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const totalWidth = rect.width;
      const mouseX = e.clientX - rect.left;
      const mousePct = (mouseX / totalWidth) * 100;
      const handleIdx = draggingRef.current;

      setWidths(prev => {
        const next = [...prev];
        if (handleIdx === 0) {
          const combinedWidth = prev[0] + prev[1];
          const newLeft = Math.max(MIN_WIDTH_PCT, Math.min(mousePct, combinedWidth - MIN_WIDTH_PCT));
          next[0] = newLeft;
          next[1] = combinedWidth - newLeft;
        } else if (handleIdx === 1) {
          const leftEdge = prev[0];
          const combinedWidth = prev[1] + prev[2];
          const newMiddle = Math.max(MIN_WIDTH_PCT, Math.min(mousePct - leftEdge, combinedWidth - MIN_WIDTH_PCT));
          next[1] = newMiddle;
          next[2] = combinedWidth - newMiddle;
        }
        return next;
      });
    }

    function onMouseUp() {
      if (draggingRef.current !== null) {
        draggingRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return { widths, containerRef, onMouseDown, draggingRef };
}
