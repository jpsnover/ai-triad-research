# Debate Sharing: Design Document

**Last updated:** 2026-06-20
**Author:** Technical Lead

## Overview

The taxonomy-editor supports two build targets (Electron desktop and Azure-hosted web app) with three debate storage scopes: **personal** ("My Debates"), **community** (shared library), and **anonymous** (ephemeral). Debates flow from personal → community via a submission/approval pipeline with sanitization. This document traces the full lifecycle.

---

## 1. Storage Layout

All debate data lives in the `ai-triad-data` GitHub repo (or local filesystem clone for Electron).

```
ai-triad-data/
  users/                          # Per-user data root
    {storageUserId}/
      debates/
        debate-{uuid}.json        # Full debate session
        debate-{uuid}-comments.json
        _index.json               # Lightweight listing cache
      chats/
        chat-{uuid}.json
  community/                      # Shared Community Library
    debates/
      debate-{uuid}.json          # Approved community debates
    chats/
      chat-{uuid}.json
    _submissions/                 # Pending submission queue
      sub-{uuid}.json             # Submission envelope (contains full data)
  debates/                        # LEGACY (pre-multi-user, jpsnover only)
  chats/                          # LEGACY
```

### User ID Derivation

`deriveStorageUserId(principalName, idp)` in `userContext.ts:91-102` produces a deterministic, human-readable directory name:

| Identity Provider | Input | Output |
|---|---|---|
| GitHub | `jpsnover` | `jpsnover` |
| Google | `jsnover13@gmail.com` | `jsnover13-at-gmail-com` |
| No auth / Electron | n/a | `_local` |

This function is deterministic and must never change once deployed -- existing users' data directories depend on it.

When `storageUserId === '_local'` (Electron desktop or unauthenticated), the legacy flat paths `debates/` and `chats/` are used directly (no `users/` prefix).

### Key Files

| File | Purpose |
|---|---|
| `server/userContext.ts` | `AsyncLocalStorage`-based per-request user identity |
| `server/fileIO.ts:655-658` | `getDebatesDir()` -- routes to `users/{userId}/debates` |
| `server/fileIO.ts:847-850` | `getChatsDir()` -- routes to `users/{userId}/chats` |
| `server/community.ts:13-15` | Community and submission directory resolvers |

---

## 2. Personal Debate Storage ("My Debates")

### How Debates Are Saved

1. User runs or edits a debate in the UI
2. Store calls `PUT /api/debates` with the full session JSON
3. Server: `ensureSessionBranch()` lazily creates `api-session/{userId}` branch from main HEAD on first write
4. `saveDebateSession()` in `fileIO.ts:791` performs:
   - Quota check (count-based via `listDirectory()`)
   - `backend.writeFile()` to `users/{userId}/debates/debate-{id}.json`
   - Upserts lightweight `_index.json` for fast listing
5. Write goes to the **session overlay** (in-memory map) -- no GitHub API call yet

### How Debates Persist Across Sessions

The persistence mechanism differs between Electron and web:

**Electron (desktop):**
- Writes go directly to the local filesystem via `FilesystemBackend`
- Immediately durable -- no overlay or commit step
- Path: `{ai-triad-data}/debates/debate-{id}.json` (flat, `_local` user)

**Web (Azure):**
- Writes accumulate in the **session overlay** (in-memory `Map<repoPath, content>`)
- On explicit "Commit" (`POST /api/sync/commit`), `commitOverlay()` flushes all pending writes to GitHub via the Trees API as a single batch commit on the user's session branch
- The session branch (`api-session/{userId}`) persists on GitHub across browser sessions -- the user's work is durable once committed
- On next login, `getEffectiveRef()` resolves to the existing session branch; reads check overlay first, then disk cache, then GitHub API

**Anonymous (web, no auth):**
- Writes go to `AnonymousSessionStore` (in-memory, backed by shared filesystem at `/mnt/shared`)
- 4-hour TTL, 10 MB limit per session, LRU eviction at 100 sessions
- Data is deliberately ephemeral -- signing in is the path to persistence

### Commit and Sync Flow

```
User edits debate
    |
    v
PUT /api/debates  -->  ensureSessionBranch()  -->  overlay.set(path, content)
    |
    |  (later, user clicks "Commit")
    v
POST /api/sync/commit  -->  commitOverlay(userId)
    |
    v
GitHub Trees API batch commit to api-session/{userId}
    |
    |  (later, user clicks "Create PR")
    v
POST /api/sync/create-pr  -->  GitHub PR from session branch to main
```

The sync status bar (`GET /api/sync/status`) shows pending overlay count, session branch name, and PR status.

---

## 3. Community Library

Community debates live at `community/debates/` on the **main** branch. They are shared, read-only content visible to all authenticated users.

### Browsing Community Debates

1. `GET /api/community/debates` calls `listCommunityDebates()` in `community.ts:53-74`
2. Reads from `community/debates/` on main (passes `{ ref: 'main' }` to both `listDirectory` and `readFile`)
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
   - Writes to `community/_submissions/sub-{id}.json` on **main** (not the session overlay -- community data is shared)
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
| Storage backend | `FilesystemBackend` (local disk) | `GitHubAPIBackend` (GitHub API) |
| Write durability | Immediate (fs.writeFileSync) | Overlay → commit → GitHub |
| User isolation | Single user (`_local`) | Per-user directories |
| Community access | Can submit to remote server via `communitySubmit` bridge | Direct REST calls |
| Session branches | N/A | `api-session/{userId}` on GitHub |
| Anonymous mode | N/A | In-memory + shared filesystem |
| Debate path | `{dataRoot}/debates/` | `{dataRoot}/users/{userId}/debates/` |

---

## 8. Key Implementation Files

| File | Lines | Responsibility |
|---|---|---|
| `server/userContext.ts` | 1-102 | Per-request user identity via AsyncLocalStorage |
| `server/fileIO.ts` | 655-811 | Debate CRUD with per-user routing, quota checks, index maintenance |
| `server/community.ts` | 1-281 | Community listing, submission, approval, rejection, sanitization, copy |
| `server/githubAPIBackend.ts` | 362-430 | `writeFile()` overlay routing; 789-900 `commitOverlay()` batch flush |
| `server/server.ts` | 176-180 | `ensureSessionBranch()` lazy branch creation |
| `server/server.ts` | 1003-1054 | Debate REST endpoints (CRUD + export) |
| `server/server.ts` | 1125-2147 | Sync endpoints (commit, diff, create-pr, discard) |
| `server/server.ts` | 1288-1373 | Admin review endpoints (queue, detail, action, stats) |
| `server/admin/reviewRegistry.ts` | 30-171 | Multi-domain review aggregation and routing |
| `server/admin/communityReviewHandler.ts` | 96-160 | Community-specific review logic + sanitization preview |
| `renderer/hooks/useCommunityStore.ts` | all | Zustand store for community browsing |
| `renderer/components/settings/AdminReviewPanel.tsx` | 387-517 | Admin review queue UI |
| `renderer/components/settings/CommunityReviewViewer.tsx` | 63-265 | Community detail viewer with edit-on-promote |
| `renderer/bridge/types.ts` | 192-200 | Bridge method signatures for community operations |
