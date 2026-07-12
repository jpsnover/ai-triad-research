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
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import dns from 'dns';
import { execFile } from 'child_process';
import { loadDataConfig, resolveDataPath, getDataRoot, getProjectRoot, getSourcesRoot, STORAGE_MODE } from '../config.js';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { safeSerialize } from '../../../../lib/debate/persistence.js';
import { POV_KEYS } from '../../../../lib/debate/types.js';
import type { StorageBackend } from './storageBackend.js';
import { log } from '../logger.js';
import { FilesystemBackend } from './filesystemBackend.js';
import { getGlobalRecorder, redactRecord } from '../../../../lib/flight-recorder/index.js';
import { parseNpy, extractNodeVectors } from '../../../../lib/npy.js';
import { getStorageUserId, isAnonymousUser, getAnonymousSessionId } from '../security/userContext.js';
import { getAnonymousSessionStore } from './anonymousSessionStore.js';
import { checkQuota, type QuotaCheckResult } from '../security/quotas.js';
import type { OrganizationEdge } from '../../../../lib/organizations/types.js';
// ── Backend injection ──

// Taxonomy / conflicts / calibration / summaries / sources use `backend`.
// User content (chats, debates, community) routes through `userContentBackend`,
// which falls back to `backend` when not separately configured (Electron /
// filesystem mode). In production, `userContentBackend` is an AzureBlobBackend
// while `backend` stays on GitHubAPIBackend.
let backend: StorageBackend = new FilesystemBackend();
let userContentBackend: StorageBackend | null = null;

/** Replace the taxonomy/default storage backend. */
export function setBackend(b: StorageBackend): void { backend = b; }
export function getBackend(): StorageBackend { return backend; }
/** Alias of setBackend, for explicit dual-backend wiring. */
export function setTaxonomyBackend(b: StorageBackend): void { backend = b; }
/** Set the backend for user content (chats/debates/community). */
export function setUserContentBackend(b: StorageBackend): void { userContentBackend = b; }
/** User-content backend; falls back to the taxonomy backend when unset. */
export function getUserContentBackend(): StorageBackend { return userContentBackend ?? backend; }

// ── Path safety ──

const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;
const SAFE_POV_RE = /^[a-z_-]+$/;
const SAFE_FILENAME_RE = /^[a-zA-Z0-9_.-]+$/;

export function assertSafeId(value: string, label: string): void {
  if (!value || !SAFE_ID_RE.test(value))
    throw Object.assign(new ActionableError({
      goal: 'Validate input parameter',
      problem: `Invalid ${label}: must be alphanumeric/hyphens/underscores, got "${value}"`,
      location: `server/fileIO.ts → assertSafeId(${label})`,
      nextSteps: ['Check the input value contains only allowed characters (a-z, A-Z, 0-9, hyphens, underscores)'],
    }), { statusCode: 400 });
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

// Non-throwing predicates over the same whitelists — single source of truth for
// the routing-layer path-param middleware (t/810) and any boolean checks.
export function isSafeId(value: string): boolean { return !!value && SAFE_ID_RE.test(value); }
export function isSafePov(value: string): boolean { return !!value && SAFE_POV_RE.test(value); }
export function isSafeFilename(value: string): boolean {
  return !!value && value !== '.' && value !== '..' && SAFE_FILENAME_RE.test(value);
}

export function assertSafeFilename(value: string, label: string): void {
  if (!value || !SAFE_FILENAME_RE.test(value) || value.includes('..'))
    throw Object.assign(new ActionableError({
      goal: 'Validate input parameter',
      problem: `Invalid ${label}: must be alphanumeric/hyphens/underscores/dots, got "${value}"`,
      location: `server/fileIO.ts → assertSafeFilename(${label})`,
      nextSteps: ['Check the input value contains only allowed characters (a-z, A-Z, 0-9, hyphens, underscores, dots)'],
    }), { statusCode: 400 });
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
    /* telemetry — silent by design */
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

export function getTaxonomyDir(): string {
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
    log.server.debug({ taxDir, fileCount: files.length, hasData }, 'isDataAvailable check');
    return hasData;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'file-io',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    log.server.debug({ taxDir, err: String(err) }, 'isDataAvailable error');
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

const SYNTHETIC_POV_KEYS = new Set(['acc', 'saf', 'skp']);

export async function loadSyntheticCorpus(pov: string): Promise<unknown | null> {
  if (!SYNTHETIC_POV_KEYS.has(pov)) return null;
  const filePath = path.join(getTaxonomyDir(), 'synthetic', `corpus_${pov}.json`);
  const raw = await backend.readFile(filePath, { ref: 'main' });
  if (raw === null) return null;
  const parsed = JSON.parse(raw.replace(/^﻿/, ''));
  validateGraphAttributes(parsed, pov); // t/768: warn (don't reject) on type drift
  return parsed;
}

// ── graph_attributes type validation (t/768) ──
//
// Catch data corruption at load time (e.g. a number where a string[] is expected)
// via a flight-recorder warning, instead of letting it surface as a downstream
// runtime crash (the SearchPanel TypeError). Warn-only — never rejects the file;
// downstream code still guards types defensively.

const GA_STRING_KEYS = ['epistemic_type', 'rhetorical_strategy', 'falsifiability',
  'audience', 'emotional_register', 'attribution_text', 'node_scope'];
const GA_STRING_ARRAY_KEYS = ['assumes', 'intellectual_lineage'];

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export interface GraphAttrMismatch { nodeId: string; key: string; expected: string; actual: string; }

/** Pure detector: list graph_attributes entries whose value type is unexpected. */
export function findGraphAttributeMismatches(parsed: unknown): GraphAttrMismatch[] {
  const out: GraphAttrMismatch[] = [];
  const nodes = (parsed as { nodes?: unknown })?.nodes;
  if (!Array.isArray(nodes)) return out;
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const node = n as { id?: unknown; graph_attributes?: unknown };
    const ga = node.graph_attributes;
    if (!ga || typeof ga !== 'object' || Array.isArray(ga)) continue;
    const nodeId = typeof node.id === 'string' ? node.id : '(unknown)';
    const attrs = ga as Record<string, unknown>;
    for (const key of GA_STRING_KEYS) {
      const v = attrs[key];
      if (v != null && typeof v !== 'string') out.push({ nodeId, key, expected: 'string', actual: describeType(v) });
    }
    for (const key of GA_STRING_ARRAY_KEYS) {
      const v = attrs[key];
      if (v == null) continue;
      if (!Array.isArray(v)) { out.push({ nodeId, key, expected: 'string[]', actual: describeType(v) }); continue; }
      const bad = v.find(el => typeof el !== 'string');
      if (bad !== undefined) out.push({ nodeId, key, expected: 'string[]', actual: `array with ${describeType(bad)} element` });
    }
  }
  return out;
}

/** Log graph_attributes type mismatches to the flight recorder (warn, best-effort). */
function validateGraphAttributes(parsed: unknown, pov: string): void {
  const recorder = getGlobalRecorder();
  if (!recorder) return;
  for (const m of findGraphAttributeMismatches(parsed)) {
    recorder.record({
      type: 'system.error',
      component: 'file-io',
      level: 'warn',
      message: `graph_attributes type mismatch (${pov} node ${m.nodeId}): ${m.key} expected ${m.expected}, got ${m.actual}`,
    });
  }
}

export async function loadSyntheticEmbeddings(): Promise<Record<string, { pov: string; vectors: number[][] }> | null> {
  const synDir = path.join(getTaxonomyDir(), 'synthetic');
  const result: Record<string, { pov: string; vectors: number[][] }> = {};
  let found = false;

  for (const pov of SYNTHETIC_POV_KEYS) {
    const npyPath = path.join(synDir, `embeddings_${pov}.npy`);
    const idxPath = path.join(synDir, `index_${pov}.json`);

    const [npyBuf, idxRaw] = await Promise.all([
      backend.readBinaryFile(npyPath),
      backend.readFile(idxPath, { ref: 'main' }),
    ]);
    if (!npyBuf || !idxRaw) continue;

    const parsed = parseNpy(npyBuf);
    const index = JSON.parse(idxRaw.replace(/^﻿/, '')) as Record<string, { start: number; count: number }>;
    Object.assign(result, extractNodeVectors(parsed, index, pov));
    found = true;
  }

  return found ? result : null;
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
  try { return JSON.parse(raw); } catch { /* telemetry — silent by design */ return null; }
}

// t/1541: write path for reviewer-entered crux external_evidence edits (mirrors
// writeEdgesFile). Callers ensureSessionBranch() first, so this lands on the
// caller's session branch. Regeneration safety (Export-AggregatedCruxes) is
// handled by Merge-CruxExternalEvidence.ps1 (t/1540), not here.
export async function writeAggregatedCruxes(data: unknown): Promise<void> {
  const filePath = path.join(getTaxonomyDir(), 'aggregated-cruxes.json');
  await backend.writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function readConflictClusters(): Promise<unknown | null> {
  const filePath = path.join(getConflictsDir(), '_conflict-clusters.json');
  const raw = await backend.readFile(filePath);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { /* telemetry — silent by design */ return null; }
}

// Conflicts are stored in a single wrapper file (t/689 / t/693) instead of
// ~1,244 individual {claimId}.json files (which cost 62 batched API reads to
// list). The 5-minute response cache lives in server.ts and is invalidated by
// the route handlers on create/write/delete — unchanged by this layer.
const CONFLICTS_FILE = 'conflicts.json';
const CONFLICTS_SCHEMA_VERSION = '2.0';

interface ConflictsWrapper {
  _schema_version: string;
  last_modified: string;
  conflict_count: number;
  conflicts: Record<string, unknown>[];
}

function conflictsFilePath(): string {
  return path.join(getConflictsDir(), CONFLICTS_FILE);
}

function claimIdOf(entry: unknown): string | undefined {
  return (entry as { claim_id?: string })?.claim_id;
}

/** Read the conflicts wrapper, tolerating a missing or malformed file (→ empty). */
async function readConflictsWrapper(): Promise<ConflictsWrapper> {
  const empty: ConflictsWrapper = {
    _schema_version: CONFLICTS_SCHEMA_VERSION,
    last_modified: new Date().toISOString(),
    conflict_count: 0,
    conflicts: [],
  };
  const raw = await backend.readFile(conflictsFilePath());
  if (raw === null) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<ConflictsWrapper>;
    const conflicts = Array.isArray(parsed.conflicts) ? parsed.conflicts as Record<string, unknown>[] : [];
    return {
      _schema_version: parsed._schema_version ?? CONFLICTS_SCHEMA_VERSION,
      last_modified: parsed.last_modified ?? empty.last_modified,
      conflict_count: conflicts.length,
      conflicts,
    };
  } catch {
    /* telemetry — silent by design; treat an unreadable conflicts file as empty */
    return empty;
  }
}

/** Persist the conflicts array, refreshing conflict_count + last_modified. */
async function writeConflictsWrapper(conflicts: Record<string, unknown>[]): Promise<void> {
  const wrapper: ConflictsWrapper = {
    _schema_version: CONFLICTS_SCHEMA_VERSION,
    last_modified: new Date().toISOString(),
    conflict_count: conflicts.length,
    conflicts,
  };
  await backend.writeFile(conflictsFilePath(), JSON.stringify(wrapper, null, 2));
}

export async function readAllConflictFiles(): Promise<unknown[]> {
  return (await readConflictsWrapper()).conflicts;
}

export async function writeConflictFile(claimId: string, data: unknown): Promise<void> {
  assertSafeId(claimId, 'claimId');
  const wrapper = await readConflictsWrapper();
  const idx = wrapper.conflicts.findIndex(c => claimIdOf(c) === claimId);
  if (idx === -1) throw new ActionableError({
    goal: 'Update conflict definition',
    problem: `Conflict not found: ${claimId}`,
    location: 'server/fileIO.ts → writeConflictFile',
    nextSteps: [
      `Verify that a conflict with claim_id "${claimId}" exists in ${CONFLICTS_FILE}`,
      'Use createConflictFile() to create a new conflict instead of writeConflictFile()',
      'Call readAllConflictFiles() to list available conflicts',
    ],
  });
  wrapper.conflicts[idx] = data as Record<string, unknown>;
  await writeConflictsWrapper(wrapper.conflicts);
}

export async function createConflictFile(claimId: string, data: unknown): Promise<void> {
  assertSafeId(claimId, 'claimId');
  const wrapper = await readConflictsWrapper();
  if (wrapper.conflicts.some(c => claimIdOf(c) === claimId)) throw new ActionableError({
    goal: 'Create conflict definition',
    problem: `Conflict already exists: ${claimId}`,
    location: 'server/fileIO.ts → createConflictFile',
    nextSteps: [
      `Use writeConflictFile() to update the existing conflict "${claimId}"`,
      'Delete the existing conflict first if you intend to replace it',
    ],
  });
  wrapper.conflicts.push(data as Record<string, unknown>);
  await writeConflictsWrapper(wrapper.conflicts);
}

export async function deleteConflictFile(claimId: string): Promise<void> {
  assertSafeId(claimId, 'claimId');
  const wrapper = await readConflictsWrapper();
  const filtered = wrapper.conflicts.filter(c => claimIdOf(c) !== claimId);
  // No-op if the claim wasn't present (mirrors the prior delete-missing behavior).
  if (filtered.length !== wrapper.conflicts.length) {
    await writeConflictsWrapper(filtered);
  }
}

// ── Lineage categories ──

export async function readLineageCategories(): Promise<unknown | null> {
  const filePath = path.join(getTaxonomyDir(), 'lineage_categories.json');
  const raw = await backend.readFile(filePath);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { /* telemetry — silent by design */ return null; }
}

// ── Lineage enrichments ──

let lineageInfoCache: Record<string, unknown> | null = null;

export async function readLineageEnrichments(): Promise<Record<string, unknown>> {
  if (lineageInfoCache) return lineageInfoCache;
  const filePath = path.join(getDataRoot(), 'calibration', 'core', 'lineage-enrichments.json');
  const raw = await backend.readFile(filePath, { optional: true });
  if (raw === null) return {};
  try {
    const data = JSON.parse(raw) as Record<string, { category?: string; description?: string; url?: string | null }>;
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(data)) {
      result[key] = {
        label: key,
        summary: entry.description ?? '',
        example: '',
        frequency: entry.category ? `Category: ${entry.category}` : '',
        links: entry.url ? [{ label: 'Reference', url: entry.url }] : [],
      };
    }
    lineageInfoCache = result;
    return result;
  } catch { /* telemetry — silent by design */ return {}; }
}

// ── Policy registry ──

export async function readOrganizations(): Promise<unknown | null> {
  try {
    const p = path.join(getTaxonomyDir(), 'organizations.json');
    const raw = await backend.readFile(p);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'file-io',
      level: 'error',
      message: 'readOrganizations failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return null;
  }
}

export async function readOrganizationEdges(): Promise<OrganizationEdge[] | null> {
  try {
    const p = path.join(getTaxonomyDir(), 'organization_edges.json');
    const raw = await backend.readFile(p);
    if (raw === null) return null;
    const data = JSON.parse(raw);
    return (data as { edges?: OrganizationEdge[] })?.edges ?? [];
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'file-io',
      level: 'error',
      message: 'readOrganizationEdges failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return null;
  }
}

export async function readPolicyRegistry(): Promise<unknown | null> {
  try {
    const taxDir = getTaxonomyDir();
    const p = path.join(taxDir, 'policy_actions.json');
    const exists = await backend.fileExists(p);
    log.server.debug({ taxDir, path: p, exists }, 'readPolicyRegistry');
    const raw = await backend.readFile(p);
    if (raw === null) return null;
    const data = JSON.parse(raw);
    const count = (data as { policies?: unknown[] })?.policies?.length ?? 0;
    log.server.debug({ count }, 'readPolicyRegistry loaded');
    return data;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'file-io',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    log.server.error({ err }, 'readPolicyRegistry failed');
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
    /* telemetry — silent by design */
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
  const summariesDir = resolveDataPath(loadDataConfig().summaries_dir);
  const sourcesDir = getSourcesDir();
  const index: NodeSourceIndex = {};

  const summaryFiles = await backend.listDirectory(summariesDir);
  if (summaryFiles.length === 0) return index;

  // Pre-load source metadata for titles/URLs.
  // Instead of checking isDirectory, we probe for metadata.json in each entry.
  const metaCache: Record<string, { title: string; url: string | null; sourceType: string; datePublished: string }> = {};
  const sourceEntries = sourcesDir ? await backend.listDirectory(sourcesDir) : [];
  for (const name of sourceEntries) {
    const metaPath = path.join(sourcesDir!, name, 'metadata.json');
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
    } catch { /* telemetry — silent by design;  skip */ }
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
    } catch { /* telemetry — silent by design */ continue; }

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
  const sourcesDir = getSourcesDir();

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
    } catch { /* telemetry — silent by design;  skip unavailable POV files */ }
  }

  // 3. Build node-source index
  const nodeSourceIdx = await buildNodeSourceIndex();

  // 4. Pre-load source metadata for dateIngested / sourceTime
  const metaCache: Record<string, { dateIngested: string; sourceTime: string }> = {};
  const sourceEntries = sourcesDir ? await backend.listDirectory(sourcesDir) : [];
  for (const name of sourceEntries) {
    const metaPath = path.join(sourcesDir!, name, 'metadata.json');
    try {
      const metaRaw = await backend.readFile(metaPath);
      if (metaRaw !== null) {
        const meta = JSON.parse(metaRaw);
        metaCache[name] = {
          dateIngested: meta.date_ingested || meta.date_published || '',
          sourceTime: meta.source_time || '',
        };
      }
    } catch { /* telemetry — silent by design;  skip */ }
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

// ── Anonymous session routing helper ──

function getAnonStore() {
  const store = getAnonymousSessionStore();
  const sessionId = getAnonymousSessionId();
  return store && sessionId ? { store, sessionId } : null;
}

// ── Debate sessions ──

function getDebatesDir(): string {
  const userId = getStorageUserId();
  if (userId === '_local') return resolveDataPath('debates');
  return resolveDataPath(`users/${userId}/debates`);
}

const DEBATE_INDEX_FILE = '_index.json';

/** Read the lightweight debate index (one file read).  Returns null if the index doesn't exist. */
async function readDebateIndex(): Promise<{ id: string; title: string; created_at: string; updated_at: string; phase: string }[] | null> {
  const backend = getUserContentBackend();
  const raw = await backend.readFile(path.join(getDebatesDir(), DEBATE_INDEX_FILE));
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { /* telemetry — silent by design */ return null; }
}

/** Write the debate index to disk. */
async function writeDebateIndex(entries: { id: string; title: string; created_at: string; updated_at: string; phase: string }[]): Promise<void> {
  const backend = getUserContentBackend();
  await backend.writeFile(
    path.join(getDebatesDir(), DEBATE_INDEX_FILE),
    JSON.stringify(entries, null, 2),
  );
}

/** Upsert a single debate entry in the index. */
async function upsertDebateIndex(summary: { id: string; title: string; created_at: string; updated_at: string; phase: string }): Promise<void> {
  const entries = (await readDebateIndex()) ?? [];
  const idx = entries.findIndex(e => e.id === summary.id);
  if (idx >= 0) entries[idx] = summary;
  else entries.push(summary);
  await writeDebateIndex(entries);
}

/** Remove a debate entry from the index by ID. */
async function removeFromDebateIndex(id: string): Promise<void> {
  const entries = await readDebateIndex();
  if (!entries) return;
  const filtered = entries.filter(e => e.id !== id);
  if (filtered.length !== entries.length) await writeDebateIndex(filtered);
}

/**
 * Fast debate listing — reads a single index file instead of every debate JSON.
 * Falls back to full scan (listDebateSessions) and rebuilds the index on first call
 * or when the file count in the tree doesn't match the index (staleness check).
 */
export async function listDebateSessionsMeta(): Promise<unknown[]> {
  if (isAnonymousUser()) { const a = getAnonStore(); return a ? await a.store.listDebatesMeta(a.sessionId) : []; }
  const backend = getUserContentBackend();
  const dir = getDebatesDir();
  const cached = await readDebateIndex();
  if (cached !== null && cached.length > 0) {
    // Lightweight staleness check: compare file count from tree with index size.
    // listDirectory() uses the in-memory repoTree — zero API calls.
    try {
      const files = (await backend.listDirectory(dir))
        .filter(f => f.endsWith('.json') && f.startsWith('debate-'));
      if (files.length === cached.length) return cached;
      // Count mismatch — rebuild in background, return stale data now for speed
      void rebuildDebateIndex().catch((err) => { log.server.warn({ err }, 'Background debate index rebuild failed'); });
      return cached;
    } catch {
      /* telemetry — silent by design */
      return cached; // tree unavailable — trust the index
    }
  }
  // Cold start: full scan to build the index
  return rebuildDebateIndex();
}

/** Full-scan rebuild of the debate index. */
async function rebuildDebateIndex(): Promise<unknown[]> {
  const summaries = await listDebateSessions();
  const typed = summaries as { id: string; title: string; created_at: string; updated_at: string; phase: string; model?: string; turn_count?: number }[];
  await writeDebateIndex(typed).catch((err) => { log.server.warn({ err }, 'Debate index write failed (best-effort)'); });
  return typed;
}

export async function listDebateSessions(): Promise<unknown[]> {
  if (isAnonymousUser()) { const a = getAnonStore(); return a ? await a.store.listDebates(a.sessionId) : []; }
  const backend = getUserContentBackend();
  const dir = getDebatesDir();
  const summaries: { id: string; title: string; created_at: string; updated_at: string; phase: string; model?: string; turn_count?: number }[] = [];

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
        const transcript = Array.isArray(raw.transcript) ? raw.transcript : [];
        summaries.push({
          id: raw.id,
          title: raw.title || raw.topic || 'Untitled',
          created_at: raw.created_at || '',
          updated_at: raw.updated_at || raw.created_at || '',
          phase: raw.phase || 'unknown',
          model: raw.debate_model,
          turn_count: transcript.filter((t: { type?: string }) => t.type === 'statement' || t.type === 'opening').length,
        });
      } catch { /* telemetry — silent by design;  skip */ }
    }
  }
  return summaries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function loadDebateSession(id: string): Promise<unknown> {
  assertSafeId(id, 'debate id');
  if (isAnonymousUser()) {
    const a = getAnonStore();
    const data = a ? await a.store.loadDebate(a.sessionId, id) : null;
    if (data === null) throw new ActionableError({ goal: 'Load debate session', problem: `Debate session not found: ${id}`, location: 'server/fileIO.ts → loadDebateSession (anonymous)', nextSteps: ['Verify the debate ID exists'] });
    return data;
  }
  const backend = getUserContentBackend();
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

/** Debate quota status for the current (non-anonymous) user — the exact count +
 *  cap the save path enforces. Shared by saveDebateSession and the read-only
 *  GET /api/debates/quota-status pre-check (t/1360) so the pre-check can never
 *  diverge from enforcement (Shared Utility Rule). */
export async function getDebatesQuotaStatus(): Promise<QuotaCheckResult> {
  const files = (await getUserContentBackend().listDirectory(getDebatesDir()))
    .filter(f => f.startsWith('debate-') && f.endsWith('.json'));
  return checkQuota('debates', files.length);
}

export async function saveDebateSession(session: unknown): Promise<void> {
  const s = session as { id: string; title?: string; topic?: { final?: string; original?: string }; created_at?: string; updated_at?: string; phase?: string };
  assertSafeId(s.id, 'debate id');
  if (isAnonymousUser()) { const a = getAnonStore(); if (a) await a.store.saveDebate(a.sessionId, session); return; }
  const backend = getUserContentBackend();
  const debatePath = path.join(getDebatesDir(), `debate-${s.id}.json`);
  const isNew = (await backend.readFile(debatePath)) === null;
  if (isNew) {
    const q = await getDebatesQuotaStatus();
    if (!q.allowed) {
      throw Object.assign(new ActionableError({ goal: 'Save debate session', problem: `Debate quota exceeded (${q.current}/${q.limit})`, location: 'server/fileIO.ts → saveDebateSession', nextSteps: ['Delete existing debates to free space'] }), { statusCode: 429, quotaInfo: q });
    }
  }
  const { json, hadError, errorMessage } = safeSerialize(session, 2);
  if (hadError) {
    log.server.warn({ debateId: s.id, errorMessage }, 'Debate session serialized with sanitizing replacer — non-serializable fields stripped');
  }
  await backend.writeFile(debatePath, json);
  // Maintain the lightweight index
  void upsertDebateIndex({
    id: s.id,
    title: s.title || s.topic?.final || s.topic?.original || 'Untitled',
    created_at: s.created_at || '',
    updated_at: s.updated_at || s.created_at || '',
    phase: s.phase || 'unknown',
  }).catch((err) => { log.server.warn({ err }, 'Debate index upsert failed (best-effort)'); });
}

export async function deleteDebateSession(id: string): Promise<void> {
  assertSafeId(id, 'debate id');
  if (isAnonymousUser()) { const a = getAnonStore(); if (a) await a.store.deleteDebate(a.sessionId, id); return; }
  const backend = getUserContentBackend();
  await backend.deleteFile(path.join(getDebatesDir(), `debate-${id}.json`));
  void removeFromDebateIndex(id).catch((err) => { log.server.warn({ err, debateId: id }, 'Debate index removal failed (best-effort)'); });
}

export async function loadDebateComments(debateId: string): Promise<unknown> {
  assertSafeId(debateId, 'debate id');
  if (isAnonymousUser()) {
    const a = getAnonStore();
    return (await a?.store.loadDebateComments(a.sessionId, debateId)) ?? { _schema_version: '1', debateId, comments: [] };
  }
  const backend = getUserContentBackend();
  const filePath = path.join(getDebatesDir(), `debate-${debateId}-comments.json`);
  const raw = await backend.readFile(filePath);
  if (raw === null) {
    return { _schema_version: '1', debateId, comments: [] };
  }
  return JSON.parse(raw);
}

export async function saveDebateComments(debateId: string, data: unknown): Promise<void> {
  assertSafeId(debateId, 'debate id');
  if (isAnonymousUser()) { const a = getAnonStore(); if (a) await a.store.saveDebateComments(a.sessionId, debateId, data); return; }
  const backend = getUserContentBackend();
  await backend.writeFile(
    path.join(getDebatesDir(), `debate-${debateId}-comments.json`),
    JSON.stringify(data, null, 2),
  );
}

// ── Chat sessions ──

function getChatsDir(): string {
  const userId = getStorageUserId();
  if (userId === '_local') return resolveDataPath('chats');
  return resolveDataPath(`users/${userId}/chats`);
}

export async function listChatSessions(): Promise<unknown[]> {
  if (isAnonymousUser()) { const a = getAnonStore(); return a ? await a.store.listChats(a.sessionId) : []; }
  const backend = getUserContentBackend();
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
    } catch { /* telemetry — silent by design;  skip */ }
  }
  return summaries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function loadChatSession(id: string): Promise<unknown> {
  assertSafeId(id, 'chat id');
  if (isAnonymousUser()) {
    const a = getAnonStore();
    const data = a ? await a.store.loadChat(a.sessionId, id) : null;
    if (data === null) throw new ActionableError({ goal: 'Load chat session', problem: `Chat session not found: ${id}`, location: 'server/fileIO.ts → loadChatSession (anonymous)', nextSteps: ['Verify the chat ID exists'] });
    return data;
  }
  const backend = getUserContentBackend();
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
  if (isAnonymousUser()) { const a = getAnonStore(); if (a) await a.store.saveChat(a.sessionId, session); return; }
  const backend = getUserContentBackend();
  const chatPath = path.join(getChatsDir(), `chat-${s.id}.json`);
  const isNew = (await backend.readFile(chatPath)) === null;
  if (isNew) {
    const files = (await backend.listDirectory(getChatsDir())).filter(f => f.startsWith('chat-') && f.endsWith('.json'));
    const q = checkQuota('chats', files.length);
    if (!q.allowed) {
      throw Object.assign(new ActionableError({ goal: 'Save chat session', problem: `Chat quota exceeded (${q.current}/${q.limit})`, location: 'server/fileIO.ts → saveChatSession', nextSteps: ['Delete existing chats to free space'] }), { statusCode: 429, quotaInfo: q });
    }
  }
  await backend.writeFile(chatPath, JSON.stringify(session, null, 2));
}

export async function deleteChatSession(id: string): Promise<void> {
  assertSafeId(id, 'chat id');
  if (isAnonymousUser()) { const a = getAnonStore(); if (a) await a.store.deleteChat(a.sessionId, id); return; }
  const backend = getUserContentBackend();
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
    /* telemetry — silent by design */
    return [];
  }
}

export async function saveProposal(filename: string, data: unknown): Promise<void> {
  assertSafeFilename(filename, 'proposal filename');
  await backend.writeFile(path.join(getDataRoot(), filename), JSON.stringify(data, null, 2));
}

// ── Admin feedback & error reports (t/837) ──
// Persisted through the user-content backend (Azure Blob in production) so they
// survive container restarts, instead of raw fs to the ephemeral data root.
// Filesystem/Electron mode falls back to the default backend (unchanged).

function adminDir(kind: 'feedback' | 'errors'): string {
  return path.join(getDataRoot(), 'admin', kind);
}

export async function saveFeedbackEntry(entry: { id: string; timestamp: string;[k: string]: unknown }): Promise<void> {
  const ts = entry.timestamp.replace(/:/g, '-');
  const file = path.join(adminDir('feedback'), `feedback-${ts}-${entry.id.slice(0, 8)}.json`);
  await getUserContentBackend().writeFile(file, JSON.stringify(entry, null, 2));
}

export async function saveErrorReport(entry: { id: string; timestamp: string;[k: string]: unknown }): Promise<void> {
  const ts = entry.timestamp.replace(/:/g, '-');
  const file = path.join(adminDir('errors'), `error-${ts}-${entry.id.slice(0, 8)}.json`);
  const sanitized = entry.context && typeof entry.context === 'object' && !Array.isArray(entry.context)
    ? { ...entry, context: redactRecord(entry.context as Record<string, unknown>) }
    : entry;
  await getUserContentBackend().writeFile(file, JSON.stringify(sanitized, null, 2));
}

async function readAdminEntries(kind: 'feedback' | 'errors', prefix: string): Promise<{ items: Record<string, unknown>[]; skipped: string[] }> {
  const ucb = getUserContentBackend();
  const dir = adminDir(kind);
  const items: Record<string, unknown>[] = [];
  const skipped: string[] = [];
  const files = (await ucb.listDirectory(dir)).filter(f => f.startsWith(prefix) && f.endsWith('.json'));
  for (const f of files) {
    try {
      const raw = await ucb.readFile(path.join(dir, f));
      if (raw == null) { skipped.push(f); continue; }
      const entry = JSON.parse(raw) as Record<string, unknown>;
      if (kind === 'feedback' && (entry.category === undefined || entry.category === null)) entry.category = 'general';
      items.push(entry);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'file-io', level: 'warn',
        message: `Failed to read/parse admin ${kind} entry; skipping`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        data: { file: f },
      });
      skipped.push(f);
    }
  }
  return { items, skipped };
}

/** All feedback entries via the backend (unsorted); missing category → 'general'. */
export async function listFeedbackEntries(): Promise<{ items: Record<string, unknown>[]; skipped: string[] }> {
  return readAdminEntries('feedback', 'feedback-');
}

/** All client error reports via the backend (unsorted). */
export async function listErrorEntries(): Promise<{ items: Record<string, unknown>[]; skipped: string[] }> {
  return readAdminEntries('errors', 'error-');
}

/** Read a single error report by ID. Returns null if not found or unparseable. */
export async function getErrorReport(id: string): Promise<Record<string, unknown> | null> {
  assertSafeId(id, 'error report id');
  const ucb = getUserContentBackend();
  const suffix = `-${id.slice(0, 8)}.json`;
  const files = (await ucb.listDirectory(adminDir('errors'))).filter(f => f.startsWith('error-') && f.endsWith(suffix));
  if (files.length === 0) return null;
  try {
    const raw = await ucb.readFile(path.join(adminDir('errors'), files[0]));
    if (raw == null) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'file-io', level: 'warn',
      message: 'Failed to read/parse error report',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      data: { errorId: id },
    });
    return null;
  }
}

const DUMP_FILENAME_RE = /^(client|server)-(.+)\.jsonl$/;

/** List flight recorder dump metadata from filenames + mtime (no file content read). */
export async function listFlightRecorderDumpIds(): Promise<Array<{ kind: 'client' | 'server'; dumpId: string; timestamp: string }>> {
  const dir = path.join(getDataRoot(), 'admin', 'flight-recorder-dumps');
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'file-io', level: 'warn',
      message: 'Failed to list flight recorder dumps directory',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return [];
  }
  const results: Array<{ kind: 'client' | 'server'; dumpId: string; timestamp: string }> = [];
  for (const name of names) {
    const m = DUMP_FILENAME_RE.exec(name);
    if (!m) continue;
    try {
      const stat = await fs.stat(path.join(dir, name));
      results.push({ kind: m[1] as 'client' | 'server', dumpId: m[2], timestamp: new Date(stat.mtimeMs).toISOString() });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'file-io', level: 'warn',
        message: 'Failed to stat flight recorder dump file; skipping',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        data: { file: name },
      });
    }
  }
  return results;
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
    } catch { /* telemetry — silent by design;  try next */ }
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
    } catch { /* telemetry — silent by design;  try next */ }
  }
  return false;
}

export async function harvestAddVerdict(conflictId: string, verdict: Record<string, unknown>): Promise<boolean> {
  assertSafeId(conflictId, 'conflict id'); // L4 (t/720): block path traversal before path construction
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

export function getSourcesDir(): string | null {
  // Sources may live in a separate repo (ai-triad-sources).
  // getSourcesRoot() returns null when the path doesn't exist.
  const sourcesRoot = getSourcesRoot();
  if (sourcesRoot) return sourcesRoot;

  // Legacy fallback: sources inside data repo (pre-separation layout).
  // In API mode the backend handles existence — skip local filesystem check.
  const config = loadDataConfig();
  const legacy = resolveDataPath(config.sources_dir);
  return (STORAGE_MODE === 'github-api' || fsSync.existsSync(legacy)) ? legacy : null;
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
  if (!sourcesDir) return []; // sources unavailable (web mode or repo not cloned)
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
    } catch { /* telemetry — silent by design;  skip */ }
  }
  return sources.sort((a, b) => a.title.localeCompare(b.title));
}

export async function loadSummary(docId: string): Promise<unknown | null> {
  assertSafeId(docId, 'document id');
  const filePath = path.join(getSummariesDir(), `${docId}.json`);
  const raw = await backend.readFile(filePath);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { /* telemetry — silent by design */ return null; }
}

export async function loadSnapshot(sourceId: string): Promise<string | null> {
  assertSafeId(sourceId, 'source id');
  const sourcesDir = getSourcesDir();
  if (!sourcesDir) return null; // sources unavailable
  return backend.readFile(path.join(sourcesDir, sourceId, 'snapshot.md'));
}

// ── Source document resolution ──

/** Result of resolving a fact's `doc_id` to an actual source document. */
export interface SourceDocumentResolution {
  available: boolean;
  type: 'pdf' | 'markdown' | null;
  /** Inline markdown content (markdown type only). */
  content?: string;
  /** Path/URL to fetch the document (pdf type only). Same-origin API URL in
   *  server mode; the Electron IPC mirror returns a local file path instead. */
  path?: string;
}

/** Find the raw PDF inside a source's `raw/` directory. Returns absolute path or null. */
async function findRawPdfPath(docId: string): Promise<string | null> {
  const sourcesDir = getSourcesDir();
  if (!sourcesDir) return null;
  const rawDir = path.join(sourcesDir, docId, 'raw');
  const entries = await backend.listDirectory(rawDir);
  const pdf = entries.find(e => e.toLowerCase().endsWith('.pdf'));
  return pdf ? path.join(rawDir, pdf) : null;
}

/**
 * Resolve a source document by id. Determines whether the document exists and
 * returns its content (markdown) or a URL to fetch it (PDF).
 *
 * Resolution order:
 *   1. metadata source_type 'pdf' (or only a PDF present) + a raw PDF → pdf
 *   2. snapshot.md present → markdown (content inline)
 *   3. a raw PDF present without snapshot → pdf
 *   4. otherwise → { available: false } (AC #3 graceful degradation)
 */
export async function resolveSourceDocument(docId: string): Promise<SourceDocumentResolution> {
  assertSafeId(docId, 'document id');
  const sourcesDir = getSourcesDir();
  if (!sourcesDir) return { available: false, type: null }; // sources unavailable

  const docDir = path.join(sourcesDir, docId);

  // Read metadata best-effort to learn the original document type.
  let sourceType = '';
  try {
    const metaRaw = await backend.readFile(path.join(docDir, 'metadata.json'));
    if (metaRaw) sourceType = String(JSON.parse(metaRaw).source_type ?? '').toLowerCase();
  } catch (err) {
    // Malformed/missing metadata — fall back to content detection below.
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'fileIO',
      level: 'warn',
      message: 'source document metadata unreadable',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }

  const pdfPath = await findRawPdfPath(docId);
  const snapshot = await backend.readFile(path.join(docDir, 'snapshot.md'));
  const fileUrl = `/api/source-documents/${encodeURIComponent(docId)}/file`;

  // Prefer markdown snapshot — renders inline with claim highlighting and
  // auto-scroll to the fact location. PDFs don't render in Electron's iframe.
  if (snapshot !== null) {
    return { available: true, type: 'markdown', content: snapshot };
  }
  if (pdfPath) {
    return { available: true, type: 'pdf', path: fileUrl };
  }
  return { available: false, type: null };
}

/** Read the raw PDF bytes for a source document. Returns null if absent. */
export async function readSourceDocumentPdf(docId: string): Promise<Buffer | null> {
  assertSafeId(docId, 'document id');
  const pdfPath = await findRawPdfPath(docId);
  if (!pdfPath) return null;
  return backend.readBinaryFile(pdfPath);
}

// ── Admin calibration curation (t/643) ──
//
// Per-user calibration metrics are appended to
// calibration/users/{origin}/calibration-log.jsonl (see lib/debate/calibrationLogger).
// An admin curates these: promoted entries are copied into the shared
// calibration/core/calibration-log.jsonl, and every promote/reject decision is
// recorded in calibration/integration-log.jsonl. The integration log is the
// source of truth for which entries are already resolved.

/** A calibration log entry. Only `debate_id` is required for curation; the rest is opaque. */
export interface CalibrationLogEntry {
  debate_id: string;
  [key: string]: unknown;
}

/** Audit record written to calibration/integration-log.jsonl on promote/reject. */
export interface CalibrationIntegrationRecord {
  action: 'promote' | 'reject';
  /** "users/{origin}" — the source user log the entries came from. */
  source: string;
  /** debate_ids that were promoted/rejected. */
  entries: string[];
  /** Admin userId who performed the action. */
  by: string;
  /** ISO 8601 timestamp. */
  at: string;
  /** Promotion notes (promote only). */
  notes?: string;
  /** Rejection reason (reject only). */
  reason?: string;
  /** debate_ids that had admin edit-on-promote corrections applied (promote only). */
  edited?: string[];
  /** Which curated file the entries belong to. Absent on legacy records → 'calibration-log'. */
  kind?: CalibrationKind | 'lineage-enrichments';
}

/** Calibration entries for one user that have not yet been promoted or rejected. */
export interface PendingCalibrationGroup {
  /** User directory name under calibration/users/. */
  origin: string;
  /** Canonical source identifier ("users/{origin}"). */
  source: string;
  /** Unresolved calibration entries for this user. */
  entries: CalibrationLogEntry[];
}

/** JSONL calibration file types curated through the staging→core workflow.
 *  Both are append-only and keyed by `debate_id` (t/621#2). */
export type CalibrationKind = 'calibration-log' | 'extraction-metrics';
const CALIBRATION_JSONL_FILE: Record<CalibrationKind, string> = {
  'calibration-log': 'calibration-log.jsonl',
  'extraction-metrics': 'extraction-metrics.jsonl',
};

function calibrationUsersDir(): string { return resolveDataPath(path.join('calibration', 'users')); }
function calibrationCoreLogPath(kind: CalibrationKind = 'calibration-log'): string {
  return resolveDataPath(path.join('calibration', 'core', CALIBRATION_JSONL_FILE[kind]));
}
function calibrationUserLogPath(origin: string, kind: CalibrationKind = 'calibration-log'): string {
  return path.join(calibrationUsersDir(), origin, CALIBRATION_JSONL_FILE[kind]);
}
function calibrationIntegrationLogPath(): string { return resolveDataPath(path.join('calibration', 'integration-log.jsonl')); }

/** Parse JSONL text into objects, skipping blank and malformed lines. */
function parseJsonlEntries<T = CalibrationLogEntry>(raw: string | null): T[] {
  if (!raw) return [];
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { out.push(JSON.parse(trimmed) as T); }
    catch { /* telemetry — silent by design; skip malformed JSONL line */ }
  }
  return out;
}

/** Read the promote/reject audit log. Returns [] when absent. */
export async function readCalibrationIntegrationLog(): Promise<CalibrationIntegrationRecord[]> {
  return parseJsonlEntries<CalibrationIntegrationRecord>(await backend.readFile(calibrationIntegrationLogPath(), { ref: 'main', optional: true }));
}

/** Resolution is per-kind: a debate can have both a calibration-log and an
 *  extraction-metrics entry sharing a debate_id, so an entry counts as resolved
 *  only when an integration record of the SAME kind lists it. Legacy records with
 *  no `kind` are treated as 'calibration-log'. */
async function resolvedCalibrationDebateIds(kind: CalibrationKind = 'calibration-log'): Promise<Set<string>> {
  const resolved = new Set<string>();
  for (const rec of await readCalibrationIntegrationLog()) {
    if ((rec.kind ?? 'calibration-log') !== kind) continue;
    for (const id of rec.entries ?? []) resolved.add(id);
  }
  return resolved;
}

/** Read one user's JSONL calibration entries for a given kind. */
async function readUserCalibrationLog(origin: string, kind: CalibrationKind = 'calibration-log'): Promise<CalibrationLogEntry[]> {
  return parseJsonlEntries(await backend.readFile(calibrationUserLogPath(origin, kind), { ref: 'main', optional: true }));
}

/**
 * List JSONL calibration entries across all users that have not been promoted or
 * rejected, grouped by user. Entries whose debate_id appears in a same-kind
 * integration record are excluded (AC #1). Defaults to the calibration-log kind.
 */
export async function listPendingCalibration(kind: CalibrationKind = 'calibration-log'): Promise<PendingCalibrationGroup[]> {
  const userDirs = await backend.listDirectory(calibrationUsersDir());
  const resolved = await resolvedCalibrationDebateIds(kind);

  const groups: PendingCalibrationGroup[] = [];
  for (const origin of userDirs) {
    if (!SAFE_ID_RE.test(origin)) continue; // skip stray non-id directory names
    const entries = (await readUserCalibrationLog(origin, kind))
      .filter(e => typeof e.debate_id === 'string' && !resolved.has(e.debate_id));
    if (entries.length > 0) groups.push({ origin, source: `users/${origin}`, entries });
  }
  groups.sort((a, b) => a.origin.localeCompare(b.origin));
  return groups;
}

/** Parse and validate a "users/{origin}" source string. Returns the origin. */
function parseCalibrationSource(source: string): string {
  const match = /^users\/(.+)$/.exec(source ?? '');
  if (!match) {
    throw new ActionableError({
      goal: 'Resolve calibration source',
      problem: `Invalid source "${source}": expected "users/{origin}"`,
      location: 'server/fileIO.ts → parseCalibrationSource',
      nextSteps: ['Pass source in the form "users/{origin}" (e.g. "users/local")'],
    });
  }
  const origin = match[1];
  assertSafeId(origin, 'calibration origin');
  return origin;
}

/** Append a record to the integration audit log (read-modify-write via backend). */
async function appendIntegrationRecord(record: CalibrationIntegrationRecord): Promise<void> {
  const logPath = calibrationIntegrationLogPath();
  const existing = (await backend.readFile(logPath, { ref: 'main', optional: true })) ?? '';
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? existing + '\n' : existing;
  await backend.writeFile(logPath, prefix + JSON.stringify(record) + '\n');
}

/**
 * Promote selected user entries into the core calibration log and record an
 * audit entry (AC #2). Only entries that actually exist in the user log are
 * promoted; returns the promoted debate_ids.
 *
 * Edit-on-promote (t/644 AC #6): `edits` maps a debate_id to a partial object
 * shallow-merged onto the matched entry before it is appended to core — lets an
 * admin correct e.g. lineage category/description without mutating the user's
 * source log. `debate_id` is always preserved from the original entry so an edit
 * can never re-key or detach an entry. Edited ids are noted in the audit record.
 */
export async function promoteCalibrationEntries(
  source: string,
  entryIds: string[],
  by: string,
  notes?: string,
  edits?: Record<string, Record<string, unknown>>,
  kind: CalibrationKind = 'calibration-log',
): Promise<{ promoted: number; entries: string[]; edited: string[] }> {
  const origin = parseCalibrationSource(source);
  const wanted = new Set(entryIds);
  const matched = (await readUserCalibrationLog(origin, kind))
    .filter(e => typeof e.debate_id === 'string' && wanted.has(e.debate_id));

  const editedIds: string[] = [];
  const toPromote = matched.map(e => {
    const patch = edits?.[e.debate_id];
    if (!patch || typeof patch !== 'object') return e;
    editedIds.push(e.debate_id);
    // Shallow-merge admin corrections, then pin debate_id back to the original.
    return { ...e, ...patch, debate_id: e.debate_id } as CalibrationLogEntry;
  });

  if (toPromote.length > 0) {
    const corePath = calibrationCoreLogPath(kind);
    const existing = (await backend.readFile(corePath, { ref: 'main', optional: true })) ?? '';
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? existing + '\n' : existing;
    const appended = toPromote.map(e => JSON.stringify(e)).join('\n') + '\n';
    await backend.writeFile(corePath, prefix + appended);
  }

  const promotedIds = toPromote.map(e => e.debate_id);
  await appendIntegrationRecord({
    action: 'promote',
    source: `users/${origin}`,
    entries: promotedIds,
    by,
    at: new Date().toISOString(),
    ...(notes ? { notes } : {}),
    ...(editedIds.length > 0 ? { edited: editedIds } : {}),
    ...(kind !== 'calibration-log' ? { kind } : {}),
  });
  return { promoted: promotedIds.length, entries: promotedIds, edited: editedIds };
}

/**
 * Record a rejection of selected user entries (AC #3). User files are never
 * modified — the rejection lives only in the integration audit log. Only ids
 * present in the user log are recorded.
 */
export async function rejectCalibrationEntries(
  source: string,
  entryIds: string[],
  by: string,
  reason: string,
  kind: CalibrationKind = 'calibration-log',
): Promise<{ rejected: number; entries: string[] }> {
  const origin = parseCalibrationSource(source);
  const wanted = new Set(entryIds);
  const rejectedIds = (await readUserCalibrationLog(origin, kind))
    .filter(e => typeof e.debate_id === 'string' && wanted.has(e.debate_id))
    .map(e => e.debate_id);

  await appendIntegrationRecord({
    action: 'reject',
    source: `users/${origin}`,
    entries: rejectedIds,
    by,
    at: new Date().toISOString(),
    reason,
    ...(kind !== 'calibration-log' ? { kind } : {}),
  });
  return { rejected: rejectedIds.length, entries: rejectedIds };
}

/** Read the curated core JSONL entries for a kind (for averages / comparison). */
export async function readCoreCalibrationEntries(kind: CalibrationKind = 'calibration-log'): Promise<CalibrationLogEntry[]> {
  return parseJsonlEntries(await backend.readFile(calibrationCoreLogPath(kind), { ref: 'main', optional: true }));
}

// ── Lineage enrichments curation (keyed-map variant, t/621#2 / t/647) ──

function lineageCoreMapPath(): string {
  return resolveDataPath(path.join('calibration', 'core', 'lineage-enrichments.json'));
}
function lineageUserMapPath(origin: string): string {
  return path.join(calibrationUsersDir(), origin, 'lineage-enrichments.json');
}

/** Read the curated core lineage-enrichments map (raw topic→value form). */
export async function readCoreLineageEnrichmentsMap(): Promise<Record<string, unknown>> {
  return readLineageMap(lineageCoreMapPath());
}

/** Read one user's raw lineage-enrichments map (topic→value). */
export async function readUserLineageEnrichmentsMap(origin: string): Promise<Record<string, unknown>> {
  assertSafeId(origin, 'calibration origin');
  return readLineageMap(lineageUserMapPath(origin));
}

/** Parse a topic-keyed enrichment map; tolerant of a missing/garbled file. */
async function readLineageMap(filePath: string): Promise<Record<string, unknown>> {
  // Lineage maps are shared calibration data on main, not on a session branch.
  const raw = await backend.readFile(filePath, { ref: 'main', optional: true });
  if (!raw) return {};
  try {
    const data = JSON.parse(raw.replace(/^﻿/, ''));
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
  } catch { /* telemetry — silent by design; treat unreadable map as empty */ return {}; }
}

/** Topic keys already promoted/rejected for lineage-enrichments (per-kind audit). */
async function resolvedLineageKeys(): Promise<Set<string>> {
  const resolved = new Set<string>();
  for (const rec of await readCalibrationIntegrationLog()) {
    if (rec.kind !== 'lineage-enrichments') continue;
    for (const k of rec.entries ?? []) resolved.add(k);
  }
  return resolved;
}

/** One user's lineage-enrichment keys not yet promoted/rejected, grouped by user. */
export async function listPendingLineageEnrichments(): Promise<Array<{ origin: string; source: string; keys: string[] }>> {
  const userDirs = await backend.listDirectory(calibrationUsersDir());
  const resolved = await resolvedLineageKeys();

  const groups: Array<{ origin: string; source: string; keys: string[] }> = [];
  for (const origin of userDirs) {
    if (!SAFE_ID_RE.test(origin)) continue;
    const keys = Object.keys(await readLineageMap(lineageUserMapPath(origin)))
      .filter(k => !resolved.has(k));
    if (keys.length > 0) groups.push({ origin, source: `users/${origin}`, keys });
  }
  groups.sort((a, b) => a.origin.localeCompare(b.origin));
  return groups;
}

/**
 * Promote selected topic keys from a user's lineage map into the core map.
 * Keys are case-normalized (lowercased) in core per t/621#2. `edits` may override
 * a key's value before the merge (edit-on-promote). Audit record kind =
 * 'lineage-enrichments', entries = the original (pre-normalization) user keys.
 */
export async function promoteLineageEnrichments(
  source: string,
  keys: string[],
  by: string,
  notes?: string,
  edits?: Record<string, Record<string, unknown>>,
): Promise<{ promoted: number; entries: string[]; edited: string[] }> {
  const origin = parseCalibrationSource(source);
  const userMap = await readLineageMap(lineageUserMapPath(origin));
  const wanted = keys.filter(k => Object.prototype.hasOwnProperty.call(userMap, k));

  if (wanted.length > 0) {
    const corePath = lineageCoreMapPath();
    const coreMap = await readLineageMap(corePath);
    const editedKeys: string[] = [];
    for (const k of wanted) {
      const patch = edits?.[k];
      const base = userMap[k];
      let value: unknown = base;
      if (patch && typeof patch === 'object') {
        editedKeys.push(k);
        value = (base && typeof base === 'object' && !Array.isArray(base))
          ? { ...(base as Record<string, unknown>), ...patch }
          : patch;
      }
      coreMap[k.toLowerCase()] = value; // case-normalized key in core
    }
    await backend.writeFile(corePath, JSON.stringify(coreMap, null, 2) + '\n');

    await appendIntegrationRecord({
      action: 'promote', source: `users/${origin}`, entries: wanted, by,
      at: new Date().toISOString(), kind: 'lineage-enrichments',
      ...(notes ? { notes } : {}),
      ...(editedKeys.length > 0 ? { edited: editedKeys } : {}),
    });
    return { promoted: wanted.length, entries: wanted, edited: editedKeys };
  }

  await appendIntegrationRecord({
    action: 'promote', source: `users/${origin}`, entries: [], by,
    at: new Date().toISOString(), kind: 'lineage-enrichments',
    ...(notes ? { notes } : {}),
  });
  return { promoted: 0, entries: [], edited: [] };
}

/** Reject selected lineage keys — audit only; the user map is never modified. */
export async function rejectLineageEnrichments(
  source: string,
  keys: string[],
  by: string,
  reason: string,
): Promise<{ rejected: number; entries: string[] }> {
  const origin = parseCalibrationSource(source);
  const userMap = await readLineageMap(lineageUserMapPath(origin));
  const rejected = keys.filter(k => Object.prototype.hasOwnProperty.call(userMap, k));

  await appendIntegrationRecord({
    action: 'reject', source: `users/${origin}`, entries: rejected, by,
    at: new Date().toISOString(), reason, kind: 'lineage-enrichments',
  });
  return { rejected: rejected.length, entries: rejected };
}

// ── Dictionary ──

export async function loadDictionary(): Promise<{ standardized: unknown[]; colloquial: unknown[]; lintViolations: unknown[] }> {
  const dictDir = resolveDataPath('dictionary');
  const stdDir = path.join(dictDir, 'standardized');
  const colDir = path.join(dictDir, 'colloquial');

  const standardized: unknown[] = [];
  try {
    const stdFiles = await backend.listDirectory(stdDir);
    for (const f of stdFiles.filter(f => f.endsWith('.json'))) {
      try {
        const raw = await backend.readFile(path.join(stdDir, f));
        if (raw) standardized.push(JSON.parse(raw));
      } catch { /* telemetry — silent by design;  skip malformed */ }
    }
  } catch { /* telemetry — silent by design;  directory may not exist */ }

  const colloquial: unknown[] = [];
  try {
    const colFiles = await backend.listDirectory(colDir);
    for (const f of colFiles.filter(f => f.endsWith('.json'))) {
      try {
        const raw = await backend.readFile(path.join(colDir, f));
        if (raw) colloquial.push(JSON.parse(raw));
      } catch { /* telemetry — silent by design;  skip malformed */ }
    }
  } catch { /* telemetry — silent by design;  directory may not exist */ }

  return { standardized, colloquial, lintViolations: [] };
}

// ── PowerShell prompts (project-root I/O — always local) ──

export async function readPsPrompt(promptName: string): Promise<{ text: string | null; error?: string }> {
  assertSafeFilename(promptName, 'prompt name'); // block path traversal (M1)
  const promptsDir = path.join(getProjectRoot(), 'scripts', 'AITriad', 'Prompts');
  const filePath = path.join(promptsDir, `${promptName}.prompt`);
  try {
    return { text: await fs.readFile(filePath, 'utf-8') };
  } catch {
    /* telemetry — silent by design */
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
    /* telemetry — silent by design */
    return [];
  }
}

// ── AI models config (project-root I/O — always local) ──

export async function loadAIModels(): Promise<unknown> {
  const configPath = path.join(getProjectRoot(), 'ai-models.json');
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf-8'));
  } catch {
    /* telemetry — silent by design */
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

/**
 * L5 (t/720): classify a resolved IP literal (IPv4 or IPv6) as private/internal.
 * Extends isPrivateIP with IPv6 loopback/ULA/link-local + IPv4-mapped handling,
 * for vetting addresses DNS returns (rebinding / SSRF defense).
 */
export function isBlockedAddress(addr: string): boolean {
  let ip = addr.trim().toLowerCase().split('%')[0]; // drop IPv6 zone id (fe80::1%eth0)
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped IPv6
  if (mapped) ip = mapped[1];

  if (ip.includes(':')) { // IPv6
    if (ip === '::1' || ip === '::') return true;                 // loopback / unspecified
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;  // fc00::/7 unique-local
    if (/^fe[89ab]/.test(ip)) return true;                        // fe80::/10 link-local
    return false;
  }
  // IPv4 — reuse isPrivateIP, plus the 0.0.0.0/8 "this-network" block.
  if (Number(ip.split('.')[0]) === 0) return true;
  return isPrivateIP(ip);
}

/**
 * L5: resolve `hostname` and reject if ANY resolved address is private/internal.
 * Defends against DNS rebinding where a public-looking host resolves to an
 * internal IP (e.g. cloud metadata 169.254.169.254). Residual TOCTOU is
 * minimized by checking immediately before the fetch.
 */
async function assertHostnameResolvesPublic(hostname: string): Promise<string | null> {
  let addresses: { address: string }[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'file-io',
      level: 'warn',
      message: `DNS resolution failed for fetch host "${hostname}"`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return 'DNS resolution failed';
  }
  if (addresses.length === 0) return 'DNS resolution returned no addresses';
  for (const a of addresses) {
    if (isBlockedAddress(a.address)) return 'URL resolves to a private/internal address';
  }
  return null;
}

function validateFetchUrl(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { /* telemetry — silent by design */ return 'Invalid URL'; }

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
  // L5 (t/720): vet the resolved IP, not just the hostname literal (DNS rebinding / SSRF).
  const dnsError = await assertHostnameResolvesPublic(new URL(url).hostname);
  if (dnsError) return { content: '', error: dnsError };

  try {
    const resp = await fetch(url, { redirect: 'manual' });
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location') || '';
      const redirectError = validateFetchUrl(location);
      if (redirectError) return { content: '', error: `Redirect blocked: ${redirectError}` };
      const redirectDnsError = await assertHostnameResolvesPublic(new URL(location).hostname);
      if (redirectDnsError) return { content: '', error: `Redirect blocked: ${redirectDnsError}` };
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
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'file-io',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
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
    /* telemetry — silent by design */
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
