// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// web-bridge openDebateWindow URL construction (t/2399, TL "complement" unit test).
// Verifies the desktop path threads `source` into the popout hash so a community
// debate opens against the community endpoint. The parse side is covered by
// popoutLoad.test.ts (parseDebateHash reads source=community back out).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => undefined }));

import { api } from './web-bridge';

describe('web-bridge openDebateWindow — source propagation (t/2399)', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom is a desktop UA (no iPad/Android), so openAppWindow uses window.open.
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('appends &source=community to the debate-window hash when source is given', async () => {
    await api.openDebateWindow('abc-123', 'community');
    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = String(openSpy.mock.calls[0][0]);
    expect(url).toContain('debate-window?id=abc-123&source=community');
  });

  it('omits source entirely when not provided (personal open, backward-compatible)', async () => {
    await api.openDebateWindow('abc-123');
    const url = String(openSpy.mock.calls[0][0]);
    expect(url).toContain('debate-window?id=abc-123');
    expect(url).not.toContain('source=');
  });

  it('url-encodes both id and source', async () => {
    await api.openDebateWindow('a/b 1', 'com munity');
    const url = String(openSpy.mock.calls[0][0]);
    expect(url).toContain('id=a%2Fb%201');
    expect(url).toContain('source=com%20munity');
  });
});
