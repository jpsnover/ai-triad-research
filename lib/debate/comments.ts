// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Comment data model for debate transcript annotations.
 * Types, Zod schemas, and CRUD helpers for managing comments
 * stored in a sidecar JSON file alongside debate data.
 */

import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { DebateSession, ArgumentNetworkNode, TranscriptEntry } from './types.js';

// ── Types & Enums ─────────────────────────────────────────

export const COMMENT_TYPES = [
  'research',
  'agree',
  'disagree',
  'changed_opinion',
  'question',
  'follow_up',
  'factual_error',
  'insight',
  'fact_supported',
  'fact_not_supported',
] as const;

export type CommentType = typeof COMMENT_TYPES[number];

export type CommentSource = 'human' | 'auto';

export type DetailTier = 'brief' | 'medium' | 'detailed';

export interface TextRange {
  entryId: string;
  tier: DetailTier;
  startOffset: number;
  endOffset: number;
  selectedText: string;
}

export interface CommentReply {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  debateId: string;
  type: CommentType;
  source: CommentSource;
  author: string;
  textRange: TextRange;
  body: string;
  replies: CommentReply[];
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommentsFile {
  _schema_version: '1';
  debateId: string;
  comments: Comment[];
}

// ── Zod Schemas ───────────────────────────────────────────

export const CommentTypeSchema = z.enum([...COMMENT_TYPES]);

export const CommentSourceSchema = z.enum(['human', 'auto']);

export const DetailTierSchema = z.enum(['brief', 'medium', 'detailed']);

export const TextRangeSchema = z.object({
  entryId: z.string().min(1),
  tier: DetailTierSchema,
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  selectedText: z.string().min(1),
}).refine(d => d.endOffset > d.startOffset, {
  message: 'endOffset must be greater than startOffset',
});

export const CommentReplySchema = z.object({
  id: z.string().min(1),
  author: z.string().min(1),
  body: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const CommentSchema = z.object({
  id: z.string().min(1),
  debateId: z.string().min(1),
  type: CommentTypeSchema,
  source: CommentSourceSchema,
  author: z.string().min(1),
  textRange: TextRangeSchema,
  body: z.string().min(1),
  replies: z.array(CommentReplySchema),
  resolved: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const CommentsFileSchema = z.object({
  _schema_version: z.literal('1'),
  debateId: z.string().min(1),
  comments: z.array(CommentSchema),
});

// ── Storage Helpers ───────────────────────────────────────

function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

/** Resolve the comments file path for a given debate file path. */
export function commentsPathForDebate(debatePath: string): string {
  const dir = path.dirname(debatePath);
  const base = path.basename(debatePath, path.extname(debatePath));
  return path.join(dir, `${base}-comments.json`);
}

/** Read comments file from disk. Returns empty container if file doesn't exist. */
export function loadComments(commentsPath: string, debateId: string): CommentsFile {
  if (!fs.existsSync(commentsPath)) {
    return { _schema_version: '1', debateId, comments: [] };
  }
  const raw = fs.readFileSync(commentsPath, 'utf-8');
  const data = JSON.parse(raw);
  return CommentsFileSchema.parse(data);
}

/** Write comments file to disk with atomic save (write-to-temp then rename). */
export function saveComments(commentsPath: string, file: CommentsFile): void {
  const json = JSON.stringify(file, null, 2);
  const tmpPath = commentsPath + '.tmp';
  fs.writeFileSync(tmpPath, json, 'utf-8');
  fs.renameSync(tmpPath, commentsPath);
}

// ── CRUD Operations ───────────────────────────────────────

export interface AddCommentInput {
  debateId: string;
  type: CommentType;
  source: CommentSource;
  author: string;
  textRange: TextRange;
  body: string;
}

export function addComment(file: CommentsFile, input: AddCommentInput): Comment {
  const timestamp = now();
  const comment: Comment = {
    id: generateId(),
    debateId: input.debateId,
    type: input.type,
    source: input.source,
    author: input.author,
    textRange: input.textRange,
    body: input.body,
    replies: [],
    resolved: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  file.comments.push(comment);
  return comment;
}

export interface UpdateCommentInput {
  type?: CommentType;
  body?: string;
  resolved?: boolean;
}

export function updateComment(file: CommentsFile, commentId: string, input: UpdateCommentInput): Comment {
  const comment = file.comments.find(c => c.id === commentId);
  if (!comment) throw new Error(`Comment not found: ${commentId}`);
  if (input.type !== undefined) comment.type = input.type;
  if (input.body !== undefined) comment.body = input.body;
  if (input.resolved !== undefined) comment.resolved = input.resolved;
  comment.updatedAt = now();
  return comment;
}

export function deleteComment(file: CommentsFile, commentId: string): void {
  const idx = file.comments.findIndex(c => c.id === commentId);
  if (idx === -1) throw new Error(`Comment not found: ${commentId}`);
  file.comments.splice(idx, 1);
}

export function resolveComment(file: CommentsFile, commentId: string): Comment {
  return updateComment(file, commentId, { resolved: true });
}

export interface AddReplyInput {
  author: string;
  body: string;
}

export function addReply(file: CommentsFile, commentId: string, input: AddReplyInput): CommentReply {
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
  return reply;
}

// ── Fact-Check Auto-Comment Generation ────────────────────

function verdictToCommentType(verdict: ArgumentNetworkNode['verification_status']): CommentType | null {
  switch (verdict) {
    case 'verified': return 'fact_supported';
    case 'disputed': return 'fact_not_supported';
    default: return null; // 'unverifiable' and 'pending' don't generate comments
  }
}

function formatFactCheckBody(node: ArgumentNetworkNode): string {
  const verdict = node.verification_status === 'verified' ? 'Supported' : 'Disputed';
  let body = `**Fact Check — ${verdict}**\n\nClaim: "${node.text}"`;
  if (node.verification_evidence) {
    body += `\n\nEvidence: ${node.verification_evidence}`;
  }
  return body;
}

function findClaimInEntry(entry: TranscriptEntry, claimText: string): { startOffset: number; endOffset: number } | null {
  const content = entry.content;
  const idx = content.indexOf(claimText);
  if (idx !== -1) return { startOffset: idx, endOffset: idx + claimText.length };
  // Fallback: try case-insensitive substring match
  const lowerContent = content.toLowerCase();
  const lowerClaim = claimText.toLowerCase();
  const lowerIdx = lowerContent.indexOf(lowerClaim);
  if (lowerIdx !== -1) return { startOffset: lowerIdx, endOffset: lowerIdx + claimText.length };
  return null;
}

/**
 * Generate auto-comments from fact-checked AN nodes in a debate session.
 * Skips nodes with verdict 'unverifiable' or 'pending'.
 * Deduplicates against existing comments by entryId + type + claim text.
 * Returns the newly added comments.
 */
export function generateFactCheckComments(
  session: DebateSession,
  file: CommentsFile,
): Comment[] {
  const nodes = session.argument_network?.nodes ?? [];
  const factChecked = nodes.filter(
    (n): n is ArgumentNetworkNode & { verification_status: 'verified' | 'disputed' } =>
      n.scoring_method === 'fact_check' &&
      (n.verification_status === 'verified' || n.verification_status === 'disputed'),
  );

  const entryMap = new Map(session.transcript.map(e => [e.id, e]));
  const added: Comment[] = [];

  for (const node of factChecked) {
    const commentType = verdictToCommentType(node.verification_status)!;
    const entry = entryMap.get(node.source_entry_id);
    if (!entry) continue;

    // Dedup: skip if an auto comment with same type + entryId + claim text already exists
    const isDuplicate = file.comments.some(
      c => c.source === 'auto' &&
        c.type === commentType &&
        c.textRange.entryId === entry.id &&
        c.textRange.selectedText === node.text,
    );
    if (isDuplicate) continue;

    const offsets = findClaimInEntry(entry, node.text);
    const textRange: TextRange = offsets
      ? { entryId: entry.id, tier: 'detailed', startOffset: offsets.startOffset, endOffset: offsets.endOffset, selectedText: node.text }
      : { entryId: entry.id, tier: 'detailed', startOffset: 0, endOffset: entry.content.length, selectedText: node.text };

    const comment = addComment(file, {
      debateId: session.id,
      type: commentType,
      source: 'auto',
      author: 'Fact Checker',
      textRange,
      body: formatFactCheckBody(node),
    });
    added.push(comment);
  }

  return added;
}
