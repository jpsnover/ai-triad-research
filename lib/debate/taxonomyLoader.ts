// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Load taxonomy data from the filesystem for the CLI debate runner.
 * Resolves data root via .aitriad.json, loads all POV files, edges, embeddings, and policy registry.
 */

import fs from 'fs';
import path from 'path';
import type { PovNode, SituationNode, EdgesFile } from './taxonomyTypes';
import type { PolicyRef } from './taxonomyContext';

// ── Types ────────────────────────────────────────────────

export interface LoadedTaxonomy {
  accelerationist: { nodes: PovNode[] };
  safetyist: { nodes: PovNode[] };
  skeptic: { nodes: PovNode[] };
  situations: { nodes: SituationNode[] };
  edges: EdgesFile | null;
  embeddings: Record<string, { pov: string; vector: number[] }>;
  policyRegistry: PolicyRef[];
}

export interface ConflictFile {
  claim_id: string;
  claim_label: string;
  description: string;
  status: string;
  linked_taxonomy_nodes: string[];
  instances: { doc_id: string; stance: string; assertion: string }[];
}

// ── Data root resolution ─────────────────────────────────

interface AiTriadConfig {
  data_root: string;
  taxonomy_dir: string;
  conflicts_dir: string;
  debates_dir: string;
}

export function resolveRepoRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.aitriad.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Cannot find .aitriad.json — are you inside the ai-triad-research repo?');
}

export function resolveDataRoot(repoRoot: string): string {
  // Priority: env var > .aitriad.json
  if (process.env.AI_TRIAD_DATA_ROOT) {
    const envRoot = path.resolve(process.env.AI_TRIAD_DATA_ROOT);
    if (!fs.existsSync(envRoot)) {
      throw new Error(
        `AI_TRIAD_DATA_ROOT is set to '${envRoot}' but that directory does not exist.\n` +
        `Either create it, fix the environment variable, or unset it to use .aitriad.json.`
      );
    }
    return envRoot;
  }
  const config = loadConfig(repoRoot);
  const dataRoot = path.resolve(repoRoot, config.data_root);
  if (!fs.existsSync(dataRoot)) {
    throw new Error(
      `Data root '${dataRoot}' (from .aitriad.json data_root: '${config.data_root}') does not exist.\n` +
      `Run Install-AITriadData to set up the data repository, or set AI_TRIAD_DATA_ROOT to an existing directory.`
    );
  }
  return dataRoot;
}

function loadConfig(repoRoot: string): AiTriadConfig {
  const configPath = path.join(repoRoot, '.aitriad.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Configuration file not found: ${configPath}\n` +
      `Ensure you are running from the ai-triad-research repo root.`
    );
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    throw new Error(
      `Failed to parse ${configPath}: ${err instanceof Error ? err.message : err}\n` +
      `The file exists but contains invalid JSON.`
    );
  }
}

// ── Taxonomy loading ─────────────────────────────────────

function loadJsonSafe<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`[taxonomy-loader] Warning: File not found: ${filePath} — using empty default\n`);
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch (err) {
    process.stderr.write(`[taxonomy-loader] Warning: Failed to parse ${filePath}: ${err instanceof Error ? err.message : err} — using empty default\n`);
    return fallback;
  }
}

export function loadTaxonomy(repoRoot: string): LoadedTaxonomy {
  const dataRoot = resolveDataRoot(repoRoot);
  const config = loadConfig(repoRoot);
  const taxonomyDir = path.join(dataRoot, config.taxonomy_dir);

  const acc = loadJsonSafe<{ nodes: PovNode[] }>(path.join(taxonomyDir, 'accelerationist.json'), { nodes: [] });
  const saf = loadJsonSafe<{ nodes: PovNode[] }>(path.join(taxonomyDir, 'safetyist.json'), { nodes: [] });
  const skp = loadJsonSafe<{ nodes: PovNode[] }>(path.join(taxonomyDir, 'skeptic.json'), { nodes: [] });
  const sit = loadJsonSafe<{ nodes: SituationNode[] }>(path.join(taxonomyDir, 'situations.json'), { nodes: [] });
  const edges = loadJsonSafe<EdgesFile | null>(path.join(taxonomyDir, 'edges.json'), null);

  // Embeddings: { model, dimension, node_count, nodes: { [id]: { pov, vector } } }
  const embeddingsRaw = loadJsonSafe<{ nodes?: Record<string, { pov: string; vector: number[] }> }>(
    path.join(taxonomyDir, 'embeddings.json'),
    { nodes: {} },
  );
  const embeddings = embeddingsRaw.nodes ?? {};

  // Policy registry
  const policyRaw = loadJsonSafe<{ policies?: { id: string; action: string; source_povs?: string[] }[] }>(
    path.join(taxonomyDir, 'policy_actions.json'),
    { policies: [] },
  );
  const policyRegistry: PolicyRef[] = (policyRaw.policies ?? []).map(p => ({
    id: p.id,
    action: p.action,
    source_povs: p.source_povs,
  }));

  return {
    accelerationist: { nodes: acc.nodes ?? [] },
    safetyist: { nodes: saf.nodes ?? [] },
    skeptic: { nodes: skp.nodes ?? [] },
    situations: { nodes: sit.nodes ?? [] },
    edges,
    embeddings,
    policyRegistry,
  };
}

// ── Conflict loading ─────────────────────────────────────

export function loadConflicts(repoRoot: string): ConflictFile[] {
  const dataRoot = resolveDataRoot(repoRoot);
  const config = loadConfig(repoRoot);
  const conflictsDir = path.join(dataRoot, config.conflicts_dir);

  if (!fs.existsSync(conflictsDir)) return [];

  const files = fs.readdirSync(conflictsDir).filter(f => f.endsWith('.json'));
  return files.map(f => loadJsonSafe<ConflictFile>(path.join(conflictsDir, f), null as unknown as ConflictFile)).filter(Boolean);
}

// ── Markdown conversion via markitdown ──────────────────

/**
 * Convert a file to Markdown using Microsoft's markitdown CLI.
 * Falls back to raw content if markitdown is not installed.
 */
export async function convertToMarkdown(filePath: string): Promise<string> {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  // For .md files, just read directly
  if (resolved.endsWith('.md')) {
    return fs.readFileSync(resolved, 'utf-8');
  }

  try {
    return await runMarkitdown(resolved);
  } catch {
    process.stderr.write(`[taxonomy-loader] markitdown not available, reading raw content\n`);
    return fs.readFileSync(resolved, 'utf-8');
  }
}

/**
 * Convert HTML string to Markdown using markitdown via a temp file.
 */
export async function htmlToMarkdown(html: string): Promise<string> {
  const { tmpdir } = await import('os');
  const tmpFile = path.join(tmpdir(), `aitriad-${Date.now()}.html`);
  try {
    fs.writeFileSync(tmpFile, html, 'utf-8');
    return await runMarkitdown(tmpFile);
  } catch {
    process.stderr.write(`[taxonomy-loader] markitdown not available, stripping HTML tags\n`);
    return stripHtmlFallback(html);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

async function runMarkitdown(filePath: string): Promise<string> {
  const { execFile } = await import('child_process');
  return new Promise((resolve, reject) => {
    execFile('markitdown', [filePath], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

function stripHtmlFallback(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Source content loading ───────────────────────────────

export async function loadSourceContent(filePath: string): Promise<string> {
  return convertToMarkdown(filePath);
}

export async function fetchUrlContent(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const html = await response.text();
  return htmlToMarkdown(html);
}
