# HLD: Migrate User Content from GitHub to Azure Blob Storage

**Last updated:** 2026-06-20
**Author:** Technical Lead
**Status:** Draft

## Problem

All data -- taxonomy, conflicts, user chats, user debates, community library, submissions -- currently lives in the `ai-triad-data` GitHub repo, accessed via the `GitHubAPIBackend`. This is wrong for user-generated content:

1. **Privacy**: User chats and debates may contain sensitive personal content. Storing them in a GitHub repo (even private) gives repo collaborators access to all users' data.
2. **Rate limits**: GitHub Contents API is capped at 5,000 requests/hour. Each user save is 4+ API calls. At 10 concurrent users this is manageable; at 50 it breaks.
3. **Repo bloat**: Every debate save creates a commit. The data repo grows linearly with user activity -- git history is meaningless for ephemeral user content.
4. **Complexity**: The session overlay + commit + PR workflow exists purely because GitHub doesn't support direct writes. This is unnecessary complexity for user content that doesn't need versioning.

## Decision

Split storage: **taxonomy and shared reference data stay in GitHub** (versioned, PR-reviewed). **User content and community library move to Azure Blob Storage** (direct read/write, per-user isolation, no versioning overhead).

## What Moves vs. What Stays

| Data | Current Location | New Location | Rationale |
|---|---|---|---|
| Taxonomy files | `taxonomy/Origin/` | **Stays in GitHub** | Versioned, PR-reviewed, shared |
| Conflicts | `conflicts/conflicts.json` | **Stays in GitHub** | Versioned, shared reference data |
| Calibration logs | `calibration/` | **Stays in GitHub** | Append-only metrics, shared |
| Summaries | `summaries/` | **Stays in GitHub** | Static reference data |
| User chats | `users/{id}/chats/` | **Azure Blob** | Per-user, unversioned, potentially sensitive |
| User debates | `users/{id}/debates/` | **Azure Blob** | Per-user, unversioned, potentially sensitive |
| User settings | `users/{id}/settings.json` | **Azure Blob** | Per-user config |
| Community chats | `community/chats/` | **Azure Blob** | User-generated shared content |
| Community debates | `community/debates/` | **Azure Blob** | User-generated shared content |
| Submissions | `community/_submissions/` | **Azure Blob** | Transient review queue |

## Azure Blob Storage Design

### Container Layout

```
Storage Account: staitriad{uniqueSuffix}
  |
  +-- Container: user-content
  |     |
  |     +-- {storageUserId}/
  |     |     +-- chats/
  |     |     |     chat-{uuid}.json
  |     |     +-- debates/
  |     |     |     debate-{uuid}.json
  |     |     |     debate-{uuid}-comments.json
  |     |     |     _index.json
  |     |     +-- settings.json
  |     |
  |     +-- {anotherUser}/
  |           ...
  |
  +-- Container: community
        |
        +-- chats/
        |     chat-{uuid}.json
        +-- debates/
        |     debate-{uuid}.json
        +-- _submissions/
              sub-{uuid}.json
```

### Why Blob Storage (not Azure Files or Cosmos DB)

- **Azure Files** is already mounted at `/mnt/shared` for anonymous sessions. It works but has POSIX semantics (file locks, mtime tracking) that are fragile across replicas. Blob Storage's HTTP API is cleaner for structured JSON document storage.
- **Cosmos DB** provides query capabilities we don't need. Our access patterns are key-based (read/write by ID, list by prefix). Blob Storage handles this natively at 1/10th the cost.
- **Blob Storage** costs ~$0.02/GB/month (Hot tier), supports Managed Identity auth (no connection strings to manage), and scales without configuration.

### Authentication

The Container App already has a **system-assigned Managed Identity** used for Key Vault access. We extend it to Blob Storage:

- Role assignment: `Storage Blob Data Contributor` on the storage account
- Access: `DefaultAzureCredential` from `@azure/identity` SDK (already a pattern in the codebase via Key Vault)
- No connection strings, no SAS tokens, no secrets to rotate

### Access Isolation

Blob Storage doesn't have per-directory ACLs in flat namespace mode. Isolation is enforced **at the application layer**, same as today:

- `getStorageUserId()` from `AsyncLocalStorage` determines the blob prefix
- Server-side path construction: `{storageUserId}/debates/debate-{id}.json`
- Path traversal prevention: existing `assertSafeId()` / `safeSegment()` guards remain
- Admin access for community review: server checks `isAdmin()` before allowing reads from `community/` container

This is identical to the current GitHub model -- the security boundary is the server, not the storage layer.

## New StorageBackend: AzureBlobBackend

The existing `StorageBackend` interface is the integration seam. A new `AzureBlobBackend` implements it.

### Interface Mapping

```typescript
// StorageBackend method → Azure Blob SDK call

readFile(path)        → blobClient.download() → streamToString()
                        Returns null on 404 (BlobNotFound)

writeFile(path, data) → blockBlobClient.upload(data, data.length)
                        Overwrites existing. No mkdir needed (virtual dirs).

listDirectory(path)   → containerClient.listBlobsByHierarchy('/', {prefix})
                        Returns blob name segments (like filenames)

deleteFile(path)      → blobClient.delete()
                        No-op on 404

fileExists(path)      → blobClient.exists()

readBinaryFile(path)  → blobClient.download() → streamToBuffer()
```

### Key Differences from GitHubAPIBackend

| Aspect | GitHubAPIBackend | AzureBlobBackend |
|---|---|---|
| Write durability | Overlay → commit (deferred) | Immediate (direct HTTP PUT) |
| Session branches | Required for writes | Not needed |
| Rate limits | 5,000/hr shared | ~20,000 RPS per account |
| Versioning | Git commits | None (not needed) |
| Auth | GitHub App PEM | Managed Identity |
| Cache | Disk cache + overlay | Optional local cache (low priority) |
| `opts.ref` | Selects git ref | Ignored (no branches) |

### No Session Overlay for User Content

The session overlay exists because GitHub doesn't support direct writes to main. With Azure Blob, writes are immediate and durable. This means:

- **No overlay for user content** -- `writeFile()` goes directly to Blob Storage
- **No commit step** -- the "Commit" button and `POST /api/sync/commit` are for taxonomy edits only
- **No session branch for user content** -- `api-session/{userId}` branches remain only for taxonomy edits (which still go through `GitHubAPIBackend`)

This eliminates the "data loss if you forget to commit" UX problem for chats/debates.

## Architecture: Dual Backend Routing

`fileIO.ts` becomes a **router** between two backends based on data type:

```typescript
// Current: single backend for everything
let backend: StorageBackend = new FilesystemBackend();

// New: two backends, fileIO routes by data type
let taxonomyBackend: StorageBackend;   // GitHub (versioned shared data)
let userContentBackend: StorageBackend; // Azure Blob (per-user + community)

// In server.ts startup:
if (STORAGE_MODE === 'github-api') {
  taxonomyBackend = new GitHubAPIBackend({...});
  userContentBackend = new AzureBlobBackend({
    accountUrl: process.env.AZURE_STORAGE_ACCOUNT_URL,
    // auth via DefaultAzureCredential (managed identity)
  });
} else {
  // Electron / local dev: both use filesystem
  taxonomyBackend = new FilesystemBackend();
  userContentBackend = new FilesystemBackend();
}
```

### Routing Rules in fileIO.ts

```
getDebatesDir()   → userContentBackend     (container: user-content)
getChatsDir()     → userContentBackend     (container: user-content)
getTaxonomyDirs() → taxonomyBackend        (GitHub repo)
getConflictsDir() → taxonomyBackend        (GitHub repo)
getCalibration()  → taxonomyBackend        (GitHub repo)
getSummaries()    → taxonomyBackend        (GitHub repo)
```

Community operations in `community.ts` route to `userContentBackend` (container: `community`).

### Minimal fileIO.ts Changes

The pivot is replacing `backend` with the right backend per function:

```typescript
// BEFORE:
function getDebatesDir(): string {
  const userId = getStorageUserId();
  if (userId === '_local') return resolveDataPath('debates');
  return resolveDataPath(`users/${userId}/debates`);
}

export async function saveDebateSession(session: unknown): Promise<void> {
  // ...
  await backend.writeFile(debatePath, JSON.stringify(session, null, 2));
}

// AFTER:
function getDebatesDir(): string {
  const userId = getStorageUserId();
  if (userId === '_local') return resolveDataPath('debates');
  return `${userId}/debates`;  // Blob path, no resolveDataPath prefix
}

export async function saveDebateSession(session: unknown): Promise<void> {
  // ...
  await getUserContentBackend().writeFile(debatePath, JSON.stringify(session, null, 2));
  // Direct write — no ensureSessionBranch(), no overlay, no commit step
}
```

## Infrastructure Changes (Bicep)

### New Resources

```bicep
// Storage Account (LRS, Hot tier)
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'staitriad${uniqueSuffix}'
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

// Blob containers
resource userContentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: '${storageAccount.name}/default/user-content'
  properties: { publicAccess: 'None' }
}

resource communityContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: '${storageAccount.name}/default/community'
  properties: { publicAccess: 'None' }
}

// Grant the Container App's managed identity Blob Data Contributor
resource blobRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storageAccount
  name: guid(storageAccount.id, containerApp.id, 'blob-contributor')
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'ba92f5b4-2d11-453d-a403-e96b0029c9fe'  // Storage Blob Data Contributor
    )
    principalId: containerApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
```

### New Environment Variables

```bicep
{ name: 'AZURE_STORAGE_ACCOUNT_URL', value: storageAccount.properties.primaryEndpoints.blob }
```

No secrets -- Managed Identity handles auth.

### Cost Estimate

At current usage (1 active user, ~100 debates, ~50 chats):
- Storage: < 50 MB = ~$0.001/month
- Transactions: ~1,000 reads + 500 writes/day = ~$0.01/month
- Total: effectively free

At 50 concurrent users: ~$0.50/month. Blob Storage costs are negligible.

## Anonymous Session Store

The `AnonymousSessionStore` currently writes to Azure Files at `/mnt/shared/anon-sessions/`. Two options:

**Option A (recommended): Keep on Azure Files.** Anonymous sessions are ephemeral (4-hour TTL), low-stakes, and the filesystem-backed pattern works well. Moving them to Blob Storage adds complexity for no benefit.

**Option B: Move to Blob Storage.** Would eliminate the Azure Files dependency entirely. The Container App volume mount could be removed. But the TTL/cleanup logic would need rewriting for Blob (lease-based expiry vs. mtime checking).

Recommendation: **Option A** -- keep anonymous sessions on Azure Files for now. Revisit if we want to drop the Azure Files dependency entirely.

## Migration

### One-Time Data Migration Script

```
1. Read all users/{userId}/chats/*.json from GitHub repo
2. Upload each to Blob: user-content/{userId}/chats/*.json
3. Read all users/{userId}/debates/*.json from GitHub repo
4. Upload each to Blob: user-content/{userId}/debates/*.json
5. Read community/{chats,debates}/*.json from GitHub repo
6. Upload each to Blob: community/{chats,debates}/*.json
7. Read community/_submissions/*.json from GitHub repo
8. Upload each to Blob: community/_submissions/*.json
```

### Cutover Strategy

1. Deploy Azure Blob backend (reads from Blob, writes to Blob)
2. Run migration script (copies GitHub → Blob)
3. Verify via `GET /api/user/profile` that debate/chat counts match
4. Remove user content from GitHub repo (cleanup PR)
5. Remove session branch creation for non-taxonomy writes

### Rollback

If Blob Storage has issues, the `STORAGE_MODE` env var can gate backend selection. Add a `USER_CONTENT_STORAGE` variable:
- `github-api` (current) -- everything through GitHub
- `azure-blob` (new) -- user content to Blob, taxonomy to GitHub
- `filesystem` (Electron/local) -- everything local

## Impact on Existing Features

### Session Branches

Session branches (`api-session/{userId}`) remain for **taxonomy edits only**. The sync panel (commit, diff, PR creation) is taxonomy-scoped. User content writes bypass the session branch entirely.

### Community Submission Pipeline

No functional change -- the `submitToCommunity()` / `approveSubmission()` flow is identical, just targeting Blob Storage instead of GitHub. The `opts.ref` parameter becomes a no-op (Blob has no branches).

### Quotas

No change -- `checkQuota()` counts items via `listDirectory()`, which works identically on Blob.

### Anonymous Sessions

No change (stays on Azure Files).

### Electron Desktop

No change -- Electron continues using `FilesystemBackend` for everything. The dual-backend routing only activates in `github-api` storage mode.

### Scaling

With user content on Blob, the replica pinning constraint (main.bicep line 374-375, `maxReplicas: 1`) can be relaxed for user content. Anonymous sessions still need the Azure Files mount, but authenticated user content is now replica-safe by default.

## Dependencies

```
New npm packages:
  @azure/storage-blob    — Blob Storage SDK
  @azure/identity        — DefaultAzureCredential (may already be present via Key Vault)
```

## Implementation Phases

### Phase 1: AzureBlobBackend + Bicep
- Implement `AzureBlobBackend` (new file, implements `StorageBackend`)
- Add storage account + containers + role assignment to `main.bicep`
- Add `AZURE_STORAGE_ACCOUNT_URL` env var
- Unit tests against Azurite (local Blob emulator)

### Phase 2: Dual-Backend Routing
- Add `getUserContentBackend()` / `getTaxonomyBackend()` to `fileIO.ts`
- Route debate/chat operations through `userContentBackend`
- Route community operations through `userContentBackend`
- `ensureSessionBranch()` no longer called for user content writes
- Integration tests

### Phase 3: Migration + Cutover
- Migration script: GitHub → Blob
- `USER_CONTENT_STORAGE` env var for gradual rollout
- Verify counts match, then remove user content from GitHub repo
- Update design-debate-sharing.md

### Phase 4: Cleanup
- Remove session branch creation for non-taxonomy writes
- Simplify sync panel (taxonomy-only scope)
- Remove `users/` and `community/` directories from GitHub repo
- Update documentation

## Key Files

| File | Change |
|---|---|
| `server/azureBlobBackend.ts` | **New** -- implements StorageBackend for Azure Blob |
| `server/fileIO.ts` | Dual-backend routing (user content vs. taxonomy) |
| `server/community.ts` | Switch from `getBackend()` to `getUserContentBackend()` |
| `server/server.ts` | Backend initialization, remove ensureSessionBranch for non-taxonomy |
| `server/storageBackend.ts` | No change (interface is sufficient) |
| `server/config.ts` | New `USER_CONTENT_STORAGE` config |
| `deploy/azure/main.bicep` | Storage account, containers, role assignment, env var |
| `docs/design-debate-sharing.md` | Update storage layout section |

## Open Questions

1. **Blob soft-delete**: Enable 7-day soft-delete for accidental deletion recovery? Costs ~2x storage but provides safety net. Recommended: yes.
2. **Blob versioning**: Enable for community content (audit trail of approved items)? Costs additional storage. Recommended: no -- the submission envelope provides the audit trail.
3. **CDN for community reads**: If community browsing gets heavy traffic, put a CDN in front of the community container. Not needed at current scale.
