// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3370 regression: makeElectronAIAdapter used to hardcode scenario: 'Debate' for all
// three callers (debate, op-ed generation, brief export), mislabeling the non-debate
// call-log entries. This asserts the scenario now comes from the caller-supplied param.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateText = vi.hoisted(() => vi.fn());
const mockWriteAICallLogEntry = vi.hoisted(() => vi.fn());

vi.mock('../embeddings.js', () => ({ generateText: mockGenerateText }));
vi.mock('../aiCallLog.js', () => ({ writeAICallLogEntry: mockWriteAICallLogEntry }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: vi.fn(() => null) }));

import { makeElectronAIAdapter } from '../electronAIAdapter.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('makeElectronAIAdapter — scenario parameterization (t/3370)', () => {
  it('logs with the caller-supplied scenario, not a hardcoded "Debate"', async () => {
    mockGenerateText.mockResolvedValue('generated text');
    const adapter = makeElectronAIAdapter('OpEd Generation');
    await adapter.generateText('a prompt', 'gemini-2.0-flash');

    expect(mockWriteAICallLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({ scenario: 'OpEd Generation', status: '200' }),
    );
  });

  it('logs the same caller-supplied scenario on failure', async () => {
    mockGenerateText.mockRejectedValue(new Error('boom'));
    const adapter = makeElectronAIAdapter('Brief Export');
    await expect(adapter.generateText('a prompt', 'gemini-2.0-flash')).rejects.toThrow();

    expect(mockWriteAICallLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({ scenario: 'Brief Export', status: 'error' }),
    );
  });

  it('still supports the original Debate scenario for the debate engine caller', async () => {
    mockGenerateText.mockResolvedValue('generated text');
    const adapter = makeElectronAIAdapter('Debate');
    await adapter.generateText('a prompt', 'gemini-2.0-flash');

    expect(mockWriteAICallLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({ scenario: 'Debate', status: '200' }),
    );
  });
});
