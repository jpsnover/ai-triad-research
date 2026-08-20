// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Brief Export wiring for the debate detail view (t/2805, T7). Extracted as a hook so the
// dialog + exports-list state stays out of DebateTab (ADR-007 file-size ceiling). Web-only
// v1: the exports list renders for closed debates on the web build; the dialog opens on
// demand from the ExportDropdown "Brief…" item.

import { useState, type ReactNode } from 'react';
import { BriefExportDialog } from './BriefExportDialog';
import { BriefExportsList } from './BriefExportsList';
import type { SessionRowData } from './DebateTable';

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
): { openRowBrief: (s: SessionRowData) => void; rowBriefNode: ReactNode } {
  const [session, setSession] = useState<SessionRowData | null>(null);
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
