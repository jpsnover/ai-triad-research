import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SOURCES_DIR = path.join(PROJECT_ROOT, 'sources');
const SUMMARIES_DIR = path.join(PROJECT_ROOT, 'summaries');
const TAXONOMY_BASE = path.join(PROJECT_ROOT, 'taxonomy');
let activeTaxonomyDir = path.join(TAXONOMY_BASE, 'Origin');

export interface DiscoveredSource {
  id: string;
  title: string;
  sourceType: string;
  url: string | null;
  authors: string[];
  dateIngested: string;
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
  const raw = fs.readFileSync(summaryPath, 'utf-8');
  return JSON.parse(raw);
}

export interface TaxonomyNode {
  id: string;
  category: string;
  label: string;
  description: string;
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
    .filter(f => f.endsWith('.json') && f !== 'embeddings.json' && f !== 'Temp.json');

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
          };
        }
      }
    } catch {
      // Skip invalid taxonomy files
    }
  }

  return result;
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
  'Goals/Values': 'goals',
  'Data/Facts': 'data',
  'Methods': 'methods',
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

    fs.writeFileSync(filePath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');

    return { success: true, nodeId: newId };
  } catch (err) {
    return { success: false, nodeId: '', error: String(err) };
  }
}

export function readSnapshot(sourceId: string): string {
  const filePath = path.join(SOURCES_DIR, sourceId, 'snapshot.md');
  if (!fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf-8');
}
