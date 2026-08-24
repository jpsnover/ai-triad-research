// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { KeyboardEvent } from 'react';

export interface InlineEditTitleProps {
  value: string;
  onChange: (value: string) => void;
  /** Optional blur handler (e.g. NodeDetail's aphorism regen). */
  onBlur?: () => void;
  /** Applies the `has-error` class (validation banner mirror). */
  hasError?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

/**
 * Auto-growing inline-edit title for the node/situation detail headers (t/2937).
 *
 * Renders a `<textarea>`, NOT an `<input>`: a long title must WRAP to multiple lines instead of
 * truncating with an ellipsis, and an `<input>` is single-line by HTML spec — no CSS can wrap it
 * (which is why the two prior CSS-only fixes did nothing; t/2937#3). Height auto-grows to the
 * wrapped content via CSS `field-sizing: content` on `.nd-header-label-editable` (Chromium 123+/
 * Electron 35). Enter COMMITS (blur) rather than inserting a literal newline — titles are single-
 * value, and the store is already updated live via onChange, so blur is the natural commit point.
 */
export function InlineEditTitle({ value, onChange, onBlur, hasError, placeholder, ariaLabel }: InlineEditTitleProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Any Enter commits (never a newline) — a title carries no line breaks; wrapping is visual only.
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  return (
    <textarea
      className={`nd-header-label nd-header-label-editable ${hasError ? 'has-error' : ''}`}
      value={value}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      aria-label={ariaLabel}
      title={value}
    />
  );
}
