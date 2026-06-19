# GitHub API Usage Analysis

**Last updated:** 2026-06-19
**Author:** Diagnostics (Orca)

This document explains how the Taxonomy Editor's `GitHubAPIBackend` uses the GitHub API, why the reported "cache hit rate" is misleadingly low, and strategies for reducing rate limit exhaustion.

## Architecture Overview

The `GitHubAPIBackend` (`taxonomy-editor/src/server/githubAPIBackend.ts`) is the storage layer for the web-deployed Taxonomy Editor. It reads and writes taxonomy data files from a GitHub repository using the GitHub REST API, with a three-layer read path:

1. **Session overlay** — in-memory per-user writes (zero API calls until commit)
2. **Disk cache** — write-through file cache on the container's local filesystem
3. **GitHub API** — fetched on cache miss, then written through to disk cache

## Scenarios That Use the GitHub API

### 1. Cold-Start Conflict Warm-Up (~1,243 calls)

**This is the dominant consumer.** On server startup (or after a container restart), `readAllConflictFiles()` in `fileIO.ts:230-251` loads all conflict definition files:

- 1 `listDirectory()` call to enumerate the conflicts directory
- ~1,242 `readFile()` calls (one per conflict JSON file), batched 20-at-a-time

With an empty disk cache (fresh container), every one of these is a cache miss that hits the GitHub API. This single operation burns **~25% of the hourly rate limit** in one burst.

**Rate:** ~1,243 calls per cold start. Frequency depends on container restarts (Azure Container Apps may restart on deploy, scaling events, or health check failures).

### 2. Background Polling (~120 calls/hour)

The polling loop (`startPolling()`, line 1684) runs every 60 seconds and makes 1-2 API calls per tick:

- `getLatestCommitSha()` — 1 call to check the current HEAD
- `getChangedFiles()` — 1 call (compare endpoint) if HEAD has moved
- `fetchRepoTree()` — 2 calls (commit + tree) if HEAD changed, to refresh the in-memory tree

**Rate:** ~60-120 calls/hour steady-state. This is modest and well within budget.

### 3. User File Reads (variable, 0-N per request)

Each `readFile()` call checks: overlay → disk cache → GitHub API. Only disk cache misses reach GitHub. The first time a file is read after a cold start (or cache invalidation), it costs 1 API call. Subsequent reads of the same file are served from disk cache at zero cost.

**Rate:** Depends on user activity and cache warmth. After warm-up, most reads hit cache.

### 4. User Commits (4 calls per commit)

`commitOverlay()` (line 772) uses the Git Data API to atomically commit all pending writes:

1. `GET /git/refs/heads/{branch}` — get current branch SHA
2. `POST /git/trees` — create a new tree with all file changes
3. `POST /git/commits` — create the commit object
4. `PATCH /git/refs/heads/{branch}` — update the branch pointer

**Rate:** 4 calls per user save. Infrequent — only when a user explicitly commits their work.

### 5. Repo Tree Fetch (2 calls)

`fetchRepoTree()` (line 1659) fetches the full recursive tree to populate the in-memory file index:

1. `GET /git/commits/{sha}` — get the tree SHA from the commit
2. `GET /git/trees/{sha}?recursive=1` — get all ~6,800 entries

**Rate:** 2 calls on init, then 2 calls whenever polling detects a new commit. Cheap.

### 6. Coherency Probes (~1 call per 100 cache hits)

On each disk cache hit, there's a 1% chance (`coherencyProbeRate = 0.01`) of an async probe that re-fetches the file from GitHub to verify the cache isn't stale.

**Rate:** Negligible. ~1 call per 100 cached reads.

## Summary: API Call Budget

| Scenario | Calls | Frequency | Hourly Impact |
|---|---|---|---|
| Conflict warm-up (cold) | ~1,243 | Per cold start | ~1,243 (burst) |
| Background polling | 1-4 | Every 60s | ~60-120 |
| User file reads (miss) | 1 each | On cache miss | Variable |
| User commit | 4 | Per save | ~4-20 |
| Tree fetch | 2 | On detected change | ~2-10 |
| Coherency probes | 1 | 1% of cache hits | ~1-5 |

**GitHub rate limit:** 5,000 calls/hour for GitHub App installations.

**Worst case:** A single cold start (~1,243) + 1 hour of polling (~120) + moderate user activity (~100 misses) = ~1,463 calls. Two cold starts in the same hour could push past 2,500. Three, and you're at risk of exhaustion — especially if combined with a burst of user reads on uncached files.

## Why the "Cache Hit Rate" Is Misleadingly Low

The metric reported by `getCacheHitRate()` (line 1896) is **not a hit rate**. It's a **cache coverage ratio**:

```typescript
getCacheHitRate(): number {
  if (this.repoTree.size === 0) return 0;
  const cachedCount = this.manifest ? Object.keys(this.manifest.files).length : 0;
  return Math.min(1, cachedCount / Math.max(1, this.repoTree.size));
}
```

This divides `number of files in disk cache` by `total files in the repo tree`. With ~103 cached files out of ~6,800 tree entries, it reports 1.5%.

**Why this is wrong as a "hit rate":**

1. **The denominator includes files that are never read.** The repo tree has ~6,800 entries (every file in the repo), but the app only reads a subset — taxonomy JSONs, conflict files, config, etc. Files like README, CI configs, source code, and images are never requested through this backend.

2. **There's no actual hit/miss counter.** The code emits `cache.hit` and `cache.miss` flight recorder events but never aggregates them into a ratio. The metric is calculated from static inventory counts, not from runtime request patterns.

3. **The metric never improves during a session.** Even after the conflict warm-up fills the cache with ~1,242 files, the tree has ~6,800 entries, so the ratio only reaches ~18%. The actual runtime hit rate (if measured) would be near 100% for subsequent reads of those files.

**The real hit rate** — if someone were to count `cache.hit` vs `cache.miss` events in the flight recorder — would be much higher after warm-up, likely 90%+ during normal operation.

## Circuit Breaker Behavior

When 5 consecutive API calls fail (typically from rate limit exhaustion), the circuit breaker opens:

- **Open state:** All API reads return `null` — files not in cache become unavailable
- **Probe schedule:** 30s → 1m → 2m → 5m (capped) — progressively slower retry attempts
- **Recovery:** A single successful probe closes the circuit immediately

The circuit breaker is the right pattern, but the probe schedule is relatively aggressive for rate limit exhaustion (where the reset is typically 30-60 minutes away). A probe during rate limit exhaustion just wastes one of the few remaining calls.

## Strategies for Improvement

### 1. Warm Cache from Fallback Data Instead of API (High Impact)

The Docker image already copies `taxonomy-snapshot/` into `/app/fallback-data/` (visible in the Dockerfile). If the disk cache were pre-seeded from this snapshot at startup, the conflict warm-up would find ~1,242 cache hits instead of ~1,242 cache misses, eliminating the largest API consumer entirely.

**Implementation:** On first boot (empty cache dir), copy files from `fallback-data/` into the cache directory structure and build the initial manifest from them. Subsequent polling would incrementally invalidate stale entries.

### 2. Implement a Real Hit/Miss Metric (Medium Impact — Observability)

Replace `getCacheHitRate()` with actual counters:

```typescript
private cacheHits = 0;
private cacheMisses = 0;

getRealHitRate(): number {
  const total = this.cacheHits + this.cacheMisses;
  return total === 0 ? 0 : this.cacheHits / total;
}
```

Increment on each `readFile()` path. This gives operators an accurate picture of cache effectiveness and makes it obvious when warm-up is the problem vs. ongoing misses.

### 3. Rate-Limit-Aware Throttling (Medium Impact)

Before making API calls, check `this.rateLimit.remaining`. When remaining drops below a threshold (e.g., 500), switch to a degraded mode:

- Skip coherency probes entirely
- Reduce polling frequency (e.g., 5 minutes instead of 60 seconds)
- Queue non-critical reads and serve `null` rather than burning remaining quota
- Log a warning so operators can see the throttle in action

### 4. Batch Conflict Reads via Trees API (Medium Impact)

Instead of 1,242 individual `readFile()` calls, use the Git Trees API to fetch the conflicts directory tree in one call, then fetch file contents via the Git Blobs API. The Trees API returns SHAs for each file — combined with the Blobs API, this could reduce ~1,242 calls to ~1,242 blob fetches, but more importantly, the tree call would let you check which files have changed since the last cached version, allowing you to skip unchanged files entirely.

Even better: if the tree SHAs match the cached manifest SHAs, skip the fetch entirely — the cache is still valid.

### 5. Smarter Circuit Breaker for Rate Limits (Low Impact)

When the circuit opens due to a 403 rate limit response, read the `X-RateLimit-Reset` header and set the probe delay to match the reset time rather than using the fixed 30s/1m/2m/5m schedule. This avoids wasting probes during the cooldown window.

### 6. Reduce Conflict File Count (Low Impact, Long-Term)

1,242 conflict files is a lot. If many are resolved or stale, archiving them to a separate directory (not loaded at startup) would reduce both the API call count and memory footprint.

## Recommended Priority

1. **Warm from fallback data** — eliminates the #1 problem with zero runtime cost
2. **Real hit/miss metric** — gives you actual data to make future decisions
3. **Rate-limit-aware throttling** — graceful degradation instead of hard failure
4. **Smarter circuit breaker** — small change, prevents wasted probes
5. **Batch reads / reduce file count** — longer-term structural improvements
