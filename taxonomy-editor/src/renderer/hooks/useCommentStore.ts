// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import { api } from '@bridge';
import type {
  Comment,
  CommentType,
  CommentSource,
  TextRange,
  CommentReply,
  CommentsFile,
} from '@lib/debate/comments';
import { COMMENT_TYPES } from '@lib/debate/comments';

// Re-export for consumers
export { COMMENT_TYPES };
export type { Comment, CommentType, CommentSource, TextRange, CommentReply, CommentsFile };

// ── Comment type metadata ────────────────────────────────

export interface CommentTypeMeta {
  label: string;
  color: string;
  icon: string;
}

export const COMMENT_TYPE_META: Record<CommentType, CommentTypeMeta> = {
  research:          { label: 'Research',          color: '#6366f1', icon: '🔬' },
  agree:             { label: 'Agree',             color: '#22c55e', icon: '✓' },
  disagree:          { label: 'Disagree',          color: '#ef4444', icon: '✗' },
  changed_opinion:   { label: 'Changed Opinion',   color: '#f59e0b', icon: '↻' },
  question:          { label: 'Question',          color: '#3b82f6', icon: '?' },
  follow_up:         { label: 'Follow-Up',         color: '#8b5cf6', icon: '→' },
  factual_error:     { label: 'Factual Error',     color: '#dc2626', icon: '!' },
  insight:           { label: 'Insight',           color: '#14b8a6', icon: '★' },
  fact_supported:    { label: 'Fact Supported',    color: '#16a34a', icon: '✓' },
  fact_not_supported:{ label: 'Fact Not Supported', color: '#b91c1c', icon: '✗' },
};

// ── Helpers ──────────────────────────────────────────────

function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function emptyFile(debateId: string): CommentsFile {
  return { _schema_version: '1', debateId, comments: [] };
}

// ── Store ────────────────────────────────────────────────

export interface CommentFilters {
  types: Set<CommentType>;
  authors: Set<string>;
  searchText: string;
  showResolved: boolean;
}

const DEFAULT_FILTERS: CommentFilters = {
  types: new Set(),
  authors: new Set(),
  searchText: '',
  showResolved: true,
};

interface CommentStore {
  /** Current debate's comments file (null if no debate loaded) */
  commentsFile: CommentsFile | null;
  /** Loading state */
  loading: boolean;
  /** Whether the sidebar panel is visible */
  sidebarOpen: boolean;
  /** Active filters */
  filters: CommentFilters;
  /** Comment ID currently focused for navigation (pulse animation) */
  focusedCommentId: string | null;

  // Lifecycle
  loadComments: (debateId: string) => Promise<void>;
  unloadComments: () => void;

  // CRUD (all auto-save)
  addComment: (input: {
    type: CommentType;
    author: string;
    textRange: TextRange;
    body?: string;
    source?: CommentSource;
  }) => Promise<Comment>;
  updateComment: (commentId: string, input: { type?: CommentType; body?: string }) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  resolveComment: (commentId: string) => Promise<void>;
  unresolveComment: (commentId: string) => Promise<void>;
  addReply: (commentId: string, input: { author: string; body: string }) => Promise<CommentReply>;

  // UI
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  // Filters (t/234)
  setFilterTypes: (types: Set<CommentType>) => void;
  toggleFilterType: (type: CommentType) => void;
  setFilterAuthors: (authors: Set<string>) => void;
  toggleFilterAuthor: (author: string) => void;
  setFilterSearch: (text: string) => void;
  setFilterShowResolved: (show: boolean) => void;
  clearFilters: () => void;
  activeFilterCount: () => number;

  // Navigation (t/235)
  focusComment: (commentId: string) => void;
  clearFocus: () => void;

  // Selectors
  getCommentsForEntry: (entryId: string) => Comment[];
  getFilteredComments: () => Comment[];
  getFilteredCommentsForEntry: (entryId: string) => Comment[];
  getCommentById: (commentId: string) => Comment | undefined;
  getUniqueAuthors: () => string[];
}

export const useCommentStore = create<CommentStore>((set, get) => {
  async function persist(): Promise<void> {
    const file = get().commentsFile;
    if (!file) return;
    await api.saveDebateComments(file.debateId, file);
  }

  function applyFilters(comments: Comment[]): Comment[] {
    const { types, authors, searchText, showResolved } = get().filters;
    let result = comments;
    if (!showResolved) result = result.filter(c => !c.resolved);
    if (types.size > 0) result = result.filter(c => types.has(c.type));
    if (authors.size > 0) result = result.filter(c => authors.has(c.author));
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      result = result.filter(c =>
        c.body.toLowerCase().includes(q)
        || c.textRange.selectedText.toLowerCase().includes(q)
        || c.author.toLowerCase().includes(q),
      );
    }
    return result;
  }

  return {
    commentsFile: null,
    loading: false,
    sidebarOpen: false,
    filters: { ...DEFAULT_FILTERS, types: new Set(), authors: new Set() },
    focusedCommentId: null,

    loadComments: async (debateId: string) => {
      set({ loading: true });
      try {
        const data = await api.loadDebateComments(debateId);
        const file = data as CommentsFile;
        if (!Array.isArray(file.comments)) file.comments = [];
        set({ commentsFile: file, loading: false });
      } catch {
        set({ commentsFile: emptyFile(debateId), loading: false });
      }
    },

    unloadComments: () => {
      set({ commentsFile: null });
    },

    addComment: async (input) => {
      const file = get().commentsFile;
      if (!file) throw new Error('No comments file loaded');
      const timestamp = now();
      const comment: Comment = {
        id: generateId(),
        debateId: file.debateId,
        type: input.type,
        source: input.source ?? 'human',
        author: input.author,
        textRange: input.textRange,
        body: input.body,
        replies: [],
        resolved: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      file.comments.push(comment);
      set({ commentsFile: { ...file } });
      await persist();
      return comment;
    },

    updateComment: async (commentId, input) => {
      const file = get().commentsFile;
      if (!file) return;
      const comment = file.comments.find(c => c.id === commentId);
      if (!comment) return;
      if (input.type !== undefined) comment.type = input.type;
      if (input.body !== undefined) comment.body = input.body;
      comment.updatedAt = now();
      set({ commentsFile: { ...file } });
      await persist();
    },

    deleteComment: async (commentId) => {
      const file = get().commentsFile;
      if (!file) return;
      file.comments = file.comments.filter(c => c.id !== commentId);
      set({ commentsFile: { ...file } });
      await persist();
    },

    resolveComment: async (commentId) => {
      const file = get().commentsFile;
      if (!file) return;
      const comment = file.comments.find(c => c.id === commentId);
      if (!comment) return;
      comment.resolved = true;
      comment.updatedAt = now();
      set({ commentsFile: { ...file } });
      await persist();
    },

    unresolveComment: async (commentId) => {
      const file = get().commentsFile;
      if (!file) return;
      const comment = file.comments.find(c => c.id === commentId);
      if (!comment) return;
      comment.resolved = false;
      comment.updatedAt = now();
      set({ commentsFile: { ...file } });
      await persist();
    },

    addReply: async (commentId, input) => {
      const file = get().commentsFile;
      if (!file) throw new Error('No comments file loaded');
      const comment = file.comments.find(c => c.id === commentId);
      if (!comment) throw new Error(`Comment not found: ${commentId}`);
      const timestamp = now();
      const reply: CommentReply = {
        id: generateId(),
        author: input.author,
        body: input.body,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      comment.replies.push(reply);
      comment.updatedAt = timestamp;
      set({ commentsFile: { ...file } });
      await persist();
      return reply;
    },

    toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),

    // Filters (t/234)
    setFilterTypes: (types) => set(s => ({ filters: { ...s.filters, types } })),
    toggleFilterType: (type) => set(s => {
      const next = new Set(s.filters.types);
      if (next.has(type)) next.delete(type); else next.add(type);
      return { filters: { ...s.filters, types: next } };
    }),
    setFilterAuthors: (authors) => set(s => ({ filters: { ...s.filters, authors } })),
    toggleFilterAuthor: (author) => set(s => {
      const next = new Set(s.filters.authors);
      if (next.has(author)) next.delete(author); else next.add(author);
      return { filters: { ...s.filters, authors: next } };
    }),
    setFilterSearch: (text) => set(s => ({ filters: { ...s.filters, searchText: text } })),
    setFilterShowResolved: (show) => set(s => ({ filters: { ...s.filters, showResolved: show } })),
    clearFilters: () => set({ filters: { ...DEFAULT_FILTERS, types: new Set(), authors: new Set() } }),
    activeFilterCount: () => {
      const { types, authors, searchText, showResolved } = get().filters;
      let count = 0;
      if (types.size > 0) count++;
      if (authors.size > 0) count++;
      if (searchText.trim()) count++;
      if (!showResolved) count++;
      return count;
    },

    // Navigation (t/235)
    focusComment: (commentId) => {
      set({ focusedCommentId: commentId });
      // Auto-clear after animation
      setTimeout(() => {
        if (get().focusedCommentId === commentId) set({ focusedCommentId: null });
      }, 2000);
    },
    clearFocus: () => set({ focusedCommentId: null }),

    // Selectors
    getCommentsForEntry: (entryId) => {
      const file = get().commentsFile;
      if (!file) return [];
      return file.comments.filter(c => c.textRange.entryId === entryId);
    },

    getFilteredComments: () => {
      const file = get().commentsFile;
      if (!file) return [];
      return applyFilters(file.comments);
    },

    getFilteredCommentsForEntry: (entryId) => {
      const file = get().commentsFile;
      if (!file) return [];
      return applyFilters(file.comments.filter(c => c.textRange.entryId === entryId));
    },

    getCommentById: (commentId) => {
      const file = get().commentsFile;
      if (!file) return undefined;
      return file.comments.find(c => c.id === commentId);
    },

    getUniqueAuthors: () => {
      const file = get().commentsFile;
      if (!file) return [];
      return [...new Set(file.comments.map(c => c.author))].sort();
    },
  };
});
