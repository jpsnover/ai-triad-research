// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * EntryDetailRouter — renders the entry detail panel for a selected transcript entry.
 *
 * Extracted from DiagnosticsWindow.tsx (lines 3830-8268).
 * Includes: entry header, proxied moderator trace, tab bar, tab content routing,
 * and text copy context menu.
 *
 * Data derivation lives in ./EntryDetailRouter.model (hook + pure helpers); the
 * header / moderator-trace / tab-bar / tab-content JSX lives in
 * ./EntryDetailRouter.parts. This shell wires them together (ADR-007 line-slice
 * decomposition of the former 197-cyclomatic component, t/1877 — behavior-preserving).
 *
 * Four tabs delegate to extracted components:
 *   - DraftTab, ClaimsTab, EvidenceTab, CitationsTab (from ./entry-tabs)
 *
 * Remaining tabs (moderator, details, brief, plan, lookahead, cite, tax-refs)
 * are rendered inline (see ./EntryDetailRouter.parts EntryTabContent).
 */

import React from 'react';
import type {
  DebateSession,
  EntryDiagnostics,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  CommitmentStore,
  TurnValidationTrail,
} from '../../../types/debate';
import { type TaxRefEdge } from '../../taxonomy/TaxonomyRefDetail';
import { EntryTab, OverviewTab, UtilitySnapshot } from './types';
import { useEntryDetailRouterModel } from './EntryDetailRouter.model';
import { EntryHeader, ProxiedModeratorTrace, EntryTabBar, EntryTabContent } from './EntryDetailRouter.parts';
import './EntryDetailRouter.css';

// ---------------------------------------------------------------------------
// Props interface
// ---------------------------------------------------------------------------

export interface EntryDetailRouterProps {
  debate: DebateSession;
  entry: DebateSession['transcript'][number];
  entryIdx: number;
  diag: EntryDiagnostics | undefined;
  meta: Record<string, unknown> | undefined;
  turnValTrail: TurnValidationTrail | undefined;
  an: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] } | undefined;
  commitments: Record<string, CommitmentStore> | undefined;
  entryTab: EntryTab;
  setEntryTab: (tab: EntryTab) => void;
  effectiveOverviewTab: OverviewTab;
  selectedEntry: string | null;
  setSelectedEntry: (id: string | null) => void;
  setOverviewTab: (tab: OverviewTab) => void;
  setLocalOverride: (v: boolean) => void;
  proxiedModeratorTrace: Record<string, unknown> | null;
  taxNodeMap: Map<string, Record<string, unknown>>;
  policyMap: Map<string, { id: string; action: string; source_povs: string[]; member_count: number }>;
  allEdges: TaxRefEdge[];
  nodeWeights: Map<string, { confidence?: number; priority?: number; operationality?: number; category?: string }>;
  selectedTaxRefId: string | null;
  setSelectedTaxRefId: (id: string | null) => void;
  selectedPolicyId: string | null;
  setSelectedPolicyId: (id: string | null) => void;
  textCopyMenu: { x: number; y: number; text: string } | null;
  setTextCopyMenu: (menu: { x: number; y: number; text: string } | null) => void;
  tabContentRef: React.RefObject<HTMLDivElement | null>;
  searchQuery: string;
  perTurnUtilities: UtilitySnapshot[];
  nodeLabels: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EntryDetailRouter(props: EntryDetailRouterProps) {
  const { proxiedModeratorTrace, textCopyMenu, setTextCopyMenu, tabContentRef } = props;
  const model = useEntryDetailRouterModel(props);

  return (
    <div className="edr-root">
      {/* ── Entry header ── */}
      <EntryHeader p={props} m={model} />

      {/* ── Proxied moderator trace for system entries ── */}
      {proxiedModeratorTrace && <ProxiedModeratorTrace trace={proxiedModeratorTrace} />}

      {/* ── Tabbed view ── */}
      <div className="edr-tabbed-view">
        <EntryTabBar p={props} m={model} />
        <EntryTabContent p={props} m={model} />

        {/* ── Text copy context menu ── */}
        {textCopyMenu && (
          <div
            onMouseDown={e => e.stopPropagation()}
            className="edr-context-menu"
            style={{ left: textCopyMenu.x, top: textCopyMenu.y }}
          >
            <button
              onClick={() => { void navigator.clipboard.writeText(textCopyMenu.text); setTextCopyMenu(null); }}
              className="edr-context-menu-item"
            >Copy</button>
            <button
              onClick={() => {
                if (tabContentRef.current) {
                  const range = document.createRange();
                  range.selectNodeContents(tabContentRef.current);
                  const sel = window.getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                }
                setTextCopyMenu(null);
              }}
              className="edr-context-menu-item"
            >Select All</button>
          </div>
        )}
      </div>
    </div>
  );
}
