// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

/**
 * t/2020 — security regressions for CodeQL high findings in server/storage.
 *
 * Covers:
 *  - js/double-escaping + js/incomplete-multi-character-sanitization
 *      (stripHtmlFallback: single-pass entity decode before tag stripping)
 *  - js/insecure-temporary-file (anonymousSessionStore: private mkdtemp base dir)
 *  - js/insecure-temporary-file (githubAPIBackend: randomised .tmp suffix)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../logger.js', () => ({
  log: { server: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

// ── stripHtmlFallback ────────────────────────────────────────────────────────

import { stripHtmlFallback } from '../storage/urlFetch.js';

describe('stripHtmlFallback (t/2020: entity decode security)', () => {
  it('decodes common HTML entities', () => {
    expect(stripHtmlFallback('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(stripHtmlFallback('1 &lt; 2 &gt; 0')).toBe('1 < 2 > 0');
    expect(stripHtmlFallback('&quot;hello&quot;')).toBe('"hello"');
    expect(stripHtmlFallback('it&#39;s &amp; &nbsp;fine')).toBe("it's & fine");
  });

  it('single-pass decode: &amp;lt; stays &lt; (not double-decoded to <)', () => {
    // Two-pass chained replaces would give: &amp;lt; → &lt; → <  (bypasses later strip)
    // Single-pass must stop at &lt; (one decode only).
    expect(stripHtmlFallback('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
  });

  it('decodes entities BEFORE stripping tags (encoded-tag bypass is caught)', () => {
    // An attacker encodes the tag: &lt;b&gt;text&lt;/b&gt;
    // Decode-first: → <b>text</b> → strip → "text"
    // Old strip-then-decode: → "&lt;b&gt;text&lt;/b&gt;" → "text" (entity still present)
    // Either way we get "text", but the key property is that tags decoded from
    // entities are also stripped (no HTML leaking through in encoded form).
    const result = stripHtmlFallback('&lt;b&gt;bold text&lt;/b&gt;');
    expect(result).not.toContain('&lt;');
    expect(result).not.toContain('&gt;');
    expect(result.trim()).toBe('bold text');
  });

  it('strips all HTML tags in a single pass (catch-all stripper)', () => {
    const result = stripHtmlFallback('<p>Hello <strong>world</strong></p>');
    expect(result.trim()).toBe('Hello world');
  });

  it('collapses excess whitespace and blank lines', () => {
    const result = stripHtmlFallback('<p>a</p>\n\n\n\n<p>b</p>');
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('returns empty string for empty input', () => {
    expect(stripHtmlFallback('')).toBe('');
  });
});

// ── AnonymousSessionStore: private temp dir ──────────────────────────────────

import { AnonymousSessionStore } from '../storage/anonymousSessionStore.js';

describe('AnonymousSessionStore tmpdir fallback (t/2020: js/insecure-temporary-file)', () => {
  let store: AnonymousSessionStore;
  let savedEnv: string | undefined;
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    savedEnv = process.env.ANON_SESSION_DIR;
    delete process.env.ANON_SESSION_DIR;
    // Pretend the Azure shared mount is not present so we hit the tmpdir fallback.
    existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    store = new AnonymousSessionStore({
      maxSessions: 2,
      sessionTtlMs: 60_000,
      maxSessionSizeBytes: 1024,
      cleanupIntervalMs: 999_999,
    });
  });

  afterEach(() => {
    store.stop();
    if (savedEnv !== undefined) process.env.ANON_SESSION_DIR = savedEnv;
    existsSyncSpy.mockRestore();
  });

  it('does NOT use the old predictable "aitriad-anon-sessions" path', () => {
    const baseDir = (store as unknown as { baseDir: string }).baseDir;
    expect(baseDir).not.toContain('aitriad-anon-sessions');
  });

  it('base dir is under os.tmpdir() with an unpredictable (random) suffix', () => {
    const baseDir = (store as unknown as { baseDir: string }).baseDir;
    // Must be under the system temp directory.
    expect(baseDir.startsWith(os.tmpdir())).toBe(true);
    // Must not be the bare tmpdir itself.
    expect(baseDir).not.toBe(os.tmpdir());
    // The random suffix (8+ chars from mkdtemp) makes it distinct from any fixed name.
    const suffix = path.basename(baseDir);
    expect(suffix.startsWith('aitriad-anon-')).toBe(true);
    expect(suffix.length).toBeGreaterThan('aitriad-anon-'.length);
  });
});

// ── githubAPIBackend: randomised .tmp suffix ─────────────────────────────────

// Mock heavy dependencies so we can import the backend without side effects.
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    mkdtemp: vi.fn().mockResolvedValue('/tmp/aitriad-abc123'),
  },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const src = (actual.default ?? actual) as Record<string, unknown>;
  const patched = {
    ...src,
    promises: { ...(src.promises as object), rename: vi.fn().mockResolvedValue(undefined) },
  };
  return { ...patched, default: patched };
});

vi.mock('../security/githubAppAuth.js', () => ({
  getGitHubAppCredentials: vi.fn().mockResolvedValue({
    token: 'ghs_test', repo: 'owner/repo', installationId: 42,
  }),
  refreshGitHubAppToken: vi.fn().mockResolvedValue('ghs_refreshed'),
}));

import fsp from 'fs/promises';
import { GitHubAPIBackend } from '../storage/githubAPIBackend.js';

describe('GitHubAPIBackend temp file names (t/2020: js/insecure-temporary-file)', () => {
  let backend: GitHubAPIBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = new GitHubAPIBackend({ cacheDir: '/tmp/test-cache', pollIntervalMs: 999_999_999 });
  });

  it('writeToDiskCache uses a randomised .tmp.<hex> suffix, not bare .tmp', async () => {
    // Trigger a cache write so writeFile is called with the temp path.
    const writeFileMock = vi.mocked(fsp.writeFile);
    // Call the internal method via a write that hits the disk cache path.
    // We do this by calling writeFile directly via the mock and inspecting the path arg.
    await (backend as unknown as {
      writeToDiskCache(p: string, c: string, s: string, e: string): Promise<void>
    }).writeToDiskCache('taxonomy/nodes.json', '{}', 'abc', '"abc"');

    const calls = writeFileMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const tmpPath = calls[0][0] as string;
    // Must have a random suffix beyond bare '.tmp'
    expect(tmpPath).toMatch(/\.tmp\.[0-9a-f]{16}$/);
    // Must NOT be the predictable bare .tmp suffix
    expect(tmpPath).not.toMatch(/\.tmp$/);
  });

  it('two successive writeToDiskCache calls produce different temp paths', async () => {
    const writeFileMock = vi.mocked(fsp.writeFile);

    await (backend as unknown as {
      writeToDiskCache(p: string, c: string, s: string, e: string): Promise<void>
    }).writeToDiskCache('a.json', '{}', 'sha1', '"sha1"');
    const path1 = writeFileMock.mock.calls[0][0] as string;

    vi.clearAllMocks();

    await (backend as unknown as {
      writeToDiskCache(p: string, c: string, s: string, e: string): Promise<void>
    }).writeToDiskCache('a.json', '{}', 'sha2', '"sha2"');
    const path2 = writeFileMock.mock.calls[0][0] as string;

    expect(path1).not.toBe(path2);
  });
});
