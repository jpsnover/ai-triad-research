// @vitest-environment node

/**
 * t/684 — shared community/calibration data lives on `main`, not the caller's
 * session branch. These reads must pass { ref: 'main' } to backend.readFile so
 * the GitHub API fallback targets main (otherwise it 404s on the session branch
 * and burns rate limit). Taxonomy/debate reads must NOT — they target the
 * session branch so the user's edits stay visible (AC#5).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { StorageBackend } from '../storageBackend.js';
import * as fileIO from '../fileIO.js';
import * as community from '../community.js';
import * as userContext from '../userContext.js';

type ReadOpts = { ref?: string } | undefined;

class SpyBackend implements StorageBackend {
  calls: { path: string; opts: ReadOpts }[] = [];
  private returns = new Map<string, string>();
  private dirs = new Map<string, string[]>();

  stubFile(substr: string, content: string) { this.returns.set(substr, content); }
  stubDir(substr: string, entries: string[]) { this.dirs.set(substr, entries); }
  optsFor(substr: string): ReadOpts[] {
    return this.calls.filter(c => c.path.includes(substr)).map(c => c.opts);
  }

  async readFile(filePath: string, opts?: { ref?: string }): Promise<string | null> {
    const p = filePath.replace(/\\/g, '/');
    this.calls.push({ path: p, opts });
    for (const [sub, content] of this.returns) if (p.includes(sub)) return content;
    return null;
  }
  async writeFile(): Promise<void> {}
  async listDirectory(dirPath: string): Promise<string[]> {
    const d = dirPath.replace(/\\/g, '/');
    for (const [sub, entries] of this.dirs) if (d.includes(sub)) return entries;
    return [];
  }
  async deleteFile(): Promise<void> {}
  async fileExists(): Promise<boolean> { return false; }
  async readBinaryFile(): Promise<Buffer | null> { return null; }
}

const authedCtx = { principalName: 'alice', idp: 'github', storageUserId: 'alice', isAnonymous: false };

let dataRoot: string;
let spy: SpyBackend;

describe('community/calibration reads target main (t/684)', () => {
  beforeAll(() => {
    process.env.AI_TRIAD_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mainref-'));
    dataRoot = process.env.AI_TRIAD_DATA_ROOT;
  });
  afterAll(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.AI_TRIAD_DATA_ROOT;
  });
  beforeEach(() => {
    spy = new SpyBackend();
    fileIO.setBackend(spy);
  });

  it('listCommunityChats reads chat files with { ref: "main" }', async () => {
    spy.stubDir('community/chats', ['chat-1.json']);
    spy.stubFile('community/chats/chat-1.json', JSON.stringify({ id: '1', title: 'T' }));

    await userContext.runWithUser(authedCtx, () => community.listCommunityChats());

    const opts = spy.optsFor('community/chats/chat-1.json');
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every(o => o?.ref === 'main')).toBe(true);
  });

  it('loadCommunityItem reads with { ref: "main" }', async () => {
    spy.stubFile('community/chats/chat-abc.json', JSON.stringify({ id: 'abc' }));
    await userContext.runWithUser(authedCtx, () => community.loadCommunityItem('chats', 'abc'));
    expect(spy.optsFor('community/chats/chat-abc.json')).toEqual([{ ref: 'main' }]);
  });

  it('listSubmissions reads submission files with { ref: "main" }', async () => {
    spy.stubDir('_submissions', ['sub-1.json']);
    spy.stubFile('sub-1.json', JSON.stringify({ id: '1', type: 'chat', status: 'pending', submittedBy: 'alice' }));

    await userContext.runWithUser(authedCtx, () => community.listSubmissions('pending'));

    const opts = spy.optsFor('_submissions/sub-1.json');
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every(o => o?.ref === 'main')).toBe(true);
  });

  it('approveSubmission reads the submission from main', async () => {
    spy.stubFile('sub-xyz.json', JSON.stringify({ id: 'xyz', type: 'chat', status: 'pending', submittedBy: 'bob', data: { id: 'c1' } }));
    await userContext.runWithUser(authedCtx, () => community.approveSubmission('xyz'));
    expect(spy.optsFor('_submissions/sub-xyz.json')).toContainEqual({ ref: 'main' });
  });

  it('calibration core + integration reads target main', async () => {
    await userContext.runWithUser(authedCtx, () => fileIO.readCoreCalibrationEntries());
    await userContext.runWithUser(authedCtx, () => fileIO.readCalibrationIntegrationLog());

    expect(spy.optsFor('calibration/core/calibration-log.jsonl').every(o => o?.ref === 'main')).toBe(true);
    expect(spy.optsFor('calibration/integration-log.jsonl').every(o => o?.ref === 'main')).toBe(true);
  });

  it('lineage map reads target main', async () => {
    await userContext.runWithUser(authedCtx, () => fileIO.readCoreLineageEnrichmentsMap());
    expect(spy.optsFor('lineage-enrichments.json').every(o => o?.ref === 'main')).toBe(true);
  });

  it('AC#5 regression guard: taxonomy reads do NOT force main (use session branch)', async () => {
    await userContext.runWithUser(authedCtx, () => fileIO.readEdgesFile());
    const opts = spy.optsFor('edges.json');
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every(o => o === undefined)).toBe(true);
  });
});
