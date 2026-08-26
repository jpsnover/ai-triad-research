// Render smoke (t/3026): assert key surfaces render STYLED in a real prod web build.
// Technique = probe-injection: navigate to the tab that owns a surface (loads its lazy
// chunk → injects that chunk's CSS into <head>), then inject a throwaway element with a
// target class and read getComputedStyle. This asserts the RULE is loaded on that surface
// without needing real data to mount a real element — catching the whole failure class
// (a surface's CSS living in a chunk it doesn't load → silent unstyling; t/3024 + t/3025).
//
// STATUS: scaffold — selectors/probe classes are best-effort from static analysis and MUST
// be tuned against a running app, and both-arms must be captured, before CI wiring (see README).
import { test, expect } from '@playwright/test';

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:7862';

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

/** Dismiss the FirstRunDialog (web boot may gate on it) so the main tabs are reachable. */
async function dismissFirstRun(page) {
  const skip = page.getByRole('button', { name: /skip/i });
  if (await skip.count().catch(() => 0)) await skip.first().click().catch(() => {});
}

/** Navigate to a main tab (loads its lazy chunk → injects that chunk's CSS). */
async function openTab(page, tabId) {
  await page.locator(`[data-tab="${tabId}"]`).first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
}

test.beforeEach(async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await dismissFirstRun(page);
  await page.waitForSelector('[role="tablist"], .tab-bar', { timeout: 30_000 });
});

test('Attributes / GraphAttributesPanel: .ga-* grid rule is loaded (t/3024 regression)', async ({ page }) => {
  await openTab(page, 'accelerationist'); // POV chunk statically imports NodeDetail → GraphAttributesPanel
  const cols = await probe(page, 'ga-grid-3col', 'grid-template-columns');
  // styled → 3 tracks; unstyled → 'none' / single track
  expect(cols.split(/\s+/).filter(Boolean).length, `ga-grid-3col grid-template-columns="${cols}"`).toBeGreaterThanOrEqual(3);
});

test('HighlightedField: .hl-backdrop overlay rule is loaded (t/3025)', async ({ page }) => {
  await openTab(page, 'accelerationist'); // NodeDescriptionSection renders HighlightedField
  expect(await probe(page, 'hl-backdrop', 'position')).toBe('absolute');
});

test('DataSourceCard: .pi-node-count-preview rule is loaded (t/3025)', async ({ page }) => {
  await openTab(page, 'chat'); // Prompt Inspector renders DataSourceCard
  const bw = await probe(page, 'pi-node-count-preview', 'border-bottom-width');
  expect(bw, `pi-node-count-preview border-bottom-width="${bw}"`).not.toBe('0px');
});

// VALIDATE(live): confirm which tab/panel loads settings/ApiKeyErrorMessage in the web build,
// then point openTab() at it. Marked fixme until the nav is confirmed so it can't false-fail.
test.fixme('ApiKeyErrorMessage: .api-key-error-link rule is loaded (t/3025)', async ({ page }) => {
  await openTab(page, 'accelerationist'); // TODO: correct surface
  const td = await probe(page, 'api-key-error-link', 'text-decoration-line');
  expect(td, `api-key-error-link text-decoration-line="${td}"`).toContain('underline');
});
