// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1295 (route extraction seam): the server-local state threaded into extracted
// route clusters (routes/*.ts). Read-mostly (TL t/1295#2) — expose live state
// via getters, not snapshots, so a cluster registered at module-load time never
// captures a stale value (e.g. githubBackend is assigned during async init).
// Grown per cluster as it's extracted; the debates slice uses nothing from it.

import type { GitHubAPIBackend } from '../storage/githubAPIBackend.js';
import type { SessionBranchManager } from '../storage/sessionBranchManager.js';
import type { FlightRecorder } from '../../../../lib/flight-recorder/flightRecorder.js';

export interface ServerCtx {
  /** Live GitHub API backend (null until initialised / in non-GitHub modes). */
  readonly getGithubBackend: () => GitHubAPIBackend | null;
  /** Live per-user session-branch manager (null in filesystem mode). (t/1295 sync) */
  readonly getSessionManager: () => SessionBranchManager | null;
  /** Best-effort broadcast of a committed taxonomy change to other web clients. */
  readonly broadcastTaxonomyUpdate: (
    backend: GitHubAPIBackend,
    pending: { writes: { path: string; content: string }[]; deletes: string[] } | null,
    user: string,
  ) => Promise<void>;
  /** Server-side flight recorder instance (admin dump endpoints). (t/1295 admin) */
  readonly serverRecorder: FlightRecorder;
  /** Ensure the caller's session branch exists before a write (no-op on blob). */
  readonly ensureSessionBranch: () => Promise<void>;
  /** Append the server ring-buffer log lines to a dump's NDJSON (admin dump). */
  readonly appendServerLogs: (ndjson: string) => string;
  /** Invalidate the server-local conflicts cache after a harvest write (t/1347). */
  readonly invalidateConflictsCache: () => void;
}
