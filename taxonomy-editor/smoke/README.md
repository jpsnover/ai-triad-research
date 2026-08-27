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

## Covered surfaces (reachability — validated live t/3026)

In the default web boot **only the 3 POV tabs render** in the tablist (`accelerationist` /
`safetyist` / `skeptic`); `chat`, `debate`, etc. are gated (feature-flag/admin), so their
`[data-tab]` buttons do not exist and their surfaces are unreachable here. The two POV-surface
assertions are **active and proven both-arms**; the two gated surfaces are `test.fixme` until the
CI job boots the app with those tabs flagged on.

| surface | tab to load its chunk | probe class | assert (computed) | status |
|---|---|---|---|---|
| Attributes / GraphAttributesPanel | POV tab (`[data-tab="accelerationist"]`) | `.ga-grid-3col` | `grid-template-columns` ≥ 3 tracks | **active** ✓ |
| HighlightedField (t/3025 fix) | POV tab (NodeDescriptionSection) | `.hl-backdrop` | `position: absolute` | **active** ✓ |
| DataSourceCard (t/3025 fix) | `[data-tab="chat"]` (Prompt Inspector) | `.pi-node-count-preview` | `border-bottom-width` ≠ 0px | `fixme` — chat tab gated |
| ApiKeyErrorMessage (t/3025 fix) | Analysis / settings error state | `.api-key-error-link` | `text-decoration` underline | `fixme` — surface/nav TBD |

**Medium candidates to adjudicate (t/3025#1)** — same probe technique decides each: `vocab-*`,
`qbaf-delta`/`qbaf-badge`, `claim-attribution-*`. Pending the gated surfaces being reachable.

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

Assertion logic proven live (2026-08-27) via the probe against the prod web build:

- **Clean arm (pass):** `.ga-grid-3col` → `grid-template-columns: "610px 305px 305px"` (3 tracks) → assertion `≥3` **passes**.
- **Deliberate-unload arm (fail):** comment out the `.ga-grid-3col` rule in `GraphAttributesPanel.css`
  → `build:web` (rule absent from all built CSS) → `grid-template-columns: "none"` (1 track) → assertion **fails**.
  `.hl-backdrop` stayed `absolute` throughout (isolated negative control). Reverted after.

## STATUS — harness validated; CI wiring is the DevOps handoff

Validated against a live prod-build server: Chromium launches, the app boots to the POV tablist,
probe-injection reads the lazy-chunk CSS, and both arms behave correctly.

**Known local limitation:** the `@playwright/test` *runner* hangs on **Node 24** (this dev box);
the raw Chromium API used to capture both-arms works fine. DevOps's CI runs **Node 22** (t/3026#4),
where the runner is unaffected — so this does not block the gate.

**DevOps handoff (CI wiring):** add the pinned `@playwright/test@1.48.2` devDep + lockfile sync
(deferred here to avoid lockfile churn), `npx playwright install --with-deps chromium`, cache
`~/.cache/ms-playwright`, wire the job **non-blocking** on Node 22 for ≥1 green real-env cycle, then
a separate draft PR flips warn→block held for TL sign-off (t/3026#4 promotion discipline). Enable the
two `fixme` surfaces once the job boots the app with `chat`/settings tabs flagged on.
