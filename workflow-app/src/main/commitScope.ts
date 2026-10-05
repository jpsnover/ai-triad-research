// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Commit exactly what this pipeline run changed (t/3894 fixes C + D; design t/3894#5,
// approved t/3894#6). The data checkout is shared: other agents' WIP, the editor's
// harvest-on-save, and stray files sit in it. f9cb8ef4 committed 78 files of that as one
// pipeline run. Nothing here stages by directory or with -A/--all: only explicit paths that
// changed while the run was active.
//
//   C  baseline = dirty paths + content hashes before the run's first data-producing step.
//      At commit: changed-during-run → stage; dirty-at-start and unchanged → exclude;
//      dirty-at-start and changed → refuse (whose change is it?); no baseline → refuse.
//   D  every staged path must lie under a surface declared by a step that ran
//      (PIPELINE_STEPS[].writes) — a concurrent writer elsewhere in the tree is refused.
//
// Residual (t/3894#5): a concurrent writer INSIDE a declared surface during the run passes
// both checks. Only the data-repo commit hooks (t/3892) or after-push detection see it.

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface DirtyEntry {
  /** Two-letter porcelain v1 status (e.g. ' M', '??', ' D'). */
  status: string;
  /** git blob hash of the working-tree content, or 'deleted' when the file is absent. */
  hash: string;
}

export type DirtySnapshot = Record<string, DirtyEntry>;

export interface Baseline {
  takenAt: string;
  entries: DirtySnapshot;
}

export type CommitPlan =
  | { ok: true; paths: string[]; warnings: string[] }
  | { ok: false; reason: string };

const BASELINE_STALE_MS = 24 * 60 * 60 * 1000;

function git(repo: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
}

/** Parse `git status --porcelain=v1 -z -uall`. A rename/copy entry is followed by its source path. */
export function parsePorcelainZ(out: string): Array<{ status: string; path: string }> {
  const fields = out.split('\0');
  const entries: Array<{ status: string; path: string }> = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field.length < 4) continue;
    const status = field.slice(0, 2);
    entries.push({ status, path: field.slice(3) });
    if (status.includes('R') || status.includes('C')) i++; // skip the source path
  }
  return entries;
}

/** Dirty paths in the data checkout, each with the hash of its current content. */
export function snapshotDirty(repo: string): DirtySnapshot {
  const entries = parsePorcelainZ(git(repo, ['status', '--porcelain=v1', '-z', '-uall']));
  const present = entries.filter(e => fs.existsSync(path.join(repo, e.path)));
  const hashes = present.length
    ? git(repo, ['hash-object', '--stdin-paths'], present.map(e => e.path).join('\n') + '\n').trim().split('\n')
    : [];
  const hashByPath = new Map(present.map((e, i) => [e.path, hashes[i]]));
  const snapshot: DirtySnapshot = {};
  for (const e of entries) snapshot[e.path] = { status: e.status, hash: hashByPath.get(e.path) ?? 'deleted' };
  return snapshot;
}

/** True when `p` is a declared surface or lies under a declared directory surface. */
export function underSurface(p: string, surfaces: string[]): boolean {
  return surfaces.some(s => {
    const surface = s.replace(/\/+$/, '');
    return p === surface || p.startsWith(`${surface}/`);
  });
}

/** Decide what to commit. Pure: no git, no I/O. */
export function planCommit(
  baseline: Baseline | null,
  current: DirtySnapshot,
  allowedSurfaces: string[],
  now: Date = new Date(),
): CommitPlan {
  if (!baseline) {
    return { ok: false, reason: 'Refusing to commit: there is no record of the data checkout\'s state when this run started (no data-producing step has run since the last commit, or the app restarted mid-run). Re-run the steps, then commit. (t/3894)' };
  }
  const changed: string[] = [];
  const ambiguous: string[] = [];
  for (const [p, entry] of Object.entries(current)) {
    const before = baseline.entries[p];
    if (!before) changed.push(p);
    // Content decides, not status: a peer merely staging an already-dirty file flips its
    // status (' M' → 'M ') without changing it, and must not read as a change by this run.
    else if (before.hash !== entry.hash) ambiguous.push(p);
    // else: dirty before the run and untouched since — someone else's work, excluded.
  }
  if (ambiguous.length) {
    return { ok: false, reason: `Refusing to commit: ${ambiguous.length} file(s) already had uncommitted changes when this run started AND changed during it, so the commit can't tell whose change it would be recording: ${ambiguous.sort().join(', ')}. Commit or discard the earlier changes, then re-run. (t/3894)` };
  }
  if (!changed.length) {
    return { ok: false, reason: 'Refusing to commit: nothing in the data checkout changed during this run. (t/3894)' };
  }
  const outside = changed.filter(p => !underSurface(p, allowedSurfaces));
  if (outside.length) {
    return { ok: false, reason: `Refusing to commit: ${outside.length} file(s) changed during this run outside what its steps write (${allowedSurfaces.join(', ') || 'nothing'}) — likely another writer working in the shared checkout: ${outside.sort().join(', ')}. Leave them for their owner, then commit. (t/3894)` };
  }
  const warnings: string[] = [];
  const ageMs = now.getTime() - new Date(baseline.takenAt).getTime();
  if (ageMs > BASELINE_STALE_MS) {
    warnings.push(`The run's baseline is ${Math.round(ageMs / 3_600_000)}h old (taken ${baseline.takenAt}); files changed by others since then can only be told apart if they were already dirty at that time.`);
  }
  return { ok: true, paths: changed.sort(), warnings };
}

/** Stage and commit exactly `paths`. Returns the git output to stream to the step log. */
export function executeCommit(repo: string, paths: string[], message: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-commit-'));
  const pathspecFile = path.join(dir, 'pathspec');
  const messageFile = path.join(dir, 'message');
  fs.writeFileSync(pathspecFile, paths.join('\0'));
  fs.writeFileSync(messageFile, message);
  const pathspecArgs = [`--pathspec-from-file=${pathspecFile}`, '--pathspec-file-nul'];
  try {
    // Activate the data-repo hooks (t/2958 Arm 2 Option B). Idempotent.
    git(repo, ['config', 'core.hooksPath', '.githooks']);
    // Explicit paths only — never -A/--all/a directory. Deletions stage via the explicit path.
    const added = git(repo, ['add', ...pathspecArgs]);
    // A pathspec commit commits ONLY these paths, whatever else is in the shared index (a
    // peer's staged files stay staged and out of this commit — t/3670). Git builds a temporary
    // index from HEAD plus these paths and points GIT_INDEX_FILE at it, so the data repo's
    // commit hooks (rationale guard, node-removal guard t/3851) see only this run's paths,
    // not the shared index (verified for these hooks at t/3851#5).
    try {
      return added + git(repo, ['commit', ...pathspecArgs, '-F', messageFile]);
    } catch (err) {
      // A refused commit (e.g. a data-repo hook) must not leave this run's paths staged in
      // the shared index, where a peer's bare `git commit` would sweep them up. Index only;
      // the working-tree content is untouched.
      git(repo, ['restore', '--staged', ...pathspecArgs]);
      throw err;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
