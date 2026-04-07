# AI Triad Taxonomy Editor — Multi-User Cloud Deployment Specification

## Document Structure

1. [Functional Specification](#1-functional-specification) — User experience
2. [Technical Design Specification](#2-technical-design-specification) — Architecture & concurrency
3. [Phased Implementation Plan](#3-phased-implementation-plan) — Delivery roadmap

---

# 1. Functional Specification

## 1.1 Vision

Multiple users connect to a shared Taxonomy Editor instance via their web browsers. Each user authenticates with Google or GitHub, sees their own session state (active taxonomy directory, debate temperature, terminal), and edits shared taxonomy data with automatic conflict detection. The system runs behind a reverse proxy with HTTPS and deploys via Docker Compose.

## 1.2 User Experience

### First Visit (Unauthenticated)

```
Browser → https://taxonomy.example.com
```

1. Caddy reverse proxy terminates TLS
2. User sees a login page with "Sign in with Google" and "Sign in with GitHub" buttons
3. OAuth flow redirects to provider, then back to the app
4. User lands on the Taxonomy Editor with their identity visible in the header

### Returning Visit

1. Session cookie is still valid → user goes directly to the editor
2. If session expired → redirected to login (one click, no re-entering credentials)

### Concurrent Editing

```
User A edits node acc-1001 description → saves
User B edits node acc-1001 label (loaded before A saved) → tries to save
  → Sees: "This node was modified by Alice 30 seconds ago. Review changes?"
  → Options: [Merge my changes] [Overwrite] [Discard my changes]
```

### Per-User Settings

Each user has isolated:
- Active taxonomy directory selection
- AI model temperature setting
- API key configuration (stored encrypted, per-user)
- Terminal session (independent PTY per user)

Settings that one user changes never bleed into another user's session.

### Admin: `Show-TaxonomyEditor -Cloud`

```powershell
PS> Show-TaxonomyEditor -Cloud https://taxonomy.example.com
# Opens browser to the hosted instance (no local container)
```

### Local + Cloud Parity

The same codebase runs in three modes:
- **Electron** — desktop app (existing)
- **Container** — single-user Docker (Phase 1–3, existing)
- **Cloud** — multi-user with auth + concurrency (Phase 4, this spec)

---

## 1.3 Non-Goals (Phase 4)

- Real-time collaborative editing (Google Docs-style) — too complex; optimistic locking is sufficient
- Role-based access control (admin vs. viewer) — all authenticated users are equal
- Multi-tenant data isolation — all users share the same taxonomy dataset
- Custom domain setup automation — users configure DNS themselves

---

# 2. Technical Design Specification

## 2.1 Current State Analysis

### Server State Inventory

The current server (`server.ts`) holds mutable state that is incompatible with multi-user access:

| State | Location | Scope | Multi-User Risk |
|-------|----------|-------|-----------------|
| `edgesCache` | server.ts | Global | **HIGH** — stale reads, lost updates |
| `embeddingsCache` | aiBackends.ts | Global | **MEDIUM** — stale after external updates |
| `activeTaxonomyDir` | fileIO.ts | Global | **HIGH** — user A's switch affects user B |
| `_debateTemperature` | aiBackends.ts | Global | **MEDIUM** — user A's setting leaks to B |
| `terminalProcess` | server.ts | Singleton | **CRITICAL** — only one user can use terminal |
| `eventClients` | server.ts | Per-instance | **LOW** — needs cross-instance broadcast for scale |
| `_configCache` | config.ts | Global | **LOW** — read-only after startup |

### File I/O Concurrency Risks

All taxonomy file writes use **atomic rename** (write `.tmp`, rename) but have **no locking**:

- **Lost updates**: Two users read the same taxonomy file, edit different nodes, save — last write wins, first user's changes are silently lost
- **TOCTOU races**: `createConflictFile` checks existence then writes — race window between check and write
- **Edges cache divergence**: In-memory `edgesCache` drifts from disk after external writes
- **Non-atomic debate saves**: `saveDebateSession` writes directly (no `.tmp` + rename), risking corruption on crash

### Terminal Singleton

The PTY broker is a single `ChildProcess`. Second WebSocket connection to `/ws/terminal` is rejected with "Terminal already active". This fundamentally blocks multi-user terminal access.

---

## 2.2 Architecture

### Deployment Topology

```
                    ┌─────────────────────────┐
Internet ──HTTPS──→ │    Caddy Reverse Proxy   │
                    │  - TLS termination       │
                    │  - OAuth2 (caddy-security)│
                    │  - X-Auth-User header    │
                    └───────────┬──────────────┘
                                │ HTTP (internal)
                    ┌───────────▼──────────────┐
                    │   Taxonomy Editor Server  │
                    │  - Session management     │
                    │  - Per-user state         │
                    │  - Optimistic locking     │
                    │  - Per-user terminals     │
                    └───────────┬──────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                   │
        ┌─────▼──────┐   ┌─────▼──────┐    ┌──────▼──────┐
        │  /data     │   │  SQLite    │    │  /sessions  │
        │  volume    │   │  (locks +  │    │  (encrypted │
        │  (taxonomy)│   │  revisions)│    │  API keys)  │
        └────────────┘   └────────────┘    └─────────────┘
```

### Component Responsibilities

| Component | Role |
|-----------|------|
| **Caddy** | TLS, OAuth2 authentication, identity headers |
| **Node server** | Business logic, session state, concurrency control |
| **SQLite** | Document revision tracking, optimistic lock enforcement |
| **/data volume** | Taxonomy JSON files, sources, summaries (shared) |
| **/sessions volume** | Per-user encrypted API keys, session data |

### Why Caddy for Auth (Not In-App)

1. **Separation of concerns** — auth is infrastructure, not app logic
2. **TLS is automatic** — Caddy provisions Let's Encrypt certs with zero config
3. **caddy-security plugin** — handles Google/GitHub OAuth, token refresh, session cookies natively
4. **Defense in depth** — unauthenticated requests never reach Node
5. **Dev mode bypass** — `NODE_ENV=development` skips auth; Caddy not needed locally

### Why SQLite for Locks (Not Redis)

1. **Zero additional infrastructure** — SQLite is embedded, no separate server
2. **ACID transactions** — `BEGIN IMMEDIATE` gives exclusive write access
3. **Good enough for scale** — handles hundreds of concurrent users on a single node
4. **File-based** — easy to back up, inspect, and debug
5. **If scaling to multiple instances later** — swap SQLite for PostgreSQL; the abstraction layer stays the same

---

## 2.3 Authentication Layer

### Flow

```
Browser → Caddy → caddy-security OAuth2 → Google/GitHub
                                        ↓
                        Callback with identity token
                                        ↓
                    Caddy sets X-Auth-User, X-Auth-Email headers
                                        ↓
                    Node server creates/resumes session
```

### Caddy Configuration (Caddyfile)

```caddyfile
taxonomy.example.com {
    # OAuth2 authentication
    security {
        oauth identity provider google {
            realm google
            driver google
            client_id {$GOOGLE_CLIENT_ID}
            client_secret {$GOOGLE_CLIENT_SECRET}
            scopes openid email profile
        }

        authentication portal myportal {
            crypto default token lifetime 86400  # 24h sessions
            enable identity provider google
            cookie domain example.com
        }

        authorization policy mypolicy {
            set auth url /oauth2/google
            allow roles authp/user
        }
    }

    route /api/* {
        authorize with mypolicy
        reverse_proxy editor:7862
    }

    route /ws/* {
        authorize with mypolicy
        reverse_proxy editor:7862
    }

    route /* {
        authorize with mypolicy
        reverse_proxy editor:7862
    }
}
```

### Identity Headers

Caddy injects after successful auth:

| Header | Value | Example |
|--------|-------|---------|
| `X-Auth-User` | Unique user ID | `google:1234567890` |
| `X-Auth-Email` | Email address | `alice@example.com` |
| `X-Auth-Name` | Display name | `Alice Smith` |

### Server-Side Session

The Node server reads identity headers and maintains a lightweight session:

```typescript
interface UserSession {
  userId: string;              // From X-Auth-User
  email: string;               // From X-Auth-Email
  displayName: string;         // From X-Auth-Name
  activeTaxonomyDir: string;   // Per-user, defaults to 'Origin'
  debateTemperature: number | null;  // Per-user override
  createdAt: number;
  lastActiveAt: number;
}
```

Sessions stored in a `Map<string, UserSession>` in memory (derived from headers on each request — Caddy handles persistence and refresh). No session cookies from Node needed.

### Development Mode

When `NODE_ENV=development` or `AUTH_DISABLED=true`:
- Server does not require identity headers
- All requests attributed to a synthetic `dev:local-user`
- No Caddy needed for local development

### Trust Boundary

**CRITICAL**: Identity headers must only be trusted when they come from Caddy, not from the public internet. Enforcement:

1. Caddy strips any incoming `X-Auth-*` headers from clients before proxying
2. Node server binds to `127.0.0.1:7862` (not `0.0.0.0`) — unreachable from outside Docker network
3. Docker Compose network isolates editor from external access

---

## 2.4 Concurrency Control

### Optimistic Locking with Revision Tracking

Every mutable document gets a `_revision` field — an incrementing integer tracked in SQLite.

#### SQLite Schema

```sql
CREATE TABLE document_revisions (
    doc_path    TEXT PRIMARY KEY,   -- e.g., 'taxonomy/Origin/accelerationist.json'
    revision    INTEGER NOT NULL DEFAULT 1,
    updated_by  TEXT,               -- userId of last writer
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    checksum    TEXT                 -- SHA-256 of file content
);
```

#### Write Flow

```
Client                          Server                          SQLite + Disk
  │                               │                                │
  │  PUT /api/taxonomy/acc        │                                │
  │  { nodes: [...],              │                                │
  │    _revision: 5 }             │                                │
  │ ─────────────────────────────→│                                │
  │                               │  BEGIN IMMEDIATE               │
  │                               │──────────────────────────────→│
  │                               │  SELECT revision               │
  │                               │  FROM document_revisions       │
  │                               │  WHERE doc_path = '...'        │
  │                               │←──────────────────────────────│
  │                               │                                │
  │                               │  revision == 5? (matches)      │
  │                               │                                │
  │                               │  Write file atomically         │
  │                               │  UPDATE revision = 6           │
  │                               │──────────────────────────────→│
  │                               │  COMMIT                        │
  │                               │──────────────────────────────→│
  │                               │                                │
  │  200 { _revision: 6 }        │                                │
  │←─────────────────────────────│                                │
```

#### Conflict Detection

If the client's `_revision` doesn't match the database:

```
Client                          Server
  │                               │
  │  PUT /api/taxonomy/acc        │
  │  { nodes: [...],              │
  │    _revision: 5 }             │
  │ ─────────────────────────────→│
  │                               │  Current revision = 6 (mismatch!)
  │                               │
  │  409 Conflict                 │
  │  { error: 'REVISION_CONFLICT',│
  │    currentRevision: 6,        │
  │    updatedBy: 'alice@...',    │
  │    updatedAt: '2026-04-06...',│
  │    currentData: { nodes:[...] │
  │  } }                          │
  │←─────────────────────────────│
```

The client receives the current data and can present a merge dialog.

#### Documents Under Revision Control

| Document | Path Pattern | Granularity |
|----------|-------------|-------------|
| Taxonomy files | `taxonomy/{dir}/{pov}.json` | Per-file |
| Edges | `taxonomy/{dir}/edges.json` | Per-file |
| Conflict files | `conflicts/{id}.json` | Per-file |
| Debate sessions | `debates/debate-{id}.json` | Per-file |
| Chat sessions | `chats/chat-{id}.json` | Per-file |

#### What Does NOT Need Revision Control

- Embeddings (read-heavy, machine-written, no user edits)
- Source documents and snapshots (write-once at ingest)
- Proposals (write-once, no concurrent editing)
- Harvest manifests (write-once)

### Conflict Resolution UI

When a 409 is returned, the client shows a modal:

```
┌─────────────────────────────────────────────┐
│  Conflict Detected                          │
│                                             │
│  alice@example.com modified this file       │
│  30 seconds ago.                            │
│                                             │
│  Your changes:                              │
│    • acc-1001: Updated description          │
│                                             │
│  Their changes:                             │
│    • acc-1500: Changed label                │
│                                             │
│  [Merge Both]  [Keep Mine]  [Keep Theirs]   │
└─────────────────────────────────────────────┘
```

- **Merge Both**: Client applies both changesets to the latest data, re-submits
- **Keep Mine**: Client re-submits with force flag (overwrites, bumps revision)
- **Keep Theirs**: Client reloads the latest data, discards local changes

---

## 2.5 Per-User State Migration

### Problem

Five global variables must become per-user:

| Variable | Current Location | Fix |
|----------|-----------------|-----|
| `activeTaxonomyDir` | fileIO.ts global | Per-request header or per-session |
| `_debateTemperature` | aiBackends.ts global | Per-request body parameter |
| `terminalProcess` | server.ts global | Per-WebSocket instance map |
| `edgesCache` | server.ts global | Remove (re-read from disk) or TTL |
| `embeddingsCache` | aiBackends.ts global | Add mtime check |

### Active Taxonomy Directory

**Current**: Global `let activeTaxonomyDir` in fileIO.ts, set via `PUT /api/taxonomy-dir/active`.

**New**: Per-user, stored in `UserSession.activeTaxonomyDir`. Two options:

**Option A (Recommended): Request header**
```
GET /api/taxonomy/accelerationist
X-Taxonomy-Dir: Draft
```

All taxonomy read/write endpoints accept an optional `X-Taxonomy-Dir` header. If absent, falls back to the user's session default. This is explicit and debuggable.

**Option B: Session-only**

The `PUT /api/taxonomy-dir/active` endpoint updates only the calling user's session. All subsequent requests from that user use their session's dir. Less explicit but fewer client changes.

**Migration**: Client sends the header on every request. Server reads it, falls back to session, falls back to `'Origin'`. Zero breaking change — header is optional.

### Debate Temperature

**Current**: Global `_debateTemperature` set via `POST /api/ai/temperature`.

**New**: Pass temperature in the request body:

```
POST /api/ai/generate
{
  "prompt": "...",
  "model": "gemini-3.1-flash-lite-preview",
  "temperature": 0.7
}
```

`POST /api/ai/temperature` becomes a session-scoped default (stored in `UserSession`), but the per-request body value always takes precedence.

### Terminal Sessions

**Current**: Single `terminalProcess` per server.

**New**: Per-WebSocket terminal instances:

```typescript
const terminals = new Map<WebSocket, ChildProcess>();

function handleTerminalConnection(ws: WebSocket, userId: string) {
  const proc = spawn('python3', [BROKER_SCRIPT], { ... });
  terminals.set(ws, proc);

  ws.on('close', () => {
    proc.kill();
    terminals.delete(ws);
  });

  // ... pipe stdin/stdout as before ...
}
```

**Resource limit**: Maximum 5 concurrent terminal sessions. Additional connections queued or rejected with a message.

### Edges Cache

**Current**: Global `edgesCache`, loaded on first GET, never invalidated except by PUT.

**New**: Remove the cache entirely. Edges files are small (~100KB) and read latency from SSD is <1ms. The cache was an optimization for Electron IPC overhead that doesn't apply to a direct file read.

If performance becomes an issue, add a TTL-based cache (5s) with file mtime validation.

### Embeddings Cache

**Current**: Global `embeddingsCache`, loaded once, never invalidated except after `updateNodeEmbeddings`.

**New**: Add mtime-based validation (same pattern as `_modelMapCache` in aiBackends.ts):

```typescript
let embeddingsCache: EmbeddingsFile | null = null;
let embeddingsMtime: number = 0;

function loadEmbeddings(): EmbeddingsFile | null {
  const filePath = getEmbeddingsPath();
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat) return null;

  if (embeddingsCache && stat.mtimeMs === embeddingsMtime) {
    return embeddingsCache;
  }

  embeddingsCache = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  embeddingsMtime = stat.mtimeMs;
  return embeddingsCache;
}
```

---

## 2.6 Per-User API Key Storage

### Current

Keys encrypted with `AES-256-GCM(PBKDF2(hostname + salt))`. Single-user — one key per backend.

### New

Per-user keys encrypted with `AES-256-GCM(PBKDF2(master_secret + user_id, per_user_salt))`.

```
/sessions/
  keys/
    google:1234567890/
      gemini.enc        # AES-256-GCM encrypted
      claude.enc
      groq.enc
    github:9876543210/
      gemini.enc
```

**Key derivation**:
```typescript
function getUserDerivedKey(userId: string, salt: Buffer): Buffer {
  const masterSecret = process.env.KEY_ENCRYPTION_SECRET;
  return crypto.pbkdf2Sync(
    masterSecret + userId,
    salt,
    600_000,  // OWASP 2023+ recommendation
    32,
    'sha256'
  );
}
```

**File format**: `salt (32 bytes) + iv (16 bytes) + authTag (16 bytes) + ciphertext`

**Migration from single-user**: Existing `.aitriad-key-*.enc` files are decrypted with the old hostname-derived key and re-encrypted with the per-user key on first login.

**Fallback**: Environment variables (`GEMINI_API_KEY`, etc.) still work as a shared fallback for all users. Per-user keys take priority.

---

## 2.7 Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  caddy:
    image: ghcr.io/greenpau/caddy-security:latest
    ports:
      - "443:443"
      - "80:80"    # Redirect to HTTPS
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    environment:
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
    depends_on:
      - editor
    restart: unless-stopped

  editor:
    image: ghcr.io/${GITHUB_OWNER}/taxonomy-editor:latest
    expose:
      - "7862"      # Internal only — not published to host
    volumes:
      - taxonomy-data:/data
      - session-data:/sessions
      - ./ai-models.json:/app/ai-models.json:ro
    environment:
      NODE_ENV: production
      AUTH_ENABLED: "true"
      KEY_ENCRYPTION_SECRET: ${KEY_ENCRYPTION_SECRET}
      GEMINI_API_KEY: ${GEMINI_API_KEY:-}
      AI_TRIAD_DATA_ROOT: /data
      SESSION_DATA_ROOT: /sessions
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=256m
      - /app/.cache:rw,noexec,nosuid,size=512m
    cap_drop:
      - ALL
    read_only: true
    mem_limit: 4g
    cpus: 2
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:7862/health"]
      interval: 10s
      timeout: 5s
      start_period: 15s

volumes:
  taxonomy-data:
    driver: local
  session-data:
    driver: local
  caddy-data:
    driver: local
  caddy-config:
    driver: local
```

### Key Design Decisions

1. **Editor binds only to internal Docker network** — `expose: 7862` (not `ports: 7862:7862`). External traffic must go through Caddy.
2. **Separate volumes** — taxonomy data and session data are independent. Session volume can be wiped without losing taxonomy.
3. **Read-only root FS** — only tmpfs and volumes are writable.
4. **All secrets via environment** — `.env` file for local, Docker secrets or vault injection for production.

---

## 2.8 Event Broadcasting

### Current

`broadcastEvent()` sends to all connected WebSocket clients on the same server instance.

### New

For a single-instance deployment (Phase 4 target), no change needed. All clients connect to the same server.

For future horizontal scaling, add Redis pub/sub:

```typescript
// Abstraction layer
interface EventBus {
  publish(type: string, data: unknown): void;
  subscribe(handler: (type: string, data: unknown) => void): void;
}

// Single-instance implementation (Phase 4)
class LocalEventBus implements EventBus { ... }

// Multi-instance implementation (future)
class RedisEventBus implements EventBus { ... }
```

Phase 4 ships with `LocalEventBus`. The interface is ready for Redis when needed.

---

## 2.9 Graceful Multi-User Shutdown

When the server receives SIGTERM:

1. Stop accepting new connections
2. Send `{ type: 'server-shutdown', data: { seconds: 30 } }` to all WebSocket clients
3. Client shows banner: "Server is shutting down in 30 seconds. Save your work."
4. Kill all terminal processes
5. Wait for in-flight requests to complete (up to 10s)
6. Close all WebSocket connections with code 1001
7. Close HTTP server
8. Force exit after 30s total

---

# 3. Phased Implementation Plan

Phase 4 is itself divided into sub-phases to keep PRs reviewable.

## Phase 4a: Per-User State Isolation

**Goal**: Eliminate all shared mutable state. No auth yet — single-user server still works, but internal architecture is multi-user ready.

### Tasks

1. **Session context middleware**
   - Create `src/server/session.ts`
   - `UserSession` type with `userId`, `activeTaxonomyDir`, `debateTemperature`
   - `getSession(req)` extracts user from `X-Auth-User` header, falls back to `dev:local-user`
   - Session map in memory (`Map<string, UserSession>`)

2. **Migrate `activeTaxonomyDir` to per-request**
   - Add `X-Taxonomy-Dir` header support to all taxonomy endpoints
   - Remove global `activeTaxonomyDir` from fileIO.ts
   - `PUT /api/taxonomy-dir/active` updates session, not global
   - Client sends header on all requests (read from store)

3. **Migrate `_debateTemperature` to per-request**
   - Add optional `temperature` field to `POST /api/ai/generate` body
   - `POST /api/ai/temperature` updates session default
   - `generateText()` reads temperature from body, falls back to session, falls back to default

4. **Per-WebSocket terminals**
   - Replace singleton `terminalProcess` with `Map<WebSocket, ChildProcess>`
   - Add max concurrent terminal limit (5)
   - Clean up on WebSocket close

5. **Remove `edgesCache`**
   - Delete the global cache variable
   - Read from disk on every GET (latency is negligible)

6. **Add mtime validation to `embeddingsCache`**
   - Check file mtime before returning cached value
   - Invalidate if mtime changed

### Files Changed

| Action | File |
|--------|------|
| **Create** | `src/server/session.ts` |
| **Modify** | `src/server/server.ts` — middleware, terminal map, remove edgesCache |
| **Modify** | `src/server/fileIO.ts` — remove global activeTaxonomyDir, add dir parameter |
| **Modify** | `src/server/aiBackends.ts` — temperature per-request, embeddings mtime |
| **Modify** | `src/renderer/bridge/web-bridge.ts` — send X-Taxonomy-Dir header |
| **Modify** | `src/renderer/hooks/useTaxonomyStore.ts` — send dir in requests |

### Verification

- All existing single-user tests pass (no auth, dev fallback)
- `activeTaxonomyDir` changes in one browser tab don't affect another
- Temperature changes in one debate don't affect another
- Two terminal sessions can be open simultaneously

---

## Phase 4b: Optimistic Locking

**Goal**: Prevent silent data loss from concurrent edits.

### Tasks

1. **SQLite revision store**
   - Create `src/server/revisionStore.ts`
   - SQLite database at `/sessions/revisions.db`
   - `getRevision(docPath)`, `checkAndBumpRevision(docPath, expectedRevision, userId)` — atomic via `BEGIN IMMEDIATE`
   - Auto-create table on first access

2. **Add `_revision` to read responses**
   - All taxonomy/conflict/edge/debate/chat read endpoints include `_revision` in response
   - Revision looked up from SQLite (or initialized to 1 if not yet tracked)

3. **Enforce revision on writes**
   - All write endpoints require `_revision` in request body
   - If `_revision` doesn't match → return 409 with conflict details
   - Force flag (`_force: true`) bypasses check (for "Keep Mine" in conflict UI)

4. **Atomic debate saves**
   - Fix `saveDebateSession` to use `.tmp` + rename pattern (currently writes directly)

5. **Fix conflict file TOCTOU**
   - `createConflictFile` uses `fs.open` with `wx` flag (O_CREAT | O_EXCL) instead of existsSync + write

### Files Changed

| Action | File |
|--------|------|
| **Create** | `src/server/revisionStore.ts` |
| **Modify** | `src/server/server.ts` — revision checks on all write endpoints |
| **Modify** | `src/server/fileIO.ts` — atomic debate saves, TOCTOU fix |
| **Modify** | `taxonomy-editor/package.json` — add `better-sqlite3` dependency |
| **Modify** | `taxonomy-editor/Dockerfile` — ensure SQLite native module builds |

### Verification

- Open two browser tabs, edit same node in both, save from both — second save gets 409
- Force-save bypasses conflict check
- Debate save interrupted by `kill -9` doesn't corrupt JSON
- Create two conflict files with same ID simultaneously — one succeeds, one fails cleanly

---

## Phase 4c: Conflict Resolution UI

**Goal**: User-facing UI for handling edit conflicts.

### Tasks

1. **Conflict dialog component**
   - Create `src/renderer/components/ConflictDialog.tsx`
   - Shows diff between user's version and current version
   - Three buttons: Merge Both, Keep Mine, Keep Theirs

2. **Diff computation**
   - For taxonomy nodes: compare node-by-node, show which nodes changed
   - For edges: compare edge-by-edge
   - For debates: show transcript diff (new entries only)

3. **Auto-merge for non-overlapping changes**
   - If user A changed node X and user B changed node Y → auto-merge silently
   - Only show dialog when the same node/field was modified by both

4. **Store integration**
   - `useTaxonomyStore` catches 409 responses, opens ConflictDialog
   - After resolution, re-submits with updated data and new revision

### Files Changed

| Action | File |
|--------|------|
| **Create** | `src/renderer/components/ConflictDialog.tsx` |
| **Create** | `src/renderer/utils/diffMerge.ts` |
| **Modify** | `src/renderer/hooks/useTaxonomyStore.ts` — 409 handling |
| **Modify** | `src/renderer/hooks/useDebateStore.ts` — 409 handling |
| **Modify** | `src/renderer/bridge/types.ts` — add `_revision` to response types |

### Verification

- Two users edit different nodes → auto-merged, no dialog
- Two users edit same node → dialog appears with correct diff
- "Merge Both" produces correct combined result
- "Keep Mine" force-saves successfully
- "Keep Theirs" reloads latest data

---

## Phase 4d: Authentication & Per-User API Keys

**Goal**: OAuth-based auth via Caddy, per-user encrypted API key storage.

### Tasks

1. **Auth middleware**
   - Create `src/server/auth.ts`
   - Reads `X-Auth-User`, `X-Auth-Email`, `X-Auth-Name` headers from Caddy
   - Rejects requests without identity headers when `AUTH_ENABLED=true`
   - Passes through when `AUTH_ENABLED` is falsy (development mode)

2. **User identity in UI**
   - New `GET /api/auth/me` endpoint returns current user info
   - Header component shows user avatar/email
   - Add to `AppAPI` interface and both bridge implementations

3. **Per-user API key storage**
   - Modify `config.ts`: `getApiKey(backend, userId)`, `storeApiKey(key, backend, userId)`
   - Per-user salt + PBKDF2 key derivation from `KEY_ENCRYPTION_SECRET` env var
   - Keys stored in `/sessions/keys/{userId}/{backend}.enc`
   - Migration: existing single-user keys moved to dev user's namespace

4. **API key settings UI**
   - Settings panel shows which backends have keys configured for the current user
   - Add/remove key per backend
   - Test key button (makes a lightweight API call)

5. **Caddy + Docker Compose**
   - Create `Caddyfile` with caddy-security OAuth config
   - Create `docker-compose.yml` with caddy + editor services
   - Create `.env.example` with required environment variables
   - Document setup in `docs/cloud-deployment-guide.md`

### Files Changed

| Action | File |
|--------|------|
| **Create** | `src/server/auth.ts` |
| **Create** | `Caddyfile` |
| **Create** | `docker-compose.yml` |
| **Create** | `.env.example` |
| **Create** | `docs/cloud-deployment-guide.md` |
| **Modify** | `src/server/server.ts` — auth middleware, /api/auth/me endpoint |
| **Modify** | `src/server/config.ts` — per-user key derivation and storage |
| **Modify** | `src/renderer/bridge/types.ts` — auth API methods |
| **Modify** | `src/renderer/bridge/web-bridge.ts` — auth API implementation |
| **Modify** | `src/renderer/components/App.tsx` — user identity display |

### Verification

- Without Caddy: app works in dev mode with no auth
- With Caddy: unauthenticated request gets 401
- With Caddy: OAuth flow completes, user sees their identity
- User A stores Gemini key → User B cannot see or use it
- Environment variable API keys still work as shared fallback

---

## Phase 4e: PowerShell Cloud Support

**Goal**: `Show-TaxonomyEditor -Cloud` connects to a hosted instance.

### Tasks

1. **`-Cloud` parameter**
   - New parameter set on `Show-TaxonomyEditor`
   - Accepts a URL (e.g., `https://taxonomy.example.com`)
   - Opens browser to that URL — no Docker, no container management
   - Validates URL responds to `/health` before opening browser

2. **`-Deploy` parameter (stretch)**
   - Wraps `docker compose up -d` for the Docker Compose stack
   - Validates `.env` file exists with required secrets
   - Runs health check after deploy

### Files Changed

| Action | File |
|--------|------|
| **Modify** | `scripts/AITriad/Public/Show-TaxonomyEditor.ps1` — new parameter sets |

### Verification

- `Show-TaxonomyEditor -Cloud https://taxonomy.example.com` opens browser
- `Show-TaxonomyEditor -Cloud https://bad.example.com` fails with actionable error
- Existing local/container modes still work

---

## Implementation Timeline

| Sub-Phase | Description | Dependencies | Key Risk |
|-----------|-------------|-------------|----------|
| **4a** | Per-user state isolation | None (internal refactor) | Terminal per-WebSocket resource usage |
| **4b** | Optimistic locking | 4a (session context) | SQLite native module in Docker |
| **4c** | Conflict resolution UI | 4b (409 responses) | Diff/merge complexity for nested JSON |
| **4d** | Authentication + keys | 4a (sessions), 4b (revisions) | Caddy-security plugin stability |
| **4e** | PowerShell cloud support | 4d (deployed cloud instance) | Minimal risk |

### Dependency Graph

```
Phase 4a ──→ Phase 4b ──→ Phase 4c
    │            │
    └────────────┴──→ Phase 4d ──→ Phase 4e
```

4a and 4b are strictly sequential (4b needs sessions from 4a). 4c depends on 4b (needs 409 responses). 4d can start after 4a but needs 4b for revision-aware key storage. 4e is last (needs a running cloud instance to connect to).

---

## Appendix A: Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| caddy-security plugin instability | Auth breaks for all users | Pin plugin version; have fallback to oauth2-proxy |
| SQLite write contention under load | Slow saves, timeouts | WAL mode, `PRAGMA busy_timeout=5000`; upgrade to PostgreSQL if needed |
| File permission mismatch with --user | Container can't read /data | Document UID matching; add init container to fix permissions |
| Per-user terminals exhaust memory | Server OOM | Hard limit of 5 concurrent terminals; idle timeout (5 min) |
| OAuth provider outage | Users can't log in | Support multiple providers (Google + GitHub); session cookies survive provider downtime |
| Lost merge (auto-merge wrong) | Data corruption | Auto-merge only for non-overlapping changes; always show dialog for same-field conflicts |
| KEY_ENCRYPTION_SECRET rotation | Old keys unreadable | Re-encryption migration script; support old+new secret during rotation window |

## Appendix B: Future Considerations (Beyond Phase 4)

- **Horizontal scaling**: Replace SQLite with PostgreSQL, add Redis for cache + pub/sub, use sticky sessions or shared session store
- **Real-time sync**: WebSocket push of change notifications; client auto-refreshes stale data
- **RBAC**: Admin, editor, viewer roles; per-POV permissions
- **Audit log**: Track who changed what, when, with diffs
- **Multi-tenant**: Separate data volumes per organization
