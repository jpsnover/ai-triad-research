// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { createHash } from 'crypto';
import { getCurrentUserId } from './userContext';

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

const HASH_EXCLUDE = new Set(['_edit_meta', 'confidence_history', 'priority_history', 'concession_history']);

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
    if (!changedIds.has(node.id)) return node;

    const existing = oldMap[node.id]?._edit_meta;
    const isNew = added.includes(node.id);

    const meta: NodeEditMeta = {
      last_edited_by: user,
      last_edited_at: now,
      created_by: isNew ? user : (existing?.created_by ?? user),
      created_at: isNew ? now : (existing?.created_at ?? now),
    };

    return { ...node, _edit_meta: meta };
  });
}
