# Performance Analysis — Taxonomy Editor Web App

**Date:** 2026-06-20
**Reviewer:** Technical Lead
**Ticket:** t/719

---

## Executive Summary

The app is well-architected for its current scale (single-digit concurrent users) but has three categories of performance debt: a **6.3MB unminified, unsplit JS bundle** that loads every feature on first paint; **N+1 GitHub API call patterns** in listing endpoints that can take 10-15s on cold cache and exhaust rate limits; and **unbounded session overlay memory** that grows linearly with concurrent editors. Infrastructure is solid — no cold starts in production, good probe separation, and Azure Blob is 10-20x faster than GitHub API.

---

## 1. Client-Side Performance

### Bundle Size

| Category | Raw | Gzipped |
|----------|-----|---------|
| JS total | 6,328 KB | ~1,330 KB |
| CSS total | 436 KB | 64 KB |
| **Grand total** | **6,764 KB** | **~1,394 KB** |

**91% of JS is in a single 5.7MB monolith chunk.** Only 5 functional code splits exist (JSZip, clustering, similarity, UpdatePrompt, @huggingface/transformers). All 30+ tab components in `App.tsx` are statically imported — every feature loads on first paint regardless of which tab the user views.

**The web build is unminified** (`vite.config.ts`: `minify: isWeb ? false : true`). The 5.7MB chunk is raw unminified code. Even though gzip masks some of this, the browser still pays the full parse/compile cost.

### Top Bundle Contributors

| Dependency | Status | Impact |
|------------|--------|--------|
| @huggingface/transformers (220MB) | Correctly excluded (dynamic import) | None |
| onnxruntime-web (128MB) | Correctly excluded | None |
| react-dom | Eagerly loaded (~130KB minified) | Expected |
| @xterm/xterm (5.7MB disk) | **Eagerly loaded** for rarely-used console pane | ~200KB bundled |
| zod v4 (4.3MB disk) | **Eagerly loaded** via schemas | Significant |
| lib/debate/prompts.ts | Own 292KB chunk (27+ templates) | Client doesn't need these |
| oss-licenses.json | Bundled as JS (~298KB) | Should be static file |
| jsQR | **Eagerly loaded** for rare QR scan | ~80KB |

### Optimization Opportunities (by impact)

| # | Change | Effort | Savings |
|---|--------|--------|---------|
| B1 | **Enable minification** for web build | Trivial (1 line) | ~2.5MB raw, ~300KB gzip |
| B2 | **Route-based lazy loading** — `React.lazy` for all tabs except default | Medium | ~3MB moved to on-demand |
| B3 | **manualChunks** vendor splitting | Low | Better cache hit rates |
| B4 | **Lazy-load xterm** — only when console pane opens | Trivial | ~200KB |
| B5 | **Lazy-load jsQR** — only when QR scan starts | Trivial | ~80KB |
| B6 | **Externalize oss-licenses.json** as static file | Low | ~298KB |
| B7 | **Review prompts architecture** — 292KB of templates client may not need | Needs design | ~292KB |

**Combined impact of B1+B2:** First-paint JS drops from ~6.3MB to ~1.5-2MB raw (~800KB gzipped). Remaining features load on tab switch.

---

## 2. Server-Side Performance

### Startup Timeline

| Phase | What happens | Blocking? | Duration |
|-------|-------------|-----------|----------|
| Module load | Sync: read `package.json`, probe dirs, register routes | Yes | <100ms |
| Azure SDK | Dynamic `await import()` for Blob backend (if enabled) | Yes (pre-listen) | ~200ms |
| `server.listen()` | Start accepting requests | — | Instant |
| GitHub init | Async: fetch tree (4-5 API calls), warm caches | No (post-listen) | ~1-2s |

**Good:** Server listens immediately; `/health` returns 200 before data is ready. `/healthz` returns 503 until init completes, which the Azure startup probe handles correctly.

### GitHub API Call Budget

| Operation | API Calls | Frequency |
|-----------|-----------|-----------|
| Startup (fetch tree) | 4-5 | Once per replica start |
| Background poll | 2-4 | Every 60s |
| User save (overlay commit) | 4 | Per sync click (batched) |
| Read file (cache miss) | 1 | Per uncached file |
| List directory | 0 | Served from in-memory tree |
| Coherency probe | 1 | 1% of cache hits |

**Rate limit headroom (5,000/hr = ~83/min):**

| Concurrent Users | Saves/min | Poll Cost | Headroom |
|------------------|-----------|-----------|----------|
| 10 | 5 saves × 4 = 20 | 4 | 83 - 24 = **59 calls free** |
| 25 | 12 saves × 4 = 48 | 4 | 83 - 52 = **31 calls free** |
| 50 | 25 saves × 4 = 100 | 4 | **Over budget** — needs Blob migration |

**This assumes warm cache.** Cold cache scenarios (new replicas, cache expiry) add 1 call per unique file read. Community listing endpoints amplify this dramatically (see N+1 below).

### N+1 Query Patterns (CRITICAL)

**`listCommunityChats/Debates/Submissions` and `listDebateSessionsMeta`** do serial per-file reads: `listDirectory()` + `readFile()` per item in a loop. With 50 community debates on cold cache:

- 1 list call + 50 read calls = **51 GitHub API calls**
- At ~200-300ms each = **10-15 second latency**
- Consumes **61% of per-minute rate budget**

| Endpoint | Pattern | Cold Cache Cost |
|----------|---------|-----------------|
| `GET /api/community/debates` | List + per-file read | 1 + N calls |
| `GET /api/community/chats` | List + per-file read | 1 + N calls |
| `GET /api/admin/submissions` | List + per-file read | 1 + N calls |
| `GET /api/node-source-index` | Serial reads of all summary files | N calls |
| `GET /api/policy-source-index` | Builds node-source-index + more | N+ calls |

**Mitigation:** Debate sessions have a `readDebateIndex()` that serves an index file instead of per-file reads. Community listings lack this pattern. The Blob migration (t/695) will help community data since Blob list operations return metadata inline, but GitHub-backed taxonomy listings still need attention.

### Memory Footprint

| Component | Size | Bounded? |
|-----------|------|----------|
| In-memory repo tree | ~100-150 KB | Yes (fixed by repo size) |
| Session overlays | **5-10 MB per active editor** | **No cap** |
| Anonymous session store | Max 1 GB on disk | Yes (100 sessions × 10 MB) |
| Conflicts cache | ~100s of KB | Yes (5-min TTL) |
| Edges cache | Several MB | No eviction |
| Evidence/doc indexes | Varies | No eviction |
| Cache manifest | ~100 KB | Yes |

**Risk:** Session overlays are unbounded. Each active editor holds full copies of modified files in memory. 10 concurrent editors × 5 MB average = 50 MB. Not dangerous at current scale, but no safety net.

### Azure Blob vs GitHub API

| Operation | GitHub API | Azure Blob | Speedup |
|-----------|-----------|------------|---------|
| Read file | 100-300ms | 5-15ms | ~10-20x |
| Write file | 4 calls (~800ms) | 1 call (~10-30ms) | ~25x |
| List directory | 0ms (cached) | 10-50ms | Tree wins (cached) |

**The Blob migration (t/695) will dramatically improve user-content latency once activated.**

---

## 3. Infrastructure

### Container Resources

| | Production | Staging |
|---|-----------|---------|
| CPU | 1.0 vCPU | 0.25 vCPU |
| Memory | 2 GiB | 0.5 GiB |
| Min replicas | 1 (no cold start) | 0 (scale-to-zero) |
| Max replicas | 5 | 1 |
| Scale trigger | 10 concurrent requests | None |

**Production avoids cold starts** (`minReplicas: 1`). Scale-out adds replicas within the 300s startup probe budget.

### Container Image Size: ~2-3 GB

| Layer | Estimated Size | Needed at Runtime? |
|-------|---------------|-------------------|
| node:22-bookworm-slim | ~200 MB | Yes |
| PowerShell 7.6 | ~100 MB | **Probably not** |
| Python + PyTorch CPU | ~800 MB | **Only for embeddings CLI** |
| MiniLM-L6-v2 model | ~90 MB | Only if local embeddings used |
| System packages (git, pandoc, etc.) | ~200 MB | Partially |
| Build tools (make, g++) | ~150 MB | **No** (build stage only) |
| App + node_modules | ~300 MB | Yes |

**~1 GB of the image may be removable** (PyTorch, PowerShell, build tools) if those aren't used at container runtime.

### Health Probes (well-configured)

| Probe | Path | Interval | Failure Budget |
|-------|------|----------|---------------|
| Startup | `/health` (lightweight sync) | 10s | 300s (5 min) |
| Readiness | `/healthz` (checks data) | 10s | 30s |
| Liveness | `/healthz` | 30s | 90s |

---

## 4. Prioritized Recommendations

### Immediate (this sprint, high ROI)

| # | Issue | Fix | Impact |
|---|-------|-----|--------|
| P1 | Web build unminified | Set `minify: true` in vite.config.ts | -2.5MB bundle, -300KB gzip |
| P2 | No code splitting | `React.lazy` for all tabs except default | -3MB first paint |
| P3 | N+1 community listings | Add index files (like debate index) or batch reads | 10-15s → <1s on cold cache |

### Short-term (next 2 sprints)

| # | Issue | Fix | Impact |
|---|-------|-----|--------|
| P4 | Session overlay unbounded | Add per-user cap (e.g., 20 MB) with LRU eviction | Prevents memory exhaustion |
| P5 | xterm/jsQR eagerly loaded | `React.lazy` / dynamic `import()` | -280KB from initial bundle |
| P6 | manualChunks vendor splitting | Add rollup config | Better cache hit rates on redeploy |
| P7 | Activate Blob routing (t/723) | Deploy + config change | 10-20x faster user-content I/O |

### Medium-term (next quarter)

| # | Issue | Fix | Impact |
|---|-------|-----|--------|
| P8 | Base image ~2-3 GB | Remove PyTorch/PowerShell if unused at runtime | -1 GB image, faster scale-out |
| P9 | Node source index N+1 | Cache or pre-build index file | Faster policy/source views |
| P10 | No `--max-old-space-size` | Set to 1536 (match container memory) | Prevent OOM without GC |
| P11 | Scale trigger threshold | Evaluate raising from 10 to 25-50 concurrent | Reduce unnecessary scale-out |
| P12 | WebSocket backpressure | Check `bufferedAmount` before send | Prevent memory bloat from slow clients |

### Accepted (no action needed)

- Azure Files mount latency: adequate for anonymous sessions at current scale
- Cold start: eliminated by `minReplicas: 1` in production
- Heavy ML deps (@huggingface, onnxruntime): already correctly excluded from bundle
- Rate limit at current scale (<10 users): comfortable headroom

---

## Key Files

- `taxonomy-editor/vite.config.ts` — build config (minify, chunks)
- `taxonomy-editor/src/renderer/App.tsx` — all static imports (no code splitting)
- `taxonomy-editor/src/server/githubAPIBackend.ts` — API call patterns, caching, rate limits
- `taxonomy-editor/src/server/community.ts` — N+1 listing pattern
- `taxonomy-editor/src/server/server.ts` — startup, routes, WebSocket, health
- `taxonomy-editor/src/server/azureBlobBackend.ts` — Blob operations
- `deploy/azure/main.bicep` — container resources, probes, scaling
- `deploy/azure/Dockerfile.base` — base image contents
