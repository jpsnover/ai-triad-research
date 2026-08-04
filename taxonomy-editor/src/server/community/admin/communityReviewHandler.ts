// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Community ReviewDomainHandler (t/650, server portion) for the unified admin
 * review panel. A thin adapter over the existing community submission flow in
 * community.ts — no new publishing/sanitization logic lives here.
 *
 * Each pending submission (one chat or one debate) is an atomic review item, so
 * one ReviewItem == one submission. Item ids are the raw submission ids.
 */

import { listSubmissions, approveSubmission, rejectSubmission } from '../community.js';
import { SENSITIVE_KEYS } from '../../../../../lib/sanitize/stripSensitiveKeys.js';
import type { ReviewAction, ReviewDomainHandler, ReviewItem } from './types.js';

const DOMAIN = 'community';
const GROUP_PREFIX = `${DOMAIN}:`;

/** Structural view of a community submission (the interface is private to community.ts). */
interface Submission {
  id: string;
  type: 'chat' | 'debate';
  submittedBy: string;
  submittedAt: string;
  status: string;
  note?: string;
  data: unknown;
}

/** Accept either a raw submission id or a `community:{id}` group id. */
function submissionId(idOrGroupId: string): string {
  return idOrGroupId.startsWith(GROUP_PREFIX) ? idOrGroupId.slice(GROUP_PREFIX.length) : idOrGroupId;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function extractString(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    for (const key of ['final', 'refined', 'original']) {
      if (typeof obj[key] === 'string') return obj[key];
    }
  }
  return '';
}

function titleOf(data: unknown): string {
  const d = asRecord(data);
  return extractString(d.title) || extractString(d.topic) || '(untitled)';
}

// t/2071: the sensitive-key set is the shared lib/sanitize source of truth (imported
// above) — scanSensitive() previews which of THOSE keys appear, so the admin "what
// will be stripped" view can never drift from what community.ts actually strips.

/** Which sensitive keys actually appear anywhere in the submission data. */
function scanSensitive(obj: unknown, found = new Set<string>()): Set<string> {
  if (!obj || typeof obj !== 'object') return found;
  if (Array.isArray(obj)) { for (const v of obj) scanSensitive(v, found); return found; }
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k)) found.add(k);
    scanSensitive(v, found);
  }
  return found;
}

/** Turn-bearing array across chat/debate shapes (debates use `transcript`). */
function turnsOf(d: Record<string, unknown>): unknown[] {
  const turns = d.transcript ?? d.messages ?? d.turns ?? d.rounds ?? [];
  return Array.isArray(turns) ? turns : [];
}

/** Best-effort flat-text preview + turn count from common chat/debate shapes. */
function buildPreview(data: unknown): { preview: string; turnCount: number } {
  const d = asRecord(data);
  const turns = turnsOf(d);
  const text = turns.length
    ? turns.map(t => {
        const r = asRecord(t);
        return String(r.content ?? r.text ?? r.message ?? '');
      }).filter(Boolean).join('\n')
    : JSON.stringify(d);
  return { preview: text.slice(0, 500), turnCount: turns.length };
}

interface TranscriptEntry { speaker: string; content: string; type: string; }

/** Structured transcript preview (first `limit` turns) for the review viewer. */
function buildTranscriptPreview(data: unknown, limit = 12): TranscriptEntry[] {
  return turnsOf(asRecord(data)).slice(0, limit).map(t => {
    const r = asRecord(t);
    return {
      speaker: String(r.speaker ?? r.character ?? r.role ?? r.pov ?? r.author ?? ''),
      content: String(r.content ?? r.text ?? r.message ?? '').slice(0, 600),
      type: String(r.type ?? r.phase ?? r.kind ?? ''),
    };
  }).filter(e => e.content);
}

/** Coerce a value into a string[] — accepts string elements or {pov|id|name} objects. */
function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map(x => typeof x === 'string' ? x : String(asRecord(x).pov ?? asRecord(x).id ?? asRecord(x).name ?? ''))
    .filter(Boolean);
}

/** Active POVers from `activePovers` / `active_povers`, falling back to `characters`. */
function activePoversOf(d: Record<string, unknown>): string[] {
  const direct = toStringArray(d.activePovers ?? d.active_povers);
  return direct.length ? direct : toStringArray(d.characters);
}

async function findPendingSubmission(id: string): Promise<Submission | null> {
  const all = await listSubmissions() as Submission[];
  return all.find(s => s.id === id) ?? null;
}

export const communityReviewHandler: ReviewDomainHandler = {
  domain: DOMAIN,

  async getPendingItems(userId?: string): Promise<ReviewItem[]> {
    const pending = (await listSubmissions('pending')) as Submission[];
    return pending
      .filter(s => !userId || s.submittedBy === userId)
      .map(s => ({
        id: `${GROUP_PREFIX}${s.id}`,
        domain: DOMAIN,
        submitter: s.submittedBy,
        submitterDisplay: s.submittedBy,
        submittedAt: s.submittedAt,
        summary: `1 ${s.type}: ${titleOf(s.data)}`,
        itemCount: 1,
        status: 'pending' as const,
      }))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  },

  async getDetailForViewer(groupId: string): Promise<unknown> {
    const id = submissionId(groupId);
    const sub = await findPendingSubmission(id);
    if (!sub) return { domain: DOMAIN, submissionId: id, found: false };

    const d = asRecord(sub.data);
    const { preview, turnCount } = buildPreview(sub.data);
    return {
      domain: DOMAIN,
      submissionId: sub.id,
      itemId: sub.id,
      type: sub.type,
      submitter: sub.submittedBy,
      submittedAt: sub.submittedAt,
      note: sub.note ?? null,
      title: titleOf(sub.data),
      topic: extractString(d.topic) || null,
      preview,
      transcriptPreview: buildTranscriptPreview(sub.data),
      metadata: {
        model: (d.model as string) ?? null,
        turnCount,
        phase: (d.phase as string) ?? null,
        audience: (d.audience as string) ?? null,
        activePovers: activePoversOf(d),
        taxonomyRefs: (d.taxonomy_refs ?? d.taxonomyRefs ?? []) as unknown,
      },
      sanitization: {
        // What community.ts → sanitizeForCommunity will do on promote.
        willStrip: [...scanSensitive(sub.data)],
        willAdd: ['community_metadata (attribution)', 'regenerated id'],
      },
    };
  },

  async executeAction(action: ReviewAction): Promise<void> {
    for (const raw of action.itemIds) {
      const id = submissionId(raw);
      if (action.action === 'promote') {
        // Edit-on-promote: edits keyed by the item id (raw or prefixed) — title /
        // description overrides merged onto the published copy (t/650 AC#4).
        const edits = action.edits?.[raw] ?? action.edits?.[id];
        await approveSubmission(id, edits && typeof edits === 'object' ? edits as Record<string, unknown> : undefined);
      } else {
        await rejectSubmission(id, action.reason); // reason persisted (t/650 AC#6)
      }
    }
  },
};
