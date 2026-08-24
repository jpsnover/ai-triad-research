import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { _guardShouldRefuse } = require('../generate-notices.cjs') as {
  _guardShouldRefuse: (branch: string, isLinkedWorktree: boolean, isCI: boolean) => boolean;
};

// t/2973: direct both-arms test for the shared-main preflight guard.
// PR CI runs on feature branches (branch≠main), so it can never exercise the
// branch=main arms. These tests verify the guard predicate directly so the
// CI=true exemption and worktree pass-through are proven before merge.
describe('generate-notices preflight guard', () => {
  it('refuses when branch=main, not a linked worktree, and CI is not set [FIRE]', () => {
    expect(_guardShouldRefuse('main', false, false)).toBe(true);
  });

  it('passes when branch=main and CI=true [CLEAN — the case that broke in t/2971]', () => {
    expect(_guardShouldRefuse('main', false, true)).toBe(false);
  });

  it('passes when branch=main and running inside a linked worktree [CLEAN]', () => {
    expect(_guardShouldRefuse('main', true, false)).toBe(false);
  });

  it('passes on any non-main branch [CLEAN — normal PR CI]', () => {
    expect(_guardShouldRefuse('devops/some-feature', false, false)).toBe(false);
  });
});
