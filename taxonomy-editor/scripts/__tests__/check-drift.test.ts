// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3841: check-drift.cjs's advice could prescribe a sync command that cannot run in the
// state it just detected (merge --ff-only while also ahead) and advise `stash` on the shared
// checkout (a prohibited, worktree-only verb) for content that should be committed or restored.
// evaluate() stays pure (testable directly with synthetic state); report() is the impure side
// that prints the advice text, tested here by stubbing process.stderr.write.

import { createRequire } from 'node:module';
import { describe, it, expect, vi, afterEach } from 'vitest';

const require = createRequire(import.meta.url);
const { evaluate, report } = require('../check-drift.cjs') as {
  evaluate: (state: Record<string, unknown>) => { kind: string; problems: string[]; stale: boolean; diverged: boolean };
  report: (result: { kind: string; problems: string[]; stale: boolean; diverged: boolean }, state: Record<string, unknown>) => void;
};

// Base state for a main checkout in a work tree, nothing wrong.
function baseState(overrides: Record<string, unknown> = {}) {
  return {
    isWorkTree: true,
    isMainCheckout: true,
    ahead: 0,
    behind: 0,
    dirtyCount: 0,
    dirtyPhantom: [] as string[],
    dirtyReal: [] as string[],
    branch: 'main',
    fetchAgeHours: 1,
    fetchMode: false,
    ...overrides,
  };
}

describe('check-drift evaluate() — kind decision', () => {
  it('clean current main checkout → none (silent)', () => {
    expect(evaluate(baseState())).toEqual({ kind: 'none', problems: [], stale: false, diverged: false });
  });

  it('not a work tree → none, regardless of other fields', () => {
    expect(evaluate(baseState({ isWorkTree: false, behind: 29 })).kind).toBe('none');
  });

  it('linked worktree (not main checkout) → none, regardless of other fields', () => {
    expect(evaluate(baseState({ isMainCheckout: false, behind: 29, dirtyCount: 3 })).kind).toBe('none');
  });

  it('behind only (not ahead) → alarm, diverged:false, plain behind message', () => {
    const r = evaluate(baseState({ behind: 29 }));
    expect(r.kind).toBe('alarm');
    expect(r.diverged).toBe(false);
    expect(r.problems).toEqual(['29 commit(s) behind origin/main']);
  });

  it('ahead AND behind → alarm, diverged:true, message names both counts [FIRE]', () => {
    const r = evaluate(baseState({ ahead: 1, behind: 29 }));
    expect(r.kind).toBe('alarm');
    expect(r.diverged).toBe(true);
    expect(r.problems).toEqual(['29 commit(s) behind origin/main (and 1 ahead — diverged)']);
  });

  it('ahead only, behind=0 → does NOT alarm on its own (purely-ahead is normal in direct mode)', () => {
    const r = evaluate(baseState({ ahead: 3, behind: 0 }));
    expect(r.kind).toBe('none');
  });

  it('dirty tracked files → alarm', () => {
    expect(evaluate(baseState({ dirtyCount: 3 })).kind).toBe('alarm');
  });

  it('detached HEAD → alarm', () => {
    const r = evaluate(baseState({ branch: null }));
    expect(r.kind).toBe('alarm');
    expect(r.problems).toContain('detached HEAD (not on a branch)');
  });

  it('non-main branch → alarm', () => {
    const r = evaluate(baseState({ branch: 't3828-oped-prompt' }));
    expect(r.kind).toBe('alarm');
    expect(r.problems).toContain("on branch 't3828-oped-prompt', not 'main'");
  });

  it('stale fetch only (otherwise clean) → info, not alarm', () => {
    const r = evaluate(baseState({ fetchAgeHours: 10 }));
    expect(r.kind).toBe('info');
    expect(r.diverged).toBe(false);
  });
});

describe('check-drift report() — advice text', () => {
  let lines: string[];

  afterEach(() => { vi.restoreAllMocks(); });

  function captureReport(result: { kind: string; problems: string[]; stale: boolean; diverged: boolean }, state: Record<string, unknown>) {
    lines = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    report(result, state);
  }

  it('diverged → prints the divergence line, NOT the ff-only merge command [FIRE]', () => {
    const state = baseState({ ahead: 1, behind: 29 });
    captureReport(evaluate(state), state);
    const text = lines.join('');
    expect(text).toContain('Diverged from origin/main');
    expect(text).toContain('docs/shared-tree-divergence.md');
    expect(text).not.toContain('merge --ff-only origin/main');
  });

  it('behind only (not diverged) → prints the ff-only merge command, NOT the divergence line', () => {
    const state = baseState({ behind: 29 });
    captureReport(evaluate(state), state);
    const text = lines.join('');
    expect(text).toContain('merge --ff-only origin/main');
    expect(text).not.toContain('Diverged from origin/main');
  });

  it('real dirty files → names them, says commit/worktree, never "stash" [FIRE]', () => {
    const state = baseState({ dirtyCount: 2, dirtyReal: ['pnpm-lock.yaml', 'taxonomy-editor/package.json'] });
    captureReport(evaluate(state), state);
    const text = lines.join('');
    expect(text).toContain('pnpm-lock.yaml');
    expect(text).toContain('taxonomy-editor/package.json');
    expect(text).toContain('NEVER stash');
    expect(text.toLowerCase()).not.toMatch(/\bgit stash\b/);
  });

  it('phantom dirty files → advises git restore, names them', () => {
    const state = baseState({ dirtyCount: 1, dirtyPhantom: ['taxonomy-editor/src/server/__tests__/__snapshots__/routeTable.test.ts.snap'] });
    captureReport(evaluate(state), state);
    const text = lines.join('');
    expect(text).toContain('git restore --');
    expect(text).toContain('routeTable.test.ts.snap');
  });

  it('clean tree → zero output', () => {
    const state = baseState();
    captureReport(evaluate(state), state);
    expect(lines.join('')).toBe('');
  });
});
