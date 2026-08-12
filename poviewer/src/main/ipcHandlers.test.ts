// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression tests for t/2534 at the IPC boundary:
//   M4  — 'get-api-key' is gone; 'has-api-key' returns a boolean (never the key).
//   M7  — 'add-source' rejects metadata whose id fails SAFE_ID_RE.
//   M10 — 'extract-pdf-text' rejects paths outside the data root / sources dir.
// Plus t/2540: 'read-source-file' (restored from the ef8bac78 regression) serves only
// dialog-returned paths — allowlisted read succeeds, non-allowlisted path → 400.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const captured = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: unknown[]) => unknown>,
  showOpen: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      captured.handlers[channel] = fn;
    },
  },
  dialog: { showOpenDialog: (opts: unknown) => captured.showOpen(opts) },
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false },
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => process.cwd() },
}));

// Isolate the sources root (computed at fileIO module load).
const TMP_SOURCES = fs.mkdtempSync(path.join(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp', 'poviewer-t2534-ipc-'));
process.env.AI_TRIAD_SOURCES_ROOT = TMP_SOURCES;

// Loaded in beforeAll (not top-level await — tsconfig.main.json compiles tests
// as CommonJS) so the env var above is in place before module-load resolution.
beforeAll(async () => {
  const { registerIpcHandlers, cleanupIpcHandlers } = await import('./ipcHandlers.js');
  registerIpcHandlers();
  cleanupIpcHandlers(); // stop any taxonomy file watchers so vitest can exit
});

const EVENT = {} as unknown;

describe('t/2534 M4: API key never crosses IPC', () => {
  it('the get-api-key channel no longer exists', () => {
    expect(captured.handlers['get-api-key']).toBeUndefined();
  });

  it('has-api-key returns a boolean payload, not a key string', async () => {
    const handler = captured.handlers['has-api-key'];
    expect(handler).toBeDefined();
    const result = await handler(EVENT);
    expect(typeof result).toBe('boolean');
  });

  it('the preload surface exposes hasApiKey and not getApiKey/readSourceFile of the key', () => {
    const preloadSrc = fs.readFileSync(path.join(__dirname, 'preload.ts'), 'utf-8');
    expect(preloadSrc).toContain("invoke('has-api-key')");
    expect(preloadSrc).not.toContain("invoke('get-api-key')");
  });
});

describe('t/2534 M7: add-source metadata shape check', () => {
  const validMeta = {
    id: 'src-001',
    title: 'A doc',
    sourceType: 'pdf',
    url: null,
    addedAt: new Date().toISOString(),
    status: 'pending',
  };

  function invokeAddSource(meta: unknown): Promise<unknown> {
    return Promise.resolve().then(() => captured.handlers['add-source'](EVENT, meta));
  }

  it('rejects a traversal id', async () => {
    await expect(invokeAddSource({ ...validMeta, id: '../evil' }))
      .rejects.toThrow(/Invalid IPC payload for 'add-source'/);
    expect(fs.existsSync(path.join(TMP_SOURCES, '..', 'evil'))).toBe(false);
  });

  it('rejects an absolute-path id and a backslash id', async () => {
    await expect(invokeAddSource({ ...validMeta, id: '/etc/passwd' }))
      .rejects.toThrow(/add-source/);
    await expect(invokeAddSource({ ...validMeta, id: 'a\\b' }))
      .rejects.toThrow(/add-source/);
  });

  it('rejects a meta payload missing required fields', async () => {
    await expect(invokeAddSource({ id: 'ok-id' }))
      .rejects.toThrow(/add-source/);
  });

  it('accepts a valid meta payload (happy path unchanged)', async () => {
    await captured.handlers['add-source'](EVENT, validMeta);
    expect(fs.existsSync(path.join(TMP_SOURCES, 'src-001', 'metadata.json'))).toBe(true);
  });
});

describe('t/2534 M10: extract-pdf-text path containment', () => {
  it('rejects an absolute path outside the allowed roots with statusCode 400', async () => {
    const outside = path.resolve(path.parse(process.cwd()).root, 'definitely-outside', 'evil.pdf');
    let thrown: unknown;
    try {
      await captured.handlers['extract-pdf-text'](EVENT, outside);
    } catch (err) {
      /* telemetry — silent by design (test captures the expected throw) */
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect((thrown as { statusCode?: number }).statusCode).toBe(400);
    expect((thrown as Error).message).toContain('Blocked PDF path');
  });

  it('rejects a traversal-relative path that escapes the roots', async () => {
    let thrown: unknown;
    try {
      await captured.handlers['extract-pdf-text'](EVENT, path.join(TMP_SOURCES, '..', '..', 'evil.pdf'));
    } catch (err) {
      /* telemetry — silent by design (test captures the expected throw) */
      thrown = err;
    }
    expect((thrown as { statusCode?: number } | undefined)?.statusCode).toBe(400);
  });

  it('allows a path inside the sources root (fails later with not-found, not 400)', async () => {
    let thrown: unknown;
    try {
      await captured.handlers['extract-pdf-text'](EVENT, path.join(TMP_SOURCES, 'src-001', 'raw', 'missing.pdf'));
    } catch (err) {
      /* telemetry — silent by design (test captures the expected throw) */
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect((thrown as { statusCode?: number }).statusCode).toBeUndefined();
    expect((thrown as Error).message).toContain('PDF file not found');
  });
});

describe('t/2534 M9pov: set-taxonomy-dir confinement', () => {
  it('rejects a traversal dirName with statusCode 400', async () => {
    let thrown: unknown;
    try {
      await captured.handlers['set-taxonomy-dir'](EVENT, '../../etc');
    } catch (err) {
      /* telemetry — silent by design (test captures the expected throw) */
      thrown = err;
    }
    expect((thrown as { statusCode?: number } | undefined)?.statusCode).toBe(400);
  });
});

describe('t/2540: read-source-file dialog-returned-path allowlist', () => {
  const allowedFile = path.join(TMP_SOURCES, 'allowed.md');
  beforeAll(() => {
    fs.writeFileSync(allowedFile, '# Allowed\n\nhello world\n');
    captured.showOpen.mockReset();
  });

  it('reads a file the native open dialog handed out (add-file flow repro)', async () => {
    // Simulates AddSourceDialog: openSourceFileDialog() then readSourceFile(fp).
    captured.showOpen.mockResolvedValueOnce({ canceled: false, filePaths: [allowedFile] });
    const paths = await captured.handlers['open-source-file-dialog'](EVENT) as string[];
    expect(paths).toEqual([allowedFile]);
    const content = await captured.handlers['read-source-file'](EVENT, allowedFile);
    expect(content).toContain('hello world');
  });

  it('refuses a path the dialog never returned — statusCode 400, four-field ActionableError', async () => {
    const outside = path.resolve(path.parse(process.cwd()).root, 'etc', 'passwd');
    let thrown: unknown;
    try {
      await captured.handlers['read-source-file'](EVENT, outside);
    } catch (err) {
      /* telemetry — silent by design (test captures the expected throw) */
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect((thrown as { statusCode?: number }).statusCode).toBe(400);
    expect((thrown as { goal?: string }).goal).toBeDefined();
    expect((thrown as { problem?: string }).problem).toBeDefined();
    expect((thrown as { location?: string }).location).toBeDefined();
    expect(Array.isArray((thrown as { nextSteps?: string[] }).nextSteps)).toBe(true);
  });

  it('a path authorized this session survives path.resolve normalization', async () => {
    captured.showOpen.mockResolvedValueOnce({ canceled: false, filePaths: [allowedFile] });
    await captured.handlers['open-source-file-dialog'](EVENT);
    // A non-normalized spelling of the same file (extra "./" segment) must still match.
    const messy = path.join(path.dirname(allowedFile), '.', path.basename(allowedFile));
    await expect(captured.handlers['read-source-file'](EVENT, messy)).resolves.toContain('hello world');
  });
});
