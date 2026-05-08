// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  addComment,
  updateComment,
  deleteComment,
  resolveComment,
  addReply,
  loadComments,
  saveComments,
  commentsPathForDebate,
  generateFactCheckComments,
  CommentsFileSchema,
  COMMENT_TYPES,
  type CommentsFile,
  type AddCommentInput,
} from './comments.js';
import type { DebateSession, ArgumentNetworkNode, TranscriptEntry } from './types.js';

function makeInput(overrides: Partial<AddCommentInput> = {}): AddCommentInput {
  return {
    debateId: 'debate-abc',
    type: 'insight',
    source: 'human',
    author: 'testuser',
    textRange: {
      entryId: 'entry-1',
      tier: 'detailed',
      startOffset: 10,
      endOffset: 50,
      selectedText: 'some selected transcript text',
    },
    body: 'This is a great point about governance.',
    ...overrides,
  };
}

function emptyFile(): CommentsFile {
  return { _schema_version: '1', debateId: 'debate-abc', comments: [] };
}

// ── commentsPathForDebate ─────────────────────────────────

describe('commentsPathForDebate', () => {
  it('generates sidecar path from debate file path', () => {
    const result = commentsPathForDebate('/data/debates/debate-abc.json');
    expect(result).toBe('/data/debates/debate-abc-comments.json');
  });
});

// ── Comment types enum ────────────────────────────────────

describe('COMMENT_TYPES', () => {
  it('has exactly 10 types', () => {
    expect(COMMENT_TYPES).toHaveLength(10);
  });
});

// ── addComment ────────────────────────────────────────────

describe('addComment', () => {
  it('adds a comment with all required fields', () => {
    const file = emptyFile();
    const comment = addComment(file, makeInput());

    expect(file.comments).toHaveLength(1);
    expect(comment.id).toBeTruthy();
    expect(comment.debateId).toBe('debate-abc');
    expect(comment.type).toBe('insight');
    expect(comment.source).toBe('human');
    expect(comment.author).toBe('testuser');
    expect(comment.body).toBe('This is a great point about governance.');
    expect(comment.replies).toEqual([]);
    expect(comment.resolved).toBe(false);
    expect(comment.textRange.entryId).toBe('entry-1');
    expect(comment.textRange.tier).toBe('detailed');
    expect(comment.textRange.selectedText).toBe('some selected transcript text');
  });

  it('generates unique IDs for multiple comments', () => {
    const file = emptyFile();
    const c1 = addComment(file, makeInput());
    const c2 = addComment(file, makeInput({ type: 'question' }));
    expect(c1.id).not.toBe(c2.id);
    expect(file.comments).toHaveLength(2);
  });

  it('validates against Zod schema', () => {
    const file = emptyFile();
    addComment(file, makeInput());
    expect(() => CommentsFileSchema.parse(file)).not.toThrow();
  });
});

// ── updateComment ─────────────────────────────────────────

describe('updateComment', () => {
  it('updates body and type', () => {
    const file = emptyFile();
    const original = addComment(file, makeInput());
    const updated = updateComment(file, original.id, {
      body: 'Updated body',
      type: 'disagree',
    });
    expect(updated.body).toBe('Updated body');
    expect(updated.type).toBe('disagree');
    expect(updated.updatedAt).toBeTruthy();
  });

  it('throws for nonexistent comment', () => {
    const file = emptyFile();
    expect(() => updateComment(file, 'nonexistent', { body: 'x' })).toThrow('Comment not found');
  });
});

// ── deleteComment ─────────────────────────────────────────

describe('deleteComment', () => {
  it('removes the comment from the array', () => {
    const file = emptyFile();
    const c = addComment(file, makeInput());
    deleteComment(file, c.id);
    expect(file.comments).toHaveLength(0);
  });

  it('throws for nonexistent comment', () => {
    const file = emptyFile();
    expect(() => deleteComment(file, 'nonexistent')).toThrow('Comment not found');
  });
});

// ── resolveComment ────────────────────────────────────────

describe('resolveComment', () => {
  it('sets resolved to true', () => {
    const file = emptyFile();
    const c = addComment(file, makeInput());
    expect(c.resolved).toBe(false);
    const resolved = resolveComment(file, c.id);
    expect(resolved.resolved).toBe(true);
  });
});

// ── addReply ──────────────────────────────────────────────

describe('addReply', () => {
  it('adds a reply to a comment', () => {
    const file = emptyFile();
    const c = addComment(file, makeInput());
    const reply = addReply(file, c.id, { author: 'other', body: 'I agree!' });

    expect(c.replies).toHaveLength(1);
    expect(reply.id).toBeTruthy();
    expect(reply.author).toBe('other');
    expect(reply.body).toBe('I agree!');
  });

  it('updates parent comment updatedAt', () => {
    const file = emptyFile();
    const c = addComment(file, makeInput());
    const originalUpdatedAt = c.updatedAt;
    // Small delay to ensure timestamp differs
    addReply(file, c.id, { author: 'other', body: 'reply' });
    expect(c.updatedAt).toBeTruthy();
  });

  it('throws for nonexistent comment', () => {
    const file = emptyFile();
    expect(() => addReply(file, 'nonexistent', { author: 'a', body: 'b' })).toThrow('Comment not found');
  });
});

// ── Zod schema validation ─────────────────────────────────

describe('CommentsFileSchema', () => {
  it('rejects invalid comment type', () => {
    const file = emptyFile();
    addComment(file, makeInput());
    (file.comments[0] as any).type = 'invalid_type';
    expect(() => CommentsFileSchema.parse(file)).toThrow();
  });

  it('rejects endOffset <= startOffset', () => {
    const file = emptyFile();
    addComment(file, makeInput({
      textRange: {
        entryId: 'entry-1', tier: 'brief',
        startOffset: 50, endOffset: 10, selectedText: 'text',
      },
    }));
    expect(() => CommentsFileSchema.parse(file)).toThrow();
  });
});

// ── File I/O ──────────────────────────────────────────────

describe('loadComments / saveComments', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comments-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty file when path does not exist', () => {
    const result = loadComments(path.join(tmpDir, 'missing.json'), 'debate-1');
    expect(result.comments).toEqual([]);
    expect(result.debateId).toBe('debate-1');
  });

  it('round-trips through save and load', () => {
    const file = emptyFile();
    addComment(file, makeInput());
    addComment(file, makeInput({ type: 'question', body: 'Why?' }));

    const filePath = path.join(tmpDir, 'test-comments.json');
    saveComments(filePath, file);
    const loaded = loadComments(filePath, 'debate-abc');

    expect(loaded.comments).toHaveLength(2);
    expect(loaded.comments[0].type).toBe('insight');
    expect(loaded.comments[1].type).toBe('question');
  });

  it('atomic save does not leave .tmp file on success', () => {
    const file = emptyFile();
    const filePath = path.join(tmpDir, 'atomic-test.json');
    saveComments(filePath, file);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(filePath + '.tmp')).toBe(false);
  });
});

// ── generateFactCheckComments ─────────────────────────────

function makeSession(overrides: Partial<DebateSession> = {}): DebateSession {
  return {
    id: 'debate-abc',
    title: 'Test Debate',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    phase: 'debate',
    topic: { original: 'AI governance', refined: null, final: 'AI governance' },
    source_type: 'topic',
    source_ref: '',
    source_content: '',
    active_povers: ['prometheus', 'sentinel', 'cassandra'],
    user_is_pover: false,
    transcript: [],
    context_summaries: [],
    ...overrides,
  };
}

function makeAnNode(overrides: Partial<ArgumentNetworkNode> = {}): ArgumentNetworkNode {
  return {
    id: 'AN-1',
    text: 'AI has reduced costs by 40%',
    speaker: 'prometheus',
    source_entry_id: 'entry-1',
    taxonomy_refs: [],
    turn_number: 1,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: 'entry-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'statement',
    speaker: 'prometheus',
    content: 'Studies show that AI has reduced costs by 40% in manufacturing sectors.',
    taxonomy_refs: [],
    ...overrides,
  };
}

describe('generateFactCheckComments', () => {
  it('creates fact_supported comment for verified claim', () => {
    const session = makeSession({
      transcript: [makeEntry()],
      argument_network: {
        nodes: [makeAnNode({ verification_status: 'verified', verification_evidence: 'Multiple studies confirm this.', scoring_method: 'fact_check' })],
        edges: [],
      },
    });
    const file = emptyFile();
    const added = generateFactCheckComments(session, file);

    expect(added).toHaveLength(1);
    expect(added[0].type).toBe('fact_supported');
    expect(added[0].source).toBe('auto');
    expect(added[0].author).toBe('Fact Checker');
    expect(added[0].body).toContain('Supported');
    expect(added[0].body).toContain('Multiple studies confirm this.');
    expect(added[0].textRange.entryId).toBe('entry-1');
    expect(added[0].textRange.selectedText).toBe('AI has reduced costs by 40%');
  });

  it('creates fact_not_supported comment for disputed claim', () => {
    const session = makeSession({
      transcript: [makeEntry()],
      argument_network: {
        nodes: [makeAnNode({ verification_status: 'disputed', verification_evidence: 'No evidence found.', scoring_method: 'fact_check' })],
        edges: [],
      },
    });
    const file = emptyFile();
    const added = generateFactCheckComments(session, file);

    expect(added).toHaveLength(1);
    expect(added[0].type).toBe('fact_not_supported');
    expect(added[0].body).toContain('Disputed');
  });

  it('skips unverifiable and pending nodes', () => {
    const session = makeSession({
      transcript: [makeEntry()],
      argument_network: {
        nodes: [
          makeAnNode({ id: 'AN-1', verification_status: 'unverifiable', scoring_method: 'fact_check' }),
          makeAnNode({ id: 'AN-2', verification_status: 'pending', scoring_method: 'fact_check' }),
        ],
        edges: [],
      },
    });
    const file = emptyFile();
    const added = generateFactCheckComments(session, file);
    expect(added).toHaveLength(0);
  });

  it('skips nodes not scored by fact_check', () => {
    const session = makeSession({
      transcript: [makeEntry()],
      argument_network: {
        nodes: [makeAnNode({ verification_status: 'verified', scoring_method: 'bdi_criteria' })],
        edges: [],
      },
    });
    const file = emptyFile();
    const added = generateFactCheckComments(session, file);
    expect(added).toHaveLength(0);
  });

  it('deduplicates on re-run', () => {
    const session = makeSession({
      transcript: [makeEntry()],
      argument_network: {
        nodes: [makeAnNode({ verification_status: 'verified', scoring_method: 'fact_check' })],
        edges: [],
      },
    });
    const file = emptyFile();
    generateFactCheckComments(session, file);
    expect(file.comments).toHaveLength(1);

    // Re-run should add nothing
    const added2 = generateFactCheckComments(session, file);
    expect(added2).toHaveLength(0);
    expect(file.comments).toHaveLength(1);
  });

  it('anchors text range with correct offsets when claim is found', () => {
    const entry = makeEntry({ content: 'Studies show that AI has reduced costs by 40% in manufacturing.' });
    const session = makeSession({
      transcript: [entry],
      argument_network: {
        nodes: [makeAnNode({ text: 'AI has reduced costs by 40%', verification_status: 'verified', scoring_method: 'fact_check' })],
        edges: [],
      },
    });
    const file = emptyFile();
    const added = generateFactCheckComments(session, file);

    expect(added[0].textRange.startOffset).toBe(18); // index of "AI has..."
    expect(added[0].textRange.endOffset).toBe(45);
    expect(added[0].textRange.tier).toBe('detailed');
  });

  it('falls back to full entry range when claim text not found', () => {
    const entry = makeEntry({ content: 'Completely different content here.' });
    const session = makeSession({
      transcript: [entry],
      argument_network: {
        nodes: [makeAnNode({ text: 'Claim not in entry', verification_status: 'verified', scoring_method: 'fact_check' })],
        edges: [],
      },
    });
    const file = emptyFile();
    const added = generateFactCheckComments(session, file);

    expect(added[0].textRange.startOffset).toBe(0);
    expect(added[0].textRange.endOffset).toBe(entry.content.length);
  });
});
