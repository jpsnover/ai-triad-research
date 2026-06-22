// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { createHash } from 'crypto';
import { getCurrentUserId } from './userContext.js';

interface NodeEditMeta {
  last_edited_by: string;
  last_edited_at: string;
  created_by?: string;
  created_at?: string;
}

interface NodeWithMeta {
  id: string;
  _edit_meta?: NodeEditMeta;
  [key: string]: unknown;
}

interface NodesById { [id: string]: NodeWithMeta }

interface NodeDiffResult {
  added: string[];
  modified: string[];
  deleted: string[];
}

interface EditHistoryEntry {
  user: string;
  timestamp: string;
  fields_changed: string[];
  summary?: string;
}

const MAX_HISTORY_ENTRIES = 50;

const HASH_EXCLUDE = new Set(['_edit_meta', '_edit_history', 'confidence_history', 'priority_history', 'concession_history']);

export function nodeContentHash(node: NodeWithMeta): string {
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (!HASH_EXCLUDE.has(k)) filtered[k] = v;
  }
  return createHash('sha256')
    .update(JSON.stringify(filtered, Object.keys(filtered).sort()))
    .digest('hex')
    .slice(0, 16);
}

export function diffNodes(oldNodes: NodeWithMeta[], newNodes: NodeWithMeta[]): NodeDiffResult {
  const oldMap: NodesById = {};
  for (const n of oldNodes) oldMap[n.id] = n;

  const newMap: NodesById = {};
  for (const n of newNodes) newMap[n.id] = n;

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const id of Object.keys(newMap)) {
    if (!oldMap[id]) {
      added.push(id);
    } else if (nodeContentHash(oldMap[id]) !== nodeContentHash(newMap[id])) {
      modified.push(id);
    }
  }

  for (const id of Object.keys(oldMap)) {
    if (!newMap[id]) deleted.push(id);
  }

  return { added, modified, deleted };
}

export function changedFields(oldNode: NodeWithMeta, newNode: NodeWithMeta): string[] {
  const fields: string[] = [];
  const allKeys = new Set([...Object.keys(oldNode), ...Object.keys(newNode)]);
  for (const k of allKeys) {
    if (HASH_EXCLUDE.has(k)) continue;
    if (JSON.stringify(oldNode[k]) !== JSON.stringify(newNode[k])) {
      fields.push(k);
    }
  }
  return fields.sort();
}

export function stampNodeAuthorship(
  oldNodes: NodeWithMeta[],
  newNodes: NodeWithMeta[],
  userId?: string,
): NodeWithMeta[] {
  const user = userId ?? getCurrentUserId();
  const now = new Date().toISOString();

  const oldMap: NodesById = {};
  for (const n of oldNodes) oldMap[n.id] = n;

  const { added, modified } = diffNodes(oldNodes, newNodes);
  const changedIds = new Set([...added, ...modified]);

  return newNodes.map(node => {
    if (!changedIds.has(node.id)) {
      // Unchanged node: carry forward prior authorship metadata. If the incoming
      // payload dropped _edit_meta/_edit_history (the client didn't round-trip the
      // stamps), restore them from disk so a re-save can't strip history a prior
      // save recorded (t/828 root cause; the web PUT /api/taxonomy/:pov path had
      // the same latent bug). Metadata is excluded from the content diff, so the
      // node is genuinely unchanged — this only restores stamps, never content.
      const old = oldMap[node.id];
      if (!old) return node;
      if (node._edit_meta !== undefined && node._edit_history !== undefined) return node;
      const restored: NodeWithMeta = { ...node };
      if (restored._edit_meta === undefined && old._edit_meta !== undefined) {
        restored._edit_meta = old._edit_meta;
      }
      if (restored._edit_history === undefined && old._edit_history !== undefined) {
        restored._edit_history = old._edit_history;
      }
      return restored;
    }

    const existing = oldMap[node.id]?._edit_meta;
    const isNew = added.includes(node.id);

    const meta: NodeEditMeta = {
      last_edited_by: user,
      last_edited_at: now,
      created_by: isNew ? user : (existing?.created_by ?? user),
      created_at: isNew ? now : (existing?.created_at ?? now),
    };

    const fields = isNew ? ['*'] : changedFields(oldMap[node.id], node);
    const historyEntry: EditHistoryEntry = {
      user,
      timestamp: now,
      fields_changed: fields,
    };
    const prevHistory = (node._edit_history as EditHistoryEntry[] | undefined) ?? (oldMap[node.id]?._edit_history as EditHistoryEntry[] | undefined) ?? [];
    const newHistory = [...prevHistory, historyEntry].slice(-MAX_HISTORY_ENTRIES);

    return { ...node, _edit_meta: meta, _edit_history: newHistory };
  });
}
