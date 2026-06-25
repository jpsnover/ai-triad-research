import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runWithUser } from '../security/userContext';
import { communityReviewHandler as handler } from '../community/admin/communityReviewHandler';

// Community storage resolves under AI_TRIAD_DATA_ROOT (filesystem backend in tests).
let dataRoot: string;
const subsDir = () => path.join(dataRoot, 'community', '_submissions');
const chatsDir = () => path.join(dataRoot, 'community', 'chats');

function writeSubmission(sub: Record<string, unknown>) {
  fs.mkdirSync(subsDir(), { recursive: true });
  fs.writeFileSync(path.join(subsDir(), `sub-${sub.id}.json`), JSON.stringify(sub, null, 2));
}
function readSubmission(id: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(subsDir(), `sub-${id}.json`), 'utf-8'));
}

// Run handler ops outside any admin auto-approve path — a plain user context.
function asUser<T>(fn: () => T): T {
  return runWithUser(
    { principalName: 'tester', idp: 'github', storageUserId: 'tester', isAnonymous: false },
    fn,
  );
}

function pendingChat(id: string, over: Record<string, unknown> = {}) {
  return {
    id, type: 'chat', originalId: `orig-${id}`, submittedBy: 'alice',
    submittedAt: '2026-06-10T00:00:00.000Z', status: 'pending',
    data: { id: `orig-${id}`, title: 'AI Safety Chat', model: 'gemini', messages: [{ content: 'hi' }, { content: 'there' }] },
    ...over,
  };
}

describe('community ReviewDomainHandler (t/650)', () => {
  beforeAll(() => {
    process.env.AI_TRIAD_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'comm-handler-'));
    dataRoot = process.env.AI_TRIAD_DATA_ROOT;
  });
  afterAll(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.AI_TRIAD_DATA_ROOT;
  });
  beforeEach(() => {
    fs.rmSync(path.join(dataRoot, 'community'), { recursive: true, force: true });
  });

  it('domain is "community"', () => {
    expect(handler.domain).toBe('community');
  });

  it('getPendingItems maps only pending submissions, newest-first', async () => {
    writeSubmission(pendingChat('a', { submittedAt: '2026-06-01T00:00:00.000Z' }));
    writeSubmission(pendingChat('b', { submittedAt: '2026-06-09T00:00:00.000Z' }));
    writeSubmission(pendingChat('c', { status: 'approved' }));

    const items = await asUser(() => handler.getPendingItems());
    expect(items.map(i => i.id)).toEqual(['community:b', 'community:a']);
    expect(items[0]).toMatchObject({ domain: 'community', submitter: 'alice', itemCount: 1 });
    expect(items[0].summary).toBe('1 chat: AI Safety Chat');
  });

  it('getPendingItems filters by submitter', async () => {
    writeSubmission(pendingChat('a', { submittedBy: 'alice' }));
    writeSubmission(pendingChat('b', { submittedBy: 'bob' }));
    const items = await asUser(() => handler.getPendingItems('bob'));
    expect(items).toHaveLength(1);
    expect(items[0].submitter).toBe('bob');
  });

  it('returns empty when no submissions exist', async () => {
    expect(await asUser(() => handler.getPendingItems())).toEqual([]);
  });

  it('getDetailForViewer returns preview, metadata, and sanitization preview', async () => {
    writeSubmission(pendingChat('a', {
      data: {
        id: 'orig-a', title: 'Secrets Chat', model: 'claude',
        api_key: 'should-be-flagged',
        messages: [{ content: 'first message' }, { content: 'second' }],
      },
    }));
    const detail = await asUser(() => handler.getDetailForViewer('community:a')) as {
      itemId: string; type: string; title: string;
      preview: string; metadata: { model: string; turnCount: number };
      sanitization: { willStrip: string[]; willAdd: string[] };
    };
    expect(detail.itemId).toBe('a');
    expect(detail.type).toBe('chat');
    expect(detail.title).toBe('Secrets Chat');
    expect(detail.metadata).toMatchObject({ model: 'claude', turnCount: 2 });
    expect(detail.preview).toContain('first message');
    expect(detail.sanitization.willStrip).toContain('api_key');
    expect(detail.sanitization.willAdd.join(' ')).toContain('community_metadata');
  });

  it('getDetailForViewer surfaces debate transcript preview + phase/audience/activePovers', async () => {
    writeSubmission({
      id: 'd1', type: 'debate', originalId: 'orig-d1', submittedBy: 'alice',
      submittedAt: '2026-06-10T00:00:00.000Z', status: 'pending',
      data: {
        id: 'orig-d1', title: 'Should AI be paused?', model: 'gemini',
        phase: 'synthesis', audience: 'policymakers',
        activePovers: ['accelerationist', 'safetyist'],
        transcript: [
          { speaker: 'accelerationist', content: 'Progress matters', type: 'argument' },
          { speaker: 'safetyist', content: 'Risk matters', type: 'argument' },
        ],
      },
    });
    const detail = await asUser(() => handler.getDetailForViewer('community:d1')) as {
      type: string;
      transcriptPreview: Array<{ speaker: string; content: string; type: string }>;
      metadata: { phase: string; audience: string; activePovers: string[]; turnCount: number };
    };
    expect(detail.type).toBe('debate');
    expect(detail.metadata).toMatchObject({ phase: 'synthesis', audience: 'policymakers', turnCount: 2 });
    expect(detail.metadata.activePovers).toEqual(['accelerationist', 'safetyist']);
    expect(detail.transcriptPreview).toHaveLength(2);
    expect(detail.transcriptPreview[0]).toEqual({ speaker: 'accelerationist', content: 'Progress matters', type: 'argument' });
  });

  it('activePovers falls back to characters when activePovers is absent', async () => {
    writeSubmission({
      id: 'd2', type: 'debate', originalId: 'orig-d2', submittedBy: 'alice',
      submittedAt: '2026-06-10T00:00:00.000Z', status: 'pending',
      data: { id: 'orig-d2', title: 'T', characters: ['accelerationist', 'skeptic'], transcript: [] },
    });
    const detail = await asUser(() => handler.getDetailForViewer('community:d2')) as {
      metadata: { activePovers: string[] };
    };
    expect(detail.metadata.activePovers).toEqual(['accelerationist', 'skeptic']);
  });

  it('debate detail leaves phase/audience null when the debate omits them', async () => {
    writeSubmission({
      id: 'd3', type: 'debate', originalId: 'orig-d3', submittedBy: 'alice',
      submittedAt: '2026-06-10T00:00:00.000Z', status: 'pending',
      data: { id: 'orig-d3', title: 'T', transcript: [{ speaker: 'skeptic', content: 'hm', type: 'q' }] },
    });
    const detail = await asUser(() => handler.getDetailForViewer('community:d3')) as {
      metadata: { phase: string | null; audience: string | null; activePovers: string[] };
    };
    expect(detail.metadata.phase).toBeNull();
    expect(detail.metadata.audience).toBeNull();
    expect(detail.metadata.activePovers).toEqual([]);
  });

  it('getDetailForViewer reports not-found for unknown id', async () => {
    const detail = await asUser(() => handler.getDetailForViewer('community:nope')) as { found: boolean };
    expect(detail.found).toBe(false);
  });

  it('executeAction promote publishes to community/chats and marks the submission approved', async () => {
    writeSubmission(pendingChat('a'));
    await asUser(() => handler.executeAction({
      domain: 'community', groupId: 'community:a', action: 'promote', itemIds: ['a'],
    }));
    expect(readSubmission('a').status).toBe('approved');
    const published = fs.readdirSync(chatsDir());
    expect(published.some(f => f.startsWith('chat-'))).toBe(true);
  });

  it('executeAction reject marks the submission rejected without publishing', async () => {
    writeSubmission(pendingChat('a'));
    await asUser(() => handler.executeAction({
      domain: 'community', groupId: 'community:a', action: 'reject', itemIds: ['a'], reason: 'low quality',
    }));
    expect(readSubmission('a').status).toBe('rejected');
    expect(fs.existsSync(chatsDir())).toBe(false);
  });

  it('AC#4: edit-on-promote merges title/description into the published copy only', async () => {
    writeSubmission(pendingChat('a'));
    await asUser(() => handler.executeAction({
      domain: 'community', groupId: 'community:a', action: 'promote', itemIds: ['a'],
      edits: { a: { title: 'Curated Title' } },
    }));
    // Published copy carries the edited title.
    const publishedFile = fs.readdirSync(chatsDir()).find(f => f.startsWith('chat-'))!;
    const published = JSON.parse(fs.readFileSync(path.join(chatsDir(), publishedFile), 'utf-8'));
    expect(published.title).toBe('Curated Title');
    // Stored submission's original data is untouched.
    expect((readSubmission('a').data as { title: string }).title).toBe('AI Safety Chat');
  });

  it('AC#6: reject persists the reason on the submission', async () => {
    writeSubmission(pendingChat('a'));
    await asUser(() => handler.executeAction({
      domain: 'community', groupId: 'community:a', action: 'reject', itemIds: ['a'], reason: 'off-topic',
    }));
    const sub = readSubmission('a');
    expect(sub.status).toBe('rejected');
    expect(sub.rejectionReason).toBe('off-topic');
  });

  it('accepts raw submission ids as well as community:-prefixed ids', async () => {
    writeSubmission(pendingChat('a'));
    await asUser(() => handler.executeAction({
      domain: 'community', groupId: 'community:a', action: 'reject', itemIds: ['community:a'], reason: 'x',
    }));
    expect(readSubmission('a').status).toBe('rejected');
  });
});
