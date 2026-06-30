// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Extract query params from a URL hash fragment.
 *
 * Handles formats like `#chat-window?id=abc`, `#/debate?id=abc&source=community`,
 * or bare `#?id=abc`. Returns an empty URLSearchParams when no `?` is present.
 */
export function parseHashParams(hash: string): URLSearchParams {
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(qIndex + 1));
}
