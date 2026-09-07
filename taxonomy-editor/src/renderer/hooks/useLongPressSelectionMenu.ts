// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3382 (DebateWorkspace fit-or-extend, t/3382#4): `useLongPressContextMenu`'s blind
// touchstart+500ms timer fits a fixed target (a chip, a badge), but a TEXT-SELECTION context menu
// needs a different trigger model — the user drags native selection handles for a variable
// duration, so the menu must appear only once the selection is FINAL, not at a blind timer mark.
// This sibling hook generalizes DebateWorkspace's own proven `handleTouchEnd` (t/3382#4): on
// touchend, wait briefly for the mobile browser to finalize the selection, then invoke the
// caller's menu-builder — which also receives the full event target (not the narrower
// ContextMenuLikeEvent shape), so callers needing `currentTarget` (e.g. to bound a DOM walk-up)
// are covered.

import { useCallback, useEffect, useRef } from 'react';

// Mobile Safari/Chrome finalize a touch-driven text selection a beat after touchend fires.
const DEFAULT_SETTLE_MS = 50;

export interface LongPressSelectionMenuHandlers {
  onContextMenu: (e: React.MouseEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
}

/**
 * @param buildMenu Pure: given the triggering element and release coordinates, return the menu
 *   state to show, or null if there's nothing to show (e.g. no selection) — in which case the
 *   native context menu / native selection callout is left alone.
 * @param onMenu Called with the built menu state when `buildMenu` returns non-null.
 * @param settleDelayMs Touch-only: delay after touchend before checking the selection. Default 50ms.
 */
export function useLongPressSelectionMenu<T>(
  buildMenu: (container: EventTarget | null, x: number, y: number) => T | null,
  onMenu: (menu: T) => void,
  settleDelayMs: number = DEFAULT_SETTLE_MS,
): LongPressSelectionMenuHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    const menu = buildMenu(e.currentTarget, e.clientX, e.clientY);
    if (!menu) return; // no selection → let the native/desktop context menu win
    e.preventDefault();
    onMenu(menu);
  }, [buildMenu, onMenu]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const container = e.currentTarget;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const x = touch.clientX;
    const y = touch.clientY;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const menu = buildMenu(container, x, y);
      if (menu) onMenu(menu);
    }, settleDelayMs);
  }, [buildMenu, onMenu, settleDelayMs]);

  return { onContextMenu, onTouchEnd };
}
