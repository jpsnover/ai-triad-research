// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * BookmarkLink (t/2393) — small inline bookmark affordance that opens a GitHub
 * explainer doc in the system browser. Used throughout the debate diagnostics UI
 * (wiring tracked separately in t/2394).
 *
 * The consumer passes a repo-relative `docPath` (+ optional `anchor`); the
 * GitHub blob URL is constructed here so callers never hand-assemble it. Opening
 * routes through the bridge (`api.openExternal`) — never shell/window directly —
 * so it works in both the Electron (shell.openExternal) and web (window.open,
 * https-guarded) builds and never navigates the Electron window itself.
 */

import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './BookmarkLink.css';
// buildDocUrl is owned by the canonical doc-link control now (t/2410); BookmarkLink is
// being retired once diagnostics migrate off it, so it consumes the shared builder.
import { buildDocUrl } from './TheoryLink';

export interface BookmarkLinkProps {
  /** Repo-relative path to the doc, e.g. "docs/reading-the-argument-network.md". */
  docPath: string;
  /** Optional anchor within the doc, e.g. "computed-strength-vs-base-strength". */
  anchor?: string;
  /** Tooltip + accessible label shown on hover. Defaults to "Learn more". */
  label?: string;
  /** Size variant. Defaults to "sm". */
  size?: 'xs' | 'sm' | 'md';
  /** Extra class(es) for inline positioning by consumers — appended to the base classes. */
  className?: string;
}

export function BookmarkLink({ docPath, anchor, label = 'Learn more', size = 'sm', className }: BookmarkLinkProps) {
  const handleOpen = () => {
    const url = buildDocUrl(docPath, anchor);
    void api.openExternal(url).catch((err) => {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'bookmark-link',
        level: 'error',
        message: 'Failed to open bookmark link externally',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    });
  };

  return (
    <button
      type="button"
      className={`bookmark-link bookmark-link--${size} ${className ?? ''}`.trim()}
      role="link"
      aria-label={label}
      title={label}
      onClick={handleOpen}
    >
      {/* Bookmark glyph (currentColor so it can be tinted muted → hover-brighten) */}
      <svg className="bookmark-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}
