// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Taxonomy graph data handlers (t/1689 split of ipcHandlers.ts, ADR-007).
// Taxonomy files, policy/lineage/conflict/crux reads, dictionary, proposals,
// source-index builders, edges, and synthetic corpus/embeddings. Behavior is
// unchanged — handler bodies are moved verbatim behind the same channel names.

import { ipcMain, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import {
  readTaxonomyFile,
  writeTaxonomyFile,
  readAllConflictFiles,
  readConflictClusters,
  writeConflictFile,
  createConflictFile,
  deleteConflictFile,
  readEdgesFile,
  writeEdgesFile,
  getTaxonomyDirs,
  getActiveTaxonomyDirName,
  setActiveTaxonomyDir,
  buildNodeSourceIndex,
  buildPolicySourceIndex,
  readPolicyRegistry,
  readAggregatedCruxes,
  readLineageCategories,
  readLineageEnrichments,
  loadSyntheticCorpus,
  loadSyntheticEmbeddings,
  updateSyntheticEmbeddings,
  getDataRootPath,
  loadDataConfig,
} from '../fileIO.js';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { renameSyncWithRetry } from '../../../../lib/debate/persistence.js';
import { stampNodeAuthorship } from '../../server/storage/editMeta.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { VALID_POV } from '../ipcSchemas.js';

/**
 * Stamp _edit_meta / _edit_history authorship onto a save's nodes (mirroring the server's
 * PUT /api/taxonomy/:pov), preserving on-disk metadata for nodes this save did NOT change
 * (t/828) and recording the save.stamp observability event. Returns the stamped node list.
 * Extracted verbatim from the save-taxonomy-file handler (t/1914 complexity split).
 */
function stampSaveNodes(pov: string, newNodes: unknown[]): unknown[] {
  let oldNodes: unknown[] = [];
  try {
    const existing = readTaxonomyFile(pov);
    // Existing file may also be either shape — extract nodes from either.
    oldNodes = Array.isArray(existing)
      ? existing
      : ((existing as { nodes?: unknown[] })?.nodes ?? []);
  } catch (err) {
    // Missing file on first write is benign (ENOENT); a corrupt existing file means we
    // can't diff for history — record it but still save against an empty baseline so the
    // edit is never blocked.
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'ipc-save-taxonomy',
      level: 'warn',
      message: 'Could not read existing taxonomy for edit-history diff; stamping against empty baseline',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }
  const stamped = stampNodeAuthorship(
    oldNodes as Parameters<typeof stampNodeAuthorship>[0],
    newNodes as Parameters<typeof stampNodeAuthorship>[1],
  );
  // Preserve on-disk authorship metadata for nodes this save did NOT change (t/828):
  // stampNodeAuthorship only (re)writes _edit_meta/_edit_history for added/modified nodes;
  // unchanged nodes come back verbatim from the payload, which on a desktop re-save lacks
  // the history already on disk — without this the 2nd+ save strips it.
  type NodeMeta = { id: string; _edit_meta?: unknown; _edit_history?: unknown };
  const oldById = new Map((oldNodes as NodeMeta[]).map((n) => [n.id, n]));
  let stampedCount = 0;
  let preservedCount = 0;
  for (const node of stamped as NodeMeta[]) {
    if (node._edit_meta !== undefined) stampedCount++; // stamp wrote metadata (added/modified node)
    const old = oldById.get(node.id);
    if (!old) continue;
    if (node._edit_meta === undefined && old._edit_meta !== undefined) { node._edit_meta = old._edit_meta; preservedCount++; }
    if (node._edit_history === undefined && old._edit_history !== undefined) node._edit_history = old._edit_history;
  }
  // Observability (t/828): one event per save so a future history-strip is immediately
  // visible from a flight-recorder dump.
  getGlobalRecorder()?.record({
    type: 'state.change',
    component: 'ipc-save-taxonomy',
    level: 'info',
    message: 'save.stamp',
    data: {
      pov,
      total: stamped.length,
      stampedCount,
      unchangedCount: stamped.length - stampedCount,
      preservedCount,
    },
  });
  return stamped;
}

export function registerTaxonomyHandlers(): void {
  ipcMain.handle('get-taxonomy-dirs', () => {
    return getTaxonomyDirs();
  });

  ipcMain.handle('get-active-taxonomy-dir', () => {
    return getActiveTaxonomyDirName();
  });

  ipcMain.handle('set-taxonomy-dir', (_event, dirName: string) => {
    setActiveTaxonomyDir(dirName);
  });

  ipcMain.handle('load-taxonomy-file', (_event, pov: string) => {
    return readTaxonomyFile(pov);
  });

  ipcMain.handle('save-taxonomy-file', (event, pov: string, data: unknown) => {
    const parsed = VALID_POV.safeParse(pov);
    if (!parsed.success) throw new ActionableError({ goal: 'Save taxonomy file', problem: `Invalid POV: ${pov}`, location: 'ipcHandlers:save-taxonomy-file', nextSteps: ['Use a valid POV name'] });
    // Stamp _edit_meta / _edit_history before writing so desktop edits record
    // authorship just like the web server's PUT /api/taxonomy/:pov handler.
    // The renderer may send either { nodes: [...] } or a bare nodes array — handle both.
    const incoming = data as { nodes?: unknown[] };
    const newNodes: unknown[] | null = Array.isArray(incoming.nodes)
      ? incoming.nodes
      : Array.isArray(data) ? (data as unknown[]) : null;
    let toWrite: unknown = data;
    if (newNodes) {
      const stamped = stampSaveNodes(parsed.data, newNodes);
      if (Array.isArray(incoming.nodes)) {
        incoming.nodes = stamped;       // object form: mutate nodes in place, write the wrapper
      } else {
        toWrite = stamped;              // bare-array form: write the stamped array directly
      }
    }
    writeTaxonomyFile(parsed.data, toWrite);
    // Notify all other windows to reload taxonomy data
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents !== event.sender) {
        win.webContents.send('reload-taxonomy');
      }
    }
  });

  ipcMain.handle('load-policy-registry', () => {
    return readPolicyRegistry();
  });

  ipcMain.handle('load-lineage-categories', () => {
    return readLineageCategories();
  });

  ipcMain.handle('load-lineage-info', () => {
    return readLineageEnrichments();
  });

  ipcMain.handle('load-conflict-files', () => {
    return readAllConflictFiles();
  });

  ipcMain.handle('load-conflict-clusters', () => {
    return readConflictClusters();
  });

  ipcMain.handle('load-aggregated-cruxes', () => {
    return readAggregatedCruxes();
  });

  // Dictionary
  ipcMain.handle('load-dictionary', () => {
    try {
      const dictDir = path.join(getDataRootPath(), 'dictionary');
      const stdDir = path.join(dictDir, 'standardized');
      const colDir = path.join(dictDir, 'colloquial');

      const standardized: unknown[] = [];
      if (fs.existsSync(stdDir)) {
        for (const f of fs.readdirSync(stdDir).filter(f => f.endsWith('.json'))) {
          try {
            standardized.push(JSON.parse(fs.readFileSync(path.join(stdDir, f), 'utf-8')));
          } catch { /* telemetry — silent by design;  skip malformed */ }
        }
      }

      const colloquial: unknown[] = [];
      if (fs.existsSync(colDir)) {
        for (const f of fs.readdirSync(colDir).filter(f => f.endsWith('.json'))) {
          try {
            colloquial.push(JSON.parse(fs.readFileSync(path.join(colDir, f), 'utf-8')));
          } catch { /* telemetry — silent by design;  skip malformed */ }
        }
      }

      return { standardized, colloquial, lintViolations: [] };
    } catch {
      /* telemetry — silent by design */
      return { standardized: [], colloquial: [], lintViolations: [] };
    }
  });

  ipcMain.handle('save-conflict-file', (_event, claimId: string, data: unknown) => {
    writeConflictFile(claimId, data);
  });

  ipcMain.handle('create-conflict-file', (_event, claimId: string, data: unknown) => {
    createConflictFile(claimId, data);
  });

  ipcMain.handle('delete-conflict-file', (_event, claimId: string) => {
    deleteConflictFile(claimId);
  });

  // Taxonomy proposal files (for batch approve UI)
  ipcMain.handle('list-proposals', () => {
    const proposalDir = path.join(getDataRootPath(), loadDataConfig().taxonomy_dir, 'proposals');
    if (!fs.existsSync(proposalDir)) return [];
    return fs.readdirSync(proposalDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(proposalDir, f), 'utf-8'));
          return { filename: f, ...data };
        } catch {
          /* telemetry — silent by design */
          return { filename: f, error: 'Failed to parse' };
        }
      });
  });

  ipcMain.handle('save-proposal', (_event, filename: string, data: unknown) => {
    const proposalDir = path.join(getDataRootPath(), loadDataConfig().taxonomy_dir, 'proposals');
    if (!fs.existsSync(proposalDir)) fs.mkdirSync(proposalDir, { recursive: true });
    if (!/^proposal-[\d-]+\.json$/.test(filename)) {
      return { error: 'Invalid proposal filename' };
    }
    const filePath = path.join(proposalDir, filename);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    renameSyncWithRetry(tmpPath, filePath);
    return { saved: true };
  });

  ipcMain.handle('build-node-source-index', () => {
    return buildNodeSourceIndex();
  });

  ipcMain.handle('build-policy-source-index', () => {
    return buildPolicySourceIndex();
  });

  ipcMain.handle('load-edges', () => {
    const data = readEdgesFile() as { edges: Record<string, unknown>[]; [k: string]: unknown } | null;
    if (!data?.edges) return data;
    return {
      ...data,
      edges: data.edges.map(({ rationale, ...rest }) => rest),
    };
  });

  ipcMain.handle('load-edge-detail', (_event, index: number) => {
    const data = readEdgesFile() as { edges: Record<string, unknown>[] } | null;
    if (!data?.edges) throw new ActionableError({
      goal: 'Load edge detail with rationale',
      problem: 'No edges.json found in the active taxonomy directory',
      location: 'ipcHandlers.loadEdgeDetail',
      nextSteps: [
        'Verify the data directory is configured correctly (Settings > Data Root)',
        'Check that edges.json exists in the active taxonomy directory',
      ],
    });
    if (index < 0 || index >= data.edges.length) throw new ActionableError({
      goal: 'Load edge detail with rationale',
      problem: `Edge index ${index} is out of range (0..${data.edges.length - 1})`,
      location: 'ipcHandlers.loadEdgeDetail',
      nextSteps: ['Reload the edges list to get current indices'],
    });
    return data.edges[index];
  });

  ipcMain.handle('update-edge-status', (_event, index: number, status: string) => {
    const data = readEdgesFile() as Record<string, unknown>;
    if (!data) throw new ActionableError({
      goal: 'Update the status of a taxonomy edge',
      problem: 'No edges.json found in the active taxonomy directory',
      location: 'ipcHandlers.updateEdgeStatus',
      nextSteps: [
        'Verify the data directory is configured correctly (Settings > Data Root)',
        'Check that edges.json exists in the active taxonomy directory',
      ],
    });
    const edges = data['edges'] as Record<string, unknown>[];
    if (index < 0 || index >= edges.length) throw new ActionableError({
      goal: 'Update the status of a taxonomy edge',
      problem: `Edge index ${index} is out of range (0..${edges.length - 1})`,
      location: 'ipcHandlers.updateEdgeStatus',
      nextSteps: [
        'Reload the edges list to get the current indices',
        'This may indicate a stale UI — try refreshing the page',
      ],
    });
    edges[index]['status'] = status;
    if (status === 'approved') {
      delete edges[index]['direction_flag'];
    }
    writeEdgesFile(data);
    return { index, status };
  });

  ipcMain.handle('swap-edge-direction', (_event, index: number) => {
    const data = readEdgesFile() as Record<string, unknown>;
    if (!data) throw new ActionableError({
      goal: 'Swap the direction of a taxonomy edge',
      problem: 'No edges.json found in the active taxonomy directory',
      location: 'ipcHandlers.swapEdgeDirection',
      nextSteps: [
        'Verify the data directory is configured correctly (Settings > Data Root)',
        'Check that edges.json exists in the active taxonomy directory',
      ],
    });
    const edges = data['edges'] as Record<string, unknown>[];
    if (index < 0 || index >= edges.length) throw new ActionableError({
      goal: 'Swap the direction of a taxonomy edge',
      problem: `Edge index ${index} is out of range (0..${edges.length - 1})`,
      location: 'ipcHandlers.swapEdgeDirection',
      nextSteps: [
        'Reload the edges list to get the current indices',
        'This may indicate a stale UI — try refreshing the page',
      ],
    });
    const edge = edges[index];
    const tmp = edge['source'];
    edge['source'] = edge['target'];
    edge['target'] = tmp;
    delete edge['direction_flag'];
    writeEdgesFile(data);
    return { index, source: edge['source'], target: edge['target'] };
  });

  ipcMain.handle('bulk-update-edges', (_event, indices: number[], status: string) => {
    const data = readEdgesFile() as Record<string, unknown>;
    if (!data) throw new ActionableError({
      goal: 'Bulk-update the status of taxonomy edges',
      problem: 'No edges.json found in the active taxonomy directory',
      location: 'ipcHandlers.bulkUpdateEdges',
      nextSteps: [
        'Verify the data directory is configured correctly (Settings > Data Root)',
        'Check that edges.json exists in the active taxonomy directory',
      ],
    });
    const edges = data['edges'] as Record<string, unknown>[];
    let updated = 0;
    for (const idx of indices) {
      if (idx >= 0 && idx < edges.length) {
        edges[idx]['status'] = status;
        updated++;
      }
    }
    writeEdgesFile(data);
    return { updated, status };
  });

  // Whole-file edge persistence for the new-edge path (t/1816/t/1822). Unlike the
  // index-based update/swap/bulk handlers above, this WRITES the entire EdgesFile,
  // so it CREATES edges.json when absent (persisting the very first edge) rather
  // than preconditioning on an existing file — requiring one would defeat the
  // new-edge purpose. It guards the incoming BODY SHAPE instead: a non-{edges:[...]}
  // payload is rejected rather than written over edges.json, mirroring the server
  // transport's PUT /api/edges 400 body guard (t/1821) so desktop and web behave
  // identically. writeEdgesFile is atomic (temp→rename).
  ipcMain.handle('save-edges', (_event, data: unknown) => {
    if (!data || typeof data !== 'object' || !Array.isArray((data as { edges?: unknown }).edges)) {
      // Client bug (400-equivalent) — thrown before the recording catch, so a bad
      // payload doesn't flood the flight recorder (mirrors the server's 400 path).
      throw new ActionableError({
        goal: 'Persist the taxonomy edges to disk',
        problem: 'save-edges received a payload that is not a valid EdgesFile (missing an `edges` array)',
        location: 'ipcHandlers.saveEdges',
        nextSteps: [
          'Send the whole edges file as { edges: [...] }',
          'This is a renderer bug — the bridge should pass a valid EdgesFile',
        ],
      });
    }
    try {
      writeEdgesFile(data);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-save-edges',
        level: 'error',
        message: 'Failed to persist edges.json',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      throw new ActionableError({
        goal: 'Persist the taxonomy edges to disk',
        problem: 'Could not write edges.json to the active taxonomy directory',
        location: 'ipcHandlers.saveEdges',
        nextSteps: [
          'Verify the data directory is configured correctly (Settings > Data Root)',
          'Check that edges.json is not locked by another process (antivirus/indexer)',
        ],
        innerError: err,
      });
    }
  });

  ipcMain.handle('load-synthetic-corpus', (_event, pov: string) => {
    return loadSyntheticCorpus(pov);
  });

  ipcMain.handle('load-synthetic-embeddings', () => {
    return loadSyntheticEmbeddings();
  });

  ipcMain.handle('update-synthetic-embeddings', (_event, nodeId: string, pov: string, vectors: number[][]) => {
    updateSyntheticEmbeddings(nodeId, pov, vectors);
  });
}
