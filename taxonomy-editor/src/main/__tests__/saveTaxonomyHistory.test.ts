// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { stampNodeAuthorship } from '../../server/editMeta.js';

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
function saveWithStamp(filePath: string, data: { nodes?: TaxNode[] }): void {
  if (data.nodes && Array.isArray(data.nodes)) {
    let oldNodes: unknown[] = [];
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { nodes?: unknown[] };
      oldNodes = existing?.nodes ?? [];
    } catch { /* missing file on first write — stamp against an empty baseline */ }
    data.nodes = stampNodeAuthorship(
      oldNodes as Parameters<typeof stampNodeAuthorship>[0],
      data.nodes as Parameters<typeof stampNodeAuthorship>[1],
    ) as TaxNode[];
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
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
});
