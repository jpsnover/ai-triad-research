// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// AppAPI completeness guard (t/2223) — ensures every method declared in the
// AppAPI interface in types.ts is present in both electron-bridge.ts and
// web-bridge.ts.  Catches t/2221-class gaps (missing delegate) at PR time
// rather than at runtime, bypassing the renderer tsc ratchet ceiling.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

function extractAppApiMethods(src: string): string[] {
  const marker = 'export interface AppAPI {';
  const start = src.indexOf(marker);
  if (start === -1) throw new Error('AppAPI interface not found in types.ts');
  // Skip to the opening brace of the interface body.
  let i = src.indexOf('{', start) + 1;
  const names = new Set<string>();
  // Track depth WITHIN the interface body; only extract names at depth 0/0.
  // braceDepth: nested {} (object types in signatures)
  // parenDepth: nested () (multi-line parameter lists)
  let braceDepth = 0;
  let parenDepth = 0;
  let lineStart = i;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') {
      braceDepth++;
    } else if (ch === '}') {
      if (braceDepth === 0) break; // closing brace of AppAPI itself
      braceDepth--;
    } else if (ch === '(') {
      parenDepth++;
    } else if (ch === ')') {
      if (parenDepth > 0) parenDepth--;
    } else if (ch === '\n') {
      if (braceDepth === 0 && parenDepth === 0) {
        const line = src.slice(lineStart, i);
        const trimmed = line.trimStart();
        // Match required members only: "  methodName(" or "  propName:" — skip optional "propName?:".
        const m = trimmed.match(/^(\w+)\s*[(:]/);
        if (m && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
          names.add(m[1]);
        }
      }
      lineStart = i + 1;
    }
    i++;
  }
  return [...names];
}

function bridgeHasKey(src: string, key: string): boolean {
  // Match the key as a property name at the start of a line (inside an object literal).
  return new RegExp(`^\\s+${key}\\s*[:(]`, 'm').test(src);
}

describe('AppAPI completeness', () => {
  const types = readFileSync(resolve(dir, 'types.ts'), 'utf-8');
  const electron = readFileSync(resolve(dir, 'electron-bridge.ts'), 'utf-8');
  const web = readFileSync(resolve(dir, 'web-bridge.ts'), 'utf-8');

  const methods = extractAppApiMethods(types);

  it('electron-bridge.ts implements all AppAPI methods (t/2221-class gap guard)', () => {
    const missing = methods.filter(m => !bridgeHasKey(electron, m));
    expect(missing, `Missing from electron-bridge.ts: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('web-bridge.ts implements all AppAPI methods', () => {
    const missing = methods.filter(m => !bridgeHasKey(web, m));
    expect(missing, `Missing from web-bridge.ts: ${missing.join(', ')}`).toHaveLength(0);
  });
});
