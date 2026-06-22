# Architecture Boundary Rules

Enforced by [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) via `npm run depcruise`. Config: `.dependency-cruiser.cjs`.

## Layer Model

```
  ┌─────────────┐
  │  renderer    │  React UI (src/renderer/)
  │  ↓ @bridge   │
  ├─────────────┤
  │  bridge      │  API abstraction (src/renderer/bridge/)
  ├─────────────┤
  │  main        │  Electron main process (src/main/)
  │  server      │  Express backend (src/server/)
  ├─────────────┤
  │  lib/        │  Shared libraries (../lib/debate, ../lib/search, etc.)
  └─────────────┘
```

## Rules

| Rule | From | To (forbidden) | Rationale |
|------|------|-----------------|-----------|
| `lib-not-to-app` | `../lib/*` | `src/*` | Shared libs are reusable — they must not depend on app code |
| `renderer-not-to-server` | `src/renderer/*` | `src/server/*` | Renderer talks to server through `@bridge`, not direct imports |
| `renderer-not-to-main` | `src/renderer/*` | `src/main/*` | Renderer uses IPC via `@bridge`, not direct main process imports |
| `server-not-to-renderer` | `src/server/*` | `src/renderer/*` | Server must not depend on UI code |
| `main-not-to-renderer` | `src/main/*` | `src/renderer/*` | Main process uses IPC, not direct renderer imports |

## Running

```bash
npm run depcruise          # standalone check
npm run verify             # full pipeline: tsc + eslint + depcruise + vitest
```

## Adding Exceptions

If a violation is intentional, add a `pathNot` exclusion to the rule in `.dependency-cruiser.cjs`:

```js
from: { path: '^\\.\\.[\\\\/]lib[\\\\/]', pathNot: 'lib/special-case/' },
```

Document the reason in a comment next to the exclusion.
