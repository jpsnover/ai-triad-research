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

## Covered surfaces (reachability)

| surface | tab to load its chunk | probe class | assert (computed) |
|---|---|---|---|
| Attributes / GraphAttributesPanel | a POV tab (`[data-tab="accelerationist"]`) | `.ga-grid-3col` | `grid-template-columns` resolves to 3 tracks |
| HighlightedField (t/3025 fix) | POV tab (NodeDescriptionSection) | `.hl-backdrop` | `position: absolute` |
| ApiKeyErrorMessage (t/3025 fix) | Analysis / settings surface | `.api-key-error-link` | `text-decoration` underline |
| DataSourceCard (t/3025 fix) | `[data-tab="chat"]` (Prompt Inspector) | `.pi-node-count-preview` | `border-bottom-width` ≠ 0px |

**Medium candidates to adjudicate (t/3025#1)** — same probe technique decides each: `vocab-*`,
`qbaf-delta`/`qbaf-badge`, `claim-attribution-*`. Confirmed unstyled → fix #1561 way; styled → leave.

## Run

```
# 1. Build the prod web artifact + server (once)
npm run build:container
# 2. Run the smoke (starts the server, waits for :7862, drives Chromium, tears down)
npm run smoke:styled
```

`run-smoke.mjs` spawns `start:server`, `wait-on http://localhost:7862`, runs the Playwright spec,
then kills the server. Exits non-zero on any failed assertion.

## Both-arms proof (Gate Verification)

- **Clean arm (pass):** `npm run build:container && npm run smoke:styled` → all surfaces styled.
- **Deliberate-misfile arm (fail):** move the `.ga-*` block from `GraphAttributesPanel.css` back into
  `analysis/GroundingPanel.css`, `npm run build:container && npm run smoke:styled` → the Attributes
  probe FAILS (the diagnostics chunk that now owns `.ga-*` never loads on the POV tab). Revert after.

## STATUS — scaffold; NOT yet validated against a live run

Authored from the locked design + boot investigation (server `PORT=7862`; web boot may show
`FirstRunDialog` → the spec skips it; tabs are `[data-tab="<id>"]` under `role="tablist"`). The
selectors + probe classes are **best-effort and must be tuned against a running app**, and the
**both-arms proof must be captured**, before this is offered to DevOps for CI wiring. That live-run
+ both-arms is the next step (route the proof to TL per t/3026#1).
