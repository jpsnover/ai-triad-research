// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { stampNodeAuthorship } from '../../server/storage/editMeta.js';

/**
 * Regression test for t/781: the Electron `save-taxonomy-file` IPC handler must
 * stamp `_edit_meta` / `_edit_history` before writing, mirroring the web
 * server's `PUT /api/taxonomy/:pov`. Previously the desktop save path wrote raw
 * data and recorded no history, so the History tab always showed "No edit
 * history available".
 *
 * The IPC handler itself can't be unit-tested in vitest because `main/fileIO.ts`
 * imports Electron's `app` at module load. This test reproduces the handler's
 * read -> stamp -> write -> reload composition against a temp file, and — unlike
 * `server/__tests__/editMeta.test.ts`, which mocks `userContext` to a fake user —
 * deliberately leaves `userContext` unmocked so it exercises the real `_local`
 * fallback that desktop mode relies on (no per-request user context).
 */

interface TaxNode { id: string; [k: string]: unknown }

// Mirrors the stamping composition in ipcHandlers.ts → 'save-taxonomy-file'.
// Accepts either { nodes: [...] } or a bare nodes array.
function saveWithStamp(filePath: string, data: { nodes?: TaxNode[] } | TaxNode[]): void {
  const incoming = data as { nodes?: TaxNode[] };
  const newNodes: TaxNode[] | null = Array.isArray(incoming.nodes)
    ? incoming.nodes
    : Array.isArray(data) ? (data as TaxNode[]) : null;
  let toWrite: unknown = data;
  if (newNodes) {
    let oldNodes: unknown[] = [];
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { nodes?: unknown[] } | unknown[];
      oldNodes = Array.isArray(existing) ? existing : ((existing as { nodes?: unknown[] })?.nodes ?? []);
    } catch { /* missing file on first write — stamp against an empty baseline */ }
    const stamped = stampNodeAuthorship(
      oldNodes as Parameters<typeof stampNodeAuthorship>[0],
      newNodes as Parameters<typeof stampNodeAuthorship>[1],
    ) as TaxNode[];
    // Preserve on-disk metadata for nodes the stamp left untouched (t/828).
    const oldById = new Map((oldNodes as TaxNode[]).map((n) => [n.id, n]));
    for (const node of stamped) {
      const old = oldById.get(node.id);
      if (!old) continue;
      if (node._edit_meta === undefined && old._edit_meta !== undefined) node._edit_meta = old._edit_meta;
      if (node._edit_history === undefined && old._edit_history !== undefined) node._edit_history = old._edit_history;
    }
    if (Array.isArray(incoming.nodes)) {
      incoming.nodes = stamped;
    } else {
      toWrite = stamped;
    }
  }
  fs.writeFileSync(filePath, JSON.stringify(toWrite, null, 2));
}

describe('Electron save path stamps node edit history (t/781)', () => {
  it('records _edit_meta and _edit_history on edit, attributed to _local, and survives reload', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tax-hist-'));
    const file = path.join(dir, 'accelerationist.json');
    try {
      // Seed an existing taxonomy file with one node and no prior history.
      fs.writeFileSync(file, JSON.stringify({ nodes: [{ id: 'acc-belief-001', label: 'Original' }] }, null, 2));

      // Edit the node's label and save through the stamping composition.
      saveWithStamp(file, { nodes: [{ id: 'acc-belief-001', label: 'Edited label' }] });

      // Reload from disk — the History tab reads exactly this persisted shape.
      const reloaded = JSON.parse(fs.readFileSync(file, 'utf-8')) as { nodes: Array<Record<string, unknown>> };
      const node = reloaded.nodes[0];
      const meta = node._edit_meta as { last_edited_by?: string; last_edited_at?: string };
      const history = node._edit_history as Array<{ user: string; timestamp: string; fields_changed: string[] }>;

      // AC1: _edit_meta with last_edited_by / last_edited_at.
      expect(meta).toBeDefined();
      expect(meta.last_edited_by).toBe('_local');
      expect(typeof meta.last_edited_at).toBe('string');

      // AC2 + AC5: history entry with timestamp and changed fields, persisted across reload.
      expect(Array.isArray(history)).toBe(true);
      expect(history).toHaveLength(1);
      expect(history[0].user).toBe('_local');
      expect(typeof history[0].timestamp).toBe('string');
      expect(history[0].fields_changed).toContain('label');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC4: does not crash when the file does not exist yet (first write, empty baseline)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tax-hist-'));
    const file = path.join(dir, 'skeptic.json');
    try {
      // No existing file — simulates a brand-new taxonomy file on first edit.
      saveWithStamp(file, { nodes: [{ id: 'skp-belief-001', label: 'Brand new' }] });

      const reloaded = JSON.parse(fs.readFileSync(file, 'utf-8')) as { nodes: Array<Record<string, unknown>> };
      const node = reloaded.nodes[0];
      const meta = node._edit_meta as { created_by?: string };
      const history = node._edit_history as Array<{ fields_changed: string[] }>;

      expect(meta.created_by).toBe('_local');
      expect(history[0].fields_changed).toEqual(['*']); // new node → wildcard
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('t/828: preserves edit history across repeated saves (renderer payload lacks the on-disk stamps)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tax-hist-'));
    const file = path.join(dir, 'accelerationist.json');
    try {
      // Existing file, one node, no prior history.
      fs.writeFileSync(file, JSON.stringify({ nodes: [{ id: 'acc-beliefs-028', label: 'Original' }] }, null, 2));

      // The renderer's in-memory copy never receives the stamps the handler writes,
      // so every save sends the same edited content WITHOUT _edit_history. A debate
      // reflection edit triggers several sequential saves of the same file.
      const editedPayload = () => ({ nodes: [{ id: 'acc-beliefs-028', label: 'Edited via reflection' }] });

      saveWithStamp(file, editedPayload()); // save 1 — records history
      saveWithStamp(file, editedPayload()); // save 2 — must NOT strip it
      saveWithStamp(file, editedPayload()); // save 3
      saveWithStamp(file, editedPayload()); // save 4 (matches the 4-save flight-recorder evidence)

      const reloaded = JSON.parse(fs.readFileSync(file, 'utf-8')) as { nodes: Array<Record<string, unknown>> };
      const node = reloaded.nodes[0];
      const meta = node._edit_meta as { last_edited_by?: string } | undefined;
      const history = node._edit_history as Array<{ user: string }> | undefined;

      // The bug stripped these to undefined on save 2+. They must survive all saves.
      expect(meta?.last_edited_by).toBe('_local');
      expect(Array.isArray(history)).toBe(true);
      expect(history!.length).toBeGreaterThanOrEqual(1);
      expect(history![0].user).toBe('_local');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stamps history when the renderer sends a bare nodes array (not wrapped in { nodes })', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tax-hist-'));
    const file = path.join(dir, 'cross_cutting.json');
    try {
      // Seed an existing file in the same bare-array shape with no prior history.
      fs.writeFileSync(file, JSON.stringify([{ id: 'cc-001', label: 'Original' }], null, 2));

      // Renderer sends a bare array (no { nodes } wrapper).
      saveWithStamp(file, [{ id: 'cc-001', label: 'Edited label' }]);

      // Persisted shape stays a bare array, and the node carries stamped history.
      const reloaded = JSON.parse(fs.readFileSync(file, 'utf-8')) as Array<Record<string, unknown>>;
      expect(Array.isArray(reloaded)).toBe(true);
      const node = reloaded[0];
      const meta = node._edit_meta as { last_edited_by?: string };
      const history = node._edit_history as Array<{ user: string; fields_changed: string[] }>;

      expect(meta.last_edited_by).toBe('_local');
      expect(history).toHaveLength(1);
      expect(history[0].fields_changed).toContain('label');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
