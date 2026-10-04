// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3894 fix A: the data-repo commit must refuse when no data-producing step ran.
// f9cb8ef4 (09-29) was a lone git-commit step (Run-Id: no-run-id, no Steps: trailer)
// that staged the shared data checkout's accumulated WIP — 78 files — as "pipeline(adhoc)".

import { describe, it, expect } from 'vitest';
import { buildGitCommitCommand } from './pipeline';

const ROOT = 'C:/data';

describe('buildGitCommitCommand — zero-step refusal (t/3894 fix A)', () => {
  it('refuses when the git-commit step runs on its own with no threaded steps (the f9cb8ef4 shape)', () => {
    expect(() => buildGitCommitCommand(ROOT, { commitMessage: 'automated data pipeline update' }))
      .toThrow(/Refusing to commit: no data-producing pipeline step ran/);
  });

  it('refuses an explicitly empty step list', () => {
    expect(() => buildGitCommitCommand(ROOT, { steps: [], runId: 'r1', touchedDirs: ['summaries'] }))
      .toThrow(/Refusing to commit/);
  });

  it('never produces the old "pipeline(adhoc)" subject', () => {
    for (const config of [{}, { steps: [] }, { steps: 'not-an-array' }]) {
      let cmd = '';
      try { cmd = buildGitCommitCommand(ROOT, config); } catch { /* refusal is the expected outcome */ }
      expect(cmd).not.toContain('pipeline(adhoc)');
    }
  });

  it('still builds a scoped commit when a data-producing step ran', () => {
    const cmd = buildGitCommitCommand(ROOT, { steps: ['summarize'], runId: 'r1', commitSummary: 'did it', touchedDirs: ['summaries'] });
    expect(cmd).toContain('pipeline(summarize): did it');
    expect(cmd).toContain('Steps: summarize');
    expect(cmd).toContain("git add -- $surfaces");
  });
});
