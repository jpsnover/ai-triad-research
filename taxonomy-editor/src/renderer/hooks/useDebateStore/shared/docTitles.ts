// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Cached source-document catalog fetch. Extracted from generation.ts (t/1779) into a
// STORE-FREE module. Reason: generation.ts imports the debate store, and `sessionSlice`
// is the FIRST slice `store.ts` instantiates — importing generation from sessionSlice
// created a module load-order cycle (store → createSessionSlice before sessionSlice had
// finished exporting it). This module imports only the bridge + flight recorder, so any
// slice (including sessionSlice) can use it without a cycle. generation.ts re-exports
// `getDocTitles` from here so its existing importers are unchanged.

import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type { DocMetaMap } from '@lib/debate/evidenceFromSummaries';

// Both backends (Electron IPC `load-doc-titles` + web `GET /api/doc-titles`) return a
// DocMetaMap (doc_id → { title, resolved_url?, provenance_label? }); the prior
// `Record<string,string>` typing understated it. Callers pass it as the pipeline's
// `DocTitleMap | DocMetaMap`, so the honest type is safe.
let _cachedDocTitles: DocMetaMap | null | undefined;
export async function getDocTitles(): Promise<DocMetaMap | undefined> {
  if (_cachedDocTitles !== undefined) return _cachedDocTitles ?? undefined;
  try {
    const bridge = api as unknown as { loadDocTitles?: () => Promise<DocMetaMap | null> };
    if (!bridge.loadDocTitles) { _cachedDocTitles = null; return undefined; }
    const result = await bridge.loadDocTitles();
    _cachedDocTitles = result;
    return result ?? undefined;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'debate-store',
      level: 'warn',
      message: 'Failed to load doc titles',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    _cachedDocTitles = null;
    return undefined;
  }
}
