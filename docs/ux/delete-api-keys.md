# Delete API Keys — UX Spec

**Author:** Design (Orca)
**Status:** Ready for implementation

## Overview

Allow users to delete their stored API keys from within the Settings dialog. Currently, keys can be saved and viewed (masked) but never removed. Users should be able to delete individual keys or all keys at once.

## Current state

**Electron:** Keys are stored as encrypted `.enc` files in `userData/` via `safeStorage`. One file per backend: `api-key.enc` (gemini), `api-key-claude.enc`, etc.

**Web/Container:** Keys are stored in `sessionStorage` as `byok-{backend}` entries. Authenticated users also have server-side storage via `POST /api/keys`.

**Settings UI:** The "Show Keys" section (`ShowKeysSection`) displays a summary row per backend with masked key and associated models. There is no delete action.

## Design

### Delete buttons in Show Keys section

Add a delete button to each key row in the expanded Show Keys panel. Only visible when the backend has a key set.

**Current layout:**
```
┌──────────────────────────────────────────────────┐
│ Gemini    AIza...Xk4Q    Gemini 3.1 Flash Lite   │
│ Claude    sk-a...9f2z    Opus 4.7, Sonnet 4.6    │
│ Groq      gsk_...a4Lm    Llama 4 Scout           │
│ OpenAI    —                                       │
│ DeepSeek  —                                       │
│ Ollama    (local — no key)                        │
└──────────────────────────────────────────────────┘
```

**New layout with delete buttons:**
```
┌───────────────────────────────────────────────────────┐
│ Gemini    AIza...Xk4Q    Gemini 3.1 Flash Lite  [🗑]  │
│ Claude    sk-a...9f2z    Opus 4.7, Sonnet 4.6   [🗑]  │
│ Groq      gsk_...a4Lm    Llama 4 Scout          [🗑]  │
│ OpenAI    —                                           │
│ DeepSeek  —                                           │
│ Ollama    (local — no key)                            │
├───────────────────────────────────────────────────────┤
│                              [Delete All Keys]        │
└───────────────────────────────────────────────────────┘
```

### Per-key delete button

- **Position:** Right end of each key summary row, only when `hasKey` is true
- **Icon:** Trash icon (🗑) — use a simple SVG trash icon, not the emoji. Same style as other icon buttons in the app.
- **Size:** `20px` square, padding to reach `28px` tap target
- **Default:** `color: var(--text-muted); opacity: 0.5`
- **Hover:** `color: #ef4444; opacity: 1` — red signals destructive
- **No row shown for backends without keys** — the `—` rows don't get a delete button (nothing to delete)

### Inline confirmation (per-key)

Clicking the delete button replaces the row content with an inline confirmation:

```
Before:
│ Gemini    AIza...Xk4Q    Gemini 3.1 Flash Lite  [🗑]  │

After click:
│ Delete Gemini key?                    [Cancel] [Delete] │
```

- The row shifts to show the confirmation text and two small buttons
- **Cancel:** Returns to the normal row display. `btn btn-sm`, secondary style.
- **Delete:** `btn btn-sm`, red background (`background: #ef4444; color: white`)
- **No separate modal or popover** — the inline swap keeps the interaction lightweight and in-context

### Delete All Keys button

Below the key summary rows, a "Delete All Keys" button appears when **two or more** backends have keys set. If only one key exists, the per-row delete is sufficient.

- **Style:** `btn btn-sm`, text only (no fill), `color: #ef4444`
- **Label:** "Delete All Keys"
- **Position:** Right-aligned below the key list, separated by a thin divider

### Delete All confirmation

Clicking "Delete All Keys" replaces the button area with:

```
│ Delete all API keys? This cannot be undone.           │
│                              [Cancel] [Delete All]    │
```

- Same inline pattern as per-key — no modal
- **Delete All** button: red background, white text

### After deletion

**Per-key:**
1. Key file/storage entry is deleted
2. Row updates to show `—` (no key) and the delete button disappears
3. The `(set)` indicator next to the backend name in the main key input section updates
4. `hasKey` state refreshes

**Delete All:**
1. All key files/storage entries are deleted
2. All rows update to `—`
3. "Delete All Keys" button disappears (no keys left)
4. `hasKey` state refreshes for all backends

**No toast needed** — the visual change in the row is immediate confirmation.

## Implementation

### apiKeyStore.ts (Electron)

Add a `deleteApiKey` function:
```typescript
export function deleteApiKey(backend?: Backend): void {
  const fp = keyFilePath(backend);
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
  }
}

export function deleteAllApiKeys(): void {
  for (const backend of ALL_BACKENDS) {
    deleteApiKey(backend);
  }
}
```

### Bridge API

Add to the bridge interface (`types.ts`):
```typescript
deleteApiKey: (backend?: string) => Promise<void>;
deleteAllApiKeys: () => Promise<void>;
```

**Electron bridge** (`electron-bridge.ts`):
```typescript
deleteApiKey: (backend) => window.electronAPI.deleteApiKey(backend),
deleteAllApiKeys: () => window.electronAPI.deleteAllApiKeys(),
```

**Web bridge** (`web-bridge.ts`):
```typescript
deleteApiKey: async (backend) => {
  const storageKey = backend ? `byok-${backend}` : 'byok-api-key';
  sessionStorage.removeItem(storageKey);
  if (!(await isAnonymous())) {
    await post('/api/keys/delete', { backend });
  }
},
deleteAllApiKeys: async () => {
  const ALL_BACKENDS = ['gemini', 'claude', 'groq', 'openai', 'deepseek', 'tavily', 'ollama'];
  for (const b of ALL_BACKENDS) {
    sessionStorage.removeItem(`byok-${b}`);
  }
  sessionStorage.removeItem('byok-api-key');
  if (!(await isAnonymous())) {
    await post('/api/keys/delete-all');
  }
},
```

### IPC handlers (Electron)

Register in `ipcHandlers.ts`:
```typescript
ipcMain.handle('delete-api-key', (_e, backend) => deleteApiKey(backend));
ipcMain.handle('delete-all-api-keys', () => deleteAllApiKeys());
```

### Server endpoints (web mode)

```
POST /api/keys/delete       body: { backend?: string }
POST /api/keys/delete-all   (no body)
```

Auth required (reject anonymous). Delete from server-side key storage for the authenticated user.

### Preload (Electron)

Add to `preload.cts`:
```typescript
deleteApiKey: (backend?: string) => ipcRenderer.invoke('delete-api-key', backend),
deleteAllApiKeys: () => ipcRenderer.invoke('delete-all-api-keys'),
```

## Integration points

| File | Change |
|---|---|
| `apiKeyStore.ts` | Add `deleteApiKey()` and `deleteAllApiKeys()` |
| `bridge/types.ts` | Add method signatures to bridge interface |
| `bridge/electron-bridge.ts` | Wire to IPC |
| `bridge/web-bridge.ts` | Clear sessionStorage + server call |
| `main/preload.cts` | Expose IPC channels |
| `main/ipcHandlers.ts` | Register handlers |
| `server/server.ts` | Add `POST /api/keys/delete` and `/api/keys/delete-all` endpoints |
| `SettingsDialog.tsx` `ShowKeysSection` | Add per-row delete button, inline confirmation, Delete All button |

## What NOT to do

- No confirmation modal — inline confirmation is lighter and sufficient for this action
- No undo — keys are sensitive data; keeping them around "just in case" is a security anti-pattern
- No "are you sure you want to delete?" warning beyond the inline confirmation — users who expand Show Keys and click delete know what they're doing
- No export prompt before delete — the Share/Import QR feature already exists for backup

## Accessibility

- Delete buttons: `aria-label="Delete {backend} API key"`
- Inline confirmation: focus moves to Cancel button when confirmation appears
- Delete All: `aria-label="Delete all stored API keys"`
- Escape in confirmation returns to normal row state
