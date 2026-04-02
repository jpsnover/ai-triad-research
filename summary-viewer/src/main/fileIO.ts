// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';

import { app } from 'electron';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
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
}

function loadDataConfig(): AiTriadConfig {
  const defaults: AiTriadConfig = {
    data_root: IS_PACKAGED ? getPlatformDataDir() : '.',
    taxonomy_dir: 'taxonomy/Origin',
    sources_dir: 'sources',
    summaries_dir: 'summaries',
    conflicts_dir: 'conflicts',
  };

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

export function resolveDataPath(subPath: string): string {
  const config = loadDataConfig();
  const envRoot = process.env.AI_TRIAD_DATA_ROOT;
  const dataRoot = envRoot || (path.isAbsolute(config.data_root)
    ? config.data_root
    : path.resolve(PROJECT_ROOT, config.data_root));
  return path.isAbsolute(subPath) ? subPath : path.resolve(dataRoot, subPath);
}

/** Parse JSON with diagnostic error messages that identify the problem and suggest a fix. */
function parseJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const basename = path.basename(filePath);
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

/** Write JSON atomically: write to .tmp then rename. */
function writeJsonFileAtomic(filePath: string, data: unknown): void {
  const content = JSON.stringify(data, null, 2) + '\n';
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to write ${path.basename(filePath)}: ${msg}. File: ${filePath}`);
  }
}

const _config = loadDataConfig();
const SOURCES_DIR = resolveDataPath(_config.sources_dir);
const SUMMARIES_DIR = resolveDataPath(_config.summaries_dir);
const TAXONOMY_BASE = path.dirname(resolveDataPath(_config.taxonomy_dir));
let activeTaxonomyDir = resolveDataPath(_config.taxonomy_dir);

export interface DiscoveredSource {
  id: string;
  title: string;
  sourceType: string;
  url: string | null;
  authors: string[];
  dateIngested: string;
  importTime: string;
  sourceTime: string;
  povTags: string[];
  topicTags: string[];
  oneLiner: string;
  hasSummary: boolean;
}

export interface PipelineSummary {
  doc_id: string;
  taxonomy_version: string;
  generated_at: string;
  ai_model: string;
  temperature: number;
  pov_summaries: Record<string, {
    stance?: string;
    key_points: Array<{
      taxonomy_node_id: string | null;
      category: string;
      point: string;
      verbatim?: string;
      excerpt_context: string;
      stance?: string;
    }>;
  }>;
  factual_claims: Array<{
    claim: string;
    doc_position: string;
    potential_conflict_id: string | null;
  }>;
  unmapped_concepts: Array<{
    concept: string;
    suggested_label?: string;
    suggested_description?: string;
    suggested_pov: string;
    suggested_category: string;
    reason: string;
    resolved_node_id?: string;
    'Accelerationist Interpretation'?: string;
    'Safetyist Interpretation'?: string;
    'Skeptic Interpretation'?: string;
  }>;
}

export function discoverSources(): DiscoveredSource[] {
  const results: DiscoveredSource[] = [];

  if (!fs.existsSync(SOURCES_DIR)) return results;

  const dirs = fs.readdirSync(SOURCES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dirs) {
    const metaPath = path.join(SOURCES_DIR, dir.name, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

      // Check if summary exists — only include sources with summaries
      const summaryPath = path.join(SUMMARIES_DIR, `${dir.name}.json`);
      const hasSummary = fs.existsSync(summaryPath);
      if (!hasSummary) continue;

      results.push({
        id: meta.id || dir.name,
        title: meta.title || dir.name,
        sourceType: meta.source_type || 'unknown',
        url: meta.url || null,
        authors: meta.authors || [],
        dateIngested: meta.date_ingested || '',
        importTime: meta.import_time || meta.date_ingested || '',
        sourceTime: meta.source_time || meta.date_published || '',
        povTags: meta.pov_tags || [],
        topicTags: meta.topic_tags || [],
        oneLiner: meta.one_liner || '',
        hasSummary,
      });
    } catch {
      // Skip sources with invalid metadata
    }
  }

  return results;
}

export function loadSummary(docId: string): PipelineSummary | null {
  const summaryPath = path.join(SUMMARIES_DIR, `${docId}.json`);
  if (!fs.existsSync(summaryPath)) return null;
  return parseJsonFile(summaryPath) as PipelineSummary;
}

export interface GraphAttributes {
  epistemic_type?: string;
  rhetorical_strategy?: string;
  assumes?: string[];
  falsifiability?: string;
  audience?: string;
  emotional_register?: string;
  intellectual_lineage?: string[];
  steelman_vulnerability?: string;
}

export interface TaxonomyNode {
  id: string;
  category: string;
  label: string;
  description: string;
  graph_attributes?: GraphAttributes;
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

export function loadTaxonomy(): Record<string, TaxonomyNode> {
  const result: Record<string, TaxonomyNode> = {};

  if (!fs.existsSync(activeTaxonomyDir)) return result;

  const files = fs.readdirSync(activeTaxonomyDir)
    .filter(f => f.endsWith('.json') && !['embeddings.json', 'edges.json', 'policy_actions.json', 'Temp.json'].includes(f));

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(activeTaxonomyDir, file), 'utf-8'));
      if (!Array.isArray(raw.nodes)) continue;
      for (const node of raw.nodes) {
        if (node.id) {
          result[node.id] = {
            id: node.id,
            category: node.category || '',
            label: node.label || '',
            description: node.description || '',
            graph_attributes: node.graph_attributes || undefined,
          };
        }
      }
    } catch {
      // Skip invalid taxonomy files
    }
  }

  return result;
}

export function readPolicyRegistry(): unknown {
  const filePath = path.join(activeTaxonomyDir, 'policy_actions.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

const POV_FILE_MAP: Record<string, string> = {
  accelerationist: 'accelerationist.json',
  safetyist: 'safetyist.json',
  skeptic: 'skeptic.json',
  'cross-cutting': 'cross-cutting.json',
};

const POV_PREFIX_MAP: Record<string, string> = {
  accelerationist: 'acc',
  safetyist: 'saf',
  skeptic: 'skp',
  'cross-cutting': 'cc',
};

const CATEGORY_PREFIX_MAP: Record<string, string> = {
  'Desires': 'goals',
  'Beliefs': 'data',
  'Intentions': 'methods',
};

export interface AddTaxonomyNodeRequest {
  pov: string;
  category: string;
  label: string;
  description: string;
  interpretations?: {
    accelerationist: string;
    safetyist: string;
    skeptic: string;
  };
  /** If provided, marks the unmapped concept as resolved in the summary JSON */
  docId?: string;
  conceptIndex?: number;
}

export interface AddTaxonomyNodeResult {
  success: boolean;
  nodeId: string;
  error?: string;
}

export function addTaxonomyNode(req: AddTaxonomyNodeRequest): AddTaxonomyNodeResult {
  const fileName = POV_FILE_MAP[req.pov];
  if (!fileName) {
    return { success: false, nodeId: '', error: `Unknown POV: ${req.pov}` };
  }

  const filePath = path.join(activeTaxonomyDir, fileName);
  if (!fs.existsSync(filePath)) {
    return { success: false, nodeId: '', error: `Taxonomy file not found: ${fileName}` };
  }

  const isCrossCutting = req.pov === 'cross-cutting';
  const povPrefix = POV_PREFIX_MAP[req.pov];

  if (!isCrossCutting) {
    const catPrefix = CATEGORY_PREFIX_MAP[req.category];
    if (!catPrefix) {
      return { success: false, nodeId: '', error: `Unknown category: ${req.category}` };
    }
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(raw.nodes)) {
      return { success: false, nodeId: '', error: 'Taxonomy file has no nodes array' };
    }

    // Check for duplicate labels — if an existing node has the same label, return it instead of creating a new one
    const normalizedLabel = req.label.trim().toLowerCase();
    const existing = raw.nodes.find((n: { label?: string }) =>
      typeof n.label === 'string' && n.label.trim().toLowerCase() === normalizedLabel
    );
    if (existing) {
      console.log(`[addTaxonomyNode] Duplicate label detected: "${req.label}" matches existing node ${existing.id} — returning existing node`);
      return { success: true, nodeId: existing.id };
    }

    let newId: string;

    if (isCrossCutting) {
      // Cross-cutting IDs: cc-NNN
      const prefix = `${povPrefix}-`;
      let maxNum = 0;
      for (const node of raw.nodes) {
        if (typeof node.id === 'string' && node.id.startsWith(prefix)) {
          const numStr = node.id.slice(prefix.length);
          const num = parseInt(numStr, 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
      newId = `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
    } else {
      // POV IDs: pov-category-NNN
      const catPrefix = CATEGORY_PREFIX_MAP[req.category];
      const prefix = `${povPrefix}-${catPrefix}-`;
      let maxNum = 0;
      for (const node of raw.nodes) {
        if (typeof node.id === 'string' && node.id.startsWith(prefix)) {
          const numStr = node.id.slice(prefix.length);
          const num = parseInt(numStr, 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
      newId = `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
    }

    const newNode = isCrossCutting
      ? {
          id: newId,
          label: req.label,
          description: req.description,
          interpretations: req.interpretations || {
            accelerationist: '',
            safetyist: '',
            skeptic: '',
          },
          linked_nodes: [],
          conflict_ids: [],
        }
      : {
          id: newId,
          category: req.category,
          label: req.label,
          description: req.description,
          parent_id: null,
          children: [],
          cross_cutting_refs: [],
        };

    raw.nodes.push(newNode);
    raw.last_modified = new Date().toISOString().split('T')[0];

    writeJsonFileAtomic(filePath, raw);

    // Mark the unmapped concept as resolved in the summary JSON
    if (req.docId != null && req.conceptIndex != null) {
      try {
        const summaryPath = path.join(SUMMARIES_DIR, `${req.docId}.json`);
        if (fs.existsSync(summaryPath)) {
          const summary = parseJsonFile(summaryPath) as Record<string, unknown>;
          const concepts = summary.unmapped_concepts as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(concepts) && concepts[req.conceptIndex]) {
            concepts[req.conceptIndex].resolved_node_id = newId;
            writeJsonFileAtomic(summaryPath, summary);
          }
        }
      } catch {
        // Non-fatal — taxonomy node was created successfully even if summary update fails
      }
    }

    return { success: true, nodeId: newId };
  } catch (err) {
    return { success: false, nodeId: '', error: String(err) };
  }
}

// ── Enrichment pipeline helpers ──────────────────────────────────────────────

/** Map node ID prefix to POV file name */
function povFileForNodeId(nodeId: string): string | null {
  if (nodeId.startsWith('acc-')) return 'accelerationist.json';
  if (nodeId.startsWith('saf-')) return 'safetyist.json';
  if (nodeId.startsWith('skp-')) return 'skeptic.json';
  if (nodeId.startsWith('cc-')) return 'cross-cutting.json';
  return null;
}

/** Map node ID prefix to POV name */
function povNameForNodeId(nodeId: string): string {
  if (nodeId.startsWith('acc-')) return 'accelerationist';
  if (nodeId.startsWith('saf-')) return 'safetyist';
  if (nodeId.startsWith('skp-')) return 'skeptic';
  return 'cross-cutting';
}

/**
 * Patch fields on an existing taxonomy node. If parent_id is being set,
 * also updates the parent's children array.
 */
export function updateNodeFields(
  nodeId: string,
  fields: Record<string, unknown>,
): { success: boolean; error?: string } {
  const fileName = povFileForNodeId(nodeId);
  if (!fileName) return { success: false, error: `Cannot determine POV file for ${nodeId}` };

  const filePath = path.join(activeTaxonomyDir, fileName);
  if (!fs.existsSync(filePath)) return { success: false, error: `File not found: ${fileName}` };

  try {
    const raw = parseJsonFile(filePath) as { nodes: Record<string, unknown>[]; last_modified?: string };
    if (!Array.isArray(raw.nodes)) return { success: false, error: 'No nodes array in taxonomy file' };

    const node = raw.nodes.find((n) => n.id === nodeId);
    if (!node) return { success: false, error: `Node ${nodeId} not found in ${fileName}` };

    // Merge fields onto the node
    for (const [key, value] of Object.entries(fields)) {
      // For source_refs, append rather than replace
      if (key === 'source_refs' && Array.isArray(value)) {
        const existing = Array.isArray(node.source_refs) ? node.source_refs as string[] : [];
        const merged = [...new Set([...existing, ...value as string[]])];
        node.source_refs = merged;
      } else {
        node[key] = value;
      }
    }

    // If parent_id was set, update the parent's children array
    if ('parent_id' in fields && fields.parent_id) {
      const parentId = fields.parent_id as string;
      const parentFileName = povFileForNodeId(parentId);

      if (parentFileName === fileName) {
        // Same file — update in place
        const parent = raw.nodes.find((n) => n.id === parentId);
        if (parent) {
          const children = Array.isArray(parent.children) ? parent.children as string[] : [];
          if (!children.includes(nodeId)) {
            children.push(nodeId);
            parent.children = children;
          }
        }
      } else if (parentFileName) {
        // Different file (cross-POV parent) — update separately
        const parentPath = path.join(activeTaxonomyDir, parentFileName);
        if (fs.existsSync(parentPath)) {
          const parentRaw = parseJsonFile(parentPath) as { nodes: Record<string, unknown>[]; last_modified?: string };
          const parent = parentRaw.nodes?.find((n) => n.id === parentId);
          if (parent) {
            const children = Array.isArray(parent.children) ? parent.children as string[] : [];
            if (!children.includes(nodeId)) {
              children.push(nodeId);
              parent.children = children;
            }
            parentRaw.last_modified = new Date().toISOString().split('T')[0];
            writeJsonFileAtomic(parentPath, parentRaw);
          }
        }
      }
    }

    raw.last_modified = new Date().toISOString().split('T')[0];
    writeJsonFileAtomic(filePath, raw);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Append proposed edges to edges.json, deduplicating by source|type|target.
 */
export function persistEdges(
  edges: Array<{
    source: string; target: string; type: string;
    bidirectional: boolean; confidence: number; rationale: string;
    model: string; strength?: string;
  }>,
): { success: boolean; count: number; error?: string } {
  const edgesPath = path.join(activeTaxonomyDir, 'edges.json');

  try {
    let edgesFile: { edges: unknown[]; last_modified?: string; discovery_log?: unknown[]; edge_types?: unknown[] };
    if (fs.existsSync(edgesPath)) {
      edgesFile = parseJsonFile(edgesPath) as typeof edgesFile;
    } else {
      edgesFile = { edges: [], last_modified: '', discovery_log: [], edge_types: [] };
    }

    if (!Array.isArray(edgesFile.edges)) edgesFile.edges = [];

    // Build existing edge keys for dedup
    const existingKeys = new Set(
      (edgesFile.edges as Array<{ source?: string; target?: string; type?: string }>)
        .map((e) => `${e.source}|${e.type}|${e.target}`),
    );

    const now = new Date().toISOString();
    let added = 0;

    for (const edge of edges) {
      const key = `${edge.source}|${edge.type}|${edge.target}`;
      if (existingKeys.has(key)) continue;

      edgesFile.edges.push({
        source: edge.source,
        target: edge.target,
        type: edge.type,
        bidirectional: edge.bidirectional,
        confidence: edge.confidence,
        rationale: edge.rationale,
        status: 'proposed',
        discovered_at: now,
        model: edge.model,
        ...(edge.strength ? { strength: edge.strength } : {}),
      });

      existingKeys.add(key);
      // Add reverse key for bidirectional edges
      if (edge.bidirectional) {
        existingKeys.add(`${edge.target}|${edge.type}|${edge.source}`);
      }
      added++;
    }

    edgesFile.last_modified = now;
    writeJsonFileAtomic(edgesPath, edgesFile);
    return { success: true, count: added };
  } catch (err) {
    return { success: false, count: 0, error: String(err) };
  }
}

/**
 * Return full node objects for a POV (optionally filtered by category).
 * Unlike loadTaxonomy(), includes parent_id, children, graph_attributes, etc.
 */
export function getNodesByPovCategory(pov: string, category?: string): unknown[] {
  const fileName = POV_FILE_MAP[pov];
  if (!fileName) return [];

  const filePath = path.join(activeTaxonomyDir, fileName);
  if (!fs.existsSync(filePath)) return [];

  try {
    const raw = parseJsonFile(filePath) as { nodes: Record<string, unknown>[] };
    if (!Array.isArray(raw.nodes)) return [];

    let nodes = raw.nodes;
    if (category) {
      nodes = nodes.filter((n) => n.category === category);
    }
    return nodes;
  } catch {
    return [];
  }
}

export function readSnapshot(sourceId: string): string {
  const filePath = path.join(SOURCES_DIR, sourceId, 'snapshot.md');
  if (!fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf-8');
}
