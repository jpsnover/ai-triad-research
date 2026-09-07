// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3382: touch devices (iPad/phone) never fire a `contextmenu` event on a long-press the way a
// desktop right-click does, so every `onContextMenu`-only handler in the renderer was unreachable
// on touch. This hook adds a long-press-to-context-menu affordance without changing any existing
// handler's signature: every `onContextMenu` callback in this codebase only reads
// `preventDefault`/`stopPropagation`/`clientX`/`clientY` off the event, so a long-press synthesizes
// a minimal object satisfying that same shape and calls the SAME handler — desktop right-click and
// touch long-press converge on one code path.

import { useCallback, useRef } from 'react';

const LONG_PRESS_MS = 500;
// Cancel the long-press if the touch drifts more than this many px (a scroll/drag, not a hold).
const MOVE_CANCEL_PX = 10;

/** The minimal event shape every onContextMenu handler in this codebase reads. */
export interface ContextMenuLikeEvent {
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
}

export interface LongPressContextMenuHandlers {
  onContextMenu: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
}

/**
 * Spread the returned handlers onto the same element that currently has `onContextMenu={handler}`.
 * Desktop right-click behavior is unchanged; a touch long-press now invokes the identical handler.
 */
export function useLongPressContextMenu(
  onContextMenu: (e: ContextMenuLikeEvent) => void,
): LongPressContextMenuHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    startRef.current = { x: touch.clientX, y: touch.clientY };
    timerRef.current = setTimeout(() => {
      onContextMenu({
        clientX: touch.clientX,
        clientY: touch.clientY,
        preventDefault: () => {},
        stopPropagation: () => {},
      });
      startRef.current = null;
    }, LONG_PRESS_MS);
  }, [onContextMenu]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!startRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - startRef.current.x;
    const dy = touch.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) clear();
  }, [clear]);

  return {
    onContextMenu,
    onTouchStart,
    onTouchMove,
    onTouchEnd: clear,
    onTouchCancel: clear,
  };
}
