# Debate Sharing: Design Document

**Last updated:** 2026-06-25
**Author:** Technical Lead

## Overview

The taxonomy-editor supports two build targets (Electron desktop and Azure-hosted web app) with three debate storage scopes: **personal** ("My Debates"), **community** (shared library), and **anonymous** (ephemeral). Debates flow from personal → community via a submission/approval pipeline with sanitization. This document traces the full lifecycle.

---

## 1. Storage Layout

Debate data is split across two storage backends based on data type:

- **Taxonomy & shared reference data** stay in the `ai-triad-data` GitHub repo (versioned, PR-reviewed)
- **User content & community library** live in Azure Blob Storage (direct read/write, no versioning overhead)

See `docs/hld-azure-blob-user-content.md` for the full migration rationale and design.

### Azure Blob Storage (user content)

Two containers, routed by path prefix in `AzureBlobBackend.containerFor()`:

```
Storage Account: staitriad{uniqueSuffix}

  Container: user-content
    users/
      {storageUserId}/
        debates/
          debate-{uuid}.json        # Full debate session
          debate-{uuid}-comments.json
          _index.json               # Lightweight listing cache
        chats/
          chat-{uuid}.json
    admin/
      feedback/
        feedback-{ts}-{uuid}.json   # User feedback entries
      errors/
        error-{ts}-{uuid}.json      # Error reports

  Container: community
    chats/
      chat-{uuid}.json              # Approved community chats
    debates/
      debate-{uuid}.json            # Approved community debates
    _submissions/
      sub-{uuid}.json               # Pending submission queue
    _removals/
      ...                           # Removal records
    _index.json                     # Community listing index
```

### GitHub API (taxonomy & reference data)

```
ai-triad-data/  (GitHub repo)
  taxonomy/Origin/                  # POV taxonomy files
  conflicts/                       # Conflict data
  calibration/                     # Calibration logs
  summaries/                       # Document summaries
```

### Electron (local filesystem)

On Electron desktop, both backends use `FilesystemBackend` — all data lives under the local `ai-triad-data` clone. The legacy flat paths `debates/` and `chats/` are used directly (no `users/` prefix, single user `_local`).

### User ID Derivation

`deriveStorageUserId(principalName, idp)` in `userContext.ts:91-102` produces a deterministic, human-readable directory name:

| Identity Provider | Input | Output |
|---|---|---|
| GitHub | `jpsnover` | `jpsnover` |
| Google | `jsnover13@gmail.com` | `jsnover13-at-gmail-com` |
| No auth / Electron | n/a | `_local` |

This function is deterministic and must never change once deployed -- existing users' data directories depend on it.

When `storageUserId === '_local'` (Electron desktop or unauthenticated), the legacy flat paths `debates/` and `chats/` are used directly (no `users/` prefix).

### Backend Routing

`fileIO.ts` maintains two backend references and routes by data type:

| Function | Backend | Storage Target |
|---|---|---|
| `getBackend()` | Taxonomy | GitHub API (versioned) |
| `getUserContentBackend()` | User content | Azure Blob (direct writes) |

User content writes are **immediately durable** — no overlay, no commit step, no session branch. The "Commit" button and `POST /api/sync/commit` apply only to taxonomy edits.

### Key Files

| File | Purpose |
|---|---|
| `server/storage/azureBlobBackend.ts` | `AzureBlobBackend` — `StorageBackend` implementation for Azure Blob |
| `server/storage/fileIO.ts` | Dual-backend routing (`getBackend()` / `getUserContentBackend()`) |
| `server/userContext.ts` | `AsyncLocalStorage`-based per-request user identity |
| `server/community/community.ts` | Community listing, submission, approval, rejection, sanitization, copy |

---

## 2. Personal Debate Storage ("My Debates")

### How Debates Are Saved

1. User runs or edits a debate in the UI
2. Store calls `PUT /api/debates` with the full session JSON
3. `saveDebateSession()` performs:
   - Quota check (count-based via `listDirectory()`)
   - `getUserContentBackend().writeFile()` to `users/{userId}/debates/debate-{id}.json`
   - Upserts lightweight `_index.json` for fast listing
4. Write is **immediately durable** — no overlay, no commit step

### How Debates Persist Across Sessions

**Electron (desktop):**
- Writes go directly to the local filesystem via `FilesystemBackend`
- Path: `{ai-triad-data}/debates/debate-{id}.json` (flat, `_local` user)

**Web (Azure):**
- Writes go directly to Azure Blob Storage via `AzureBlobBackend`
- Path: `users/{userId}/debates/debate-{id}.json` in the `user-content` container
- No session branch, overlay, or commit step — the Blob write is the persistence event
- Auth: `DefaultAzureCredential` (Managed Identity in Azure)

**Anonymous (web, no auth):**
- Writes go to `AnonymousSessionStore` (in-memory, backed by shared filesystem at `/mnt/shared`)
- 4-hour TTL, 10 MB limit per session, LRU eviction at 100 sessions
- Data is deliberately ephemeral — signing in is the path to persistence

---

## 3. Community Library

Community debates live in the `community` Blob container at `debates/`. They are shared, read-only content visible to all authenticated users.

### Browsing Community Debates

1. `GET /api/community/debates` calls `listCommunityDebates()` in `community.ts`
2. Reads from `community/debates/` via `getUserContentBackend()` (routed to the `community` Blob container)
3. Returns lightweight summaries: `{ id, title, created_at, updated_at, phase, community_metadata }`
4. Client `useCommunityStore` caches the list

### Copying a Community Debate to Personal Store

1. User clicks "Copy to My Library" on a community debate
2. `POST /api/community/copy` with `{ type: 'debates', communityId }`
3. `copyFromCommunity()` in `community.ts:259-280`:
   - Loads the community item from `community/debates/`
   - Deep-clones and regenerates `id` (new UUID)
   - Sets `copied_from_community = originalId`
   - Saves to user's personal store via `saveDebateSession()`
4. The copy is now a fully independent personal debate

---

## 4. Submission Pipeline: Personal -> Community

### Step 1: User Submits

1. User clicks "Submit to Community" on a personal debate
2. Client calls `POST /api/community/submit` with `{ type: 'debate', data: fullSession, note?: string }`
3. `submitToCommunity()` in `community.ts:98-137`:
   - Rate limit: max 20 pending submissions per user (HTTP 429 if exceeded)
   - Creates a **submission envelope**:
     ```json
     {
       "id": "uuid",
       "type": "debate",
       "originalId": "original-debate-uuid",
       "submittedBy": "jpsnover",
       "submittedAt": "2026-06-20T...",
       "status": "pending",
       "note": "User's optional note",
       "data": { /* full debate session JSON */ }
     }
     ```
   - Writes to `community/_submissions/sub-{id}.json` via `getUserContentBackend()` (routed to `community` Blob container)
   - If submitter is an admin, auto-approves immediately

### Step 2: Admin Reviews

The admin review panel (`AdminReviewPanel.tsx`) aggregates pending items across domains (community, calibration) via a registry pattern.

1. Admin opens Settings > Reviews tab
2. `GET /api/admin/review/queue` aggregates all pending review groups
3. Admin selects a community submission
4. `GET /api/admin/review/detail/community:{submissionId}` returns:
   ```json
   {
     "domain": "community",
     "submissionId": "uuid",
     "type": "debate",
     "submitter": "jpsnover",
     "submittedAt": "2026-06-20T...",
     "title": "AI Safety Debate",
     "topic": "...",
     "preview": "first 500 chars of transcript...",
     "metadata": { "model": "gemini-2.5-flash", "turnCount": 12 },
     "sanitization": {
       "willStrip": ["api_key", "flight_recorder"],
       "willAdd": ["community_metadata (attribution)", "regenerated id"]
     }
   }
   ```
5. The sanitization preview tells the admin exactly what will be stripped and added

### Step 3a: Approval

1. Admin optionally edits title/description in the edit-on-promote fields
2. Clicks "Promote"
3. `POST /api/admin/review/action` with:
   ```json
   {
     "domain": "community",
     "action": "promote",
     "groupId": "community:{submissionId}",
     "itemIds": ["{submissionId}"],
     "edits": { "{submissionId}": { "title": "Better Title" } }
   }
   ```
4. `approveSubmission()` in `community.ts:207-240`:
   - Loads submission, verifies `status === 'pending'`
   - Shallow-merges admin edits onto data (title, description)
   - **Sanitizes** the merged data:
     - Deep-clones via `JSON.parse(JSON.stringify(data))`
     - `stripSensitiveKeys()` recursively removes:
       - Keys: `api_key`, `apiKey`, `secret`, `token`, `password`, `credential`, `authorization`, `auth_token`, `access_token`, `refresh_token`, `private_key`, `flight_recorder`, `debug`, `_internal`, `diagnostics_state`
       - String values matching: `/^(sk-|AIza|gsk_|key-|xai-|Bearer\s)/`
     - Adds `community_metadata`:
       ```json
       {
         "submitted_by_display": "jpsnover",
         "submitted_at": "2026-06-20T...",
         "approved_at": "2026-06-20T...",
         "original_id": "original-debate-uuid"
       }
       ```
     - Regenerates root `id` (new UUID -- prevents collision with the personal original)
   - Writes sanitized debate to `community/debates/debate-{newId}.json` on main
   - Updates submission record: `status = 'approved'`

### Step 3b: Rejection

1. Admin enters rejection reason, clicks "Reject"
2. `rejectSubmission()` in `community.ts:242-257`:
   - Sets `status = 'rejected'`
   - Persists `rejectionReason` in the submission envelope
   - The rejection reason can surface in a future "My Submissions" view

### Post-Approval State

After approval, the debate exists in **three** places:

| Location | Content | Owner |
|---|---|---|
| `users/{userId}/debates/debate-{originalId}.json` | Original, unmodified | Submitter |
| `community/_submissions/sub-{submissionId}.json` | Submission envelope (status: approved) | System |
| `community/debates/debate-{newId}.json` | Sanitized copy with new ID + community_metadata | Community |

The personal original is untouched -- edits to the personal copy do not affect the community version, and vice versa. There is no sync between them. The `community_metadata.original_id` field provides traceability back to the source.

---

## 5. Access Control

| User Type | Browse Community | Submit | Admin Review | Copy to Personal | Save Debates |
|---|---|---|---|---|---|
| Authenticated (non-admin) | Yes | Yes | No | Yes | Yes (quota) |
| Admin (`ADMIN_USERS`) | Yes | Yes (auto-approve) | Yes | Yes | Yes (quota) |
| Anonymous | Yes | No (403) | No | No (403) | Ephemeral only |
| Electron (`_local`) | N/A (single-user) | Via remote server | N/A | N/A | Yes (filesystem) |

Admin users are defined by `ADMIN_USERS` env var (default: `jpsnover`), matched against `storageUserId`.

---

## 6. Data Flow Diagram

```
                          PERSONAL STORE
                    users/{userId}/debates/
                   debate-{originalId}.json
                              |
                    [Submit to Community]
                              |
                              v
                      SUBMISSION QUEUE
                   community/_submissions/
                     sub-{submissionId}.json
                      status: "pending"
                              |
              +-----------+---+-----------+
              |                           |
        [Admin: Promote]           [Admin: Reject]
              |                           |
              v                           v
     stripSensitiveKeys()        status: "rejected"
     add community_metadata      + rejectionReason
     regenerate id               (stays in _submissions/)
              |
              v
                     COMMUNITY LIBRARY
                   community/debates/
                    debate-{newId}.json
                              |
                    [User: Copy to Mine]
                              |
                              v
                    PERSONAL STORE (copy)
                   users/{userId}/debates/
                    debate-{copiedId}.json
                   copied_from_community: {newId}
```

---

## 7. Electron vs Web Differences

| Aspect | Electron | Web (Azure) |
|---|---|---|
| Taxonomy backend | `FilesystemBackend` (local disk) | `GitHubAPIBackend` (GitHub API) |
| User content backend | `FilesystemBackend` (local disk) | `AzureBlobBackend` (Azure Blob Storage) |
| Write durability | Immediate (fs.writeFileSync) | Immediate (Blob HTTP PUT) |
| User isolation | Single user (`_local`) | Per-user directories in `user-content` container |
| Community access | Can submit to remote server via `communitySubmit` bridge | Direct REST calls |
| Session branches | N/A | Taxonomy edits only (`api-session/{userId}`) |
| Anonymous mode | N/A | In-memory + shared filesystem |
| Debate path | `{dataRoot}/debates/` | `users/{userId}/debates/` in `user-content` container |

---

## 8. Key Implementation Files

| File | Responsibility |
|---|---|
| `server/storage/azureBlobBackend.ts` | `AzureBlobBackend` — `StorageBackend` for Azure Blob with dual-container routing |
| `server/storage/fileIO.ts` | Dual-backend routing, debate/chat CRUD, quota checks, index maintenance |
| `server/userContext.ts` | Per-request user identity via AsyncLocalStorage |
| `server/community/community.ts` | Community listing, submission, approval, rejection, sanitization, copy |
| `server/server.ts` | Backend initialization (`USER_CONTENT_STORAGE` gating), REST endpoints |
| `server/admin/reviewRegistry.ts` | Multi-domain review aggregation and routing |
| `server/admin/communityReviewHandler.ts` | Community-specific review logic + sanitization preview |
| `renderer/hooks/useCommunityStore.ts` | Zustand store for community browsing |
| `renderer/components/settings/AdminReviewPanel.tsx` | Admin review queue UI |
| `renderer/components/settings/CommunityReviewViewer.tsx` | Community detail viewer with edit-on-promote |
| `renderer/bridge/types.ts` | Bridge method signatures for community operations |
