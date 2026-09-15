// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Boots deep-linkable in-app URLs (t/3486): runs the matching registered route's
// restore() once at mount (a pasted URL reopens what it names) and again on every
// popstate (back/forward). Web only — Electron's renderer has no meaningful
// navigation history for this to react to.

import { useEffect } from 'react';
import { isElectronMode } from '@bridge';
import { findRoute } from './appRoutes';

function restoreFromLocation(): void {
  const match = findRoute(window.location.pathname);
  if (!match) return;
  const query = new URLSearchParams(window.location.search);
  match.route.restore(match.params, query);
}

export function useAppRoute(): void {
  useEffect(() => {
    if (isElectronMode()) return;
    restoreFromLocation();
    window.addEventListener('popstate', restoreFromLocation);
    return () => window.removeEventListener('popstate', restoreFromLocation);
  }, []);
}
