# Type System Patterns

Failure patterns related to TypeScript types, Zod schemas, and module resolution.

---

## [Type System] Zod v4 Inline Schemas Can Cause TypeScript OOM

**Pattern:** Zod v4's inline composed schemas (e.g., `z.tuple([z.string().regex(...)])`) trigger TS2589 (infinite type recursion), causing `tsc --noEmit` to exhaust the heap (4GB+) before it can even report the error.

**Instances:**
- 2026-05-24 — Taxonomy Editor: poviewer `tsc --noEmit` OOM at `ipcHandlers.ts:125` due to `z.tuple([z.string().regex(...)])` inline schema. Fixed by extracting to a pre-defined `oneString` schema with runtime regex check. Commit 588ca0a (p/6#3).

**Root Cause:** Zod v4's TypeScript type inference for composed schemas (tuple + regex) creates deeply recursive conditional types. When inlined, the TypeScript compiler attempts to resolve the full type tree and enters infinite recursion, consuming all available memory before producing a diagnostic.

**Prevention:**
1. Pre-define complex Zod schemas as named constants rather than inlining them in function signatures or handlers.
2. Separate validation concerns: use simple Zod types (`z.string()`) for shape validation, then apply regex/format checks at runtime.
3. If `tsc` hangs or OOMs with no error output, suspect recursive type inference — bisect by commenting out Zod schemas to isolate the culprit.
4. Monitor `tsc --noEmit` memory usage in CI; an unexplained spike is likely a type recursion issue.

**Status:** Active

**Applies To:** All agents working with Zod v4 schemas in the Electron apps (taxonomy-editor, poviewer, summary-viewer).

---

## [Type System] TypeScript nodenext Requires .js Extension on Imports

**Pattern:** TypeScript with `moduleResolution: "nodenext"` requires `.js` extensions on relative imports even though the source files are `.ts`. Missing the extension causes TS2835/TS2307 at type-check time.

**Instances:**
- 2026-05-28 — Taxonomy Editor: CI type-check failed on ONNX import — missing `.js` extension for `nodenext` module resolution, plus implicit `any` on callback param. Fixed by adding `.js` to import path and type annotation. Commit 47e4452 (p/6#13).

**Root Cause:** `nodenext` module resolution mirrors Node.js ESM behavior, which requires explicit file extensions. TypeScript enforces this at type-check — you must write `import './foo.js'` even though the source file is `foo.ts`. This is counterintuitive but by design.

**Prevention:**
1. Always include `.js` extension on relative imports in projects using `nodenext` or `node16` module resolution.
2. Run `tsc --noEmit` locally before pushing to catch these — CI will reject them.
3. When adding new imports, check the project's `tsconfig.json` for `moduleResolution` to know whether extensions are required.
4. Enable `noImplicitAny` awareness — always annotate callback parameters.

**Status:** Active

**Applies To:** All agents writing TypeScript in the Electron apps (all three use nodenext).

---

## [Type System] Divergent Cross-Package Type Unions Break Main Between Agents

**Pattern:** Two packages define parallel union types for the same concept (e.g., backend IDs). When one agent adds a member to one union without updating the other, `tsc` breaks on main for downstream code that bridges both types.

**Instances:**
- 2026-06-25 — ServerAPI: Shared Lib added `'azure'` to `BackendId` (`lib/ai-client/types.ts`) but the server's `AIBackend` union (`config.ts`) wasn't updated. `resolveBackend()` returns `BackendId`, which feeds `getApiKeys()`/`hasApiKey()` (typed as `AIBackend`), so `tsc` failed with "'azure' not assignable to AIBackend" on `aiBackends.ts:358` + `server.ts`. Fixed by adding `'azure'` to `AIBackend` + `ENV_KEY_NAMES` (commit 318a85b6). Recommended unifying the two unions to prevent recurrence (p/79#3).

**Root Cause:** The same domain concept (AI backend identifiers) is represented by two separate union types in different packages (`BackendId` in `lib/ai-client/types.ts`, `AIBackend` in server `config.ts`). There's no compile-time constraint enforcing `BackendId ⊆ AIBackend`. In a multi-agent environment, different agents own different packages — Agent A adds a member to their union, Agent B's code breaks because their parallel union is now a subset. The break only surfaces when `tsc` runs across the full project.

**Prevention:**
1. **Unify parallel union types** — define the canonical type in one place and import/re-export it. If the server needs a subset, derive it with `Extract<BackendId, ...>`.
2. When adding a member to a union type, grep for other definitions of the same concept across packages: `grep -r "type.*Backend" --include='*.ts'`.
3. After modifying shared types in `lib/`, run `tsc` across all consuming projects (server, taxonomy-editor) before pushing — not just the project you're working in.
4. Consider a CI step that type-checks all packages together, not just the one that changed.

**Status:** Active

**Applies To:** All agents modifying shared type definitions in `lib/` or server config types.

---

## [Type System] New Flight Recorder Event Type Not Added to EventType Union

**Pattern:** A new flight recorder event (e.g., `'state.save-coalesced'`) is emitted at the call site but not added to the `EventType` union in `lib/flight-recorder/types.ts`, causing a `tsc` failure.

**Instances:**
- 2026-07-10 — Taxonomy Editor: added `'state.save-coalesced'` event emission (t/1468) but forgot to extend the `EventType` union in `lib/flight-recorder/types.ts`. `tsc` caught it. Fixed in 37ed8841 (p/6#15).

**Root Cause:** The flight recorder's `record()` call accepts an `EventType` string literal union. Adding a new event at the call site is easy — the string is just typed inline — but the union in `types.ts` is a separate file that must also be updated. No compiler error appears at the call site until `tsc` runs (the literal is narrower than `string`, so autocompletion doesn't force you through the union).

**Prevention:**
1. When adding a new flight recorder event, update `EventType` in `lib/flight-recorder/types.ts` FIRST, then use it at the call site — the union is the source of truth.
2. After adding any new string literal to a recorder call, grep for `type EventType` to find the union and add the new literal.
3. Same family as #36 (divergent cross-package unions) but single-file: the union and its usage sites are in different files within the same package.

**Status:** Active

**Applies To:** All agents adding new flight recorder events.
