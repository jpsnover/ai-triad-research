// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * File I/O service for the web server — mirrors the Electron main/fileIO.ts
 * logic without any Electron imports.
 */

import fs from 'fs';
import path from 'path';
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

export function readAllConflictFiles(): unknown[] {
  const dir = getConflictsDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
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
    const p = resolveDataPath('policy_actions.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
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

export function buildNodeSourceIndex(): Record<string, string[]> {
  const config = loadDataConfig();
  const sourcesDir = resolveDataPath(config.sources_dir);
  const index: Record<string, string[]> = {};
  if (!fs.existsSync(sourcesDir)) return index;
  for (const docId of fs.readdirSync(sourcesDir)) {
    const metaPath = path.join(sourcesDir, docId, 'metadata.json');
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      for (const tag of (meta.pov_tags || [])) {
        (index[tag] ??= []).push(docId);
      }
      for (const tag of (meta.topic_tags || [])) {
        (index[tag] ??= []).push(docId);
      }
    } catch { /* skip */ }
  }
  return index;
}

export function buildPolicySourceIndex(): Record<string, string[]> {
  const config = loadDataConfig();
  const sourcesDir = resolveDataPath(config.sources_dir);
  const index: Record<string, string[]> = {};
  if (!fs.existsSync(sourcesDir)) return index;
  for (const docId of fs.readdirSync(sourcesDir)) {
    const metaPath = path.join(sourcesDir, docId, 'metadata.json');
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      for (const ref of (meta.policy_refs || [])) {
        (index[ref] ??= []).push(docId);
      }
    } catch { /* skip */ }
  }
  return index;
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
    const { fetchUrlContent: fetchAndConvert } = await import('../../../lib/debate/taxonomyLoader');
    const markdown = await fetchAndConvert(url);
    return { content: markdown };
  } catch (err) {
    return { content: '', error: String(err) };
  }
}
