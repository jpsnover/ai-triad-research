// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Lead review on t/4085 PR #3134 (MUST 2, SHOULD 3): proves the partial-upload-is-unknown
// and malformed-line-is-unknown rules directly, without a live `gh` call.
// Run: node --test operations/devops/collect-flake-heal-runs.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRunArtifacts } from './collect-flake-heal-runs.mjs';

test('MUST 2: complete upload (artifact count == job count), no bad lines -> ok', () => {
  assert.equal(classifyRunArtifacts({ shardArtifactCount: 6, expectedShards: 6, badLines: 0 }), 'ok');
});

test('MUST 2: PARTIAL upload (5 of 6 shard artifacts) -> unknown, not zero heals', () => {
  assert.equal(classifyRunArtifacts({ shardArtifactCount: 5, expectedShards: 6, badLines: 0 }), 'unknown');
});

test('MUST 2: more artifacts than jobs (stale/duplicate) is also not a clean match -> unknown', () => {
  assert.equal(classifyRunArtifacts({ shardArtifactCount: 7, expectedShards: 6, badLines: 0 }), 'unknown');
});

test('MUST 2: expectedShards unresolvable (0, e.g. jobs API returned nothing) -> unknown', () => {
  assert.equal(classifyRunArtifacts({ shardArtifactCount: 0, expectedShards: 0, badLines: 0 }), 'unknown');
});

test('SHOULD 3: a single malformed line on an otherwise-complete upload -> unknown', () => {
  assert.equal(classifyRunArtifacts({ shardArtifactCount: 6, expectedShards: 6, badLines: 1 }), 'unknown');
});

test('a complete, clean run with zero shard artifacts matching zero expected jobs is still unknown (expectedShards=0 guard)', () => {
  // Degenerate case: if the jobs API call itself failed and returned 0, we must not treat
  // 0-equals-0 as "a complete, empty match" -- that would silently read as ok with zero heals.
  assert.equal(classifyRunArtifacts({ shardArtifactCount: 0, expectedShards: 0, badLines: 0 }), 'unknown');
});
