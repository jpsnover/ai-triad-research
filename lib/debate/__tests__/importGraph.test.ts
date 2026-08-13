// Renderer-safety regression test (t/2550).
//
// Asserts that lib/debate/comments.ts's transitive import graph does NOT reach
// 'child_process'. If this test fails, a Node-only module has been re-introduced
// into the renderer bundle's import chain — which crashes the Debate tab.
//
// This is a STATIC analysis test: it reads TypeScript source files and
// follows import statements without actually executing the modules.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Root of lib/debate source (one level up from __tests__)
const LIB_DEBATE_DIR = resolve(__dirname, '..');
// Root of lib/ (for resolving ../flight-recorder etc.)
const LIB_DIR = resolve(LIB_DEBATE_DIR, '..');

const IMPORT_RE = /^(?:import|export)\s[^'"]*?['"]([^'"]+)['"]/gm;

function tryResolveTs(specifier: string, fromDir: string): string | null {
  if (!specifier.startsWith('.')) return null;

  const base = specifier.replace(/\.js$/, '');
  const candidates = [
    resolve(fromDir, base + '.ts'),
    resolve(fromDir, base, 'index.ts'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function collectTransitiveSpecifiers(
  entryFile: string,
): { specifiers: Set<string>; visited: Set<string> } {
  const specifiers = new Set<string>();
  const visited = new Set<string>();

  function visit(filePath: string): void {
    if (visited.has(filePath)) return;
    visited.add(filePath);

    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      return;
    }

    let match: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(content)) !== null) {
      const specifier = match[1];
      specifiers.add(specifier);

      const resolved = tryResolveTs(specifier, dirname(filePath));
      if (resolved) visit(resolved);
    }
  }

  visit(entryFile);
  return { specifiers, visited };
}

describe('lib/debate/comments.ts import graph — renderer safety (t/2550)', () => {
  const entryFile = join(LIB_DEBATE_DIR, 'comments.ts');

  it('entry file exists', () => {
    expect(existsSync(entryFile)).toBe(true);
  });

  it('does not transitively import child_process', () => {
    const { specifiers, visited } = collectTransitiveSpecifiers(entryFile);

    const nodeBuiltins = [...specifiers].filter(
      s => s === 'child_process' || s === 'node:child_process',
    );

    if (nodeBuiltins.length > 0) {
      // Provide a useful diagnostic: which file introduced the import
      const offenders: string[] = [];
      for (const f of visited) {
        try {
          const content = readFileSync(f, 'utf-8');
          if (/['"](?:node:)?child_process['"]/.test(content)) {
            offenders.push(f.replace(LIB_DIR, '<lib>'));
          }
        } catch { /* skip */ }
      }
      expect.fail(
        `child_process found in comments.ts transitive import graph.\n` +
        `Offending files:\n${offenders.map(f => `  ${f}`).join('\n')}\n\n` +
        `Fix: move Node-only code to a separate module (e.g. lockHolder.ts) and inject ` +
        `it via callback so persistence.ts stays free of child_process imports.`,
      );
    }

    expect(nodeBuiltins).toHaveLength(0);
  });

  it('does not transitively import lockHolder.ts (Node-only module must stay out of renderer graph)', () => {
    const { specifiers } = collectTransitiveSpecifiers(entryFile);

    const lockHolderImports = [...specifiers].filter(
      s => s.includes('lockHolder'),
    );
    expect(lockHolderImports).toHaveLength(0);
  });

  it('persistence.ts source does not contain a top-level child_process import', () => {
    const persistenceFile = join(LIB_DEBATE_DIR, 'persistence.ts');
    const content = readFileSync(persistenceFile, 'utf-8');

    // Match a top-level (non-dynamic) import of child_process
    const hasTopLevelImport = /^import\s[^'"]*?['"](?:node:)?child_process['"]/m.test(content);
    expect(hasTopLevelImport).toBe(false);
  });
});
