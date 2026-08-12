// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';

// Stub Electron and every local dependency so the module loads under vitest's
// node environment without touching the filesystem or IPC infrastructure.
// We only need addNodeSchema — a pure zod definition — from this module.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  clipboard: { writeText: vi.fn() },
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => process.cwd() },
}));
vi.mock('./fileIO.js', () => ({}));
vi.mock('./embeddings.js', () => ({}));
vi.mock('./generateContent.js', () => ({}));
vi.mock('./apiKeyStore.js', () => ({}));
vi.mock('./modelDiscovery.js', () => ({}));
vi.mock('./diagnosePython.js', () => ({}));
vi.mock('../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => null }));
vi.mock('../../../lib/electron-shared/promptLoader.js', () => ({}));
vi.mock('../../../lib/electron-shared/utils/validatedIpc.js', () => ({
  validatedHandle: vi.fn(),
  noArgs: null, oneString: null, stringArray: null, stringAndRecord: null,
  stringAndOptionalString: null, optionalString: null,
  twoStringsAndOptional: null, unknownArray: null,
}));

import { addNodeSchema } from './ipcHandlers.js';

afterEach(() => { vi.clearAllMocks(); });

// Regression test for t/2533 L12a: the add-taxonomy-node handler was previously
// registered with `oneUnknown` (a z.tuple([z.unknown()])), meaning any payload
// passed Zod validation and addTaxonomyNode received an unsafe cast. This test
// verifies the replacement schema rejects structurally invalid payloads before
// the handler body runs.
describe('add-taxonomy-node IPC schema (L12a — t/2533)', () => {
  const validPayload = {
    pov: 'accelerationist',
    category: 'beliefs',
    label: 'Test node',
    description: 'A test node description',
  };

  it('accepts a structurally valid payload', () => {
    const result = addNodeSchema.safeParse([validPayload]);
    expect(result.success).toBe(true);
  });

  it('accepts a payload with all optional fields present', () => {
    const result = addNodeSchema.safeParse([{
      ...validPayload,
      docId: 'doc-abc123',
      conceptIndex: 0,
      interpretations: {
        accelerationist: 'acc view',
        safetyist: 'saf view',
        skeptic: 'skp view',
      },
    }]);
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing required field pov', () => {
    const { pov: _pov, ...withoutPov } = validPayload;
    const result = addNodeSchema.safeParse([withoutPov]);
    expect(result.success).toBe(false);
  });

  it('rejects a payload missing required field label', () => {
    const { label: _label, ...withoutLabel } = validPayload;
    const result = addNodeSchema.safeParse([withoutLabel]);
    expect(result.success).toBe(false);
  });

  it('rejects a non-object payload (string)', () => {
    const result = addNodeSchema.safeParse(['not-an-object']);
    expect(result.success).toBe(false);
  });

  it('rejects an empty tuple (no args)', () => {
    const result = addNodeSchema.safeParse([]);
    expect(result.success).toBe(false);
  });
});
