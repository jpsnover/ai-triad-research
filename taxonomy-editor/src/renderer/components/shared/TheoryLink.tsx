// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * TheoryLink (t/2343) — shared open-book help affordance that opens an external
 * GitHub theory-notes doc. Muted glyph that brightens on hover (mirrors
 * .field-help-btn), with a small ↗ external-jump badge + tooltip so the
 * open-in-browser behavior is discoverable.
 *
 * Activation routes through the bridge (`api.openExternal`) — never shell/window
 * directly — so it works in both the Electron (shell.openExternal) and web
 * (window.open, https-guarded) builds.
 *
 * The `data-theory-link` attribute marks the button for the app-level F1
 * hotkey (see useTheoryLinkHotkey), which activates the nearest instance.
 */

import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './TheoryLink.css';

export interface TheoryLinkProps {
  /** Full GitHub blob URL to open externally. */
  url: string;
  /** Accessible label, distinct per instance (e.g. "Help: debate system overview"). */
  label: string;
  /** Glyph size in px, clamped to 14–16. Default 15. */
  size?: number;
  /** Hover tooltip text. Default "Open theory notes on GitHub". */
  tooltip?: string;
  /** Extra class(es) for inline positioning by consumers — appended to the base class. */
  className?: string;
}

const DEFAULT_TOOLTIP = 'Open theory notes on GitHub';

export function TheoryLink({ url, label, size = 15, tooltip = DEFAULT_TOOLTIP, className }: TheoryLinkProps) {
  const px = Math.min(16, Math.max(14, size));

  const handleOpen = () => {
    void api.openExternal(url).catch((err) => {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'theory-link',
        level: 'error',
        message: 'Failed to open theory link externally',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    });
  };

  return (
    <button
      type="button"
      className={`theory-link ${className ?? ''}`}
      data-theory-link
      aria-label={label}
      title={tooltip}
      onClick={handleOpen}
      // eslint-disable-next-line local/no-inline-style -- dynamic glyph size (14–16px) drives the 1em SVG
      style={{ fontSize: `${px}px` }}
    >
      {/* Open-book glyph (currentColor so it can be tinted muted → hover-brighten) */}
      <svg className="theory-link-book" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M2 4h6a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2H2z" />
        <path d="M22 4h-6a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2H22z" />
      </svg>
      {/* External-jump badge (↗) — visual affordance paired with the tooltip text */}
      <span className="theory-link-badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" focusable="false">
          <line x1="6" y1="18" x2="18" y2="6" />
          <polyline points="9 6 18 6 18 15" />
        </svg>
      </span>
    </button>
  );
}
