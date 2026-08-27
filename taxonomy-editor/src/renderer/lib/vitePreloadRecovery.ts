// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Graceful recovery for Vite's `vite:preloadError` (t/3080).
 *
 * When a dynamically-imported chunk or its CSS `<link>` fails to preload,
 * Vite's `__vitePreload` throws "Unable to preload CSS/module …" — surfacing
 * as a hard, unhandled error. The asset is usually NOT missing: the common
 * causes are a transient fetch failure during a cold-start/overload window, a
 * mid-session redeploy that rehashed the chunk under the user, or a proxy/CDN
 * cache miss. All of these are recoverable by reloading the page, which fetches
 * the current `index.html` (stale-deploy) or simply retries (transient).
 *
 * Strategy:
 *   1st miss  → suppress the hard error, record it, and reload once.
 *   2nd miss  → the reload didn't help → genuinely persistent. Record it and
 *               surface a friendly reload banner instead of a raw stack.
 *
 * A `sessionStorage` flag makes the reload fire at most once per browser tab
 * session, preventing a reload loop. The flag is cleared only on a *delayed*
 * confirmed-good load, so a fast repeat failure on the reloaded page still sees
 * the flag set and is treated as persistent (not re-looped). After a clean
 * window, a later unrelated miss can self-heal once again.
 */

import { getGlobalRecorder } from '@lib/flight-recorder/index';

const RELOAD_FLAG = 'vite-preload-reload';
/**
 * Delay before clearing the reload flag on a good load. Long enough that a
 * repeat preload failure on the freshly-reloaded page (which typically fails
 * within the first moments of load) still observes the flag → persistent path,
 * rather than clearing it and re-looping.
 */
const CLEAR_DELAY_MS = 10_000;
const BANNER_ID = 'vite-preload-recovery-banner';

function hasReloaded(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_FLAG) === '1';
  // eslint-disable-next-line local/require-flight-recorder-in-catch -- recovery infra must not throw or recurse into itself; storage-unavailable is treated as "not yet reloaded"
  } catch {
    return false;
  }
}

function markReloaded(): void {
  try {
    sessionStorage.setItem(RELOAD_FLAG, '1');
  // eslint-disable-next-line local/require-flight-recorder-in-catch -- recovery infra must not throw; failing to persist the flag only risks one extra reload, never a data issue
  } catch {
    /* storage unavailable — degrade to no reload-once guard */
  }
}

function clearReloadedFlag(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  // eslint-disable-next-line local/require-flight-recorder-in-catch -- recovery infra must not throw; a stale flag only suppresses one future self-heal
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

/** Best-effort extraction of the failing asset URL from the event payload. */
function extractAssetPath(event: Event): string | undefined {
  const payload = (event as unknown as { payload?: unknown }).payload;
  if (payload instanceof Error) {
    // Vite's message embeds the URL, e.g. "Unable to preload CSS for https://…/x.css".
    const m = /(https?:\/\/\S+)/.exec(payload.message);
    return m?.[1] ?? payload.message;
  }
  if (typeof payload === 'string') return payload;
  return undefined;
}

/**
 * Render a minimal, self-contained reload banner. Plain DOM (not React) so it
 * works even when the failure happened before/around mount and the React tree
 * is unavailable. The Reload button calls `window.location.reload()` directly —
 * no imported helper that could itself be a missing chunk.
 */
function showPersistentFailureBanner(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(BANNER_ID)) return; // already shown

  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.setAttribute('role', 'alert');
  banner.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
    'display:flex', 'align-items:center', 'justify-content:center', 'gap:12px',
    'padding:12px 16px', 'background:#7a1f1f', 'color:#fff',
    'font:14px/1.4 system-ui,-apple-system,sans-serif', 'text-align:center',
    'box-shadow:0 2px 8px rgba(0,0,0,0.3)',
  ].join(';');

  const message = document.createElement('span');
  message.textContent = 'Failed to load part of the app. This is usually temporary — please reload.';

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Reload';
  button.style.cssText = [
    'padding:6px 14px', 'background:#fff', 'color:#7a1f1f', 'border:none',
    'border-radius:4px', 'font-weight:600', 'cursor:pointer',
  ].join(';');
  button.addEventListener('click', () => {
    // Direct call — no imported helper (which could be the very chunk that failed).
    window.location.reload();
  });

  banner.append(message, button);
  (document.body ?? document.documentElement).appendChild(banner);
}

/**
 * Register the `vite:preloadError` recovery handler. Call once, as early as
 * possible in the renderer entry. Returns a disposer that unregisters the
 * listeners (unused in production, where the handler lives for the page's
 * lifetime; consumed by tests to avoid cross-case listener leakage).
 */
export function installVitePreloadRecovery(): () => void {
  if (typeof window === 'undefined') return () => { /* no-op: no window */ };

  const onPreloadError = (event: Event) => {
    const assetPath = extractAssetPath(event);

    if (!hasReloaded()) {
      // First miss: suppress the hard error, record, and self-heal via one reload.
      event.preventDefault();
      markReloaded();
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'asset-preload',
        level: 'warn',
        message: 'vite:preloadError — reloading once to recover',
        data: { preload_error: assetPath, recovering: 'reload' },
      });
      window.location.reload();
      return;
    }

    // Second miss after a reload already happened: persistent failure. Suppress
    // the raw error, record it, and surface a friendly reload banner.
    event.preventDefault();
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'asset-preload',
      level: 'error',
      message: 'vite:preloadError persisted after recovery reload',
      data: { preload_error: assetPath, recovering: 'none', persistent: true },
    });
    showPersistentFailureBanner();
  };

  window.addEventListener('vite:preloadError', onPreloadError);

  // Clear the reload-once flag on a delayed confirmed-good load so a later,
  // unrelated miss can self-heal once again. The delay is what prevents a
  // reload loop: a fast repeat failure on the reloaded page still sees the flag.
  const scheduleClear = () => window.setTimeout(clearReloadedFlag, CLEAR_DELAY_MS);
  const deferredClear = document.readyState !== 'complete';
  if (deferredClear) {
    window.addEventListener('load', scheduleClear, { once: true });
  } else {
    scheduleClear();
  }

  return () => {
    window.removeEventListener('vite:preloadError', onPreloadError);
    if (deferredClear) window.removeEventListener('load', scheduleClear);
  };
}
