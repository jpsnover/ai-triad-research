// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4034: the post-save policy_actions.json recount's non-blocking notice. Either the counts are still
// stale (refused / failed), or, on desktop, they were written but the registry is uncommitted, and
// PowerShell registry writers refuse a dirty registry until it is committed (e/264#26).

import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import type { PolicyRecountNotice as Notice } from '../utils/policyRecount';
import './PolicyRecountNotice.css';

const MAX_IDS_SHOWN = 5;

function idList(ids: string[]): string {
  const shown = ids.slice(0, MAX_IDS_SHOWN).join(', ');
  return ids.length > MAX_IDS_SHOWN ? `${shown} (+${ids.length - MAX_IDS_SHOWN} more)` : shown;
}

export function policyRecountNoticeText(notice: Notice): string {
  if (notice.kind === 'needs-commit') {
    return `Policy registry counts updated for ${idList(notice.ids)}. Commit policy_actions.json before the next pipeline run, or that run will leave new policy actions unregistered.`;
  }
  const why = notice.reason === 'locked' ? 'another writer held the registry lock'
    : notice.reason === 'failed' ? 'the recount call failed'
    : `the recount was refused (${notice.reason})`;
  return `Saved, but policy registry counts were not updated for ${idList(notice.ids)}: ${why}. Save again later, or run Update-PolicyRegistry -Fix.`;
}

export function PolicyRecountNotice() {
  const notice = useTaxonomyStore(s => s.policyRecountNotice);
  const dismiss = useTaxonomyStore(s => s.dismissPolicyRecountNotice);
  if (!notice) return null;
  return (
    <div role="status" aria-live="polite" className={`policy-recount-notice policy-recount-notice--${notice.kind}`}>
      <span className="policy-recount-notice-text">{policyRecountNoticeText(notice)}</span>
      <button onClick={dismiss} aria-label="Dismiss" className="policy-recount-notice-dismiss">&times;</button>
    </div>
  );
}
