// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';

import { app } from 'electron';

/** Walk up from __dirname to find the repo root (where .aitriad.json or scripts/ lives). */
function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.aitriad.json')) || fs.existsSync(path.join(dir, 'scripts', 'AITriad'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  // Fallback for packaged builds
  return path.dirname(app.getAppPath());
}

const PROJECT_ROOT = findRepoRoot();
console.log(`[fileIO] PROJECT_ROOT: ${PROJECT_ROOT} (from __dirname: ${__dirname})`);
const IS_PACKAGED = app?.isPackaged ?? false;

// ── Platform-specific default data directory ──
function getPlatformDataDir(): string {
  if (process.platform === 'darwin') {
    return path.join(app.getPath('home'), 'Library', 'Application Support', 'AITriad', 'data');
  } else if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || app.getPath('userData'), '..', 'AITriad', 'data');
  } else {
    const xdgData = process.env.XDG_DATA_HOME || path.join(app.getPath('home'), '.local', 'share');
    return path.join(xdgData, 'aitriad', 'data');
  }
}

// ── Data path resolution from .aitriad.json ──
interface AiTriadConfig {
  data_root: string;
  taxonomy_dir: string;
  sources_dir: string;
  summaries_dir: string;
  conflicts_dir: string;
  debates_dir: string;
  queue_file: string;
  version_file: string;
}

export function loadDataConfig(): AiTriadConfig {
  const defaults: AiTriadConfig = {
    data_root: IS_PACKAGED ? getPlatformDataDir() : '.',
    taxonomy_dir: 'taxonomy/Origin',
    sources_dir: 'sources',
    summaries_dir: 'summaries',
    conflicts_dir: 'conflicts',
    debates_dir: 'debates',
    queue_file: '.summarise-queue.json',
    version_file: 'TAXONOMY_VERSION',
  };

  // Search for .aitriad.json in multiple locations
  const searchPaths = [
    path.join(PROJECT_ROOT, '.aitriad.json'),
  ];
  if (IS_PACKAGED) {
    searchPaths.push(path.join(process.resourcesPath, '.aitriad.json'));
  }

  for (const configPath of searchPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        console.log(`[fileIO] Loaded config from ${configPath}`);
        return { ...defaults, ...raw };
      }
    } catch { /* try next */ }
  }

  console.log(`[fileIO] Using default config (packaged=${IS_PACKAGED}, data_root=${defaults.data_root})`);
  return defaults;
}

function resolveDataPath(subPath: string): string {
  const config = loadDataConfig();
  const envRoot = process.env.AI_TRIAD_DATA_ROOT;
  const dataRoot = envRoot || (path.isAbsolute(config.data_root)
    ? config.data_root
    : path.resolve(PROJECT_ROOT, config.data_root));
  return path.isAbsolute(subPath) ? subPath : path.resolve(dataRoot, subPath);
}

/** Check if data directory exists and has taxonomy files */
export function isDataAvailable(): boolean {
  try {
    const taxDir = resolveDataPath(loadDataConfig().taxonomy_dir);
    return fs.existsSync(taxDir) && fs.readdirSync(taxDir).some(f => f.endsWith('.json') && f !== 'embeddings.json' && f !== 'edges.json');
  } catch {
    return false;
  }
}

export function getDataRootPath(): string {
  return resolveDataPath('.');
}

/** Persist a new data_root into .aitriad.json. Caller should relaunch the app afterward. */
export function setDataRootPath(newRoot: string): void {
  const configPath = path.join(PROJECT_ROOT, '.aitriad.json');
  let existing: Record<string, unknown> = {};
  try {
    if (fs.existsSync(configPath)) {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch { /* start fresh */ }
  existing.data_root = newRoot;
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
  console.log(`[fileIO] Updated .aitriad.json data_root → ${newRoot}`);
}

const _config = loadDataConfig();
const TAXONOMY_BASE = path.dirname(resolveDataPath(_config.taxonomy_dir));
let activeTaxonomyDir = resolveDataPath(_config.taxonomy_dir);
const CONFLICTS_DIR = resolveDataPath(_config.conflicts_dir);
const SUMMARIES_DIR = resolveDataPath(_config.summaries_dir);
const SOURCES_DIR = resolveDataPath(_config.sources_dir);

export { PROJECT_ROOT, resolveDataPath };

const POV_FILE_MAP: Record<string, string> = {
  accelerationist: 'accelerationist.json',
  safetyist: 'safetyist.json',
  skeptic: 'skeptic.json',
  // Situations migration: renderer uses 'situations' key, resolves to situations.json (or cross-cutting.json fallback)
  'situations': 'situations.json',
};

/** Resolve the situations/cross-cutting file — tries situations.json first, falls back to cross-cutting.json. */
export function resolveSituationsFilePath(): string {
  const sitPath = path.join(activeTaxonomyDir, 'situations.json');
  if (fs.existsSync(sitPath)) return sitPath;
  return path.join(activeTaxonomyDir, 'cross-cutting.json');
}

export function getTaxonomyDirs(): string[] {
  if (!fs.existsSync(TAXONOMY_BASE)) return [];
  return fs.readdirSync(TAXONOMY_BASE, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'schemas')
    .map(d => d.name);
}

export function getActiveTaxonomyDirName(): string {
  return path.basename(activeTaxonomyDir);
}

export function setActiveTaxonomyDir(dirName: string): void {
  const newDir = path.join(TAXONOMY_BASE, dirName);
  if (!fs.existsSync(newDir)) {
    throw new Error(`Taxonomy directory not found: ${dirName}`);
  }
  activeTaxonomyDir = newDir;
}

/** Parse JSON with diagnostic error messages that identify the problem and suggest a fix. */
function parseJsonFile(filePath: string): unknown {
  // Strip UTF-8 BOM if present — PowerShell's Set-Content writes BOM by default
  const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const basename = path.basename(filePath);
    // Diagnose the specific problem
    let diagnosis: string;
    if (raw.length === 0) {
      diagnosis = `${basename} is empty (0 bytes). It may have been truncated during a failed write.`;
    } else if (fs.existsSync(filePath + '.tmp')) {
      diagnosis = `${basename} appears corrupted and a .tmp file exists, indicating a write was interrupted. ` +
        `Try: rename ${basename}.tmp to ${basename} to recover the last successful write.`;
    } else if (!raw.trimStart().startsWith('{') && !raw.trimStart().startsWith('[')) {
      diagnosis = `${basename} does not start with {{ or [ — it may not be JSON. First 100 chars: "${raw.slice(0, 100)}"`;
    } else {
      diagnosis = `${basename} contains malformed JSON. It may have been hand-edited incorrectly or truncated. Parse error: ${msg}`;
    }
    throw new Error(`${diagnosis} File: ${filePath}`);
  }
}

/** Write JSON atomically: write to .tmp then rename, preventing corruption on crash/disk-full. */
function writeJsonFileAtomic(filePath: string, data: unknown): void {
  const content = JSON.stringify(data, null, 2) + '\n';
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Clean up tmp file if rename failed
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to write ${path.basename(filePath)}: ${msg}. File: ${filePath}`);
  }
}

export function readTaxonomyFile(pov: string): unknown {
  // Situations migration: fall back to cross-cutting.json if situations.json doesn't exist
  if (pov === 'situations') {
    return parseJsonFile(resolveSituationsFilePath());
  }
  const filename = POV_FILE_MAP[pov];
  if (!filename) {
    throw new Error(`Unknown POV: ${pov}`);
  }
  return parseJsonFile(path.join(activeTaxonomyDir, filename));
}

export function writeTaxonomyFile(pov: string, data: unknown): void {
  // Situations migration: write to whichever file currently exists (prefer situations.json)
  if (pov === 'situations') {
    writeJsonFileAtomic(resolveSituationsFilePath(), data);
    return;
  }
  const filename = POV_FILE_MAP[pov];
  if (!filename) {
    throw new Error(`Unknown POV: ${pov}`);
  }
  writeJsonFileAtomic(path.join(activeTaxonomyDir, filename), data);
}

export function readPolicyRegistry(): unknown {
  const filePath = path.join(activeTaxonomyDir, 'policy_actions.json');
  if (!fs.existsSync(filePath)) return null;
  return parseJsonFile(filePath);
}

export function readConflictClusters(): unknown | null {
  const filePath = path.join(CONFLICTS_DIR, '_conflict-clusters.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    return parseJsonFile(filePath);
  } catch { return null; }
}

export function readAllConflictFiles(): unknown[] {
  if (!fs.existsSync(CONFLICTS_DIR)) {
    return [];
  }
  const files = fs.readdirSync(CONFLICTS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const results: unknown[] = [];
  for (const f of files) {
    try {
      results.push(parseJsonFile(path.join(CONFLICTS_DIR, f)));
    } catch (err) {
      console.warn(`[fileIO] Skipping corrupt conflict file ${f}:`, err);
    }
  }
  return results;
}

export function writeConflictFile(claimId: string, data: unknown): void {
  const filePath = path.join(CONFLICTS_DIR, `${claimId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Conflict file not found: ${claimId}`);
  }
  writeJsonFileAtomic(filePath, data);
}

export function createConflictFile(claimId: string, data: unknown): void {
  if (!fs.existsSync(CONFLICTS_DIR)) {
    fs.mkdirSync(CONFLICTS_DIR, { recursive: true });
  }
  const filePath = path.join(CONFLICTS_DIR, `${claimId}.json`);
  if (fs.existsSync(filePath)) {
    throw new Error(`Conflict file already exists: ${claimId}`);
  }
  writeJsonFileAtomic(filePath, data);
}

export function deleteConflictFile(claimId: string): void {
  const filePath = path.join(CONFLICTS_DIR, `${claimId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Conflict file not found: ${claimId}`);
  }
  fs.unlinkSync(filePath);
}

// ── Summaries & Sources ──

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

export function discoverSources(): DiscoveredSource[] {
  const config = loadDataConfig();
  const sourcesDir = resolveDataPath(config.sources_dir);
  const summariesDir = resolveDataPath(config.summaries_dir);
  if (!fs.existsSync(sourcesDir)) return [];

  const sources: DiscoveredSource[] = [];
  for (const entry of fs.readdirSync(sourcesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(sourcesDir, entry.name, 'metadata.json');
    try {
      if (!fs.existsSync(metaPath)) continue;
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const summaryPath = path.join(summariesDir, `${entry.name}.json`);
      sources.push({
        id: entry.name,
        title: meta.title || entry.name,
        url: meta.url || null,
        sourceType: meta.source_type || 'unknown',
        datePublished: meta.date_published || meta.source_time || '',
        dateIngested: meta.date_ingested || '',
        hasSummary: fs.existsSync(summaryPath),
        tags: meta.pov_tags || [],
        authors: meta.authors || [],
      });
    } catch { /* skip */ }
  }
  return sources.sort((a, b) => a.title.localeCompare(b.title));
}

export function loadSummary(docId: string): unknown | null {
  const config = loadDataConfig();
  const summariesDir = resolveDataPath(config.summaries_dir);
  const filePath = path.join(summariesDir, `${docId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return null; }
}

export function loadSnapshot(sourceId: string): string | null {
  const config = loadDataConfig();
  const sourcesDir = resolveDataPath(config.sources_dir);
  const filePath = path.join(sourcesDir, sourceId, 'snapshot.md');
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch { return null; }
}

export function readEdgesFile(): unknown | null {
  const edgesPath = path.join(activeTaxonomyDir, 'edges.json');
  if (!fs.existsSync(edgesPath)) return null;
  return parseJsonFile(edgesPath);
}

export function writeEdgesFile(data: unknown): void {
  const edgesPath = path.join(activeTaxonomyDir, 'edges.json');
  writeJsonFileAtomic(edgesPath, data);
}

// ── Node ↔ Source reverse index ──────────────────────────────────────────────

export interface SourceReference {
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

export type NodeSourceIndex = Record<string, SourceReference[]>;

/**
 * Scan all summary JSON files and build a reverse index:
 * nodeId → list of source references that mapped to it.
 * Also loads source metadata for titles/URLs.
 */
export function buildNodeSourceIndex(): NodeSourceIndex {
  const index: NodeSourceIndex = {};

  if (!fs.existsSync(SUMMARIES_DIR)) return index;

  // Pre-load source metadata for titles/URLs
  const metaCache: Record<string, { title: string; url: string | null; sourceType: string; datePublished: string }> = {};
  if (fs.existsSync(SOURCES_DIR)) {
    for (const entry of fs.readdirSync(SOURCES_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(SOURCES_DIR, entry.name, 'metadata.json');
      try {
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          metaCache[entry.name] = {
            title: meta.title || entry.name,
            url: meta.url || null,
            sourceType: meta.source_type || 'unknown',
            datePublished: meta.date_published || meta.source_time || '',
          };
        }
      } catch { /* skip */ }
    }
  }

  // Scan all summary files
  for (const file of fs.readdirSync(SUMMARIES_DIR)) {
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
      summary = JSON.parse(fs.readFileSync(path.join(SUMMARIES_DIR, file), 'utf-8'));
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

// ── Policy ↔ Source reverse index ─────────────────────────────────────────────

export interface PolicySourceReference {
  docId: string;
  title: string;
  dateIngested: string;
  sourceTime: string;
  stance: string;
  nodeId: string;
  pov: string;
}

export type PolicySourceIndex = Record<string, PolicySourceReference[]>;

/**
 * For each policy in policy_actions.json, find all nodes that reference it
 * (by scanning policy_actions in POV files), then use the node-source index
 * to find which sources reference those nodes.
 * Returns policyId → list of source references.
 */
export function buildPolicySourceIndex(): PolicySourceIndex {
  const result: PolicySourceIndex = {};

  // 1. Load policy registry to get all policy IDs
  const regRaw = readPolicyRegistry() as { policies?: { id: string }[] } | null;
  if (!regRaw?.policies) return result;
  for (const pol of regRaw.policies) {
    result[pol.id] = [];
  }

  // 2. Build node → policy mapping by scanning all POV files
  const nodeToPolicies = new Map<string, string[]>();
  for (const pov of Object.keys(POV_FILE_MAP)) {
    if (pov === 'situations') continue;
    try {
      const file = readTaxonomyFile(pov) as { nodes?: Array<{ id: string; graph_attributes?: { policy_actions?: { policy_id?: string }[] } }> };
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

  // 3. Build or reuse the node-source index
  const nodeSourceIdx = buildNodeSourceIndex();

  // 4. Pre-load source metadata for dateIngested / sourceTime
  const metaCache: Record<string, { dateIngested: string; sourceTime: string }> = {};
  if (fs.existsSync(SOURCES_DIR)) {
    for (const entry of fs.readdirSync(SOURCES_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(SOURCES_DIR, entry.name, 'metadata.json');
      try {
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          metaCache[entry.name] = {
            dateIngested: meta.date_ingested || meta.date_published || '',
            sourceTime: meta.source_time || '',
          };
        }
      } catch { /* skip */ }
    }
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
