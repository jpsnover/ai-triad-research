// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/2694 / t/2698 — regression coverage for the diagnostics-window "never
 * displays" race. The main window pushes the cached state once on the popup's
 * did-finish-load, but useDiagnosticsState subscribes only after React mounts; a
 * push arriving first was silently dropped, leaving an idle debate stuck on
 * "Loading debate…". preload.cts fixes it with createLatestValueBuffer (buffer the
 * latest pre-registration value, flush on subscribe). These tests exercise that
 * buffer state machine directly — now possible because t/2698 widened vite's
 * esbuild.include to cover typed `.cts` modules.
 */

import { describe, it, expect } from 'vitest';
import { createLatestValueBuffer } from '../preloadBuffer.cjs';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createLatestValueBuffer (t/2694 diagnostics-window race)', () => {
  it('delivers a value buffered BEFORE subscribe (the race)', async () => {
    const b = createLatestValueBuffer<string>();
    b.onIpc('s1'); // push arrives before the component mounts + subscribes
    const got: string[] = [];
    b.onSubscribe(v => got.push(v));
    await flush(); // buffered value is delivered on a microtask
    expect(got).toEqual(['s1']);
  });

  it('keeps only the latest pre-subscribe value (full-state snapshots)', async () => {
    const b = createLatestValueBuffer<string>();
    b.onIpc('old');
    b.onIpc('new');
    const got: string[] = [];
    b.onSubscribe(v => got.push(v));
    await flush();
    expect(got).toEqual(['new']);
  });

  it('delivers nothing when no push arrived before subscribe', async () => {
    const b = createLatestValueBuffer<string>();
    const got: string[] = [];
    b.onSubscribe(v => got.push(v));
    await flush();
    expect(got).toEqual([]);
  });

  it('stops buffering once subscribed (live pushes go through the ipc listener, not the buffer)', async () => {
    const b = createLatestValueBuffer<string>();
    const got: string[] = [];
    b.onSubscribe(v => got.push(v));
    b.onIpc('after'); // arrives after subscribe → not re-delivered by the buffer
    await flush();
    expect(got).toEqual([]);
  });

  it('re-arms after unsubscribe so the next reload cycle is covered', async () => {
    const b = createLatestValueBuffer<string>();
    b.onSubscribe(() => {}); // first mount
    b.onUnsubscribe(); // re-arm the buffer
    b.onIpc('between'); // push arrives between reloads (nothing subscribed)
    const got: string[] = [];
    b.onSubscribe(v => got.push(v)); // second mount must still receive it
    await flush();
    expect(got).toEqual(['between']);
  });
});
