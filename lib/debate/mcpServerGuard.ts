// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// H2 fix (t/2528): safe debate-ID validator for MCP load_debate.
// Inline until t/2526 ships the shared lib/electron-shared assertSafeId helper.

import path from 'path';

const SAFE_DEBATE_ID_RE = /^[A-Za-z0-9-]+$/;

/**
 * Validates a debate session ID before using it to construct a filesystem path.
 * Rejects traversal sequences, slashes, null bytes, and anything outside [A-Za-z0-9-].
 * Also asserts post-resolve containment within `debatesDir` as a second line of defence.
 */
export function assertSafeDebateId(id: string, debatesDir: string): void {
  if (!SAFE_DEBATE_ID_RE.test(id)) {
    throw new Error(`Invalid debate ID: must match /^[A-Za-z0-9-]+$/ (got: ${JSON.stringify(id)})`);
  }
  const resolved = path.resolve(debatesDir, `debate-${id}.json`);
  if (!resolved.startsWith(path.resolve(debatesDir) + path.sep)) {
    throw new Error('Invalid debate ID: path escapes debates directory');
  }
}
