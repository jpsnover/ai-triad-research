// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3296 A arm — validateDataRoot(): fail loud on missing/empty data sentinels.
// Verifies:
//   Filesystem mode:
//     (1) Both sentinels non-empty → passes
//     (2) taxonomy/ empty → throws ActionableError
//     (3) dictionary/ empty → throws ActionableError
//   GitHub-api mode (backend has listDirectoryStrict):
//     (4) Both sentinels non-empty → passes
//     (5) taxonomy/ genuine-empty [] → throws immediately (no retry)
//     (6) taxonomy/ transient 3× → throws after 3 attempts; WARN recorded each time
//     (7) taxonomy/ transient 1× then succeeds → passes (retry works)
//     (8) No-creds (listDirectoryStrict throws ActionableError) → throws immediately (no retry)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (hoisted before imports) ──

let recordedEvents: Array<{ level?: string; message?: string; data?: Record<string, unknown> }> = [];
vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: () => ({ record: (ev: unknown) => { recordedEvents.push(ev as never); } }),
  redactRecord: (r: unknown) => r,
}));

import { validateDataRoot, setBackend } from '../storage/fileIO.js';
import { ActionableError } from '../../../../lib/debate/errors.js';
import type { StorageBackend } from '../storage/storageBackend.js';
import { FilesystemBackend } from '../storage/filesystemBackend.js';

// ── Setup ──

// Speed up retries — set delay to 0ms for all tests
process.env.VALIDATE_DATA_ROOT_RETRY_DELAY_MS = '0';

// ── Helpers ──

function makeFilesystemBackend(
  listFn: (dir: string) => Promise<string[]>,
): StorageBackend {
  return { listDirectory: listFn } as unknown as StorageBackend;
}

function makeGitHubBackend(
  listDirectoryStrictFn: (dir: string, opts?: { ref?: string }) => Promise<string[]>,
): StorageBackend {
  return {
    listDirectory: async () => [],
    listDirectoryStrict: listDirectoryStrictFn,
  } as unknown as StorageBackend;
}

// ── Tests ──

describe('validateDataRoot (t/3296 A arm)', () => {
  beforeEach(() => {
    recordedEvents = [];
  });

  afterEach(() => {
    setBackend(new FilesystemBackend());
  });

  // ── Filesystem mode ──

  describe('filesystem mode (no listDirectoryStrict)', () => {
    it('passes when both sentinels are non-empty', async () => {
      setBackend(makeFilesystemBackend(async () => ['file1.json', 'file2.json']));
      await expect(validateDataRoot()).resolves.toBeUndefined();
    });

    it('throws ActionableError when taxonomy/ is empty', async () => {
      setBackend(makeFilesystemBackend(async (dir) => {
        if (dir.includes('taxonomy')) return [];
        return ['file.json'];
      }));
      await expect(validateDataRoot()).rejects.toThrow(ActionableError);
      await expect(validateDataRoot()).rejects.toMatchObject({
        message: expect.stringContaining("taxonomy/"),
      });
    });

    it('throws ActionableError when dictionary/ is empty', async () => {
      setBackend(makeFilesystemBackend(async (dir) => {
        if (dir.includes('dictionary')) return [];
        return ['file.json'];
      }));
      await expect(validateDataRoot()).rejects.toThrow(ActionableError);
      await expect(validateDataRoot()).rejects.toMatchObject({
        message: expect.stringContaining("dictionary/"),
      });
    });
  });

  // ── GitHub-api mode ──

  describe('github-api mode (backend has listDirectoryStrict)', () => {
    it('passes when both sentinels are non-empty', async () => {
      setBackend(makeGitHubBackend(async () => ['node1.json', 'node2.json']));
      await expect(validateDataRoot()).resolves.toBeUndefined();
    });

    it('throws immediately on genuine-empty [] without retrying', async () => {
      let callCount = 0;
      setBackend(makeGitHubBackend(async (dir) => {
        if (dir.includes('taxonomy')) {
          callCount++;
          return []; // genuine empty
        }
        return ['file.json'];
      }));
      await expect(validateDataRoot()).rejects.toThrow(ActionableError);
      expect(callCount).toBe(1); // called only once — no retry for genuine-empty
    });

    it('throws after 3 transient attempts and records WARN for each', async () => {
      const transientErr = Object.assign(new Error('circuit breaker open — transient'), { kind: 'transient' as const });
      setBackend(makeGitHubBackend(async (dir) => {
        if (dir.includes('taxonomy')) throw transientErr;
        return ['file.json'];
      }));

      await expect(validateDataRoot()).rejects.toThrow(ActionableError);

      const warns = recordedEvents.filter(e =>
        e.level === 'warn' && e.message?.includes("taxonomy/"),
      );
      expect(warns).toHaveLength(3);
      expect(warns[0]?.data?.attempt).toBe(1);
      expect(warns[1]?.data?.attempt).toBe(2);
      expect(warns[2]?.data?.attempt).toBe(3);
    });

    it('passes when transient on attempt 1 then succeeds on attempt 2', async () => {
      const transientErr = Object.assign(new Error('transient'), { kind: 'transient' as const });
      let callCount = 0;
      setBackend(makeGitHubBackend(async (dir) => {
        if (dir.includes('taxonomy')) {
          callCount++;
          if (callCount === 1) throw transientErr;
          return ['file.json'];
        }
        return ['file.json'];
      }));

      await expect(validateDataRoot()).resolves.toBeUndefined();
      expect(callCount).toBe(2); // failed once, succeeded on retry
      const warns = recordedEvents.filter(e => e.level === 'warn' && e.message?.includes("taxonomy/"));
      expect(warns).toHaveLength(1); // WARN only for the first transient attempt
    });

    it('throws immediately on ActionableError (no-creds) without retrying', async () => {
      let callCount = 0;
      const credsError = new ActionableError({
        goal: 'Validate data root via GitHub API',
        problem: 'GitHub App credentials are missing.',
        location: 'GitHubAPIBackend.listDirectoryStrict',
        nextSteps: ['Set GITHUB_APP_ID'],
      });
      setBackend(makeGitHubBackend(async (dir) => {
        if (dir.includes('taxonomy')) {
          callCount++;
          throw credsError;
        }
        return ['file.json'];
      }));

      await expect(validateDataRoot()).rejects.toThrow(ActionableError);
      expect(callCount).toBe(1); // no retry for ActionableError
      const warns = recordedEvents.filter(e => e.level === 'warn');
      expect(warns).toHaveLength(0); // no WARN recorded for config errors
    });
  });
});
