# Render smoke — "surface renders styled" (t/3026)

Durable gate for the failure class **single-context validation + silent degradation → invisible
failure**: a component's CSS lives in a lazy tab-chunk that is *not* loaded on the surface that
uses the classes, so the surface renders **unstyled with no error** (the t/3024 `.ga-*` incident;
plus the three t/3025 orphans this smoke regression-tests).

jsdom/vitest **cannot** compute stylesheet cascade → a unit test here is a false-green. This smoke
runs in a **real browser** (Playwright-Chromium) against a **production web build** served by the
real server, so lazy CSS code-splitting behaves exactly as in prod.

## Why this shape (locked with TL p/336#198/#199 + DevOps t/3026#4)

- **Playwright-Chromium vs `start:server`** (the real prod web artifact), NOT `vite preview` and NOT
  Electron+xvfb. The bug is a Vite-bundling concern → the web profile covers the class at lowest
  flake. Must be a **prod build** — the dev server serves unbundled (no lazy split → false green).
- **Assertion = probe-injection.** For each surface we navigate to the tab that owns it (which loads
  that surface's lazy chunk → injects its CSS into `<head>`), then inject a throwaway element with a
  target class and read `getComputedStyle`. This asserts the *rule is loaded on that surface* without
  needing real data to mount a real element — it catches the whole failure class, not one instance.
- **Both-arms** (required, Gate Verification): a correct build **passes**; deliberately re-misfiling
  the `.ga-*` block into `GroundingPanel.css` (a lazy diagnostics chunk) makes it **fail**. See below.
- **Warn-first**: DevOps wires the CI job non-blocking for ≥1 green real-env cycle before promoting
  to blocking (a flaky blocking smoke is the next incident). DevOps owns the CI flip.

## Covered surfaces (reachability — validated live t/3026 + t/3059)

In the default web boot **only the 3 POV tabs render** in the tablist (`accelerationist` /
`safetyist` / `skeptic`); `chat`, `debate`, etc. are gated (feature-flag/admin). But a surface's
CSS is reachable whenever its rule ships in a **chunk that loads at boot** — not only when its own
tab is clicked. All five active surfaces below ride the **main entry chunk** (their components are
statically imported via `App.tsx → PovTab`), so their rules are present at boot and probeable on
any POV tab. **All five are active and proven both-arms** (t/3059).

| surface | tab to load its chunk | probe class | assert (computed) | status |
|---|---|---|---|---|
| Attributes / GraphAttributesPanel | POV tab (`[data-tab="accelerationist"]`) | `.ga-grid-3col` | `grid-template-columns` ≥ 3 tracks | **active** ✓ |
| HighlightedField (t/3025 fix) | POV tab (NodeDescriptionSection) | `.hl-backdrop` | `position: absolute` | **active** ✓ |
| DataSourceCard (t/3025 fix) | POV tab (main chunk via PromptInspector) | `.pi-node-count-preview` | `border-bottom-width` ≠ 0px | **active** ✓ (t/3059) |
| ApiKeyErrorMessage (t/3025 fix) | POV tab (main chunk via AnalysisPanel) | `.api-key-error-link` | `text-decoration` underline | **active** ✓ (t/3059) |
| claim-attribution (t/3025/t/3059 fix) | POV tab (NodeDetail) | `.claim-attribution-label` | `text-transform: uppercase` | **active** ✓ (t/3059) |

> The DataSourceCard/ApiKeyErrorMessage `fixme`s were **over-conservative** — both ride the main
> chunk, so no `chat`/settings tab flagging was needed (t/3059). Enabled + proven on a POV tab.

**Medium-3 adjudication (t/3025#1) — DONE (t/3059). All three are CONFIRMED orphans** (single
component-local definition each, no `styles.css` fallback; used cross-component on surfaces whose
chunk does not load the defining sheet):

| class | sole CSS home (chunk) | live usage off that chunk | verdict | action |
|---|---|---|---|---|
| `claim-attribution-*` | ArgumentGraph.css — imported only by `ArgumentGraph ← TimelineScrubber`, **never rendered → tree-shaken → ships in NO chunk** | NodeDetail (POV, main), ReflectionsPanel, 3 diagnostics surfaces | **CONFIRMED** — unstyled on the POV tab today | **FIXED here**: relocated to NodeDetail.css (main chunk) + active smoke assertion above |
| `qbaf-delta` / `qbaf-badge` | QbafOverlay.css — loads only in diagnostics + harvest chunks | ConflictDetail (conflict chunk), StatementCard (debate chunk) | **CONFIRMED** — unstyled on conflict + debate surfaces | **Routed** → Conflict (ConflictDetail.css) + DebateWorkspace (StatementCard.css) |
| `vocab-term` | VocabularyPanel.css — loads only in the debate chunk | OverviewTabRouter (diagnostics-window chunk) | **CONFIRMED** — unstyled on the diagnostics overview surface | **Routed** → DebateDiagnostics (OverviewTabRouter.css) |

> qbaf/vocab consumers live on **gated** surfaces (conflict/debate/diagnostics) whose fix lands in
> child-role scopes; those fixes are routed, not done here, and are **not** added as smoke
> assertions — the gate stays POV-scoped and low-flake per TL (t/3026#10). claim-attribution is the
> one confirmed orphan that renders on the POV surface, so it is both fixed and asserted here.

## Run

```
# 1. Build the prod web artifact + server (once)
npm run build:container
# 2. Run the smoke — Playwright's webServer starts the server, waits for `/`, and tears it down.
npm run smoke:styled
```

- `run-smoke.mjs` resolves the **local** `@playwright/test` CLI (not `npx`, which can fetch a
  mismatched playwright) and runs the spec.
- `playwright.config.mjs` `webServer` runs `serve.mjs`, which **symlinks the renderer** into the
  path the server expects (mirrors `Dockerfile:196`; without it `/` 404s) and starts the server
  **in-process** (so Playwright's teardown kills it cleanly — a spawned child would zombie the port).
- The spec suppresses the `OnboardingTour` overlay via `addInitScript` (`localStorage`
  `taxonomy-editor-onboarding-dismissed`) — it is aria-modal and otherwise intercepts every click.

## Both-arms proof (Gate Verification) — CAPTURED

Assertion logic proven live (2026-08-27) via the probe against the prod web build. **Every active
assertion has its own proven failure arm** (t/3026#10 cond 1 — a passive always-pass control on a
known-orphan surface would be a false-green):

- **Attributes `.ga-grid-3col`** — clean → `"610px 305px 305px"` (3 tracks) → `≥3` **passes**;
  comment the rule → `build:web` (absent from all built CSS) → `"none"` (1 track) → **fails**.
- **HighlightedField `.hl-backdrop`** — clean → `position: absolute` → **passes**; comment the rule →
  `build:web` → `position: static` → **fails** (`.ga-grid-3col` stayed 3 tracks — isolated).
- **DataSourceCard `.pi-node-count-preview`** (t/3059) — clean → `border-bottom-width: 1px` →
  **passes**; neuter the rule → `build:web` → `0px` → **fails**.
- **ApiKeyErrorMessage `.api-key-error-link`** (t/3059) — clean → `text-decoration: underline` →
  **passes**; neuter the rule → `build:web` → `none` → **fails**.
- **claim-attribution `.claim-attribution-label`** (t/3059) — clean → `text-transform: uppercase` →
  **passes**; neuter the rule → `build:web` → `none` → **fails** (`.ga`/`.hl` stayed styled — isolated).

Both/all arms captured 2026-08-27 via the `@playwright/test` runner (v1.60.0, Node 24.15.0) against
the prod web build: clean = **5 passed**; all-three-neutered = **3 failed / 2 passed**. Rules
reverted after. Rebuilding (not DOM-hiding) is required — it exercises the Vite chunk-graph, which
is the actual failure class.

## STATUS — harness validated; live CI gate wired (non-blocking)

Validated against a live prod-build server: Chromium launches, the app boots to the POV tablist,
probe-injection reads the main-chunk CSS, and every arm behaves correctly.

**Node-24 runner:** fixed. The `@playwright/test` runner previously hung on Node 24 (yauzl
stream-destruction regression, Node ≥24.16); **v1.60.0 vendored the fix** and DevOps pinned it in
the CI job (#1599). The runner now runs clean on Node 22 (CI) and Node 24.15.0 (this dev box).

**CI status:** DevOps wired the non-blocking render-smoke job on **Node 22**, pinned
`@playwright/test@1.60.0`, `build:container` → `smoke:styled`, cached `~/.cache/ms-playwright`
(#1599). It runs on every electron PR + main push. Promotion warn→block is a separate TL-signed
draft PR gated on DevOps's real-env both-arms — unchanged, DevOps-owned (t/3026#10 cond 4).

**Coverage (honest, per "no silent caps"):** this harness now covers **5 active + both-arms-proven**
POV-surface assertions (Attributes `.ga-*`, HighlightedField `.hl-*`, DataSourceCard `.pi-*`,
ApiKeyErrorMessage `.api-key-error-*`, claim-attribution `.claim-attribution-*`). The medium-3
adjudication is **done** (all CONFIRMED orphans): claim-attribution is fixed + asserted here;
`qbaf-*` and `vocab-*` render only on **gated** surfaces (conflict/debate/diagnostics) — their fixes
are **routed to the owning child roles** (Conflict, DebateWorkspace, DebateDiagnostics) and are
deliberately **not** asserted here (the gate stays POV-scoped + low-flake). Those routed fixes are
tracked in **t/3059**. A green check here covers the five POV surfaces above, not the gated ones.
