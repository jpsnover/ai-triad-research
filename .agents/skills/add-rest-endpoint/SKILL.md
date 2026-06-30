---
name: add-rest-endpoint
description: Pattern playbook for adding REST endpoints to the taxonomy-editor server. Self-certify against this pattern to skip TL design review.
---

# REST Endpoint Playbook

Use this playbook when adding a new REST endpoint to the taxonomy-editor server. Following this pattern qualifies for the **design review gate exemption** — state in your ticket comment that you followed `/add-rest-endpoint` and note any deviations.

## When This Applies

- Adding a new GET/POST/PUT/DELETE endpoint to `server.ts`
- Adding the corresponding bridge method and type

## When This Does NOT Apply (requires TL design review)

- New auth patterns or modifications to existing auth gates
- Endpoints that create new data models or storage backends
- Endpoints that affect multiple agents' scopes (cross-cutting)
- WebSocket or streaming endpoints

## Key Files

| File | Purpose |
|------|---------|
| `taxonomy-editor/src/server/server.ts` | Route definitions (micro-router: `get()`, `post()`, `put()`, `del()`) |
| `taxonomy-editor/src/server/security/accessControl.ts` | `isAnonAllowedRoute()` — anonymous user route allowlist |
| `taxonomy-editor/src/server/community/admin/reviewRegistry.ts` | `requireAdmin()` — admin gate |
| `taxonomy-editor/src/renderer/bridge/types.ts` | `AppAPI` interface — add bridge method type here |
| `taxonomy-editor/src/renderer/bridge/web-bridge.ts` | Web bridge implementation (REST calls) |
| `taxonomy-editor/src/renderer/bridge/electron-bridge.ts` | Electron bridge implementation (IPC delegation) |

## Step-by-Step

### 1. Define the route in server.ts

Use the micro-router helpers:

```typescript
// GET — read operation
get('/api/my-resource/:id', async (req, res) => {
  try {
    const id = param(req, 'id', '/api/my-resource/:id');
    const result = await fileIO.readMyResource(id);
    json(res, result);
  } catch (err) { error(res, String(err), 500, err); }
});

// POST — create/action
post('/api/my-resource', async (req, res, body) => {
  try {
    await ensureSessionBranch();  // Required for write operations
    const input = body as MyResourceInput;
    // Validate input
    if (!input.name || typeof input.name !== 'string') {
      error(res, 'name is required and must be a string', 400);
      return;
    }
    const result = await fileIO.createMyResource(input);
    json(res, result, 201);
  } catch (err) { error(res, String(err), 500, err); }
});
```

### 2. Choose the right auth gate

| Gate | When to use | Code |
|------|------------|------|
| **None** | Public read-only data (taxonomy, edges) | Just implement the handler |
| **Anonymous block** | Write operations that need a real user | `if (isAnonymousUser()) { error(res, 'Sign in required', 403); return; }` |
| **Admin only** | Admin panel, config, user management | `if (!requireAdmin(res)) return;` |
| **Tier-based** | AI operations with rate limits | `const tier = proxyTiers.resolveTier(...)` |

**Important:** If anonymous users need this endpoint, add it to `isAnonAllowedRoute()` in `accessControl.ts`. Check both GET and POST allowlists.

### 3. Add flight recorder instrumentation

```typescript
// In catch blocks (required by ADR-003):
catch (err) {
  getGlobalRecorder()?.record({
    type: 'system.error', component: 'my-resource', level: 'error',
    message: 'Failed to create resource',
    error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
  });
  error(res, String(err), 500, err);
}

// For significant operations (optional but recommended):
getGlobalRecorder()?.record({
  type: 'lifecycle', component: 'my-resource', level: 'info',
  message: 'Resource created',
  data: { id: result.id },
});
```

### 4. Add the AppAPI method in types.ts

```typescript
export interface AppAPI {
  // ... existing methods ...
  getMyResource: (id: string) => Promise<MyResource>;
  createMyResource: (input: MyResourceInput) => Promise<MyResource>;
}
```

### 5. Implement the bridge methods

**web-bridge.ts** (uses `get`, `post`, `put`, `del` helpers with resilience):
```typescript
const rawApi: AppAPI = {
  // ... existing methods ...
  getMyResource: (id) => get(`/api/my-resource/${encodeURIComponent(id)}`),
  createMyResource: (input) => post('/api/my-resource', input),
};
```

**electron-bridge.ts** (delegates to IPC):
```typescript
export const api: AppAPI = {
  // ... existing methods ...
  getMyResource: (id) => window.electronAPI.getMyResource(id),
  createMyResource: (input) => window.electronAPI.createMyResource(input),
};
```

### 6. Write tests

Server-side test for the endpoint:
```typescript
it('GET /api/my-resource/:id returns resource', async () => {
  const res = await request(app).get('/api/my-resource/test-id');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('id', 'test-id');
});

it('POST /api/my-resource validates input', async () => {
  const res = await request(app).post('/api/my-resource').send({});
  expect(res.status).toBe(400);
});

it('POST /api/my-resource blocks anonymous users', async () => {
  // Set up anonymous user context
  const res = await request(app).post('/api/my-resource').send({ name: 'test' });
  expect(res.status).toBe(403);
});
```

## Helper Reference

| Helper | Signature | Purpose |
|--------|-----------|---------|
| `param(req, name, routePath)` | `string` | Extract URL param (`:id`), auto-decodes |
| `query(req, name)` | `string \| null` | Extract query param |
| `json(res, data, status?)` | `void` | Write JSON response (default 200) |
| `error(res, msg, status?, cause?)` | `void` | Write error response, records to flight recorder for 5xx |
| `ensureSessionBranch()` | `Promise<void>` | Required before write operations |
| `isAnonymousUser()` | `boolean` | Check if current request is unauthenticated |
| `getStorageUserId()` | `string` | Get the current user's storage ID |

## Self-Certification Checklist

- [ ] Route uses correct HTTP verb (GET=read, POST=create/action, PUT=update, DELETE=remove)
- [ ] Auth gate appropriate for the operation (see gate table)
- [ ] Anonymous users considered — added to allowlist if needed
- [ ] Input validated with 400 response on bad input
- [ ] Write operations call `ensureSessionBranch()` first
- [ ] Flight recorder in every catch block (`getGlobalRecorder()?.record()`)
- [ ] Errors use `error()` helper, not bare `res.end()`
- [ ] AppAPI type added in `types.ts`
- [ ] Both bridge implementations added (web-bridge + electron-bridge)
- [ ] Tests cover: happy path, bad input (400), auth rejection (403), error case (500)
- [ ] Verify gate passes: `cd taxonomy-editor && npm run verify`

## Common Mistakes

- **Forgetting `ensureSessionBranch()`** on write endpoints — causes writes to wrong branch.
- **Not adding to `isAnonAllowedRoute()`** — anonymous users get 403 even when they should have access.
- **Bare `res.end()` instead of `error()`** — skips flight recorder and production error masking.
- **Missing `encodeURIComponent()`** in web-bridge — path params with special chars break routing.
- **Forgetting electron-bridge stub** — Electron builds crash on undefined method.