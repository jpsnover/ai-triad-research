// Render smoke (t/3026): assert key surfaces render STYLED in a real prod web build.
// Technique = probe-injection: navigate to the tab that owns a surface (loads its lazy
// chunk → injects that chunk's CSS into <head>), then inject a throwaway element with a
// target class and read getComputedStyle. This asserts the RULE is loaded on that surface
// without needing real data to mount a real element — catching the whole failure class
// (a surface's CSS living in a chunk it doesn't load → silent unstyling; t/3024 + t/3025).
import { test, expect } from '@playwright/test';

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:7862';

/** Inject `<div class=className>`, read one computed property, remove it. */
async function probe(page, className, prop) {
  return page.evaluate(({ className, prop }) => {
    const el = document.createElement('div');
    el.className = className;
    document.body.appendChild(el);
    const v = getComputedStyle(el).getPropertyValue(prop);
    el.remove();
    return v;
  }, { className, prop });
}

/** Navigate to a main tab (loads its lazy chunk → injects that chunk's CSS). */
async function openTab(page, tabId) {
  await page.locator(`[data-tab="${tabId}"]`).first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
}

test.beforeEach(async ({ page }) => {
  // Suppress the OnboardingTour overlay (shown to no-API-key users) — it is aria-modal and
  // intercepts every tab click, so without this the whole suite times out (t/3026 live-run
  // finding). App.tsx:337 early-returns when this localStorage flag is set.
  await page.addInitScript(() => {
    try { localStorage.setItem('taxonomy-editor-onboarding-dismissed', 'true'); } catch { /* private mode */ }
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-tab]', { timeout: 30_000 });
});

test('Attributes / GraphAttributesPanel: .ga-* grid rule is loaded (t/3024 regression)', async ({ page }) => {
  await openTab(page, 'accelerationist'); // POV chunk statically imports NodeDetail → GraphAttributesPanel
  const cols = await probe(page, 'ga-grid-3col', 'grid-template-columns');
  // styled → 3 tracks (e.g. "610px 305px 305px"); unstyled → 'none' / single track
  expect(cols.split(/\s+/).filter(Boolean).length, `ga-grid-3col grid-template-columns="${cols}"`).toBeGreaterThanOrEqual(3);
});

test('HighlightedField: .hl-backdrop overlay rule is loaded (t/3025)', async ({ page }) => {
  await openTab(page, 'accelerationist'); // NodeDescriptionSection renders HighlightedField on the POV surface
  expect(await probe(page, 'hl-backdrop', 'position')).toBe('absolute');
});

// VALIDATE(live t/3026): in the default web boot only the 3 POV tabs render in the tablist —
// `chat`/`debate`/etc. are gated (feature-flag/admin), so [data-tab="chat"] does not exist and
// the DataSourceCard (Prompt Inspector) surface is unreachable here. Enable once the CI job
// boots the app with those tabs flagged on, then point openTab() at the chat surface.
test.fixme('DataSourceCard: .pi-node-count-preview rule is loaded (t/3025)', async ({ page }) => {
  await openTab(page, 'chat'); // Prompt Inspector renders DataSourceCard
  const bw = await probe(page, 'pi-node-count-preview', 'border-bottom-width');
  expect(bw, `pi-node-count-preview border-bottom-width="${bw}"`).not.toBe('0px');
});

// VALIDATE(live): confirm which surface renders ApiKeyErrorMessage in the web build (its error
// state), then point openTab() at it. Marked fixme until that nav is confirmed.
test.fixme('ApiKeyErrorMessage: .api-key-error-link rule is loaded (t/3025)', async ({ page }) => {
  await openTab(page, 'accelerationist'); // TODO: correct surface + trigger the error state
  const td = await probe(page, 'api-key-error-link', 'text-decoration-line');
  expect(td, `api-key-error-link text-decoration-line="${td}"`).toContain('underline');
});
