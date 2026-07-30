// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { DetailPane } from './DetailPane';
import { useDebateStore } from '../../hooks/useDebateStore';
import './GlobalDetailPaneHost.css';

/**
 * App-level host for the shared ref → DetailPane contract (t/1987, topology t/1987#2).
 *
 * Rendered once in `App.tsx` after the main tab content, inside the `.app-body` flex
 * row. Reads the GLOBAL `selectedRef` from the debate store, so a FactsPanel or
 * read-only mention ref-link click in ANY main tab that renders in the shared app
 * shell — PovTab, Situations, Conflicts, Cruxes, Debate, … — opens this one pane.
 * A single mount replaces what would otherwise be a per-tab host (the dead-click gap
 * hit PovTab/t/1906, Cruxes, and DebateUI/t/1905 alike).
 *
 * Standalone contexts — the Chat tab, the popped-out debate window, and the
 * EntityBrowser panel — keep their OWN co-mounted DetailPane; they render outside
 * this shell (or in a separate window/store context), so this host does not cover
 * them and must not double-mount over them.
 *
 * Store-fed today; stays compatible with t/1977's `onSelectRef` DI when it lands
 * (TL p/56#176). A11y (focus capture + Escape) is inherited from the shared
 * DetailPane (t/1925); Design re-verifies it live in this mount context before
 * t/1905 / t/1906 close.
 */
export function GlobalDetailPaneHost() {
  const selectedRef = useDebateStore((s) => s.selectedRef);
  const setSelectedRef = useDebateStore((s) => s.setSelectedRef);

  if (!selectedRef) return null;

  return (
    <DetailPane
      className="app-detail-pane"
      selectedRef={selectedRef}
      onSelectRef={setSelectedRef}
      onClose={() => setSelectedRef(null)}
    />
  );
}
