// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for t/3080: graceful recovery from Vite's `vite:preloadError`.
 *
 * 1st miss → suppress the hard error, record it, reload once (flag set).
 * 2nd miss (flag set) → no reload, record persistent failure, show banner.
 * Flag cleared on a delayed confirmed-good load so a later miss can self-heal.
 */

const h = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: h.record }),
}));

import { installVitePreloadRecovery } from '../vitePreloadRecovery';

const RELOAD_FLAG = 'vite-preload-reload';
const BANNER_ID = 'vite-preload-recovery-banner';

function firePreloadError(assetUrl = 'https://app.example/assets/chartTooltip-abc.css'): Event {
  const event = new Event('vite:preloadError', { cancelable: true });
  (event as unknown as { payload: Error }).payload = new Error(`Unable to preload CSS for ${assetUrl}`);
  window.dispatchEvent(event);
  return event;
}

describe('installVitePreloadRecovery (t/3080)', () => {
  let reloadSpy: ReturnType<typeof vi.fn>;
  let dispose: () => void;

  beforeEach(() => {
    h.record.mockClear();
    sessionStorage.clear();
    document.body.innerHTML = '';
    dispose = () => { /* replaced by each test's install */ };
    // jsdom's location.reload is a non-functional stub that warns; replace it.
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
    // Force the "already complete" branch so the delayed clear is schedulable.
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
  });

  afterEach(() => {
    dispose(); // remove the listener so cases don't accumulate handlers on window
    vi.useRealTimers();
  });

  it('1st preloadError: prevents default, sets flag, records recovering, reloads once', () => {
    dispose = installVitePreloadRecovery();

    const event = firePreloadError();

    expect(event.defaultPrevented).toBe(true);
    expect(sessionStorage.getItem(RELOAD_FLAG)).toBe('1');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(h.record).toHaveBeenCalledTimes(1);
    const rec = h.record.mock.calls[0][0];
    expect(rec).toMatchObject({
      component: 'asset-preload',
      level: 'warn',
      data: { recovering: 'reload' },
    });
    expect(rec.data.preload_error).toContain('chartTooltip-abc.css');
    // No banner on the first, recoverable miss.
    expect(document.getElementById(BANNER_ID)).toBeNull();
  });

  it('2nd preloadError (flag set): no reload, records persistent, shows banner', () => {
    sessionStorage.setItem(RELOAD_FLAG, '1'); // simulate we already reloaded once
    dispose = installVitePreloadRecovery();

    const event = firePreloadError();

    expect(event.defaultPrevented).toBe(true);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(h.record).toHaveBeenCalledTimes(1);
    expect(h.record.mock.calls[0][0]).toMatchObject({
      component: 'asset-preload',
      level: 'error',
      data: { recovering: 'none', persistent: true },
    });
    const banner = document.getElementById(BANNER_ID);
    expect(banner).not.toBeNull();

    // Banner's Reload button calls location.reload() directly.
    banner!.querySelector('button')!.click();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('banner is not duplicated on repeated persistent misses', () => {
    sessionStorage.setItem(RELOAD_FLAG, '1');
    dispose = installVitePreloadRecovery();

    firePreloadError();
    firePreloadError();

    expect(document.querySelectorAll(`#${BANNER_ID}`)).toHaveLength(1);
  });

  it('clears the reload flag on a delayed confirmed-good load', () => {
    vi.useFakeTimers();
    sessionStorage.setItem(RELOAD_FLAG, '1');

    dispose = installVitePreloadRecovery(); // readyState==='complete' → schedules delayed clear

    // Flag still set immediately — a fast repeat failure would be treated as persistent.
    expect(sessionStorage.getItem(RELOAD_FLAG)).toBe('1');

    vi.advanceTimersByTime(10_000);

    expect(sessionStorage.getItem(RELOAD_FLAG)).toBeNull();
  });
});
