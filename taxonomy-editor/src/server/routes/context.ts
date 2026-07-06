// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1295 (route extraction seam): the server-local state threaded into extracted
// route clusters (routes/*.ts). Read-mostly (TL t/1295#2) — expose live state
// via getters, not snapshots, so a cluster registered at module-load time never
// captures a stale value (e.g. githubBackend is assigned during async init).
// Grown per cluster as it's extracted; the debates slice uses nothing from it.

import type { GitHubAPIBackend } from '../storage/githubAPIBackend.js';

export interface ServerCtx {
  /** Live GitHub API backend (null until initialised / in non-GitHub modes). */
  readonly getGithubBackend: () => GitHubAPIBackend | null;
}
