// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Pure, renderer-safe HTTP URL extraction (t/2483#2).
 * Zero node:* imports — importable from server, Electron main, and renderer alike.
 * Direct import path only; not re-exported from any barrel.
 */

const HTTP_URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/**
 * Extract unique http/https URLs from a block of text.
 * @param text  Input text (chat message, prompt, etc.)
 * @param max   Maximum number of URLs to return. Default: 10.
 */
export function extractHttpUrls(text: string, max = 10): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  let match: RegExpExecArray | null;
  HTTP_URL_RE.lastIndex = 0;
  while ((match = HTTP_URL_RE.exec(text)) !== null) {
    const url = match[0].replace(/[.,;:!?]+$/, ''); // strip trailing punctuation
    if (!seen.has(url)) {
      seen.add(url);
      results.push(url);
      if (results.length >= max) break;
    }
  }
  return results;
}
