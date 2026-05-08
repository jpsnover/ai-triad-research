# Data Flow: ai-triad-data ↔ Taxonomy Editor (Azure)

## 1. Data Elements

The `ai-triad-data` repo contains 7 distinct data types, each with different storage paths, load timing, and sync behavior:

| Data Type | Path in ai-triad-data | File Format | Load Timing | Editable in App? |
|-----------|----------------------|-------------|-------------|-----------------|
| **Taxonomy (POV)** | `taxonomy/Origin/{acc,saf,skp}.json` | JSON (nodes array) | Startup — Phase 1 | Yes |
| **Situations** | `taxonomy/Origin/situations.json` | JSON (nodes array) | Startup — Phase 2 | Yes |
| **Conflicts** | `conflicts/{claim-id}.json` | JSON (one file per conflict) | Startup — Phase 2 | Yes |
| **Edges** | `taxonomy/Origin/edges.json` | JSON (edges array) | Lazy (on demand) | Yes |
| **Embeddings** | `taxonomy/Origin/embeddings.json` | JSON (384-dim vectors) | Eager (on debate start); also on semantic search | Auto-updated on save |
| **Debates** | `debates/debate-{id}.json` | JSON (session transcript + AN) | On demand (user opens debate) | Yes |
| **Sources** | `sources/{doc-id}/metadata.json` + `snapshot.md` | JSON + Markdown | Lazy (index built on first use) | No (read-only) |

Additional supporting files: `policy_actions.json`, `aggregated-cruxes.json`, `conflict-clusters.json`, `summaries/`.

### Key Difference: Taxonomy vs Debates

**Taxonomy** (POV files, situations, conflicts, edges) is the **shared knowledge base**. All users see the same taxonomy. Edits are saved immediately to disk and optionally committed to a git session branch.

**Debates** are **per-session artifacts**. Each debate is a self-contained JSON file with its own transcript, argument network, QBAF results, and reflections. Debates reference taxonomy nodes but are stored separately.

```
ai-triad-data/
├── taxonomy/Origin/          ← SHARED, loaded at startup
│   ├── accelerationist.json
│   ├── safetyist.json
│   ├── skeptic.json
│   ├── situations.json
│   ├── edges.json
│   └── embeddings.json
├── conflicts/                ← SHARED, loaded at startup
│   ├── conflict-001.json
│   └── ...
├── debates/                  ← PER-SESSION, loaded on demand
│   ├── debate-4546569a.json
│   └── ...
└── sources/                  ← READ-ONLY reference material
    ├── doc-001/
    │   ├── metadata.json
    │   └── snapshot.md
    └── ...
```

---

## 2. How Data Gets INTO the Azure Container

Three layers, each solving a different problem:

### Layer 1: Azure Files (persistent storage)

Azure Files SMB share mounted at `/data-persistent` via Bicep configuration. This is the durable store — survives container restarts, scales to zero, and persists across deployments.

The data repo is cloned here (either manually or via the app's GitHub App integration).

### Layer 2: Entrypoint Copy (fast local disk)

Azure Files SMB has 5-25ms latency per operation. The app reads/writes to `/data` (local container disk, <1ms). The entrypoint bridges the gap:

```
Container starts
  ├── App starts immediately on port 7862 (health check passes)
  └── Background process copies /data-persistent → /data
      ├── 9 directories: taxonomy, conflicts, debates, sources, summaries, ...
      ├── Progress tracked at /tmp/copy-status.json
      └── Completes in 30-60 seconds
```

The app serves from fast local `/data`. Saves write to local `/data` and are durable because the Azure Files share is the source of truth for the next container start.

**Key implication:** Changes saved to `/data` are local to the running container. If the container restarts before the data is synced back to `/data-persistent` or committed to git, changes are lost.

### Layer 3: Data Root Resolution

The app finds its data via this priority chain:
1. `AI_TRIAD_DATA_ROOT=/data` (set by Bicep) — **Azure uses this**
2. `.aitriad.json` `data_root` field (relative path)
3. Monorepo fallback `../ai-triad-data` (dev only)

---

## 3. Startup Data Load Sequence

```
User opens app → React App.tsx mounts
  │
  ├── Check: isDataAvailable?
  │   ├── YES → load taxonomy
  │   └── NO + web mode + data root set → DeploymentErrorScreen
  │
  └── useTaxonomyStore.loadAll()
      │
      ├── PHASE 1 (blocking, app waits):
      │   └── GET /api/taxonomy/accelerationist → first POV file
      │       App renders immediately with partial data
      │
      └── PHASE 2 (parallel background):
          ├── GET /api/taxonomy/safetyist
          ├── GET /api/taxonomy/skeptic
          ├── GET /api/taxonomy/situations
          ├── GET /api/conflicts         (scans conflicts/ directory)
          ├── GET /api/policy-registry
          ├── GET /api/conflicts/clusters
          └── GET /api/cruxes
```

**Server-side path** (for each GET):
```
server.ts endpoint
  → fileIO.ts: getTaxonomyDir() → {dataRoot}/taxonomy/Origin/
  → fs.readFileSync({file})
  → strip UTF-8 BOM
  → JSON.parse()
  → return to client
```

**Lazy-loaded data** (not at startup):
- **Edges** — loaded when Edge Browser panel opens
- **Embeddings** — loaded on first semantic search
- **Sources index** — built on first source lookup
- **Debate sessions** — loaded when user opens a specific debate

---

## 4. Save Path

### Taxonomy Save (POV files, situations, conflicts)

```
User edits a node → Zustand store updated (in-memory)
  │
  └── User clicks Save (or Approve & Apply triggers save)
      │
      ├── CLIENT: Zod schema validation
      ├── CLIENT: Referential integrity check (validateTaxonomy)
      │   └── If errors → abort, show in SaveBar, no write
      │
      └── PUT /api/taxonomy/{pov}  (or PUT /api/conflicts/{id})
          │
          └── SERVER: fileIO.ts
              ├── Write to {file}.tmp
              ├── Atomic rename: {file}.tmp → {file}
              └── Return success
```

### Debate Save

```
Debate action (turn, reflection, etc.)
  │
  └── useDebateStore.saveDebate()
      │
      └── PUT /api/debates/{id}
          │
          └── SERVER: Write debate-{id}.json to {dataRoot}/debates/
```

### Embeddings (auto-updated)

After a successful taxonomy save, embeddings are updated fire-and-forget:
```
Save completes → POST /api/embeddings/update-nodes
  └── Re-embed changed nodes → update embeddings.json
```

---

## 5. Git Sync (Getting Changes Back to GitHub)

**This is the critical gap to understand.** Saving to disk is NOT the same as syncing to GitHub.

### Current State

Git sync is **optional** and controlled by `GIT_SYNC_ENABLED=1`:

| Operation | Endpoint | What It Does |
|-----------|----------|-------------|
| Check for updates | `POST /api/data/check-updates` | Compares local HEAD vs origin/main |
| Pull updates | `POST /api/data/pull` | Fetches + resets to origin/main (discards local changes) |
| Commit changes | `POST /api/sync/commit` | Commits dirty files to `web-session/{user}` branch |
| Sync status | `GET /api/sync/status` | Returns count of uncommitted changes |

### Data Flow Direction

```
GitHub (ai-triad-data)
    │
    ▼ (git clone / pull)
Azure Files (/data-persistent)
    │
    ▼ (entrypoint copy)
Container Local (/data)
    │
    ▼ (user edits + save)
Container Local (/data)  ← changes are HERE
    │
    ▼ (git commit + push, IF sync enabled)
GitHub (ai-triad-data, web-session/{user} branch)
    │
    ▼ (manual PR merge to main)
GitHub (ai-triad-data, main branch)
```

**Important:** Changes flow DOWN automatically (GitHub → Azure Files → local). Changes flow UP only if git sync is enabled AND the user commits AND someone merges the PR.

---

## 6. Diagnostic Checklist

### "Is the data there?"

```bash
# 1. Check health endpoint
curl https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io/healthz
# Expected: {"status":"healthy","dataRoot":"/data"}

# 2. Check data availability
curl https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io/api/data/available
# Expected: true

# 3. Check copy status (during startup)
curl https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io/status
# Expected: {"state":"complete"} or progress details
```

### "Is the data current?"

```bash
# 4. Check what git revision the app is running from (NOTE: POST, not GET)
curl -X POST https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io/api/data/check-updates
# Shows local HEAD vs origin/main — are they the same?

# 5. Check sync status (uncommitted local changes)
curl https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io/api/sync/status
# Shows count of files changed locally but not committed
```

### "Are my edits being saved?"

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Edit appears in app but gone after container restart | Saved to local `/data` but not committed to git | Enable git sync, commit changes |
| Save button shows error | Validation failure (schema or integrity) | Check SaveBar error message, fix data |
| Save succeeds but other users don't see it | Changes on local disk only, not pushed to GitHub | Commit + push + pull on other instance |
| Approve & Apply shows error | Evidence QBAF or integrity check failed | Check inline error message |

### "Why does the app show old data?"

```
Container restarts → copies from /data-persistent (Azure Files)
  └── Azure Files has the data from last git pull
      └── If nobody pulled since the last push, data is stale

Fix: POST /api/data/pull to update from GitHub
```

### "Are debates being saved?"

Debates save to `{dataRoot}/debates/` on every action (turn, phase transition, reflection). They follow the same local-disk path as taxonomy. Check:

```bash
# List debates via API
curl https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io/api/debates
```

### Container Logs (for deeper diagnosis)

```bash
# Console logs (app output)
az containerapp logs show --name taxonomy-editor -g ai-triad \
  --type console --tail 100

# System events (probes, OOM, restarts)
az containerapp logs show --name taxonomy-editor -g ai-triad \
  --type system --tail 50
```

---

## 7. Summary: What's Different About Each Data Type

| Data Type | Loaded | Saved | Synced to Git | Shared Across Users |
|-----------|--------|-------|---------------|-------------------|
| Taxonomy (POV) | Startup | On save (atomic) | If sync enabled | Yes (shared files) |
| Situations | Startup | On save (atomic) | If sync enabled | Yes |
| Conflicts | Startup | On save (atomic) | If sync enabled | Yes |
| Edges | Lazy | On save (atomic) | If sync enabled | Yes |
| Embeddings | Lazy | Auto after save | If sync enabled | Yes |
| Debates | On demand | On every action | If sync enabled | Yes (shared files) |
| Sources | Lazy (read-only) | Never (read-only) | N/A | Yes |
| Cruxes | Startup | Via cmdlet only | Via cmdlet commit | Yes |

The key architectural difference is **not** between taxonomy and debates — both follow the same save-to-local-disk pattern. The difference is in **load timing** (startup vs on-demand) and **edit frequency** (taxonomy edits are deliberate, debate saves are automatic on every turn).

The real gap is **sync**: local saves are durable only for the lifetime of the container. Without git sync enabled and active, any container restart reverts to the last Azure Files state.
