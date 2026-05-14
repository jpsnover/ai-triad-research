// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * GitHubAPIBackend — GitHub REST API implementation of StorageBackend.
 *
 * Used in Azure container deployment (STORAGE_MODE=github-api). Reads/writes
 * data via GitHub Contents/Blobs/Trees APIs with a local file cache on SSD.
 *
 * Architecture:
 *   - Session context: reads/writes resolve to correct git ref (main vs session branch)
 *   - Two-layer cache: shared main cache + per-user session overlays
 *   - Write-through: cache updated only after 2xx from GitHub
 *   - Retry: 3x exponential backoff + jitter, Retry-After, 401→refresh+retry
 *   - Circuit breaker: adaptive half-open probing (30s→1m→2m→5m cap)
 *   - Flight recorder: 18+ event types for full observability
 *   - SIGUSR2: emergency dump bypasses blocked event loop
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { StorageBackend } from './storageBackend';
import { getCredentials, getRepoSlug, type SyncCredentials } from './githubAppAuth';
import { ActionableError } from '../../../lib/debate/errors';
import type { FlightRecorder, RecordInput } from '../../../lib/flight-recorder/index';
import { getCurrentUserId, getSessionBranchName } from './userContext';

// ── Types ────────────────────────────────────────────────────────────────

export interface SessionContext {
  userId: string;
  branchName?: string;  // null = no session branch, read from main
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface FileChange {
  path: string;
  content: string;
}

export interface CompareResult {
  ahead_by: number;
  behind_by: number;
  status: 'ahead' | 'behind' | 'diverged' | 'identical';
  files: Array<{ filename: string; status: string; patch?: string }>;
  total_commits: number;
}

interface CacheManifest {
  version: 1;
  generation: number;
  lastCommitSha: string;
  lastUpdated: string;
  files: Record<string, { sha: string; etag: string; cachedAt: string }>;
}

interface RateLimitInfo {
  remaining: number;
  limit: number;
  resetsAt: number;   // epoch ms
}

type CircuitState = 'closed' | 'open' | 'half-open';

export interface GitHubAPIBackendConfig {
  cacheDir: string;
  recorder?: FlightRecorder;
  pollIntervalMs?: number;
  coherencyProbeRate?: number;   // 0.0–1.0, default 0.01
}

// ── Constants ────────────────────────────────────────────────────────────

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'ai-triad-taxonomy-editor';
const API_VERSION = '2022-11-28';

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = [100, 300, 900];
const BACKOFF_JITTER_MS = 100;

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_PROBE_SCHEDULE_MS = [30_000, 60_000, 120_000, 300_000]; // 30s→1m→2m→5m cap

const POLL_INTERVAL_MS = 60_000;
const ERROR_BUFFER_CAPACITY = 100;

const MANIFEST_FILE = 'manifest.json';

// ── GitHubAPIBackend ─────────────────────────────────────────────────────

export class GitHubAPIBackend implements StorageBackend {
  private readonly cacheDir: string;
  private readonly recorder: FlightRecorder | null;
  private readonly pollIntervalMs: number;
  private readonly coherencyProbeRate: number;

  // Session context — legacy instance field used only by tests that call
  // setSessionContext() directly. Production reads from AsyncLocalStorage
  // (see userContext.ts). getEffectiveRef/getUserId check ALS first.
  private sessionContext: SessionContext | null = null;

  // In-memory repo tree (path→TreeEntry)
  private repoTree: Map<string, TreeEntry> = new Map();
  private treeSha: string | null = null;

  // Cache manifest
  private manifest: CacheManifest | null = null;

  // Per-user session overlays: userId → (repoPath → content)
  private sessionOverlays: Map<string, Map<string, string>> = new Map();

  // Rate limit tracking
  private rateLimit: RateLimitInfo = { remaining: 5000, limit: 5000, resetsAt: 0 };

  // Circuit breaker state
  private circuitState: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private circuitOpenedAt = 0;
  private probeIndex = 0;

  // Secondary error-only ring buffer (100 events)
  private errorBuffer: Array<RecordInput & { _wall: number }> = [];

  // Polling timer
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // Coherency probe stats
  private coherencyViolations = 0;

  // Manifest write mutex — serializes all manifest mutations to prevent
  // concurrent read-modify-write races (see t/479). Without this, parallel
  // readFile() cache misses each call writeToDiskCache() → saveManifest()
  // concurrently, corrupting the shared .tmp file and losing entries.
  private manifestLock: Promise<void> = Promise.resolve();

  // Cached credentials
  private cachedCreds: SyncCredentials | null = null;
  private credsExpiresAt = 0;

  constructor(config: GitHubAPIBackendConfig) {
    this.cacheDir = config.cacheDir;
    this.recorder = config.recorder ?? null;
    this.pollIntervalMs = config.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.coherencyProbeRate = config.coherencyProbeRate ?? 0.01;

    this.registerSigHandler();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.recordEvent({
      type: 'storage.mode',
      component: 'storage',
      level: 'info',
      message: 'GitHubAPIBackend initializing',
      data: { mode: 'github-api', cacheDir: this.cacheDir },
    });

    await fs.mkdir(this.cacheDir, { recursive: true });
    await this.loadManifest();

    const creds = await this.getCredsCached();
    if (!creds) {
      this.recordEvent({
        type: 'storage.fallback',
        component: 'storage',
        level: 'warn',
        message: 'No GitHub credentials available — running in fallback mode',
      });
      return;
    }

    const mainSha = await this.getLatestCommitSha();
    if (this.manifest && this.manifest.lastCommitSha === mainSha) {
      this.recordEvent({
        type: 'cache.hit',
        component: 'cache',
        level: 'info',
        message: 'Cache manifest matches main HEAD — serving from cache',
        data: { sha: mainSha, fileCount: Object.keys(this.manifest.files).length },
      });
    } else {
      await this.fetchRepoTree(mainSha);
      if (this.manifest && mainSha) {
        await this.invalidateChangedFiles(this.manifest.lastCommitSha, mainSha);
      }
      if (mainSha) {
        await this.updateManifestSha(mainSha);
      }
    }

    this.startPolling();
  }

  shutdown(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ── Session context ────────────────────────────────────────────────────

  /** @deprecated Use ALS (runWithUser) in production. Retained for test compatibility. */
  setSessionContext(ctx: SessionContext | null): void {
    this.sessionContext = ctx;
  }

  /** @deprecated Use ALS (getCurrentUser) in production. Retained for test compatibility. */
  getSessionContext(): SessionContext | null {
    return this.sessionContext;
  }

  /**
   * Resolve the effective git ref for the current request.
   * Priority: AsyncLocalStorage (production) → instance field (tests) → 'main'.
   */
  private getEffectiveRef(): string {
    return getSessionBranchName() ?? this.sessionContext?.branchName ?? 'main';
  }

  /**
   * Resolve the effective userId for the current request.
   * Priority: AsyncLocalStorage (production) → instance field (tests) → undefined.
   */
  private getEffectiveUserId(): string | undefined {
    const alsId = getCurrentUserId();
    if (alsId !== '_local') return alsId;
    return this.sessionContext?.userId ?? (alsId === '_local' ? '_local' : undefined);
  }

  /** Whether a session context (ALS or instance field) is active. */
  private hasSessionContext(): boolean {
    return getSessionBranchName() != null || this.sessionContext != null;
  }

  // ── StorageBackend interface ───────────────────────────────────────────

  async readFile(filePath: string): Promise<string | null> {
    const repoPath = this.toRepoPath(filePath);

    // Check session overlay first
    const readBranch = this.getEffectiveRef();
    const readUserId = this.getEffectiveUserId();
    if (readBranch !== 'main' && readUserId) {
      const overlay = this.sessionOverlays.get(readUserId);
      if (overlay?.has(repoPath)) {
        this.recordEvent({
          type: 'cache.hit',
          component: 'cache',
          level: 'debug',
          message: `Session overlay hit: ${repoPath}`,
          data: { path: repoPath, layer: 'session', userId: readUserId },
        });
        return overlay.get(repoPath)!;
      }
    }

    // Check main cache (on-disk)
    const cached = await this.readFromDiskCache(repoPath);
    if (cached !== null) {
      this.recordEvent({
        type: 'cache.hit',
        component: 'cache',
        level: 'debug',
        message: `Disk cache hit: ${repoPath}`,
        data: { path: repoPath, layer: 'main' },
      });

      // Coherency probe — async, doesn't block the read
      if (Math.random() < this.coherencyProbeRate) {
        this.runCoherencyProbe(repoPath).catch(() => {});
      }

      return cached;
    }

    // Cache miss — fetch from GitHub
    this.recordEvent({
      type: 'cache.miss',
      component: 'cache',
      level: 'info',
      message: `Cache miss: ${repoPath}`,
      data: { path: repoPath, reason: 'missing' },
    });

    if (this.circuitState === 'open' && !this.shouldProbe()) {
      return null; // Circuit open — serve null (file not available)
    }

    const ref = this.getEffectiveRef();
    const result = await this.fetchFileFromGitHub(repoPath, ref);
    if (result === null) return null;

    // Write-through to disk cache
    await this.writeToDiskCache(repoPath, result.content, result.sha, result.etag);
    return result.content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const repoPath = this.toRepoPath(filePath);

    if (this.circuitState === 'open' && !this.shouldProbe()) {
      throw new ActionableError({
        goal: 'Write file to GitHub',
        problem: 'GitHub API is unavailable (circuit breaker open). Edits temporarily disabled.',
        location: `GitHubAPIBackend.writeFile(${repoPath})`,
        nextSteps: ['Wait for GitHub API to recover', 'Check /health for circuit breaker status'],
      });
    }

    const ref = this.getEffectiveRef();
    if (ref === 'main' && this.hasSessionContext()) {
      // Writes must go to a session branch — caller should create one first
      throw new ActionableError({
        goal: 'Write file to GitHub',
        problem: 'Cannot write directly to main. Create a session branch first.',
        location: `GitHubAPIBackend.writeFile(${repoPath})`,
        nextSteps: ['Create a session branch via the Session Branch Manager'],
      });
    }

    // Get the current file SHA for the update (required by Contents API)
    let fileSha = await this.getFileSha(repoPath, ref);

    const creds = await this.getCredsCached();
    if (!creds) throw this.noCredsError('writeFile');

    const callId = crypto.randomUUID();
    const encodedContent = Buffer.from(content, 'utf-8').toString('base64');

    const doWrite = async (sha: string | null, attempt: number) => {
      const body: Record<string, unknown> = {
        message: `Update ${repoPath}`,
        content: encodedContent,
        branch: ref,
      };
      if (sha) body.sha = sha;

      const resp = await this.apiRequest(creds, 'PUT',
        `/repos/${creds.repo}/contents/${repoPath}`, body, callId);

      if (resp.status === 409 && attempt === 0) {
        // SHA conflict — another write updated this file. Re-fetch and retry once.
        this.recordEvent({
          type: 'github.api.conflict',
          component: 'github-api',
          level: 'warn',
          message: `409 SHA conflict on ${repoPath}, retrying with fresh SHA`,
          call_id: callId,
          data: { path: repoPath, ref, staleSha: sha },
        });
        const freshSha = await this.getFileSha(repoPath, ref);
        return doWrite(freshSha, 1);
      }

      if (!resp.ok) {
        throw new ActionableError({
          goal: `Write ${repoPath} to GitHub`,
          problem: `GitHub API returned ${resp.status}: ${resp.error}`,
          location: `GitHubAPIBackend.writeFile(${repoPath})`,
          nextSteps: ['Check GitHub API status', 'Retry the operation'],
        });
      }

      return resp;
    };

    const resp = await doWrite(fileSha, 0);

    // Write-through: update cache only after confirmed 2xx
    const respData = resp.data as { content?: { sha?: string } };
    const newSha = respData?.content?.sha ?? '';
    await this.writeToDiskCache(repoPath, content, newSha, '');

    // Update session overlay
    const writeUserId = this.getEffectiveUserId();
    if (writeUserId) {
      let overlay = this.sessionOverlays.get(writeUserId);
      if (!overlay) {
        overlay = new Map();
        this.sessionOverlays.set(writeUserId, overlay);
      }
      overlay.set(repoPath, content);
    }
  }

  async listDirectory(dirPath: string): Promise<string[]> {
    const repoPath = this.toRepoPath(dirPath);

    // Use the in-memory tree if available
    if (this.repoTree.size > 0) {
      const prefix = repoPath ? repoPath + '/' : '';
      const entries: string[] = [];
      const seen = new Set<string>();
      for (const [p] of this.repoTree) {
        if (prefix && !p.startsWith(prefix)) continue;
        if (!prefix && p.includes('/')) {
          // Top-level: extract first segment
          const seg = p.split('/')[0];
          if (!seen.has(seg)) { seen.add(seg); entries.push(seg); }
          continue;
        }
        const rest = prefix ? p.slice(prefix.length) : p;
        if (!rest) continue;
        // Direct children only
        const seg = rest.split('/')[0];
        if (!seen.has(seg)) { seen.add(seg); entries.push(seg); }
      }
      return entries;
    }

    // Fallback: GitHub Contents API
    if (this.circuitState === 'open' && !this.shouldProbe()) return [];

    const creds = await this.getCredsCached();
    if (!creds) return [];

    const ref = this.getEffectiveRef();
    const qRef = ref === 'main' ? '' : `?ref=${encodeURIComponent(ref)}`;
    const resp = await this.apiRequest(creds, 'GET',
      `/repos/${creds.repo}/contents/${repoPath}${qRef}`);

    if (!resp.ok) return [];

    const data = resp.data;
    if (!Array.isArray(data)) return [];
    return (data as Array<{ name: string }>).map(e => e.name);
  }

  async deleteFile(filePath: string): Promise<void> {
    const repoPath = this.toRepoPath(filePath);

    if (this.circuitState === 'open' && !this.shouldProbe()) {
      throw new ActionableError({
        goal: 'Delete file from GitHub',
        problem: 'GitHub API is unavailable (circuit breaker open). Edits temporarily disabled.',
        location: `GitHubAPIBackend.deleteFile(${repoPath})`,
        nextSteps: ['Wait for GitHub API to recover'],
      });
    }

    const ref = this.getEffectiveRef();
    const existingSha = await this.getFileSha(repoPath, ref);
    if (!existingSha) return; // File doesn't exist — no-op per StorageBackend contract

    const creds = await this.getCredsCached();
    if (!creds) throw this.noCredsError('deleteFile');

    const resp = await this.apiRequest(creds, 'DELETE',
      `/repos/${creds.repo}/contents/${repoPath}`, {
        message: `Delete ${repoPath}`,
        sha: existingSha,
        branch: ref,
      });

    if (!resp.ok && resp.status !== 404) {
      throw new ActionableError({
        goal: `Delete ${repoPath} from GitHub`,
        problem: `GitHub API returned ${resp.status}: ${resp.error}`,
        location: `GitHubAPIBackend.deleteFile(${repoPath})`,
        nextSteps: ['Check GitHub API status', 'Retry the operation'],
      });
    }

    // Write-through: remove from cache after confirmed deletion
    await this.removeFromDiskCache(repoPath);
    const delUserId = this.getEffectiveUserId();
    if (delUserId) {
      this.sessionOverlays.get(delUserId)?.delete(repoPath);
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    const repoPath = this.toRepoPath(filePath);

    // Check session overlay
    const existsBranch = this.getEffectiveRef();
    const existsUserId = this.getEffectiveUserId();
    if (existsBranch !== 'main' && existsUserId) {
      const overlay = this.sessionOverlays.get(existsUserId);
      if (overlay?.has(repoPath)) return true;
    }

    // Check disk cache manifest
    if (this.manifest?.files[repoPath]) return true;

    // Check in-memory tree
    if (this.repoTree.has(repoPath)) return true;

    // Check for directory in tree
    if (this.repoTree.size > 0) {
      const prefix = repoPath + '/';
      for (const [p] of this.repoTree) {
        if (p.startsWith(prefix)) return true;
      }
    }

    // Fallback: HEAD request to Contents API
    if (this.circuitState === 'open' && !this.shouldProbe()) return false;

    const creds = await this.getCredsCached();
    if (!creds) return false;

    const ref = this.getEffectiveRef();
    const qRef = ref === 'main' ? '' : `?ref=${encodeURIComponent(ref)}`;
    const resp = await this.apiRequest(creds, 'HEAD',
      `/repos/${creds.repo}/contents/${repoPath}${qRef}`);
    return resp.ok;
  }

  // ── GitHub-specific methods ────────────────────────────────────────────

  async getLatestCommitSha(): Promise<string> {
    const creds = await this.getCredsCached();
    if (!creds) return '';

    const resp = await this.apiRequest(creds, 'GET',
      `/repos/${creds.repo}/commits/main`);
    if (!resp.ok) return '';

    return (resp.data as { sha: string }).sha;
  }

  async getChangedFiles(fromSha: string, toSha: string): Promise<string[]> {
    const creds = await this.getCredsCached();
    if (!creds) return [];

    const resp = await this.apiRequest(creds, 'GET',
      `/repos/${creds.repo}/compare/${fromSha}...${toSha}`);

    if (!resp.ok) {
      // Force-push detection: 404 or 422 means cached SHA no longer in history
      if (resp.status === 404 || resp.status === 422) {
        this.recordEvent({
          type: 'cache.invalidate',
          component: 'cache',
          level: 'warn',
          message: 'Force push detected — cached SHA not in history. Full cache invalidation.',
          data: { fromSha, toSha, trigger: 'force-push' },
        });
        await this.fullCacheInvalidation();
      }
      return [];
    }

    const data = resp.data as { files?: Array<{ filename: string }> };
    return (data.files ?? []).map(f => f.filename);
  }

  async getTree(sha: string, recursive?: boolean): Promise<TreeEntry[]> {
    const creds = await this.getCredsCached();
    if (!creds) return [];

    const q = recursive ? '?recursive=1' : '';
    const resp = await this.apiRequest(creds, 'GET',
      `/repos/${creds.repo}/git/trees/${sha}${q}`);

    if (!resp.ok) return [];

    const data = resp.data as { tree: TreeEntry[]; truncated?: boolean };
    if (data.truncated) {
      this.recordEvent({
        type: 'system.scaling_warning',
        component: 'github-api',
        level: 'warn',
        message: 'Git Trees API returned truncated result (>100,000 entries)',
        data: { sha, entryCount: data.tree.length },
      });
    }
    return data.tree;
  }

  async createBranch(name: string, fromSha?: string): Promise<void> {
    const creds = await this.getCredsCached();
    if (!creds) throw this.noCredsError('createBranch');

    const sha = fromSha ?? await this.getLatestCommitSha();
    const callId = crypto.randomUUID();

    const resp = await this.apiRequest(creds, 'POST',
      `/repos/${creds.repo}/git/refs`, {
        ref: `refs/heads/${name}`,
        sha,
      }, callId);

    if (!resp.ok && resp.status !== 422) {
      // 422 = branch already exists — not an error
      throw new ActionableError({
        goal: `Create branch ${name}`,
        problem: `GitHub API returned ${resp.status}: ${resp.error}`,
        location: `GitHubAPIBackend.createBranch(${name})`,
        nextSteps: ['Check if the branch already exists', 'Verify GitHub App permissions'],
      });
    }

    this.recordEvent({
      type: 'branch.create',
      component: 'session',
      level: 'info',
      message: `Branch created: ${name}`,
      call_id: callId,
      data: { branch: name, fromSha: sha, userId: this.getEffectiveUserId() },
    });
  }

  async createCommitFromTree(
    branch: string,
    files: FileChange[],
    message: string,
  ): Promise<string> {
    const creds = await this.getCredsCached();
    if (!creds) throw this.noCredsError('createCommitFromTree');

    const callId = crypto.randomUUID();
    const startMs = Date.now();

    // Step 1: Get current branch ref
    const refResp = await this.apiRequest(creds, 'GET',
      `/repos/${creds.repo}/git/refs/heads/${branch}`, undefined, callId);
    if (!refResp.ok) {
      throw new ActionableError({
        goal: `Batch commit to ${branch}`,
        problem: `Failed to get branch ref: ${refResp.status} ${refResp.error}`,
        location: `GitHubAPIBackend.createCommitFromTree step 1`,
        nextSteps: ['Verify branch exists', 'Check GitHub App permissions'],
      });
    }
    const currentSha = ((refResp.data as { object: { sha: string } }).object).sha;

    // Step 2: Create tree with changed files
    const treeEntries = files.map(f => ({
      path: f.path,
      mode: '100644' as const,
      type: 'blob' as const,
      content: f.content,
    }));
    const treeResp = await this.apiRequest(creds, 'POST',
      `/repos/${creds.repo}/git/trees`, {
        base_tree: currentSha,
        tree: treeEntries,
      }, callId);
    if (!treeResp.ok) {
      throw new ActionableError({
        goal: `Batch commit to ${branch}`,
        problem: `Failed to create tree: ${treeResp.status} ${treeResp.error}`,
        location: `GitHubAPIBackend.createCommitFromTree step 2`,
        nextSteps: ['Check file paths and content', 'Verify GitHub App permissions'],
      });
    }
    const newTreeSha = (treeResp.data as { sha: string }).sha;

    // Step 3: Create commit pointing to new tree
    const commitResp = await this.apiRequest(creds, 'POST',
      `/repos/${creds.repo}/git/commits`, {
        message,
        tree: newTreeSha,
        parents: [currentSha],
      }, callId);
    if (!commitResp.ok) {
      throw new ActionableError({
        goal: `Batch commit to ${branch}`,
        problem: `Failed to create commit: ${commitResp.status} ${commitResp.error}`,
        location: `GitHubAPIBackend.createCommitFromTree step 3`,
        nextSteps: ['Retry the operation — dangling tree is harmless'],
      });
    }
    const commitSha = (commitResp.data as { sha: string }).sha;

    // Step 4: Update branch ref
    const updateResp = await this.apiRequest(creds, 'PATCH',
      `/repos/${creds.repo}/git/refs/heads/${branch}`, {
        sha: commitSha,
        force: false,
      }, callId);
    if (!updateResp.ok) {
      throw new ActionableError({
        goal: `Batch commit to ${branch}`,
        problem: `Failed to update branch ref: ${updateResp.status} ${updateResp.error}`,
        location: `GitHubAPIBackend.createCommitFromTree step 4`,
        nextSteps: ['Retry — tree and commit are already created', 'Check for concurrent updates'],
      });
    }

    const durationMs = Date.now() - startMs;
    this.recordEvent({
      type: 'branch.commit',
      component: 'session',
      level: 'info',
      message: `Batch commit to ${branch}: ${files.length} files`,
      call_id: callId,
      duration_ms: durationMs,
      data: { branch, fileCount: files.length, commitSha, durationMs },
    });

    // Write-through: update session overlay for committed files
    const commitUserId = this.getEffectiveUserId();
    if (commitUserId) {
      let overlay = this.sessionOverlays.get(commitUserId);
      if (!overlay) {
        overlay = new Map();
        this.sessionOverlays.set(commitUserId, overlay);
      }
      for (const f of files) {
        overlay.set(f.path, f.content);
      }
    }

    return commitSha;
  }

  async createOrUpdatePR(
    branch: string,
    title: string,
    body: string,
  ): Promise<{ number: number; url: string }> {
    const creds = await this.getCredsCached();
    if (!creds) throw this.noCredsError('createOrUpdatePR');

    // Check if PR already exists for this branch
    const listResp = await this.apiRequest(creds, 'GET',
      `/repos/${creds.repo}/pulls?head=${encodeURIComponent(creds.repo.split('/')[0])}:${branch}&state=open`);

    if (listResp.ok && Array.isArray(listResp.data) && (listResp.data as unknown[]).length > 0) {
      const existing = (listResp.data as Array<{ number: number; html_url: string }>)[0];
      // Update existing PR
      const updateResp = await this.apiRequest(creds, 'PATCH',
        `/repos/${creds.repo}/pulls/${existing.number}`, { title, body });

      this.recordEvent({
        type: 'sync.pr.update',
        component: 'session',
        level: 'info',
        message: `PR #${existing.number} updated`,
        data: { number: existing.number, branch },
      });
      return { number: existing.number, url: updateResp.ok ? existing.html_url : existing.html_url };
    }

    // Create new PR
    const resp = await this.apiRequest(creds, 'POST',
      `/repos/${creds.repo}/pulls`, {
        title,
        body,
        head: branch,
        base: 'main',
      });

    if (!resp.ok) {
      throw new ActionableError({
        goal: `Create PR from ${branch}`,
        problem: `GitHub API returned ${resp.status}: ${resp.error}`,
        location: `GitHubAPIBackend.createOrUpdatePR(${branch})`,
        nextSteps: ['Check if branch has commits ahead of main', 'Verify GitHub App permissions'],
      });
    }

    const pr = resp.data as { number: number; html_url: string };
    this.recordEvent({
      type: 'sync.pr.create',
      component: 'session',
      level: 'info',
      message: `PR #${pr.number} created`,
      data: { number: pr.number, url: pr.html_url, branch },
    });
    return { number: pr.number, url: pr.html_url };
  }

  async compareBranches(base: string, head: string): Promise<CompareResult> {
    const creds = await this.getCredsCached();
    if (!creds) {
      return { ahead_by: 0, behind_by: 0, status: 'identical', files: [], total_commits: 0 };
    }

    const resp = await this.apiRequest(creds, 'GET',
      `/repos/${creds.repo}/compare/${base}...${head}`);

    if (!resp.ok) {
      return { ahead_by: 0, behind_by: 0, status: 'identical', files: [], total_commits: 0 };
    }

    const data = resp.data as {
      ahead_by: number;
      behind_by: number;
      status: string;
      files?: Array<{ filename: string; status: string; patch?: string }>;
      total_commits: number;
    };
    return {
      ahead_by: data.ahead_by,
      behind_by: data.behind_by,
      status: data.status as CompareResult['status'],
      files: (data.files ?? []).map(f => ({
        filename: f.filename,
        status: f.status,
        patch: f.patch,
      })),
      total_commits: data.total_commits,
    };
  }

  /**
   * Merge main into the given branch via the GitHub Merges API.
   * Returns { ok, sha, conflicts } — conflicts true when the API returns 409.
   */
  async mergeBranch(
    branch: string,
    commitMessage?: string,
  ): Promise<{ ok: boolean; sha: string; conflicts: boolean; message: string }> {
    const creds = await this.getCredsCached();
    if (!creds) throw this.noCredsError('mergeBranch');

    const resp = await this.apiRequest(creds, 'POST',
      `/repos/${creds.repo}/merges`, {
        base: branch,
        head: 'main',
        commit_message: commitMessage ?? `Merge main into ${branch}`,
      });

    if (resp.status === 409) {
      this.recordEvent({
        type: 'sync.conflict', component: 'session', level: 'warn',
        message: `Merge conflict: main into ${branch}`,
        data: { branch },
      });
      return { ok: false, sha: '', conflicts: true, message: 'Merge conflict — resolve on GitHub' };
    }

    if (resp.status === 204) {
      // 204 = already up to date (no merge needed)
      return { ok: true, sha: '', conflicts: false, message: 'Already up to date' };
    }

    if (!resp.ok) {
      throw new ActionableError({
        goal: `Merge main into ${branch}`,
        problem: `GitHub API returned ${resp.status}: ${resp.error}`,
        location: `GitHubAPIBackend.mergeBranch(${branch})`,
        nextSteps: ['Check branch exists on GitHub', 'Verify GitHub App permissions'],
      });
    }

    const data = resp.data as { sha: string };
    return { ok: true, sha: data.sha, conflicts: false, message: `Merged main into ${branch}` };
  }

  // ── Path contract ──────────────────────────────────────────────────────

  private toRepoPath(filePath: string): string {
    let p = filePath;

    // If the path is absolute and starts with the cache dir, strip it
    if (p.startsWith(this.cacheDir)) {
      p = p.slice(this.cacheDir.length);
    }

    // Strip leading slashes
    p = p.replace(/^\/+/, '');

    // Reject .git paths
    if (p === '.git' || p.startsWith('.git/')) {
      throw new ActionableError({
        goal: 'Validate file path',
        problem: `Path traversal into .git directory rejected: "${filePath}"`,
        location: 'GitHubAPIBackend.toRepoPath',
        nextSteps: ['Use a valid repository file path'],
      });
    }

    // Reject path traversal
    if (p.includes('..')) {
      throw new ActionableError({
        goal: 'Validate file path',
        problem: `Path traversal with ".." rejected: "${filePath}"`,
        location: 'GitHubAPIBackend.toRepoPath',
        nextSteps: ['Use an absolute or clean relative path'],
      });
    }

    return p;
  }

  // ── Retry + Circuit Breaker ────────────────────────────────────────────

  private async apiRequest(
    creds: SyncCredentials,
    method: string,
    pathAndQuery: string,
    body?: unknown,
    callId?: string,
  ): Promise<{ ok: boolean; status: number; data: unknown; error?: string; etag?: string }> {
    const reqUserId = this.getEffectiveUserId();
    const requestId = reqUserId
      ? `${reqUserId}-${Date.now()}`
      : undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const startMs = Date.now();

      this.recordEvent({
        type: 'github.api.request',
        component: 'github-api',
        level: 'debug',
        message: `${method} ${pathAndQuery}`,
        call_id: callId,
        request_id: requestId,
        data: { method, endpoint: pathAndQuery, attempt },
      });

      try {
        const url = `${GITHUB_API}${pathAndQuery}`;
        const headers: Record<string, string> = {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${creds.token}`,
          'User-Agent': USER_AGENT,
          'X-GitHub-Api-Version': API_VERSION,
        };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (requestId) headers['X-Request-ID'] = requestId;

        // Add ETag for conditional requests
        const cachedEtag = this.getCachedEtag(pathAndQuery);
        if (cachedEtag && method === 'GET') {
          headers['If-None-Match'] = cachedEtag;
        }

        const res = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });

        const durationMs = Date.now() - startMs;

        // Track rate limits from response headers
        this.updateRateLimit(res.headers);

        // ETag from response
        const responseEtag = res.headers.get('etag') ?? undefined;

        // 304 Not Modified — return cached
        if (res.status === 304) {
          this.recordEvent({
            type: 'github.api.response',
            component: 'github-api',
            level: 'debug',
            duration_ms: durationMs,
            call_id: callId,
            request_id: requestId,
            data: { status: 304, method, endpoint: pathAndQuery, cache_hit: true,
                    rate_remaining: this.rateLimit.remaining },
          });
          this.onApiSuccess();
          return { ok: true, status: 304, data: null, etag: responseEtag };
        }

        // Parse response body
        const text = await res.text();
        let data: unknown = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }

        this.recordEvent({
          type: res.ok ? 'github.api.response' : 'github.api.error',
          component: 'github-api',
          level: res.ok ? 'debug' : 'error',
          duration_ms: durationMs,
          call_id: callId,
          request_id: requestId,
          data: {
            status: res.status, method, endpoint: pathAndQuery,
            rate_remaining: this.rateLimit.remaining,
            ...(res.ok ? {} : { error: text?.slice(0, 500) }),
          },
        });

        if (res.ok) {
          this.onApiSuccess();
          return { ok: true, status: res.status, data, etag: responseEtag };
        }

        // 404 — not found, don't retry
        if (res.status === 404) {
          return { ok: false, status: 404, data, error: 'Not found' };
        }

        // 401 — token expired, refresh once and retry
        if (res.status === 401 && attempt === 0) {
          this.cachedCreds = null;
          this.credsExpiresAt = 0;
          const freshCreds = await this.getCredsCached();
          if (freshCreds) {
            creds = freshCreds;
            continue; // retry with fresh token
          }
        }

        // 409 — conflict (SHA mismatch on write)
        if (res.status === 409) {
          return { ok: false, status: 409, data,
            error: 'Conflict — file was modified concurrently' };
        }

        // 422 — validation error (branch exists, etc.)
        if (res.status === 422) {
          return { ok: false, status: 422, data,
            error: (data && typeof data === 'object' && 'message' in data)
              ? String((data as { message: unknown }).message) : 'Validation error' };
        }

        // 429 — rate limited
        if (res.status === 429) {
          this.recordEvent({
            type: 'github.api.rate_limit',
            component: 'github-api',
            level: 'warn',
            message: 'Rate limited by GitHub API',
            data: { remaining: this.rateLimit.remaining, resetsAt: this.rateLimit.resetsAt },
          });

          const retryAfter = res.headers.get('retry-after');
          if (retryAfter && attempt < MAX_RETRIES) {
            await this.sleep(parseInt(retryAfter, 10) * 1000);
            continue;
          }
        }

        // 5xx — retryable
        if (res.status >= 500 && attempt < MAX_RETRIES) {
          this.onApiFailure();
          await this.sleep(this.backoffMs(attempt));
          continue;
        }

        // Other 4xx — not retryable
        const errorMsg = (data && typeof data === 'object' && 'message' in data)
          ? String((data as { message: unknown }).message)
          : text || `HTTP ${res.status}`;
        this.onApiFailure();
        return { ok: false, status: res.status, data, error: errorMsg };

      } catch (err: unknown) {
        // Network error — retryable
        const durationMs = Date.now() - startMs;
        this.recordEvent({
          type: 'github.api.error',
          component: 'github-api',
          level: 'error',
          duration_ms: durationMs,
          call_id: callId,
          request_id: requestId,
          error: normalizeErrorForEvent(err),
          data: { method, endpoint: pathAndQuery, attempt, network_error: true },
        });

        this.onApiFailure();
        if (attempt < MAX_RETRIES) {
          await this.sleep(this.backoffMs(attempt));
          continue;
        }

        return { ok: false, status: 0, data: null,
          error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    // Should not reach here, but just in case
    return { ok: false, status: 0, data: null, error: 'Max retries exceeded' };
  }

  private backoffMs(attempt: number): number {
    const base = BACKOFF_BASE_MS[Math.min(attempt, BACKOFF_BASE_MS.length - 1)];
    const jitter = Math.floor(Math.random() * BACKOFF_JITTER_MS);
    return base + jitter;
  }

  private onApiSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.circuitState !== 'closed') {
      this.recordEvent({
        type: 'github.api.circuit_break',
        component: 'github-api',
        level: 'info',
        message: `Circuit breaker: ${this.circuitState} → closed`,
        data: { previousState: this.circuitState },
      });
      this.circuitState = 'closed';
      this.probeIndex = 0;
    }
  }

  private onApiFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD && this.circuitState === 'closed') {
      this.circuitState = 'open';
      this.circuitOpenedAt = Date.now();
      this.probeIndex = 0;
      this.recordEvent({
        type: 'github.api.circuit_break',
        component: 'github-api',
        level: 'warn',
        message: `Circuit breaker: closed → open (${this.consecutiveFailures} consecutive failures)`,
        data: { failures: this.consecutiveFailures },
      });
    }
  }

  private shouldProbe(): boolean {
    if (this.circuitState === 'closed') return true;

    const probeDelay = CIRCUIT_PROBE_SCHEDULE_MS[
      Math.min(this.probeIndex, CIRCUIT_PROBE_SCHEDULE_MS.length - 1)
    ];
    const elapsed = Date.now() - this.circuitOpenedAt;

    if (elapsed >= probeDelay) {
      this.circuitState = 'half-open';
      this.circuitOpenedAt = Date.now(); // Reset for next probe interval
      this.probeIndex = Math.min(this.probeIndex + 1, CIRCUIT_PROBE_SCHEDULE_MS.length - 1);

      this.recordEvent({
        type: 'github.api.circuit_break',
        component: 'github-api',
        level: 'info',
        message: `Circuit breaker: probing (attempt ${this.probeIndex})`,
        data: { probeIndex: this.probeIndex, probeDelay },
      });
      return true;
    }

    return false;
  }

  // ── Rate limit tracking ────────────────────────────────────────────────

  private updateRateLimit(headers: Headers): void {
    const remaining = headers.get('x-ratelimit-remaining');
    const limit = headers.get('x-ratelimit-limit');
    const reset = headers.get('x-ratelimit-reset');

    if (remaining !== null) this.rateLimit.remaining = parseInt(remaining, 10);
    if (limit !== null) this.rateLimit.limit = parseInt(limit, 10);
    if (reset !== null) this.rateLimit.resetsAt = parseInt(reset, 10) * 1000;

    if (this.rateLimit.remaining < 500) {
      this.recordEvent({
        type: 'github.api.rate_limit',
        component: 'github-api',
        level: this.rateLimit.remaining < 500 ? 'warn' : 'info',
        message: `Rate limit: ${this.rateLimit.remaining}/${this.rateLimit.limit} remaining`,
        data: { ...this.rateLimit },
      });
    }
  }

  // ── Manifest mutex ───────────────────────────────────────────────────

  /**
   * Serialize manifest mutations. Callers queue behind the previous holder;
   * the promise chain guarantees FIFO ordering and prevents concurrent
   * saveManifest() calls from stomping each other's .tmp file.
   */
  private async withManifestLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    const prev = this.manifestLock;
    this.manifestLock = next;

    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  // ── Disk cache ─────────────────────────────────────────────────────────

  private async loadManifest(): Promise<void> {
    const manifestPath = path.join(this.cacheDir, MANIFEST_FILE);
    try {
      const raw = await fs.readFile(manifestPath, 'utf-8');
      const parsed = JSON.parse(raw);

      // Manifest checksum validation (t/465#4)
      if (!parsed || parsed.version !== 1 || !parsed.lastCommitSha ||
          !parsed.files || typeof parsed.generation !== 'number') {
        this.recordEvent({
          type: 'cache.invalidate',
          component: 'cache',
          level: 'warn',
          message: 'Manifest failed integrity check — treating as cold start',
          data: { reason: 'invalid-structure' },
        });
        this.manifest = null;
        return;
      }

      this.manifest = parsed as CacheManifest;
    } catch {
      // Missing or corrupt — cold start
      this.manifest = null;
    }
  }

  private async saveManifest(): Promise<void> {
    if (!this.manifest) return;

    const manifestPath = path.join(this.cacheDir, MANIFEST_FILE);
    const tmpPath = manifestPath + '.tmp';
    const content = JSON.stringify(this.manifest, null, 2);

    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, manifestPath);

    this.recordEvent({
      type: 'cache.manifest.swap',
      component: 'cache',
      level: 'info',
      message: 'Cache manifest updated',
      data: {
        generation: this.manifest.generation,
        fileCount: Object.keys(this.manifest.files).length,
        mainSha: this.manifest.lastCommitSha,
      },
    });
  }

  private async readFromDiskCache(repoPath: string): Promise<string | null> {
    if (!this.manifest?.files[repoPath]) return null;

    const diskPath = path.join(this.cacheDir, repoPath);
    try {
      return await fs.readFile(diskPath, 'utf-8');
    } catch {
      return null;
    }
  }

  private async writeToDiskCache(
    repoPath: string, content: string, sha: string, etag: string,
  ): Promise<void> {
    const diskPath = path.join(this.cacheDir, repoPath);
    await fs.mkdir(path.dirname(diskPath), { recursive: true });

    const tmpPath = diskPath + '.tmp';
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, diskPath);

    await this.withManifestLock(async () => {
      if (!this.manifest) {
        this.manifest = {
          version: 1,
          generation: 1,
          lastCommitSha: '',
          lastUpdated: new Date().toISOString(),
          files: {},
        };
      }

      this.manifest.files[repoPath] = {
        sha,
        etag,
        cachedAt: new Date().toISOString(),
      };
      this.manifest.generation++;
      this.manifest.lastUpdated = new Date().toISOString();
      await this.saveManifest();
    });
  }

  private async removeFromDiskCache(repoPath: string): Promise<void> {
    const diskPath = path.join(this.cacheDir, repoPath);
    try {
      await fs.unlink(diskPath);
    } catch {
      // Ignore missing file
    }

    await this.withManifestLock(async () => {
      if (this.manifest?.files[repoPath]) {
        delete this.manifest.files[repoPath];
        this.manifest.generation++;
        this.manifest.lastUpdated = new Date().toISOString();
        await this.saveManifest();
      }
    });
  }

  private getCachedEtag(pathAndQuery: string): string | null {
    if (!this.manifest) return null;
    // Extract repo path from the API endpoint
    const match = pathAndQuery.match(/\/contents\/(.+?)(\?|$)/);
    if (!match) return null;
    const entry = this.manifest.files[match[1]];
    return entry?.etag || null;
  }

  // ── GitHub file operations (low-level) ─────────────────────────────────

  private async fetchFileFromGitHub(
    repoPath: string,
    ref: string,
  ): Promise<{ content: string; sha: string; etag: string } | null> {
    const creds = await this.getCredsCached();
    if (!creds) return null;

    const qRef = ref === 'main' ? '' : `?ref=${encodeURIComponent(ref)}`;
    const resp = await this.apiRequest(creds, 'GET',
      `/repos/${creds.repo}/contents/${repoPath}${qRef}`);

    if (!resp.ok) return null;

    const data = resp.data as {
      content?: string;
      encoding?: string;
      sha: string;
      size?: number;
      type?: string;
    };

    // If it's a directory, return null (caller should use listDirectory)
    if (data.type === 'dir') return null;

    // Decode base64 content
    if (!data.content || data.encoding !== 'base64') {
      // Large file — use Blobs API
      if (data.sha && (data.size ?? 0) > 0) {
        return this.fetchBlobFromGitHub(creds, data.sha, resp.etag ?? '');
      }
      return null;
    }

    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return { content, sha: data.sha, etag: resp.etag ?? '' };
  }

  private async fetchBlobFromGitHub(
    creds: SyncCredentials,
    sha: string,
    etag: string,
  ): Promise<{ content: string; sha: string; etag: string } | null> {
    const resp = await this.apiRequest(creds, 'GET',
      `/repos/${creds.repo}/git/blobs/${sha}`);

    if (!resp.ok) return null;

    const data = resp.data as { content: string; encoding: string; sha: string };
    const content = data.encoding === 'base64'
      ? Buffer.from(data.content, 'base64').toString('utf-8')
      : data.content;
    return { content, sha: data.sha, etag: resp.etag ?? etag };
  }

  private async getFileSha(repoPath: string, ref: string): Promise<string | null> {
    // Check manifest first
    if (this.manifest?.files[repoPath]) {
      return this.manifest.files[repoPath].sha;
    }

    // Check tree
    const entry = this.repoTree.get(repoPath);
    if (entry) return entry.sha;

    // Fetch from API (GET, not HEAD — we need the SHA from the response body)
    const creds = await this.getCredsCached();
    if (!creds) return null;

    const qRef = ref === 'main' ? '' : `?ref=${encodeURIComponent(ref)}`;
    const resp = await this.apiRequest(creds, 'GET',
      `/repos/${creds.repo}/contents/${repoPath}${qRef}`);
    if (!resp.ok) return null;
    return (resp.data as { sha: string }).sha;
  }

  // ── Repo tree ──────────────────────────────────────────────────────────

  private async fetchRepoTree(commitSha: string): Promise<void> {
    if (!commitSha) return;

    const creds = await this.getCredsCached();
    if (!creds) return;

    // Get the tree SHA from the commit
    const commitResp = await this.apiRequest(creds, 'GET',
      `/repos/${creds.repo}/git/commits/${commitSha}`);
    if (!commitResp.ok) return;

    const treeSha = (commitResp.data as { tree: { sha: string } }).tree.sha;
    const entries = await this.getTree(treeSha, true);

    this.repoTree.clear();
    for (const entry of entries) {
      if (entry.type === 'blob') {
        this.repoTree.set(entry.path, entry);
      }
    }
    this.treeSha = treeSha;
  }

  // ── Polling ────────────────────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(() => void (async () => {
      try {
        const currentSha = await this.getLatestCommitSha();
        if (!currentSha || currentSha === this.manifest?.lastCommitSha) return;

        const changed = this.manifest?.lastCommitSha
          ? await this.getChangedFiles(this.manifest.lastCommitSha, currentSha)
          : [];

        if (changed.length > 0) {
          this.recordEvent({
            type: 'cache.invalidate',
            component: 'cache',
            level: 'info',
            message: `Poll: ${changed.length} files changed`,
            data: { paths: changed.slice(0, 20), trigger: 'poll', sha: currentSha },
          });

          // Invalidate changed files from disk cache (under manifest lock)
          await this.withManifestLock(async () => {
            for (const filePath of changed) {
              if (this.manifest?.files[filePath]) {
                delete this.manifest.files[filePath];
              }
            }
          });
        }

        // Update tree
        await this.fetchRepoTree(currentSha);
        await this.updateManifestSha(currentSha);
      } catch (err: unknown) {
        this.recordEvent({
          type: 'system.error',
          component: 'cache',
          level: 'error',
          message: 'Polling loop error',
          error: normalizeErrorForEvent(err),
          data: { context: 'background-task' },
        });
      }
    })(), this.pollIntervalMs);
  }

  private async invalidateChangedFiles(fromSha: string, toSha: string): Promise<void> {
    const changed = await this.getChangedFiles(fromSha, toSha);
    if (changed.length === 0) return;

    await this.withManifestLock(async () => {
      for (const filePath of changed) {
        if (this.manifest?.files[filePath]) {
          delete this.manifest.files[filePath];
        }
      }
    });

    this.recordEvent({
      type: 'cache.invalidate',
      component: 'cache',
      level: 'info',
      message: `Invalidated ${changed.length} files on startup diff`,
      data: { paths: changed.slice(0, 20), trigger: 'startup' },
    });
  }

  private async fullCacheInvalidation(): Promise<void> {
    await this.withManifestLock(async () => {
      if (this.manifest) {
        this.manifest.files = {};
        this.manifest.generation++;
        this.manifest.lastCommitSha = '';
        await this.saveManifest();
      }
    });
    this.repoTree.clear();
    this.treeSha = null;
  }

  private async updateManifestSha(sha: string): Promise<void> {
    await this.withManifestLock(async () => {
      if (!this.manifest) {
        this.manifest = {
          version: 1,
          generation: 1,
          lastCommitSha: sha,
          lastUpdated: new Date().toISOString(),
          files: {},
        };
      } else {
        this.manifest.lastCommitSha = sha;
        this.manifest.generation++;
        this.manifest.lastUpdated = new Date().toISOString();
      }
      await this.saveManifest();
    });
  }

  // ── Coherency probe ────────────────────────────────────────────────────

  private async runCoherencyProbe(repoPath: string): Promise<void> {
    const entry = this.manifest?.files[repoPath];
    if (!entry?.etag) return;

    const creds = await this.getCredsCached();
    if (!creds) return;

    const resp = await this.apiRequest(creds, 'GET',
      `/repos/${creds.repo}/contents/${repoPath}`);

    if (resp.status === 200) {
      // Content changed but cache reported hit — coherency violation
      const newSha = (resp.data as { sha: string })?.sha;
      if (newSha && newSha !== entry.sha) {
        this.coherencyViolations++;
        this.recordEvent({
          type: 'cache.coherency_violation',
          component: 'cache',
          level: 'error',
          message: `Cache coherency violation: ${repoPath} (cached SHA ${entry.sha}, actual ${newSha})`,
          data: { path: repoPath, cachedSha: entry.sha, actualSha: newSha,
                  totalViolations: this.coherencyViolations },
        });
        // Auto-invalidate entire cache
        await this.fullCacheInvalidation();
      }
    }
    // 304 = coherency confirmed, no action needed
  }

  // ── SIGUSR2 emergency dump ─────────────────────────────────────────────

  private registerSigHandler(): void {
    if (typeof process === 'undefined' || !process.on) return;

    process.on('SIGUSR2', () => {
      if (!this.recorder) return;
      const dump = this.recorder.buildDump('manual', undefined, { trigger: 'SIGUSR2' });
      process.stderr.write(dump.ndjson + '\n');
    });
  }

  // ── Credentials helper ─────────────────────────────────────────────────

  private async getCredsCached(): Promise<SyncCredentials | null> {
    if (this.cachedCreds && Date.now() < this.credsExpiresAt) {
      return this.cachedCreds;
    }
    this.cachedCreds = await getCredentials();
    // Cache for 5 minutes
    this.credsExpiresAt = Date.now() + 5 * 60 * 1000;
    return this.cachedCreds;
  }

  private noCredsError(method: string): ActionableError {
    return new ActionableError({
      goal: `Execute ${method}`,
      problem: 'No GitHub credentials configured. Set GITHUB_APP_ID + PEM or GITHUB_TOKEN.',
      location: `GitHubAPIBackend.${method}`,
      nextSteps: [
        'Set GITHUB_APP_ID + GITHUB_APP_INSTALLATION_ID + GITHUB_APP_PRIVATE_KEY_SECRET_NAME',
        'Or set GITHUB_TOKEN for dev/test',
      ],
    });
  }

  // ── Flight recorder helpers ────────────────────────────────────────────

  private recordEvent(input: RecordInput): void {
    if (this.recorder) {
      this.recorder.record(input);
    }

    // Secondary error buffer (t/465#5)
    if (input.level === 'error' || input.level === 'warn') {
      this.errorBuffer.push({ ...input, _wall: Date.now() });
      if (this.errorBuffer.length > ERROR_BUFFER_CAPACITY) {
        this.errorBuffer.shift();
      }
    }
  }

  // ── Sleep utility ──────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Public accessors for health/diagnostics ────────────────────────────

  getCacheGeneration(): number { return this.manifest?.generation ?? 0; }
  getCachedFileCount(): number { return this.manifest ? Object.keys(this.manifest.files).length : 0; }
  getMainSha(): string { return this.manifest?.lastCommitSha ?? ''; }
  getLastPollAge(): number {
    if (!this.manifest?.lastUpdated) return -1;
    return Math.round((Date.now() - new Date(this.manifest.lastUpdated).getTime()) / 1000);
  }
  getRateLimitRemaining(): number { return this.rateLimit.remaining; }
  getRateLimitResetsAt(): string { return new Date(this.rateLimit.resetsAt).toISOString(); }
  getCircuitState(): CircuitState { return this.circuitState; }
  getCoherencyViolations(): number { return this.coherencyViolations; }
  getErrorBuffer(): Array<RecordInput & { _wall: number }> { return [...this.errorBuffer]; }
  getActiveBranchCount(): number { return this.sessionOverlays.size; }
  getCacheHitRate(): number {
    // Approximation from tree + manifest coverage
    if (this.repoTree.size === 0) return 0;
    const cachedCount = this.manifest ? Object.keys(this.manifest.files).length : 0;
    return Math.min(1, cachedCount / Math.max(1, this.repoTree.size));
  }

  getSessionOverlay(userId: string): Map<string, string> | undefined {
    return this.sessionOverlays.get(userId);
  }

  clearSessionOverlay(userId: string): void {
    this.sessionOverlays.delete(userId);
    this.recordEvent({
      type: 'branch.delete',
      component: 'session',
      level: 'info',
      message: `Session overlay cleared for ${userId}`,
      data: { userId },
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function normalizeErrorForEvent(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack?.slice(0, 500) };
  }
  return { name: 'Error', message: String(err) };
}
