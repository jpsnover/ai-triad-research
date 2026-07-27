# Dual-Build Bridge Pattern (taxonomy-editor)

> Extracted from the root `AGENTS.md` for token efficiency (t/1730). Relevant only to taxonomy-editor renderer work; see also `taxonomy-editor/AGENTS.md` and the `/add-bridge-method` playbook.

The taxonomy-editor runs as both Electron desktop and hosted web app. The bridge abstraction (`taxonomy-editor/src/renderer/bridge/`) ensures renderer code is build-target agnostic:

| File | Role |
|------|------|
| `types.ts` | `AppAPI` interface — the contract both implementations satisfy |
| `web-bridge.ts` | Web: REST calls via `get`/`post`/`put`/`del` helpers with resilience (circuit breaker, retry, timeout) |
| `electron-bridge.ts` | Electron: delegates to `window.electronAPI` (IPC to main process) |

**Rules:** Always import from `@bridge` (tsconfig alias), never from specific bridge files (breaks the other build target). New methods follow the `/add-bridge-method` playbook. Electron-only features need web fallbacks. `openExternal` must validate `https?://` to prevent `javascript:` and other protocol injection.
