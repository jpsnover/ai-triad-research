// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * File I/O service for the web server — mirrors the Electron main/fileIO.ts
 * logic without any Electron imports.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { loadDataConfig, resolveDataPath, getDataRoot, getProjectRoot } from './config';

// ── Taxonomy directories ──

let activeTaxonomyDir = '';

export function getTaxonomyDirs(): string[] {
  const config = loadDataConfig();
  const taxonomyBase = resolveDataPath(path.dirname(config.taxonomy_dir));
  try {
    return fs.readdirSync(taxonomyBase)
      .filter(d => {
        const full = path.join(taxonomyBase, d);
        return fs.statSync(full).isDirectory()
          && fs.readdirSync(full).some(f => f.endsWith('.json') && f !== 'embeddings.json' && f !== 'edges.json');
      });
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

export function isDataAvailable(): boolean {
  const taxDir = getTaxonomyDir();
  try {
    const files = fs.readdirSync(taxDir);
    return files.some(f => f.endsWith('.json') && f !== 'embeddings.json' && f !== 'edges.json');
  } catch {
    return false;
  }
}

export function getDataRootPath(): string {
  return getDataRoot();
}

// ── Taxonomy CRUD ──

function resolveTaxonomyFilePath(pov: string): string {
  const taxDir = getTaxonomyDir();
  if (pov === 'situations') {
    const sitPath = path.join(taxDir, 'situations.json');
    if (fs.existsSync(sitPath)) return sitPath;
    const ccPath = path.join(taxDir, 'cross-cutting.json');
    if (fs.existsSync(ccPath)) return ccPath;
    return sitPath;
  }
  return path.join(taxDir, `${pov}.json`);
}

export function readTaxonomyFile(pov: string): unknown {
  const filePath = resolveTaxonomyFilePath(pov);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

export function writeTaxonomyFile(pov: string, data: unknown): void {
  const filePath = resolveTaxonomyFilePath(pov);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

// ── Conflict CRUD ──

function getConflictsDir(): string {
  const config = loadDataConfig();
  return resolveDataPath(config.conflicts_dir);
}

export function readConflictClusters(): unknown | null {
  const filePath = path.join(getConflictsDir(), '_conflict-clusters.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return null; }
}

export function readAllConflictFiles(): unknown[] {
  const dir = getConflictsDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const results: unknown[] = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
      results.push(JSON.parse(raw));
    } catch { /* skip corrupt files */ }
  }
  return results;
}

export function writeConflictFile(claimId: string, data: unknown): void {
  const filePath = path.join(getConflictsDir(), `${claimId}.json`);
  if (!fs.existsSync(filePath)) throw new Error(`Conflict file not found: ${claimId}`);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function createConflictFile(claimId: string, data: unknown): void {
  const dir = getConflictsDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${claimId}.json`);
  if (fs.existsSync(filePath)) throw new Error(`Conflict file already exists: ${claimId}`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function deleteConflictFile(claimId: string): void {
  const filePath = path.join(getConflictsDir(), `${claimId}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── Policy registry ──

export function readPolicyRegistry(): unknown | null {
  try {
    // policy_actions.json lives in the active taxonomy directory, not the data root
    const taxDir = getTaxonomyDir();
    const p = path.join(taxDir, 'policy_actions.json');
    console.log(`[fileIO] readPolicyRegistry: taxDir=${taxDir}, path=${p}, exists=${fs.existsSync(p)}`);
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
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

export function readEdgesFile(): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(getEdgesPath(), 'utf-8'));
  } catch {
    return null;
  }
}

export function writeEdgesFile(data: unknown): void {
  const p = getEdgesPath();
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

export function updateEdgeStatus(edges: unknown, index: number, status: string): unknown {
  const arr = edges as { edges: Record<string, unknown>[] };
  if (arr.edges && arr.edges[index]) {
    arr.edges[index].status = status;
    writeEdgesFile(arr);
  }
  return arr;
}

export function bulkUpdateEdges(edges: unknown, indices: number[], status: string): unknown {
  const arr = edges as { edges: Record<string, unknown>[] };
  if (arr.edges) {
    for (const i of indices) {
      if (arr.edges[i]) arr.edges[i].status = status;
    }
    writeEdgesFile(arr);
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
export function buildNodeSourceIndex(): NodeSourceIndex {
  const config = loadDataConfig();
  const summariesDir = resolveDataPath(config.summaries_dir);
  const sourcesDir = resolveDataPath(config.sources_dir);
  const index: NodeSourceIndex = {};

  if (!fs.existsSync(summariesDir)) return index;

  // Pre-load source metadata for titles/URLs
  const metaCache: Record<string, { title: string; url: string | null; sourceType: string; datePublished: string }> = {};
  if (fs.existsSync(sourcesDir)) {
    for (const entry of fs.readdirSync(sourcesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(sourcesDir, entry.name, 'metadata.json');
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
  for (const file of fs.readdirSync(summariesDir)) {
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
      summary = JSON.parse(fs.readFileSync(path.join(summariesDir, file), 'utf-8'));
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

const POV_NAMES = ['accelerationist', 'safetyist', 'skeptic'] as const;

/**
 * For each policy in policy_actions.json, find all nodes that reference it
 * (by scanning policy_actions in POV files), then use the node-source index
 * to find which sources reference those nodes.
 */
export function buildPolicySourceIndex(): PolicySourceIndex {
  const result: PolicySourceIndex = {};
  const config = loadDataConfig();
  const sourcesDir = resolveDataPath(config.sources_dir);

  // 1. Load policy registry to get all policy IDs
  const regRaw = readPolicyRegistry() as { policies?: { id: string }[] } | null;
  if (!regRaw?.policies) return result;
  for (const pol of regRaw.policies) {
    result[pol.id] = [];
  }

  // 2. Build node → policy mapping by scanning all POV files
  const nodeToPolicies = new Map<string, string[]>();
  for (const pov of POV_NAMES) {
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

  // 3. Build node-source index
  const nodeSourceIdx = buildNodeSourceIndex();

  // 4. Pre-load source metadata for dateIngested / sourceTime
  const metaCache: Record<string, { dateIngested: string; sourceTime: string }> = {};
  if (fs.existsSync(sourcesDir)) {
    for (const entry of fs.readdirSync(sourcesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(sourcesDir, entry.name, 'metadata.json');
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

// ── Debate sessions ──

function getDebatesDir(): string {
  const dir = resolveDataPath('debates');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listDebateSessions(): unknown[] {
  const dir = getDebatesDir();
  const files = fs.readdirSync(dir).filter(f => f.startsWith('debate-') && f.endsWith('.json'));
  const summaries: { id: string; title: string; created_at: string; updated_at: string; phase: string }[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      summaries.push({
        id: raw.id,
        title: raw.title || raw.topic || 'Untitled',
        created_at: raw.created_at || '',
        updated_at: raw.updated_at || raw.created_at || '',
        phase: raw.phase || 'unknown',
      });
    } catch { /* skip */ }
  }
  return summaries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function loadDebateSession(id: string): unknown {
  const filePath = path.join(getDebatesDir(), `debate-${id}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function saveDebateSession(session: unknown): void {
  const s = session as { id: string };
  const filePath = path.join(getDebatesDir(), `debate-${s.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
}

export function deleteDebateSession(id: string): void {
  const filePath = path.join(getDebatesDir(), `debate-${id}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── Chat sessions ──

function getChatsDir(): string {
  const dir = resolveDataPath('chats');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listChatSessions(): unknown[] {
  const dir = getChatsDir();
  const files = fs.readdirSync(dir).filter(f => f.startsWith('chat-') && f.endsWith('.json'));
  const summaries: { id: string; title: string; created_at: string; updated_at: string; mode: string; pover: string }[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      summaries.push({
        id: raw.id,
        title: raw.title || 'Untitled',
        created_at: raw.created_at || '',
        updated_at: raw.updated_at || raw.created_at || '',
        mode: raw.mode || '',
        pover: raw.pover || '',
      });
    } catch { /* skip */ }
  }
  return summaries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function loadChatSession(id: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(getChatsDir(), `chat-${id}.json`), 'utf-8'));
}

export function saveChatSession(session: unknown): void {
  const s = session as { id: string };
  fs.writeFileSync(path.join(getChatsDir(), `chat-${s.id}.json`), JSON.stringify(session, null, 2), 'utf-8');
}

export function deleteChatSession(id: string): void {
  const p = path.join(getChatsDir(), `chat-${id}.json`);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// ── Proposals ──

export function listProposals(): unknown[] {
  const dir = getDataRoot();
  try {
    return fs.readdirSync(dir)
      .filter(f => f.startsWith('taxonomy-proposal') && f.endsWith('.json'))
      .map(f => {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        return { filename: f, ...raw };
      });
  } catch {
    return [];
  }
}

export function saveProposal(filename: string, data: unknown): void {
  fs.writeFileSync(path.join(getDataRoot(), filename), JSON.stringify(data, null, 2), 'utf-8');
}

// ── Harvest operations ──

export function harvestCreateConflict(conflict: Record<string, unknown>): boolean {
  const id = conflict.claim_id as string || conflict.id as string;
  if (!id) return false;
  const dir = getConflictsDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(conflict, null, 2), 'utf-8');
  return true;
}

export function harvestAddDebateRef(nodeId: string, debateId: string): boolean {
  // Find which POV file contains this node and update it
  const taxDir = getTaxonomyDir();
  for (const pov of ['accelerationist', 'safetyist', 'skeptic', 'situations']) {
    try {
      const filePath = resolveTaxonomyFilePath(pov);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const nodes = data.nodes || data;
      const node = Array.isArray(nodes) ? nodes.find((n: Record<string, unknown>) => n.id === nodeId) : null;
      if (node) {
        if (!node.debate_refs) node.debate_refs = [];
        if (!node.debate_refs.includes(debateId)) {
          node.debate_refs.push(debateId);
          const tmp = filePath + '.tmp';
          fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
          fs.renameSync(tmp, filePath);
        }
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

export function harvestUpdateSteelman(nodeId: string, attackerPov: string, newText: string): boolean {
  for (const pov of ['accelerationist', 'safetyist', 'skeptic', 'situations']) {
    try {
      const filePath = resolveTaxonomyFilePath(pov);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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
        const tmp = filePath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tmp, filePath);
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

export function harvestAddVerdict(conflictId: string, verdict: Record<string, unknown>): boolean {
  const filePath = path.join(getConflictsDir(), `${conflictId}.json`);
  if (!fs.existsSync(filePath)) return false;
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  data.verdict = verdict;
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
  return true;
}

export function harvestQueueConcept(concept: Record<string, unknown>): boolean {
  const dir = resolveDataPath('harvests');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `concept-${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(concept, null, 2), 'utf-8');
  return true;
}

export function harvestSaveManifest(manifest: Record<string, unknown>): boolean {
  const dir = resolveDataPath('harvests');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `manifest-${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), 'utf-8');
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

export function discoverSources(): DiscoveredSource[] {
  const sourcesDir = getSourcesDir();
  const summariesDir = getSummariesDir();
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
  const summariesDir = getSummariesDir();
  const filePath = path.join(summariesDir, `${docId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return null; }
}

export function loadSnapshot(sourceId: string): string | null {
  const sourcesDir = getSourcesDir();
  const filePath = path.join(sourcesDir, sourceId, 'snapshot.md');
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch { return null; }
}

// ── PowerShell prompts ──

export function readPsPrompt(promptName: string): { text: string | null; error?: string } {
  const promptsDir = path.join(getProjectRoot(), 'scripts', 'AITriad', 'Prompts');
  const filePath = path.join(promptsDir, `${promptName}.prompt`);
  try {
    return { text: fs.readFileSync(filePath, 'utf-8') };
  } catch {
    return { text: null, error: `Prompt not found: ${promptName}` };
  }
}

export function listPsPrompts(): string[] {
  const promptsDir = path.join(getProjectRoot(), 'scripts', 'AITriad', 'Prompts');
  try {
    return fs.readdirSync(promptsDir)
      .filter(f => f.endsWith('.prompt'))
      .map(f => f.replace('.prompt', ''));
  } catch {
    return [];
  }
}

// ── AI models config ──

export function loadAIModels(): unknown {
  const configPath = path.join(getProjectRoot(), 'ai-models.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return { backends: [], models: [], defaults: {} };
  }
}

// ── URL content fetching ──

export async function fetchUrlContent(url: string): Promise<{ content: string; error?: string }> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return { content: '', error: `HTTP ${resp.status}` };
    const html = await resp.text();
    const markdown = await htmlToMarkdown(html);
    return { content: markdown };
  } catch (err) {
    return { content: '', error: String(err) };
  }
}

function htmlToMarkdown(html: string): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `aitriad-${Date.now()}.html`);
  fs.writeFileSync(tmpFile, html, 'utf-8');
  return new Promise((resolve) => {
    execFile('markitdown', [tmpFile], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      if (err) {
        // Fallback: strip HTML tags
        resolve(stripHtmlFallback(html));
      } else {
        resolve(stdout);
      }
    });
  });
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
