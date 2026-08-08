// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression: brief-timeout emit↔consume alignment across the @bridge seam (t/2307).
//
// The bug: clarificationSlice emitted via a hard `web-bridge` import (a module-local
// Set), while the Electron consumer (useBriefTimeoutEvents → @bridge → electron-bridge)
// subscribed to a *different* channel — an IPC channel with zero senders. So in the
// Electron build the toast/dialog never fired.
//
// This test exercises the REAL wiring both sides use — emit via `@bridge`
// (clarificationSlice's path) and subscribe via `@bridge` `api.onBriefTimeout`
// (useBriefTimeoutEvents's path). In vitest `@bridge` resolves to the ELECTRON
// bridge config (bridge/index.ts → electron-bridge), i.e. the build that was broken.
// The existing useBriefTimeoutEvents.test.ts mocks `@bridge`, so it cannot catch a
// mismatch in the emit↔consume seam — that gap is exactly what this covers.

import { describe, it, expect } from 'vitest';
import { api, emitBriefTimeout, emitBriefRetriesExhausted } from '@bridge';
// Concrete web-bridge module — the target the WEB build's `@bridge` alias resolves
// to directly. clarificationSlice now emits via `@bridge` (was a hard web-bridge
// import), so we also assert the web resolution still exposes the emitters and that
// emit↔consume aligns there — web was the only working build before t/2307, so a
// silent web regression would be the worst case (TL t/2307#2).
import { api as webApi, emitBriefTimeout as webEmitTimeout, emitBriefRetriesExhausted as webEmitExhausted } from '../web-bridge';

type TimeoutPayload = { debateId: string; speaker: string; attempt: number; maxAttempts: number; currentModel: string };
type ExhaustedPayload = { debateId: string; speaker: string; totalAttempts: number; currentModel: string };

// Cast: onBriefTimeout / onBriefRetriesExhausted are on AppAPI; keep the payload
// types explicit here so a signature drift on either side is a compile error.
const bridge = api as unknown as {
  onBriefTimeout: (cb: (e: TimeoutPayload) => void) => () => void;
  onBriefRetriesExhausted: (cb: (e: ExhaustedPayload) => void) => () => void;
};

describe('brief-timeout @bridge emit↔consume seam (Electron config)', () => {
  it('delivers emitBriefTimeout to a consumer subscribed via api.onBriefTimeout', () => {
    const received: TimeoutPayload[] = [];
    const unsub = bridge.onBriefTimeout((e) => received.push(e));

    const payload: TimeoutPayload = { debateId: 'd1', speaker: 'safetyist', attempt: 1, maxAttempts: 3, currentModel: '' };
    emitBriefTimeout(payload);

    expect(received).toEqual([payload]);
    unsub();
  });

  it('delivers emitBriefRetriesExhausted to a consumer subscribed via api.onBriefRetriesExhausted', () => {
    const received: ExhaustedPayload[] = [];
    const unsub = bridge.onBriefRetriesExhausted((e) => received.push(e));

    const payload: ExhaustedPayload = { debateId: 'd1', speaker: 'skeptic', totalAttempts: 3, currentModel: '' };
    emitBriefRetriesExhausted(payload);

    expect(received).toEqual([payload]);
    unsub();
  });

  it('stops delivering after unsubscribe', () => {
    const received: TimeoutPayload[] = [];
    const unsub = bridge.onBriefTimeout((e) => received.push(e));
    unsub();

    emitBriefTimeout({ debateId: 'd1', speaker: 'accelerationist', attempt: 2, maxAttempts: 3, currentModel: '' });

    expect(received).toEqual([]);
  });
});

// Web build: `@bridge` → web-bridge.ts directly. Guards against a silent web
// regression from the slice's emit source switching to `@bridge` (TL t/2307#2).
describe('brief-timeout web-bridge emit↔consume seam (Web config)', () => {
  const webBridge = webApi as unknown as {
    onBriefTimeout: (cb: (e: TimeoutPayload) => void) => () => void;
    onBriefRetriesExhausted: (cb: (e: ExhaustedPayload) => void) => () => void;
  };

  it('exposes emitBriefTimeout / emitBriefRetriesExhausted', () => {
    expect(typeof webEmitTimeout).toBe('function');
    expect(typeof webEmitExhausted).toBe('function');
  });

  it('delivers web emitBriefTimeout to a web api.onBriefTimeout consumer', () => {
    const received: TimeoutPayload[] = [];
    const unsub = webBridge.onBriefTimeout((e) => received.push(e));

    const payload: TimeoutPayload = { debateId: 'w1', speaker: 'safetyist', attempt: 1, maxAttempts: 3, currentModel: '' };
    webEmitTimeout(payload);

    expect(received).toEqual([payload]);
    unsub();
  });

  it('delivers web emitBriefRetriesExhausted to a web api.onBriefRetriesExhausted consumer', () => {
    const received: ExhaustedPayload[] = [];
    const unsub = webBridge.onBriefRetriesExhausted((e) => received.push(e));

    const payload: ExhaustedPayload = { debateId: 'w1', speaker: 'skeptic', totalAttempts: 3, currentModel: '' };
    webEmitExhausted(payload);

    expect(received).toEqual([payload]);
    unsub();
  });
});
