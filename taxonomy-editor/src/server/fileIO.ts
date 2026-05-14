// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * File I/O service for the web server — mirrors the Electron main/fileIO.ts
 * logic without any Electron imports.
 *
 * All public functions are async.  Data-repo I/O is delegated to the pluggable
 * StorageBackend (default: FilesystemBackend).  Project-root I/O (AI models,
 * PS prompts) uses fs/promises directly — these files are always local.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { loadDataConfig, resolveDataPath, getDataRoot, getProjectRoot } from './config';
import { ActionableError } from '../../../lib/debate/errors';
import { POV_KEYS } from '../../../lib/debate/types';
import type { StorageBackend } from './storageBackend';
import { FilesystemBackend } from './filesystemBackend';
import type { SessionContext } from './githubAPIBackend';

// ── Backend injection ──

let backend: StorageBackend = new FilesystemBackend();

/** Replace the storage backend (e.g. with GitHubAPIBackend for Azure). */
export function setBackend(b: StorageBackend): void { backend = b; }
export function getBackend(): StorageBackend { return backend; }

/**
 * Set per-request session context. Only effective when the backend is
 * GitHubAPIBackend (API mode). FilesystemBackend ignores this.
 */
export function setSessionContext(ctx: SessionContext | null): void {
  if ('setSessionContext' in backend && typeof (backend as Record<string, unknown>).setSessionContext === 'function') {
    (backend as { setSessionContext(ctx: SessionContext | null): void }).setSessionContext(ctx);
  }
}

// ── Path safety ──

const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;
const SAFE_POV_RE = /^[a-z_-]+$/;
const SAFE_FILENAME_RE = /^[a-zA-Z0-9_.-]+$/;

function assertSafeId(value: string, label: string): void {
  if (!value || !SAFE_ID_RE.test(value))
    throw new ActionableError({
      goal: 'Validate input parameter',
      problem: `Invalid ${label}: must be alphanumeric/hyphens/underscores, got "${value}"`,
      location: `server/fileIO.ts → assertSafeId(${label})`,
      nextSteps: ['Check the input value contains only allowed characters (a-z, A-Z, 0-9, hyphens, underscores)'],
    });
}

function assertSafePov(value: string): void {
  if (!value || !SAFE_POV_RE.test(value))
    throw new ActionableError({
      goal: 'Validate input parameter',
      problem: `Invalid POV name: must be lowercase alpha/hyphens/underscores, got "${value}"`,
      location: 'server/fileIO.ts → assertSafePov',
      nextSteps: ['Check the input value contains only allowed characters (a-z, hyphens, underscores)'],
    });
}

function assertSafeFilename(value: string, label: string): void {
  if (!value || !SAFE_FILENAME_RE.test(value) || value.includes('..'))
    throw new ActionableError({
      goal: 'Validate input parameter',
      problem: `Invalid ${label}: must be alphanumeric/hyphens/underscores/dots, got "${value}"`,
      location: `server/fileIO.ts → assertSafeFilename(${label})`,
      nextSteps: ['Check the input value contains only allowed characters (a-z, A-Z, 0-9, hyphens, underscores, dots)'],
    });
}

// ── Taxonomy directories ──

let activeTaxonomyDir = '';

export async function getTaxonomyDirs(): Promise<string[]> {
  const config = loadDataConfig();
  const taxonomyBase = resolveDataPath(path.dirname(config.taxonomy_dir));
  try {
    const entries = await backend.listDirectory(taxonomyBase);
    const dirs: string[] = [];
    for (const d of entries) {
      const full = path.join(taxonomyBase, d);
      const children = await backend.listDirectory(full);
      if (children.some(f => f.endsWith('.json') && f !== 'embeddings.json' && f !== 'edges.json')) {
        dirs.push(d);
      }
    }
    return dirs;
  } catch {
    return [];
  }
}

export function getActiveTaxonomyDirName(): string {
  if (!activeTaxonomyDir) {
    const config = loadDataConfig();
    activeTaxonomyDir = path.basename(config.taxonomy_dir);
  }
  return activeTaxonomyDir;
}

export function setActiveTaxonomyDir(dirName: string): void {
  activeTaxonomyDir = dirName;
}

function getTaxonomyDir(): string {
  const config = loadDataConfig();
  const base = resolveDataPath(path.dirname(config.taxonomy_dir));
  const active = getActiveTaxonomyDirName();
  return path.join(base, active);
}

// ── Data availability ──

export async function isDataAvailable(): Promise<boolean> {
  const taxDir = getTaxonomyDir();
  try {
    const files = await backend.listDirectory(taxDir);
    const hasData = files.some(f => f.endsWith('.json') && f !== 'embeddings.json' && f !== 'edges.json');
    console.log(`[isDataAvailable] taxDir=${taxDir} files=${files.length} hasData=${hasData}`);
    return hasData;
  } catch (err) {
    console.log(`[isDataAvailable] taxDir=${taxDir} error=${String(err)}`);
    return false;
  }
}

export function getDataRootPath(): string {
  return getDataRoot();
}

// ── Taxonomy CRUD ──

async function resolveTaxonomyFilePath(pov: string): Promise<string> {
  assertSafePov(pov);
  const taxDir = getTaxonomyDir();
  if (pov === 'situations') {
    const sitPath = path.join(taxDir, 'situations.json');
    if (await backend.fileExists(sitPath)) return sitPath;
    const ccPath = path.join(taxDir, 'cross-cutting.json');
    if (await backend.fileExists(ccPath)) return ccPath;
    return sitPath;
  }
  return path.join(taxDir, `${pov}.json`);
}

export async function readTaxonomyFile(pov: string): Promise<unknown> {
  const filePath = await resolveTaxonomyFilePath(pov);
  const raw = await backend.readFile(filePath);
  if (raw === null) throw new ActionableError({
    goal: 'Read taxonomy file',
    problem: `Taxonomy file not found: ${filePath}`,
    location: 'server/fileIO.ts → readTaxonomyFile',
    nextSteps: ['Verify the POV file exists in the active taxonomy directory'],
  });
  // Strip UTF-8 BOM if present — PowerShell's Set-Content writes BOM by default
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
}

export async function writeTaxonomyFile(pov: string, data: unknown): Promise<void> {
  const filePath = await resolveTaxonomyFilePath(pov);
  await backend.writeFile(filePath, JSON.stringify(data, null, 2));
}

// ── Conflict CRUD ──

function getConflictsDir(): string {
  const config = loadDataConfig();
  return resolveDataPath(config.conflicts_dir);
}

export async function readAggregatedCruxes(): Promise<unknown | null> {
  const filePath = path.join(getTaxonomyDir(), 'aggregated-cruxes.json');
  const raw = await backend.readFile(filePath);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function readConflictClusters(): Promise<unknown | null> {
  const filePath = path.join(getConflictsDir(), '_conflict-clusters.json');
  const raw = await backend.readFile(filePath);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function readAllConflictFiles(): Promise<unknown[]> {
  const dir = getConflictsDir();
  const entries = await backend.listDirectory(dir);
  const results: unknown[] = [];
  for (const f of entries.filter(f => f.endsWith('.json') && !f.startsWith('_'))) {
    try {
      const raw = await backend.readFile(path.join(dir, f));
      if (raw !== null) results.push(JSON.parse(raw));
    } catch { /* skip corrupt files */ }
  }
  return results;
}

export async function writeConflictFile(claimId: string, data: unknown): Promise<void> {
  assertSafeId(claimId, 'claimId');
  const filePath = path.join(getConflictsDir(), `${claimId}.json`);
  if (!await backend.fileExists(filePath)) throw new ActionableError({
    goal: 'Load conflict definition',
    problem: `Conflict file not found: ${claimId}`,
    location: 'server/fileIO.ts → writeConflictFile',
    nextSteps: [
      `Verify that ${claimId}.json exists in the conflicts directory`,
      'Use createConflictFile() to create a new conflict instead of writeConflictFile()',
      'Call readAllConflictFiles() to list available conflict files',
    ],
  });
  await backend.writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function createConflictFile(claimId: string, data: unknown): Promise<void> {
  assertSafeId(claimId, 'claimId');
  const filePath = path.join(getConflictsDir(), `${claimId}.json`);
  if (await backend.fileExists(filePath)) throw new ActionableError({
    goal: 'Create conflict definition',
    problem: `Conflict file already exists: ${claimId}`,
    location: 'server/fileIO.ts → createConflictFile',
    nextSteps: [
      `Use writeConflictFile() to update the existing ${claimId}.json`,
      'Delete the existing file first if you intend to replace it',
    ],
  });
  await backend.writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function deleteConflictFile(claimId: string): Promise<void> {
  assertSafeId(claimId, 'claimId');
  await backend.deleteFile(path.join(getConflictsDir(), `${claimId}.json`));
}

// ── Policy registry ──

export async function readPolicyRegistry(): Promise<unknown | null> {
  try {
    const taxDir = getTaxonomyDir();
    const p = path.join(taxDir, 'policy_actions.json');
    const exists = await backend.fileExists(p);
    console.log(`[fileIO] readPolicyRegistry: taxDir=${taxDir}, path=${p}, exists=${exists}`);
    const raw = await backend.readFile(p);
    if (raw === null) return null;
    const data = JSON.parse(raw);
    const count = (data as { policies?: unknown[] })?.policies?.length ?? 0;
    console.log(`[fileIO] readPolicyRegistry: loaded ${count} policies`);
    return data;
  } catch (err) {
    console.error(`[fileIO] readPolicyRegistry failed:`, err);
    return null;
  }
}

// ── Edges ──

function getEdgesPath(): string {
  return path.join(getTaxonomyDir(), 'edges.json');
}

export async function readEdgesFile(): Promise<unknown | null> {
  try {
    const raw = await backend.readFile(getEdgesPath());
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeEdgesFile(data: unknown): Promise<void> {
  await backend.writeFile(getEdgesPath(), JSON.stringify(data, null, 2));
}

export async function updateEdgeStatus(edges: unknown, index: number, status: string): Promise<unknown> {
  const arr = edges as { edges: Record<string, unknown>[] };
  if (arr.edges && arr.edges[index]) {
    arr.edges[index].status = status;
    if (status === 'approved') {
      delete arr.edges[index].direction_flag;
    }
    await writeEdgesFile(arr);
  }
  return arr;
}

export async function bulkUpdateEdges(edges: unknown, indices: number[], status: string): Promise<unknown> {
  const arr = edges as { edges: Record<string, unknown>[] };
  if (arr.edges) {
    for (const i of indices) {
      if (arr.edges[i]) arr.edges[i].status = status;
    }
    await writeEdgesFile(arr);
  }
  return arr;
}

export async function swapEdgeDirection(edges: unknown, index: number): Promise<unknown> {
  const arr = edges as { edges: Record<string, unknown>[] };
  if (arr.edges && arr.edges[index]) {
    const edge = arr.edges[index];
    const tmp = edge.source;
    edge.source = edge.target;
    edge.target = tmp;
    delete edge.direction_flag;
    await writeEdgesFile(arr);
  }
  return arr;
}

// ── Node/Policy source index ──

interface SourceReference {
  docId: string;
  title: string;
  pov: string;
  stance: string;
  point: string;
  verbatim: string;
  excerptContext: string;
  url: string | null;
  sourceType: string;
  datePublished: string;
}

type NodeSourceIndex = Record<string, SourceReference[]>;

/**
 * Scan all summary JSON files and build a reverse index:
 * nodeId → list of source references that mapped to it.
 */
export async function buildNodeSourceIndex(): Promise<NodeSourceIndex> {
  const config = loadDataConfig();
  const summariesDir = resolveDataPath(config.summaries_dir);
  const sourcesDir = resolveDataPath(config.sources_dir);
  const index: NodeSourceIndex = {};

  const summaryFiles = await backend.listDirectory(summariesDir);
  if (summaryFiles.length === 0) return index;

  // Pre-load source metadata for titles/URLs.
  // Instead of checking isDirectory, we probe for metadata.json in each entry.
  const metaCache: Record<string, { title: string; url: string | null; sourceType: string; datePublished: string }> = {};
  const sourceEntries = await backend.listDirectory(sourcesDir);
  for (const name of sourceEntries) {
    const metaPath = path.join(sourcesDir, name, 'metadata.json');
    try {
      const metaRaw = await backend.readFile(metaPath);
      if (metaRaw !== null) {
        const meta = JSON.parse(metaRaw);
        metaCache[name] = {
          title: meta.title || name,
          url: meta.url || null,
          sourceType: meta.source_type || 'unknown',
          datePublished: meta.date_published || meta.source_time || '',
        };
      }
    } catch { /* skip */ }
  }

  // Scan all summary files
  for (const file of summaryFiles) {
    if (!file.endsWith('.json')) continue;
    const docId = file.replace(/\.json$/, '');

    let summary: {
      pov_summaries?: Record<string, {
        key_points?: Array<{
          taxonomy_node_id?: string | null;
          point?: string;
          stance?: string;
          verbatim?: string;
          excerpt_context?: string;
        }>;
      }>;
    };

    try {
      const raw = await backend.readFile(path.join(summariesDir, file));
      if (raw === null) continue;
      summary = JSON.parse(raw);
    } catch { continue; }

    const meta = metaCache[docId] || { title: docId, url: null, sourceType: 'unknown', datePublished: '' };

    for (const [pov, povData] of Object.entries(summary.pov_summaries || {})) {
      for (const kp of povData.key_points || []) {
        const nodeId = kp.taxonomy_node_id;
        if (!nodeId) continue;

        if (!index[nodeId]) index[nodeId] = [];
        index[nodeId].push({
          docId,
          title: meta.title,
          pov,
          stance: kp.stance || 'neutral',
          point: kp.point || '',
          verbatim: kp.verbatim || '',
          excerptContext: kp.excerpt_context || '',
          url: meta.url,
          sourceType: meta.sourceType,
          datePublished: meta.datePublished,
        });
      }
    }
  }

  return index;
}

interface PolicySourceReference {
  docId: string;
  title: string;
  dateIngested: string;
  sourceTime: string;
  stance: string;
  nodeId: string;
  pov: string;
}

type PolicySourceIndex = Record<string, PolicySourceReference[]>;

/**
 * For each policy in policy_actions.json, find all nodes that reference it
 * (by scanning policy_actions in POV files), then use the node-source index
 * to find which sources reference those nodes.
 */
export async function buildPolicySourceIndex(): Promise<PolicySourceIndex> {
  const result: PolicySourceIndex = {};
  const config = loadDataConfig();
  const sourcesDir = resolveDataPath(config.sources_dir);

  // 1. Load policy registry to get all policy IDs
  const regRaw = await readPolicyRegistry() as { policies?: { id: string }[] } | null;
  if (!regRaw?.policies) return result;
  for (const pol of regRaw.policies) {
    result[pol.id] = [];
  }

  // 2. Build node → policy mapping by scanning all POV files
  const nodeToPolicies = new Map<string, string[]>();
  for (const pov of POV_KEYS) {
    try {
      const file = await readTaxonomyFile(pov) as { nodes?: Array<{ id: string; graph_attributes?: { policy_actions?: { policy_id?: string }[] } }> };
      if (!file?.nodes) continue;
      for (const node of file.nodes) {
        const actions = node.graph_attributes?.policy_actions;
        if (!actions) continue;
        for (const action of actions) {
          if (!action.policy_id) continue;
          if (!nodeToPolicies.has(node.id)) nodeToPolicies.set(node.id, []);
          nodeToPolicies.get(node.id)!.push(action.policy_id);
        }
      }
    } catch { /* skip unavailable POV files */ }
  }

  // 3. Build node-source index
  const nodeSourceIdx = await buildNodeSourceIndex();

  // 4. Pre-load source metadata for dateIngested / sourceTime
  const metaCache: Record<string, { dateIngested: string; sourceTime: string }> = {};
  const sourceEntries = await backend.listDirectory(sourcesDir);
  for (const name of sourceEntries) {
    const metaPath = path.join(sourcesDir, name, 'metadata.json');
    try {
      const metaRaw = await backend.readFile(metaPath);
      if (metaRaw !== null) {
        const meta = JSON.parse(metaRaw);
        metaCache[name] = {
          dateIngested: meta.date_ingested || meta.date_published || '',
          sourceTime: meta.source_time || '',
        };
      }
    } catch { /* skip */ }
  }

  // 5. For each node that has sources, map those sources to the node's policies
  for (const [nodeId, policyIds] of nodeToPolicies) {
    const sourceRefs = nodeSourceIdx[nodeId];
    if (!sourceRefs) continue;

    for (const polId of policyIds) {
      if (!result[polId]) result[polId] = [];
      for (const ref of sourceRefs) {
        const meta = metaCache[ref.docId] || { dateIngested: ref.datePublished, sourceTime: '' };
        result[polId].push({
          docId: ref.docId,
          title: ref.title,
          dateIngested: meta.dateIngested,
          sourceTime: meta.sourceTime,
          stance: ref.stance,
          nodeId,
          pov: ref.pov,
        });
      }
    }
  }

  return result;
}

// ── Debate sessions ──

function getDebatesDir(): string {
  return resolveDataPath('debates');
}

export async function listDebateSessions(): Promise<unknown[]> {
  const dir = getDebatesDir();
  const summaries: { id: string; title: string; created_at: string; updated_at: string; phase: string }[] = [];

  // Scan root debates dir + cli-runs subdirectory
  const scanDirs = [dir, path.join(dir, 'cli-runs')];

  for (const scanDir of scanDirs) {
    const files = (await backend.listDirectory(scanDir))
      .filter(f => f.endsWith('.json') && (f.startsWith('debate-') || f.endsWith('-debate.json')));
    for (const f of files) {
      try {
        const rawContent = await backend.readFile(path.join(scanDir, f));
        if (rawContent === null) continue;
        const raw = JSON.parse(rawContent);
        // Normalize CLI-generated filenames ({slug}-debate.json → debate-{id}.json)
        // Move cli-runs files up to the root debates dir for consistent access
        const canonical = `debate-${raw.id}.json`;
        const canonicalPath = path.join(dir, canonical);
        const currentPath = path.join(scanDir, f);
        if (currentPath !== canonicalPath) {
          await backend.writeFile(canonicalPath, rawContent);
          await backend.deleteFile(currentPath);
        }
        summaries.push({
          id: raw.id,
          title: raw.title || raw.topic || 'Untitled',
          created_at: raw.created_at || '',
          updated_at: raw.updated_at || raw.created_at || '',
          phase: raw.phase || 'unknown',
        });
      } catch { /* skip */ }
    }
  }
  return summaries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function loadDebateSession(id: string): Promise<unknown> {
  assertSafeId(id, 'debate id');
  const filePath = path.join(getDebatesDir(), `debate-${id}.json`);
  const raw = await backend.readFile(filePath);
  if (raw === null) throw new ActionableError({
    goal: 'Load debate session',
    problem: `Debate session not found: ${id}`,
    location: 'server/fileIO.ts → loadDebateSession',
    nextSteps: ['Verify the debate ID exists via listDebateSessions()'],
  });
  return JSON.parse(raw);
}

export async function saveDebateSession(session: unknown): Promise<void> {
  const s = session as { id: string };
  assertSafeId(s.id, 'debate id');
  await backend.writeFile(
    path.join(getDebatesDir(), `debate-${s.id}.json`),
    JSON.stringify(session, null, 2),
  );
}

export async function deleteDebateSession(id: string): Promise<void> {
  assertSafeId(id, 'debate id');
  await backend.deleteFile(path.join(getDebatesDir(), `debate-${id}.json`));
}

export async function loadDebateComments(debateId: string): Promise<unknown> {
  assertSafeId(debateId, 'debate id');
  const filePath = path.join(getDebatesDir(), `debate-${debateId}-comments.json`);
  const raw = await backend.readFile(filePath);
  if (raw === null) {
    return { _schema_version: '1', debateId, comments: [] };
  }
  return JSON.parse(raw);
}

export async function saveDebateComments(debateId: string, data: unknown): Promise<void> {
  assertSafeId(debateId, 'debate id');
  await backend.writeFile(
    path.join(getDebatesDir(), `debate-${debateId}-comments.json`),
    JSON.stringify(data, null, 2),
  );
}

// ── Chat sessions ──

function getChatsDir(): string {
  return resolveDataPath('chats');
}

export async function listChatSessions(): Promise<unknown[]> {
  const dir = getChatsDir();
  const files = (await backend.listDirectory(dir)).filter(f => f.startsWith('chat-') && f.endsWith('.json'));
  const summaries: { id: string; title: string; created_at: string; updated_at: string; mode: string; pover: string }[] = [];
  for (const f of files) {
    try {
      const raw = await backend.readFile(path.join(dir, f));
      if (raw === null) continue;
      const parsed = JSON.parse(raw);
      summaries.push({
        id: parsed.id,
        title: parsed.title || 'Untitled',
        created_at: parsed.created_at || '',
        updated_at: parsed.updated_at || parsed.created_at || '',
        mode: parsed.mode || '',
        pover: parsed.pover || '',
      });
    } catch { /* skip */ }
  }
  return summaries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function loadChatSession(id: string): Promise<unknown> {
  assertSafeId(id, 'chat id');
  const raw = await backend.readFile(path.join(getChatsDir(), `chat-${id}.json`));
  if (raw === null) throw new ActionableError({
    goal: 'Load chat session',
    problem: `Chat session not found: ${id}`,
    location: 'server/fileIO.ts → loadChatSession',
    nextSteps: ['Verify the chat ID exists via listChatSessions()'],
  });
  return JSON.parse(raw);
}

export async function saveChatSession(session: unknown): Promise<void> {
  const s = session as { id: string };
  assertSafeId(s.id, 'chat id');
  await backend.writeFile(
    path.join(getChatsDir(), `chat-${s.id}.json`),
    JSON.stringify(session, null, 2),
  );
}

export async function deleteChatSession(id: string): Promise<void> {
  assertSafeId(id, 'chat id');
  await backend.deleteFile(path.join(getChatsDir(), `chat-${id}.json`));
}

// ── Proposals ──

export async function listProposals(): Promise<unknown[]> {
  const dir = getDataRoot();
  try {
    const entries = await backend.listDirectory(dir);
    const proposals: unknown[] = [];
    for (const f of entries.filter(f => f.startsWith('taxonomy-proposal') && f.endsWith('.json'))) {
      const raw = await backend.readFile(path.join(dir, f));
      if (raw !== null) {
        proposals.push({ filename: f, ...JSON.parse(raw) });
      }
    }
    return proposals;
  } catch {
    return [];
  }
}

export async function saveProposal(filename: string, data: unknown): Promise<void> {
  assertSafeFilename(filename, 'proposal filename');
  await backend.writeFile(path.join(getDataRoot(), filename), JSON.stringify(data, null, 2));
}

// ── Harvest operations ──

export async function harvestCreateConflict(conflict: Record<string, unknown>): Promise<boolean> {
  const id = conflict.claim_id as string || conflict.id as string;
  if (!id) return false;
  assertSafeId(id, 'conflict id');
  await backend.writeFile(
    path.join(getConflictsDir(), `${id}.json`),
    JSON.stringify(conflict, null, 2),
  );
  return true;
}

export async function harvestAddDebateRef(nodeId: string, debateId: string): Promise<boolean> {
  // Find which POV file contains this node and update it
  for (const pov of [...POV_KEYS, 'situations']) {
    try {
      const filePath = await resolveTaxonomyFilePath(pov);
      const raw = await backend.readFile(filePath);
      if (raw === null) continue;
      const data = JSON.parse(raw);
      const nodes = data.nodes || data;
      const node = Array.isArray(nodes) ? nodes.find((n: Record<string, unknown>) => n.id === nodeId) : null;
      if (node) {
        if (!node.debate_refs) node.debate_refs = [];
        if (!node.debate_refs.includes(debateId)) {
          node.debate_refs.push(debateId);
          await backend.writeFile(filePath, JSON.stringify(data, null, 2));
        }
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

export async function harvestUpdateSteelman(nodeId: string, attackerPov: string, newText: string): Promise<boolean> {
  for (const pov of [...POV_KEYS, 'situations']) {
    try {
      const filePath = await resolveTaxonomyFilePath(pov);
      const raw = await backend.readFile(filePath);
      if (raw === null) continue;
      const data = JSON.parse(raw);
      const nodes = data.nodes || data;
      const node = Array.isArray(nodes) ? nodes.find((n: Record<string, unknown>) => n.id === nodeId) : null;
      if (node) {
        if (typeof node.steelman_vulnerability === 'string') {
          node.steelman_vulnerability = { [attackerPov]: newText };
        } else if (typeof node.steelman_vulnerability === 'object' && node.steelman_vulnerability !== null) {
          node.steelman_vulnerability[attackerPov] = newText;
        } else {
          node.steelman_vulnerability = { [attackerPov]: newText };
        }
        await backend.writeFile(filePath, JSON.stringify(data, null, 2));
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

export async function harvestAddVerdict(conflictId: string, verdict: Record<string, unknown>): Promise<boolean> {
  const filePath = path.join(getConflictsDir(), `${conflictId}.json`);
  const raw = await backend.readFile(filePath);
  if (raw === null) return false;
  const data = JSON.parse(raw);
  data.verdict = verdict;
  await backend.writeFile(filePath, JSON.stringify(data, null, 2));
  return true;
}

export async function harvestQueueConcept(concept: Record<string, unknown>): Promise<boolean> {
  const dir = resolveDataPath('harvests');
  await backend.writeFile(
    path.join(dir, `concept-${Date.now()}.json`),
    JSON.stringify(concept, null, 2),
  );
  return true;
}

export async function harvestSaveManifest(manifest: Record<string, unknown>): Promise<boolean> {
  const dir = resolveDataPath('harvests');
  await backend.writeFile(
    path.join(dir, `manifest-${Date.now()}.json`),
    JSON.stringify(manifest, null, 2),
  );
  return true;
}

// ── Summaries & Sources ──

function getSourcesDir(): string {
  const config = loadDataConfig();
  return resolveDataPath(config.sources_dir);
}

function getSummariesDir(): string {
  const config = loadDataConfig();
  return resolveDataPath(config.summaries_dir);
}

export interface DiscoveredSource {
  id: string;
  title: string;
  url: string | null;
  sourceType: string;
  datePublished: string;
  dateIngested: string;
  hasSummary: boolean;
  tags: string[];
  authors: string[];
}

export async function discoverSources(): Promise<DiscoveredSource[]> {
  const sourcesDir = getSourcesDir();
  const summariesDir = getSummariesDir();

  const sourceEntries = await backend.listDirectory(sourcesDir);
  if (sourceEntries.length === 0) return [];

  const sources: DiscoveredSource[] = [];
  for (const name of sourceEntries) {
    const metaPath = path.join(sourcesDir, name, 'metadata.json');
    try {
      const metaRaw = await backend.readFile(metaPath);
      if (metaRaw === null) continue; // not a source directory (no metadata)
      const meta = JSON.parse(metaRaw);
      const summaryPath = path.join(summariesDir, `${name}.json`);
      sources.push({
        id: name,
        title: meta.title || name,
        url: meta.url || null,
        sourceType: meta.source_type || 'unknown',
        datePublished: meta.date_published || meta.source_time || '',
        dateIngested: meta.date_ingested || '',
        hasSummary: await backend.fileExists(summaryPath),
        tags: meta.pov_tags || [],
        authors: meta.authors || [],
      });
    } catch { /* skip */ }
  }
  return sources.sort((a, b) => a.title.localeCompare(b.title));
}

export async function loadSummary(docId: string): Promise<unknown | null> {
  assertSafeId(docId, 'document id');
  const filePath = path.join(getSummariesDir(), `${docId}.json`);
  const raw = await backend.readFile(filePath);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function loadSnapshot(sourceId: string): Promise<string | null> {
  assertSafeId(sourceId, 'source id');
  return backend.readFile(path.join(getSourcesDir(), sourceId, 'snapshot.md'));
}

// ── PowerShell prompts (project-root I/O — always local) ──

export async function readPsPrompt(promptName: string): Promise<{ text: string | null; error?: string }> {
  const promptsDir = path.join(getProjectRoot(), 'scripts', 'AITriad', 'Prompts');
  const filePath = path.join(promptsDir, `${promptName}.prompt`);
  try {
    return { text: await fs.readFile(filePath, 'utf-8') };
  } catch {
    return { text: null, error: `Prompt not found: ${promptName}` };
  }
}

export async function listPsPrompts(): Promise<string[]> {
  const promptsDir = path.join(getProjectRoot(), 'scripts', 'AITriad', 'Prompts');
  try {
    const entries = await fs.readdir(promptsDir);
    return entries
      .filter(f => f.endsWith('.prompt'))
      .map(f => f.replace('.prompt', ''));
  } catch {
    return [];
  }
}

// ── AI models config (project-root I/O — always local) ──

export async function loadAIModels(): Promise<unknown> {
  const configPath = path.join(getProjectRoot(), 'ai-models.json');
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf-8'));
  } catch {
    return { backends: [], models: [], defaults: {} };
  }
}

// ── URL content fetching ──

function isPrivateIP(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => isNaN(n))) return false;
  // RFC 1918
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  // Loopback
  if (parts[0] === 127) return true;
  // Link-local (includes Azure IMDS 169.254.169.254)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // CGNAT
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  return false;
}

function validateFetchUrl(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 'Invalid URL'; }

  if (parsed.protocol !== 'https:') return 'Only HTTPS URLs are allowed';
  if (parsed.username || parsed.password) return 'URLs with credentials are not allowed';

  if (isPrivateIP(parsed.hostname)) return 'URLs targeting private/internal addresses are not allowed';
  if (parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local'))
    return 'URLs targeting local addresses are not allowed';
  if (parsed.hostname.endsWith('.internal') || parsed.hostname.endsWith('.corp'))
    return 'URLs targeting internal addresses are not allowed';

  return null;
}

export async function fetchUrlContent(url: string): Promise<{ content: string; error?: string }> {
  const validationError = validateFetchUrl(url);
  if (validationError) return { content: '', error: validationError };

  try {
    const resp = await fetch(url, { redirect: 'manual' });
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location') || '';
      const redirectError = validateFetchUrl(location);
      if (redirectError) return { content: '', error: `Redirect blocked: ${redirectError}` };
      const resp2 = await fetch(location, { redirect: 'manual' });
      if (!resp2.ok) return { content: '', error: `HTTP ${resp2.status}` };
      const html = await resp2.text();
      const markdown = await htmlToMarkdown(html);
      return { content: markdown };
    }
    if (!resp.ok) return { content: '', error: `HTTP ${resp.status}` };
    const html = await resp.text();
    const markdown = await htmlToMarkdown(html);
    return { content: markdown };
  } catch (err) {
    return { content: '', error: String(err) };
  }
}

async function htmlToMarkdown(html: string): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `aitriad-${Date.now()}.html`);
  await fs.writeFile(tmpFile, html, 'utf-8');
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('markitdown', [tmpFile], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }, (err, out) => {
        if (err) reject(err); else resolve(out);
      });
    });
    return stdout;
  } catch {
    return stripHtmlFallback(html);
  } finally {
    fs.unlink(tmpFile).catch(() => { /* ignore */ });
  }
}

function stripHtmlFallback(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    .trim();
}
