// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CommentsFile, Comment, TextRange } from '@lib/debate/comments';

// Hoisted mocks — available before vi.mock factories execute
const { mockApi } = vi.hoisted(() => {
  const mockApi = {
    loadDebateComments: vi.fn().mockResolvedValue({ _schema_version: '1', debateId: 'test-debate', comments: [] }),
    saveDebateComments: vi.fn().mockResolvedValue(undefined),
  };
  return { mockApi };
});

vi.mock('@bridge', () => ({ api: mockApi }));

// Mock localStorage
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn((key: string) => { storage.delete(key); }),
  clear: vi.fn(() => { storage.clear(); }),
  length: 0,
  key: vi.fn(),
});

import { useCommentStore } from './useCommentStore';

const testRange: TextRange = {
  entryId: 'entry-1',
  tier: 'detailed',
  startOffset: 0,
  endOffset: 10,
  selectedText: 'test text.',
};

describe('useCommentStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCommentStore.setState({
      commentsFile: null,
      loading: false,
      sidebarOpen: false,
      filters: { types: new Set(), authors: new Set(), searchText: '', showResolved: true },
      focusedCommentId: null,
    });
  });

  describe('loadComments', () => {
    it('loads comments for a debate', async () => {
      const mockFile: CommentsFile = {
        _schema_version: '1',
        debateId: 'debate-1',
        comments: [],
      };
      mockApi.loadDebateComments.mockResolvedValueOnce(mockFile);

      await useCommentStore.getState().loadComments('debate-1');

      expect(mockApi.loadDebateComments).toHaveBeenCalledWith('debate-1');
      expect(useCommentStore.getState().commentsFile).toEqual(mockFile);
      expect(useCommentStore.getState().loading).toBe(false);
    });

    it('creates empty file on error', async () => {
      mockApi.loadDebateComments.mockRejectedValueOnce(new Error('not found'));

      await useCommentStore.getState().loadComments('missing-debate');

      expect(useCommentStore.getState().commentsFile).toEqual({
        _schema_version: '1',
        debateId: 'missing-debate',
        comments: [],
      });
    });
  });

  describe('addComment', () => {
    it('adds a comment and persists', async () => {
      useCommentStore.setState({
        commentsFile: { _schema_version: '1', debateId: 'debate-1', comments: [] },
      });

      const comment = await useCommentStore.getState().addComment({
        type: 'insight',
        author: 'Alice',
        textRange: testRange,
        body: 'Great point!',
      });

      expect(comment.type).toBe('insight');
      expect(comment.author).toBe('Alice');
      expect(comment.body).toBe('Great point!');
      expect(comment.source).toBe('human');
      expect(comment.resolved).toBe(false);
      expect(useCommentStore.getState().commentsFile!.comments).toHaveLength(1);
      expect(mockApi.saveDebateComments).toHaveBeenCalledOnce();
    });
  });

  describe('resolveComment', () => {
    it('marks a comment as resolved', async () => {
      const existing: Comment = {
        id: 'c1',
        debateId: 'debate-1',
        type: 'question',
        source: 'human',
        author: 'Bob',
        textRange: testRange,
        body: 'Why?',
        replies: [],
        resolved: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      useCommentStore.setState({
        commentsFile: { _schema_version: '1', debateId: 'debate-1', comments: [existing] },
      });

      await useCommentStore.getState().resolveComment('c1');

      expect(useCommentStore.getState().commentsFile!.comments[0].resolved).toBe(true);
      expect(mockApi.saveDebateComments).toHaveBeenCalled();
    });
  });

  describe('deleteComment', () => {
    it('removes a comment', async () => {
      const existing: Comment = {
        id: 'c1',
        debateId: 'debate-1',
        type: 'agree',
        source: 'human',
        author: 'Alice',
        textRange: testRange,
        body: 'Agreed',
        replies: [],
        resolved: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      useCommentStore.setState({
        commentsFile: { _schema_version: '1', debateId: 'debate-1', comments: [existing] },
      });

      await useCommentStore.getState().deleteComment('c1');

      expect(useCommentStore.getState().commentsFile!.comments).toHaveLength(0);
      expect(mockApi.saveDebateComments).toHaveBeenCalled();
    });
  });

  describe('addReply', () => {
    it('adds a reply to a comment', async () => {
      const existing: Comment = {
        id: 'c1',
        debateId: 'debate-1',
        type: 'question',
        source: 'human',
        author: 'Bob',
        textRange: testRange,
        body: 'Why?',
        replies: [],
        resolved: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      useCommentStore.setState({
        commentsFile: { _schema_version: '1', debateId: 'debate-1', comments: [existing] },
      });

      const reply = await useCommentStore.getState().addReply('c1', { author: 'Alice', body: 'Because.' });

      expect(reply.author).toBe('Alice');
      expect(reply.body).toBe('Because.');
      expect(useCommentStore.getState().commentsFile!.comments[0].replies).toHaveLength(1);
      expect(mockApi.saveDebateComments).toHaveBeenCalled();
    });
  });

  describe('getCommentsForEntry', () => {
    it('filters comments by entry ID', () => {
      const c1: Comment = {
        id: 'c1', debateId: 'd', type: 'agree', source: 'human', author: 'A',
        textRange: { ...testRange, entryId: 'e1' }, body: 'yes', replies: [], resolved: false,
        createdAt: '', updatedAt: '',
      };
      const c2: Comment = {
        id: 'c2', debateId: 'd', type: 'disagree', source: 'human', author: 'B',
        textRange: { ...testRange, entryId: 'e2' }, body: 'no', replies: [], resolved: false,
        createdAt: '', updatedAt: '',
      };
      useCommentStore.setState({
        commentsFile: { _schema_version: '1', debateId: 'd', comments: [c1, c2] },
      });

      expect(useCommentStore.getState().getCommentsForEntry('e1')).toEqual([c1]);
      expect(useCommentStore.getState().getCommentsForEntry('e2')).toEqual([c2]);
      expect(useCommentStore.getState().getCommentsForEntry('e3')).toEqual([]);
    });
  });

  describe('sidebar', () => {
    it('toggles sidebar state', () => {
      expect(useCommentStore.getState().sidebarOpen).toBe(false);
      useCommentStore.getState().toggleSidebar();
      expect(useCommentStore.getState().sidebarOpen).toBe(true);
      useCommentStore.getState().toggleSidebar();
      expect(useCommentStore.getState().sidebarOpen).toBe(false);
    });
  });
});
