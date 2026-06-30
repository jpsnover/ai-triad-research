---
name: add-bridge-method
description: Pattern playbook for adding bridge methods to the taxonomy-editor dual-build architecture. Self-certify against this pattern to skip TL design review.
---

# Bridge Method Playbook

Use this playbook when adding a new bridge method to the taxonomy-editor. The bridge abstraction lets the same renderer code work in both Electron (IPC to main process) and web (REST to server). Following this pattern qualifies for the **design review gate exemption** — state in your ticket comment that you followed `/add-bridge-method` and note any deviations.

## When This Applies

- Adding a new method that the renderer needs to call for data access or mutations
- The operation already has (or will have) a server-side REST endpoint AND an Electron IPC handler

## When This Does NOT Apply (requires TL design review)

- New bridge patterns (streaming, WebSocket, server-sent events)
- Changes to the resilience layer (`resilience.ts`, retry/timeout config)
- Methods that only work in one build target (Electron-only or web-only features)
- Changes to the `instrumentBridge()` wrapper or telemetry

## Key Files

| File | Purpose |
|------|---------|
| `taxonomy-editor/src/renderer/bridge/types.ts` | `AppAPI` interface — the contract both implementations satisfy |
| `taxonomy-editor/src/renderer/bridge/web-bridge.ts` | Web implementation — REST calls via `get`/`post`/`put`/`del` helpers |
| `taxonomy-editor/src/renderer/bridge/electron-bridge.ts` | Electron implementation — delegates to `window.electronAPI` (IPC) |
| `taxonomy-editor/src/renderer/hooks/useTaxonomyStore/` | Zustand stores that consume bridge methods |

## Architecture

```
Renderer (React)
  └── Store (Zustand)
        └── import { api } from '@bridge'
              ├── web-bridge.ts    → REST calls → server.ts
              └── electron-bridge.ts → IPC calls → main process
```

The `@bridge` import alias (configured in tsconfig) resolves to the correct implementation at build time.

## Step-by-Step

### 1. Add the method signature to AppAPI (types.ts)

```typescript
export interface AppAPI {
  // ... existing methods ...
  
  // New method — use descriptive name matching the operation
  getMyResource: (id: string) => Promise<MyResource>;
  saveMyResource: (id: string, data: MyResourceData) => Promise<void>;
}
```

**Conventions:**
- All methods return `Promise<T>` (async by design)
- Read operations: `get*`, `load*`, `list*`, `find*`
- Write operations: `save*`, `create*`, `delete*`, `update*`
- Void mutations return `Promise<void>`

### 2. Implement in web-bridge.ts

```typescript
const rawApi: AppAPI = {
  // ... existing methods ...
  
  getMyResource: (id) => get(`/api/my-resource/${encodeURIComponent(id)}`),
  saveMyResource: (id, data) => put(`/api/my-resource/${encodeURIComponent(id)}`, data).then(() => {}),
};
```

**Helper reference:**

| Helper | HTTP Method | Timeout | Retries |
|--------|------------|---------|---------|
| `get(path)` | GET | 30s (read) | 3 |
| `post(path, body)` | POST | 180s (mutation) | 0-1 (idempotent only) |
| `put(path, body)` | PUT | 180s (mutation) | 0-1 |
| `del(path)` | DELETE | 180s (mutation) | 0 |

- Always `encodeURIComponent()` path parameters
- For void operations, append `.then(() => {})` to discard the response body
- Helpers automatically handle: resilient fetch with circuit breaker, HTTP error mapping to ActionableError, retry on transient failures

### 3. Implement in electron-bridge.ts

```typescript
export const api: AppAPI = {
  // ... existing methods ...
  
  getMyResource: (id) => window.electronAPI.getMyResource(id),
  saveMyResource: (id, data) => window.electronAPI.saveMyResource(id, data),
};
```

**Notes:**
- Direct delegation to IPC — no HTTP wrapper needed
- If the IPC handler doesn't exist yet, use optional chaining with fallback: `window.electronAPI.getMyResource?.(id) ?? Promise.resolve(null)`
- The main process IPC handler is a separate concern (owned by whoever owns `src/main/`)

### 4. Consume in a Zustand store

```typescript
import { api } from '@bridge';

// In a store slice:
loadMyResource: async (id: string) => {
  set({ loading: true });
  try {
    const data = await api.getMyResource(id);
    set({ myResource: data, loading: false });
  } catch (err) {
    set({ loading: false, error: mapErrorToUserMessage(err) });
  }
},
```

**Conventions:**
- Import from `@bridge`, never from `web-bridge` or `electron-bridge` directly
- Handle errors with try/catch, map to user-facing messages
- Set loading state before and after async calls
- Never reference `window.electronAPI` in store code

### 5. Write tests

```typescript
// Mock the bridge for component/store tests
vi.mock('@bridge', () => ({
  api: {
    getMyResource: vi.fn().mockResolvedValue({ id: 'test', name: 'Test' }),
    saveMyResource: vi.fn().mockResolvedValue(undefined),
  },
}));

it('loads resource via bridge', async () => {
  const { result } = renderHook(() => useMyStore());
  await act(() => result.current.loadMyResource('test-id'));
  expect(api.getMyResource).toHaveBeenCalledWith('test-id');
  expect(result.current.myResource).toEqual({ id: 'test', name: 'Test' });
});
```

## Self-Certification Checklist

- [ ] Method added to `AppAPI` interface in `types.ts`
- [ ] Web-bridge implementation uses correct helper (`get`/`post`/`put`/`del`)
- [ ] Path params use `encodeURIComponent()`
- [ ] Electron-bridge implementation delegates to `window.electronAPI`
- [ ] Store imports from `@bridge`, not from specific bridge files
- [ ] Error handling in store uses `mapErrorToUserMessage()` or equivalent
- [ ] Both implementations satisfy the same `AppAPI` signature (TypeScript enforces this)
- [ ] Tests mock `@bridge` and verify the method is called correctly
- [ ] Verify gate passes: `cd taxonomy-editor && npm run verify`

## Common Mistakes

- **Importing directly from `web-bridge.ts`** in renderer code — breaks Electron builds. Always use `@bridge`.
- **Missing `encodeURIComponent()`** — special chars in IDs break URL routing.
- **Forgetting electron-bridge** — TypeScript catches this (AppAPI mismatch), but it's easy to miss in a rush.
- **Not handling void returns** — `put()` returns the parsed response body; add `.then(() => {})` for void operations.
- **Calling bridge methods outside React lifecycle** — bridge depends on the app being initialized. Use in store actions or effects, not at module scope.