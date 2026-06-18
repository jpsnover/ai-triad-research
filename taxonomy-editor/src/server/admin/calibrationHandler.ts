// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Calibration ReviewDomainHandler (t/647) for the unified admin review panel.
 *
 * Surfaces per-user calibration contributions awaiting curation across all three
 * file types (t/621#2):
 *   - calibration-log.jsonl   (debate metrics, keyed by debate_id)
 *   - extraction-metrics.jsonl (keyed by debate_id)
 *   - lineage-enrichments.json (topic-keyed map)
 *
 * One ReviewItem == one user's pending calibration submissions (a "review group").
 * Item ids within a group are qualified `${kind}::${key}` so executeAction can
 * route each entry to the right file — the two JSONL kinds can share a debate_id.
 */

import {
  listPendingCalibration,
  listPendingLineageEnrichments,
  promoteCalibrationEntries,
  rejectCalibrationEntries,
  promoteLineageEnrichments,
  rejectLineageEnrichments,
  readCoreCalibrationEntries,
  readCoreLineageEnrichmentsMap,
  readUserLineageEnrichmentsMap,
  type CalibrationKind,
} from '../fileIO.js';
import { getStorageUserId } from '../userContext.js';
import type { ReviewAction, ReviewDomainHandler, ReviewItem } from './types.js';

const DOMAIN = 'calibration';
const JSONL_KINDS: CalibrationKind[] = ['calibration-log', 'extraction-metrics'];
const ALL_KINDS = [...JSONL_KINDS, 'lineage-enrichments'] as const;
type Kind = (typeof ALL_KINDS)[number];

const ITEM_SEP = '::';
const groupId = (origin: string) => `${DOMAIN}:${origin}`;
const itemId = (kind: Kind, key: string) => `${kind}${ITEM_SEP}${key}`;

/** `calibration:{origin}` → origin. Falls back to the whole string if unprefixed. */
function originFromGroupId(id: string): string {
  const prefix = `${DOMAIN}:`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

/** `${kind}::${key}` → [kind, key]; null when the kind is unknown. */
function parseItemId(id: string): [Kind, string] | null {
  const i = id.indexOf(ITEM_SEP);
  if (i < 0) return null;
  const kind = id.slice(0, i);
  if (!(ALL_KINDS as readonly string[]).includes(kind)) return null;
  return [kind as Kind, id.slice(i + ITEM_SEP.length)];
}

type Entry = { debate_id: string; [k: string]: unknown };

/** Best-effort timestamp from an entry, for newest-first ordering. */
function entryTime(e: Entry): string {
  return (e.timestamp ?? e.at ?? e.created_at ?? '') as string;
}

/** Average each numeric top-level field across entries (comparison context). */
function numericAverages(entries: Entry[]): Record<string, number> {
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const e of entries) {
    for (const [k, v] of Object.entries(e)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        sums[k] = (sums[k] ?? 0) + v;
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
  }
  const avg: Record<string, number> = {};
  for (const k of Object.keys(sums)) avg[k] = sums[k] / counts[k];
  return avg;
}

interface PerOrigin {
  origin: string;
  jsonl: Record<CalibrationKind, Entry[]>;
  lineageKeys: string[];
}

/** Collect pending submissions per user across all kinds. */
async function collectPending(filterOrigin?: string): Promise<Map<string, PerOrigin>> {
  const [cal, ext, lin] = await Promise.all([
    listPendingCalibration('calibration-log'),
    listPendingCalibration('extraction-metrics'),
    listPendingLineageEnrichments(),
  ]);

  const map = new Map<string, PerOrigin>();
  const ensure = (origin: string): PerOrigin => {
    let p = map.get(origin);
    if (!p) {
      p = { origin, jsonl: { 'calibration-log': [], 'extraction-metrics': [] }, lineageKeys: [] };
      map.set(origin, p);
    }
    return p;
  };

  for (const g of cal) if (!filterOrigin || g.origin === filterOrigin) ensure(g.origin).jsonl['calibration-log'] = g.entries as Entry[];
  for (const g of ext) if (!filterOrigin || g.origin === filterOrigin) ensure(g.origin).jsonl['extraction-metrics'] = g.entries as Entry[];
  for (const g of lin) if (!filterOrigin || g.origin === filterOrigin) ensure(g.origin).lineageKeys = g.keys;
  return map;
}

function summarize(p: PerOrigin): { itemCount: number; summary: string; submittedAt: string } {
  const calN = p.jsonl['calibration-log'].length;
  const extN = p.jsonl['extraction-metrics'].length;
  const linN = p.lineageKeys.length;
  const parts: string[] = [];
  if (calN) parts.push(`${calN} debate metric${calN === 1 ? '' : 's'}`);
  if (extN) parts.push(`${extN} extraction metric${extN === 1 ? '' : 's'}`);
  if (linN) parts.push(`${linN} enrichment${linN === 1 ? '' : 's'}`);
  const times = [...p.jsonl['calibration-log'], ...p.jsonl['extraction-metrics']].map(entryTime).filter(Boolean);
  const submittedAt = times.length ? times.reduce((a, b) => (a > b ? a : b)) : '';
  return { itemCount: calN + extN + linN, summary: parts.join(', ') || 'no pending items', submittedAt };
}

export const calibrationReviewHandler: ReviewDomainHandler = {
  domain: DOMAIN,

  async getPendingItems(userId?: string): Promise<ReviewItem[]> {
    const pending = await collectPending(userId);
    const items: ReviewItem[] = [];
    for (const p of pending.values()) {
      const { itemCount, summary, submittedAt } = summarize(p);
      if (itemCount === 0) continue;
      items.push({
        id: groupId(p.origin),
        domain: DOMAIN,
        submitter: p.origin,
        submitterDisplay: p.origin,
        submittedAt,
        summary,
        itemCount,
        status: 'pending',
      });
    }
    items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return items;
  },

  async getDetailForViewer(id: string): Promise<unknown> {
    const origin = originFromGroupId(id);
    const [pending, coreCal, coreExt, coreLineage] = await Promise.all([
      collectPending(origin),
      readCoreCalibrationEntries('calibration-log'),
      readCoreCalibrationEntries('extraction-metrics'),
      readCoreLineageEnrichmentsMap(),
    ]);
    const p = pending.get(origin) ?? { origin, jsonl: { 'calibration-log': [], 'extraction-metrics': [] }, lineageKeys: [] };

    const jsonlDetail = (kind: CalibrationKind, core: Entry[]) => ({
      coreAverages: numericAverages(core),
      coreCount: core.length,
      entries: p.jsonl[kind].map(e => ({ itemId: itemId(kind, e.debate_id), entry: e })),
    });

    // For lineage we need each pending key's user value + any existing core value.
    const userLineage = await readUserLineageEnrichmentsMap(origin);
    return {
      domain: DOMAIN,
      origin,
      source: `users/${origin}`,
      calibrationLog: jsonlDetail('calibration-log', coreCal as Entry[]),
      extractionMetrics: jsonlDetail('extraction-metrics', coreExt as Entry[]),
      lineageEnrichments: {
        entries: p.lineageKeys.map(key => ({
          itemId: itemId('lineage-enrichments', key),
          key,
          value: userLineage[key],
          coreValue: coreLineage[key.toLowerCase()] ?? null,
        })),
      },
    };
  },

  async executeAction(action: ReviewAction): Promise<void> {
    const origin = originFromGroupId(action.groupId);
    const source = `users/${origin}`;
    const by = getStorageUserId();

    // Bucket item ids (and any edits) by kind.
    const keysByKind = new Map<Kind, string[]>();
    const editsByKind = new Map<Kind, Record<string, Record<string, unknown>>>();
    for (const raw of action.itemIds) {
      const parsed = parseItemId(raw);
      if (!parsed) continue;
      const [kind, key] = parsed;
      (keysByKind.get(kind) ?? keysByKind.set(kind, []).get(kind)!).push(key);
      const patch = action.edits?.[raw];
      if (patch && typeof patch === 'object') {
        const bucket = editsByKind.get(kind) ?? editsByKind.set(kind, {}).get(kind)!;
        bucket[key] = patch as Record<string, unknown>;
      }
    }

    for (const [kind, keys] of keysByKind) {
      if (action.action === 'promote') {
        if (kind === 'lineage-enrichments') {
          await promoteLineageEnrichments(source, keys, by, action.notes, editsByKind.get(kind));
        } else {
          await promoteCalibrationEntries(source, keys, by, action.notes, editsByKind.get(kind), kind);
        }
      } else {
        const reason = action.reason ?? '';
        if (kind === 'lineage-enrichments') {
          await rejectLineageEnrichments(source, keys, by, reason);
        } else {
          await rejectCalibrationEntries(source, keys, by, reason, kind);
        }
      }
    }
  },
};
