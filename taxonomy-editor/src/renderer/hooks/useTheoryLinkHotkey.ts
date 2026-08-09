// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * useTheoryLinkHotkey (t/2343) — app-root F1 handler that activates the nearest
 * TheoryLink. Register once at each window root; the popout is a separate
 * document so it must register too (App.tsx renders it, and DebatePopoutWindow
 * registers as well — the ref-counted guard below makes double-registration a
 * no-op, so exactly one keydown listener exists per document and F1 fires once).
 *
 * Resolution is pure-DOM (no registry): from the focused element, climb ancestors
 * and take the nearest enclosing section that contains a visible TheoryLink;
 * within that section (or as a whole-document fallback) pick the geometrically
 * nearest one. If no TheoryLink is present we do NOT preventDefault, leaving F1's
 * default behavior intact.
 */

import { useEffect } from 'react';

const SELECTOR = '.theory-link[data-theory-link]';

function isVisible(el: HTMLElement): boolean {
  // offsetParent is null for display:none (and fixed elements, which we don't use here).
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

function visibleLinks(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(SELECTOR)).filter(isVisible);
}

function centerDistanceSq(a: DOMRect, b: DOMRect): number {
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2;
  const by = b.top + b.height / 2;
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

function geometricNearest(candidates: HTMLElement[], ref: Element): HTMLElement {
  const refRect = ref.getBoundingClientRect();
  let best = candidates[0];
  let bestD = Infinity;
  for (const el of candidates) {
    const d = centerDistanceSq(refRect, el.getBoundingClientRect());
    if (d < bestD) {
      bestD = d;
      best = el;
    }
  }
  return best;
}

/** Returns true if a TheoryLink was found and activated. */
export function activateNearestTheoryLink(): boolean {
  const all = visibleLinks();
  if (all.length === 0) return false;
  const allSet = new Set(all);
  const active = document.activeElement as HTMLElement | null;

  // 1. Ancestor-walk: nearest enclosing section that contains a visible TheoryLink
  //    ("the section you're in"), with geometric tie-break inside that section.
  if (active && active !== document.body) {
    let node: HTMLElement | null = active;
    while (node) {
      const within = Array.from(node.querySelectorAll<HTMLElement>(SELECTOR)).filter((el) => allSet.has(el));
      if (within.length > 0) {
        (within.length === 1 ? within[0] : geometricNearest(within, active)).click();
        return true;
      }
      node = node.parentElement;
    }
  }

  // 2. Fallback: geometrically nearest to the focused element (or viewport-ish body).
  geometricNearest(all, active ?? document.body).click();
  return true;
}

// Module-level ref-counted listener: multiple callers in the same document share
// ONE keydown listener, so App.tsx + DebatePopoutWindow both registering never
// double-fires F1. Per-document module state (each BrowserWindow has its own JS
// context), so every window still gets its own single listener.
let listenerCount = 0;
let handler: ((e: KeyboardEvent) => void) | null = null;

function ensureListener(): void {
  if (listenerCount === 0) {
    handler = (e: KeyboardEvent) => {
      if (e.key !== 'F1') return;
      if (activateNearestTheoryLink()) e.preventDefault();
    };
    window.addEventListener('keydown', handler, true);
  }
  listenerCount += 1;
}

function releaseListener(): void {
  listenerCount -= 1;
  if (listenerCount <= 0) {
    listenerCount = 0;
    if (handler) {
      window.removeEventListener('keydown', handler, true);
      handler = null;
    }
  }
}

export function useTheoryLinkHotkey(): void {
  useEffect(() => {
    ensureListener();
    return releaseListener;
  }, []);
}
