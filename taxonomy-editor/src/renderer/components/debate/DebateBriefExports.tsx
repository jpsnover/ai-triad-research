// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Brief Export wiring for the debate detail view (t/2805, T7). Extracted as a hook so the
// dialog + exports-list state stays out of DebateTab (ADR-007 file-size ceiling). Web-only
// v1: the exports list renders for closed debates on the web build; the dialog opens on
// demand from the ExportDropdown "Brief…" item.

import { useState, type ReactNode } from 'react';
import { BriefExportDialog } from './BriefExportDialog';
import { BriefExportsList } from './BriefExportsList';

/** Minimal shape a row must supply to open a brief export — satisfied by both a My-debate
 *  SessionRowData and a Community CommunityDebate, so either list can trigger the dialog.
 *  `phase` is required here; community rows carry an optional phase, so DebateTab coerces a
 *  missing one to '' (⇒ not-'closed' ⇒ the dialog's closed-only explanation — brief is
 *  closed-only for v1 per BriefExportDialog TL ruling A). */
export type BriefTarget = { id: string; title: string; phase: string };

export function useDebateBriefExports(
  debate: { id: string; title: string; phase: string },
  isElectron: boolean,
): { openBrief: () => void; node: ReactNode } {
  const [showBrief, setShowBrief] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const node = (
    <>
      {!isElectron && debate.phase === 'closed' && (
        <BriefExportsList debateId={debate.id} refreshKey={refresh} />
      )}
      {showBrief && (
        <BriefExportDialog
          debateId={debate.id}
          debateTitle={debate.title}
          debatePhase={debate.phase}
          onClose={() => setShowBrief(false)}
          onExported={() => setRefresh(k => k + 1)}
        />
      )}
    </>
  );

  return { openBrief: () => setShowBrief(true), node };
}

/** Row-level brief export: manages session selection + dialog mount (t/2805 follow-up). */
export function useRowBriefExport(
  isElectron: boolean,
): { openRowBrief: (s: BriefTarget) => void; rowBriefNode: ReactNode } {
  const [session, setSession] = useState<BriefTarget | null>(null);
  const rowBriefNode = session && !isElectron ? (
    <BriefExportDialog
      debateId={session.id}
      debateTitle={session.title}
      debatePhase={session.phase}
      onClose={() => setSession(null)}
      onExported={() => setSession(null)}
    />
  ) : null;
  return { openRowBrief: (s) => setSession(s), rowBriefNode };
}
