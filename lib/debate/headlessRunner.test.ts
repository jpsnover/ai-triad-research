// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runHeadlessDebate } from './headlessRunner.js';
import { createMockAdapter, createMinimalTaxonomy, createDefaultConfig } from './debateEngine.testHelpers.js';

// ── Mocks ─────────────────────────────────────────────────

const { mockRecord } = vi.hoisted(() => ({ mockRecord: vi.fn() }));

vi.mock('../flight-recorder/index.js', () => ({
  getGlobalRecorder: () => ({ record: mockRecord }),
}));

const mockRun = vi.fn();
const mockConstructor = vi.fn();

vi.mock('./debateEngine.js', () => ({
  DebateEngine: class MockDebateEngine {
    constructor(...args: unknown[]) {
      mockConstructor(...args);
    }
    run(...args: unknown[]) {
      return mockRun(...args);
    }
  },
}));

const mockDerive = vi.fn();

vi.mock('./calibrationLogger/extract.js', () => ({
  deriveTerminationReason: (...args: unknown[]) => mockDerive(...args),
}));

// ── Fixtures ──────────────────────────────────────────────

function makeSession(id = 'sess-1') {
  return { id, transcript: [] } as any;
}

// ── Tests ─────────────────────────────────────────────────

describe('runHeadlessDebate', () => {
  const config = createDefaultConfig();
  const adapter = createMockAdapter();
  const taxonomy = createMinimalTaxonomy();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes config, adapter, taxonomy to DebateEngine constructor in order', async () => {
    const session = makeSession();
    mockRun.mockResolvedValue(session);
    mockDerive.mockReturnValue('natural_conclusion');

    await runHeadlessDebate(config, adapter, taxonomy);

    expect(mockConstructor).toHaveBeenCalledOnce();
    expect(mockConstructor).toHaveBeenCalledWith(config, adapter, taxonomy);
  });

  it('calls engine.run with the onProgress callback', async () => {
    const session = makeSession();
    mockRun.mockResolvedValue(session);
    mockDerive.mockReturnValue('natural_conclusion');

    const onProgress = vi.fn();
    await runHeadlessDebate(config, adapter, taxonomy, onProgress);

    expect(mockRun).toHaveBeenCalledOnce();
    expect(mockRun).toHaveBeenCalledWith(onProgress);
  });

  it('calls engine.run with undefined when no onProgress provided', async () => {
    const session = makeSession();
    mockRun.mockResolvedValue(session);
    mockDerive.mockReturnValue('natural_conclusion');

    await runHeadlessDebate(config, adapter, taxonomy);

    expect(mockRun).toHaveBeenCalledWith(undefined);
  });

  it('returns the session from engine.run', async () => {
    const session = makeSession('sess-42');
    mockRun.mockResolvedValue(session);
    mockDerive.mockReturnValue('natural_conclusion');

    const result = await runHeadlessDebate(config, adapter, taxonomy);

    expect(result.session).toBe(session);
  });

  it('calls deriveTerminationReason with the session', async () => {
    const session = makeSession();
    mockRun.mockResolvedValue(session);
    mockDerive.mockReturnValue('max_iterations');

    await runHeadlessDebate(config, adapter, taxonomy);

    expect(mockDerive).toHaveBeenCalledOnce();
    expect(mockDerive).toHaveBeenCalledWith(session);
  });

  it('returns terminationReason from deriveTerminationReason', async () => {
    const session = makeSession();
    mockRun.mockResolvedValue(session);
    mockDerive.mockReturnValue('situation_cap');

    const result = await runHeadlessDebate(config, adapter, taxonomy);

    expect(result.terminationReason).toBe('situation_cap');
  });

  it('degrades to "unknown" when deriveTerminationReason throws', async () => {
    const session = makeSession('sess-bad');
    mockRun.mockResolvedValue(session);
    mockDerive.mockImplementation(() => { throw new TypeError('unexpected shape'); });

    const result = await runHeadlessDebate(config, adapter, taxonomy);

    expect(result.terminationReason).toBe('unknown');
    expect(result.session).toBe(session);
  });

  it('emits a WARN when deriveTerminationReason throws', async () => {
    const session = makeSession('sess-warn');
    mockRun.mockResolvedValue(session);
    mockDerive.mockImplementation(() => { throw new Error('bad session shape'); });

    await runHeadlessDebate(config, adapter, taxonomy);

    expect(mockRecord).toHaveBeenCalledOnce();
    const call = mockRecord.mock.calls[0][0];
    expect(call.type).toBe('system.error');
    expect(call.level).toBe('warn');
    expect(call.component).toBe('headlessRunner');
    expect(call.message).toMatch(/degrading to 'unknown'/);
    expect(call.message).toContain('sess-warn');
  });

  it('does NOT emit a WARN on the happy path', async () => {
    const session = makeSession();
    mockRun.mockResolvedValue(session);
    mockDerive.mockReturnValue('natural_conclusion');

    await runHeadlessDebate(config, adapter, taxonomy);

    expect(mockRecord).not.toHaveBeenCalled();
  });
});
