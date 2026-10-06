// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import './OrphanedTagsBanner.css';

const SHOWN_IDS = 3;

/**
 * Non-blocking notice for t/3984 (SO e/253#2 note): the save succeeded, but untouched nodes still carry
 * POV tags the registry no longer has, usually because a registry change skipped its data migration.
 * The save gate (t/3973) lets those nodes save so one missed migration can't block editing; this makes
 * the orphans visible to the person saving, who is the one most likely to report them.
 */
export function OrphanedTagsBanner() {
  const ids = useTaxonomyStore((s) => s.orphanedTagNodeIds) ?? []; // partial store mocks in other suites
  const dismiss = useTaxonomyStore((s) => s.dismissOrphanedTagNotice);

  if (ids.length === 0) return null;

  const shown = ids.slice(0, SHOWN_IDS).join(', ');
  const more = ids.length > SHOWN_IDS ? `, +${ids.length - SHOWN_IDS} more` : '';
  return (
    <div className="orphaned-tags-banner" role="status" aria-live="polite">
      <span className="orphaned-tags-banner-text">
        Saved. {ids.length} {ids.length === 1 ? 'node carries' : 'nodes carry'} POV tags no longer in the
        registry ({shown}{more}). Report this to the registry owner: a tag was likely removed without migrating its data.
      </span>
      <button className="orphaned-tags-banner-dismiss" onClick={dismiss} aria-label="Dismiss orphaned-tags notice">
        &times;
      </button>
    </div>
  );
}
