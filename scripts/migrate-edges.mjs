#!/usr/bin/env node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Phase 5 — Edge semantics overhaul: consolidate 40+ edge types to 7 canonical.
 *
 * Steps:
 *   1. Map non-canonical types via deterministic mapping table
 *   2. Reclassify CONTRADICTS → TENSION_WITH where nodes have different node_scope
 *   3. Archive CITES and SUPPORTED_BY edges
 *   4. Domain/range validation
 *   5. File migration manifest
 *
 * Usage: node scripts/migrate-edges.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, '..', '..', 'ai-triad-data');
const TAXONOMY_DIR = path.join(DATA_ROOT, 'taxonomy', 'Origin');
const MANIFEST_DIR = path.join(DATA_ROOT, 'migrations');

const DRY_RUN = process.argv.includes('--dry-run');

// ── Load data ─────────────────────────────────────────────

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function saveJsonAtomic(p, data) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, p);
}

const edgesPath = path.join(TAXONOMY_DIR, 'edges.json');
const edgesFile = loadJson(edgesPath);

// Build node_scope index from all taxonomy files
const nodeScopeIndex = {};
const nodeCategoryIndex = {};
for (const f of ['accelerationist.json', 'safetyist.json', 'skeptic.json', 'cross-cutting.json']) {
  const data = loadJson(path.join(TAXONOMY_DIR, f));
  for (const n of data.nodes) {
    nodeScopeIndex[n.id] = n.graph_attributes?.node_scope || null;
    nodeCategoryIndex[n.id] = n.category || null;
  }
}

// ── Canonical types ───────────────────────────────────────

const CANONICAL = new Set(['SUPPORTS', 'CONTRADICTS', 'ASSUMES', 'WEAKENS', 'RESPONDS_TO', 'TENSION_WITH', 'INTERPRETS']);

// ── Mapping table: non-canonical → canonical ──────────────

const TYPE_MAP = {
  // Direct synonyms → SUPPORTS
  'SUPPORTED_BY': 'SUPPORTS',        // reverse direction — will flip source/target
  'JUSTIFIES': 'SUPPORTS',
  'VALIDATES_ARGUMENT_WITHIN': 'SUPPORTS',
  'ENABLES': 'SUPPORTS',
  'UNDERLIES': 'SUPPORTS',
  'INFORMED_BY': 'SUPPORTS',
  'PROVIDES_CONTEXT_FOR': 'SUPPORTS',
  'HIGHLIGHTS_IMPORTANCE_OF': 'SUPPORTS',
  'UNDERSCORES_IMPORTANCE_OF': 'SUPPORTS',
  'INFORMS_DESIGN_OR_INTERACTION': 'SUPPORTS',

  // Similarity/equivalence → SUPPORTS (they reinforce)
  'COMPLEMENTS': 'SUPPORTS',
  'IS_EQUIVALENT_TO': 'SUPPORTS',
  'DESCRIBES_SAME_CONCEPT_AS': 'SUPPORTS',
  'IS_A_RESTATEMENT_OF': 'SUPPORTS',
  'REITERATES': 'SUPPORTS',
  'ANALOGOUS_TO': 'SUPPORTS',
  'SHARES_MECHANISM_WITH': 'SUPPORTS',

  // Hierarchical → SUPPORTS (parent-child is supportive)
  'IS_A_POSITION_WITHIN': 'SUPPORTS',
  'IS_A_METHOD_OF': 'SUPPORTS',
  'GENERALIZES': 'SUPPORTS',
  'SPECIALIZES': 'SUPPORTS',
  'IS_AN_EXAMPLE_OF': 'SUPPORTS',
  'EXEMPLIFIES': 'SUPPORTS',
  'ILLUSTRATES': 'SUPPORTS',
  'ILLUSTRATES_CONSEQUENCE': 'SUPPORTS',
  'INSTANTIATES': 'SUPPORTS',
  'ELABORATES_ON': 'SUPPORTS',
  'ENCOMPASSES_ELEMENT': 'SUPPORTS',
  'DEFINES_ASPECT_OF': 'SUPPORTS',
  'INCLUDES': 'SUPPORTS',
  'EXPLAINS': 'SUPPORTS',

  // Causal → SUPPORTS or WEAKENS
  'CAUSES': 'SUPPORTS',
  'LEADS_TO': 'SUPPORTS',
  'INFLUENCES': 'SUPPORTS',

  // Counter/opposition → WEAKENS
  'EXACERBATES': 'WEAKENS',
  'CONTributes_TO_RISK': 'WEAKENS',
  'HIGHLIGHTS_VULNERABILITY_TO': 'WEAKENS',
  'VULNERABLE_TO': 'WEAKENS',
  'PREVENTS_NEED_FOR': 'WEAKENS',
  'AIMS_TO_MITIGATE': 'WEAKENS',
  'TARGETS': 'WEAKENS',

  // Scope/framing → INTERPRETS
  'DEFINES_SCOPE_BY_EXCLUDING': 'INTERPRETS',

  // Citation → archive (handled separately)
  'CITES': '_ARCHIVE',
  'CITATION_EQUIVALENT': '_ARCHIVE',
  'CITATION_OF_CONCEPT': '_ARCHIVE',

  // Reference → RESPONDS_TO
  'PROPOSES': 'RESPONDS_TO',
  'USES': 'RESPONDS_TO',
};

// Types that need source/target flip when mapped
const FLIP_DIRECTION = new Set(['SUPPORTED_BY', 'INFORMED_BY']);

// ── Reclassification logic ────────────────────────────────

function shouldReclassifyToTension(edge) {
  // Only CONTRADICTS edges
  if (edge.type !== 'CONTRADICTS') return false;

  const srcScope = nodeScopeIndex[edge.source];
  const tgtScope = nodeScopeIndex[edge.target];

  // Both must have node_scope
  if (!srcScope || !tgtScope) return false;

  // If they're at different scope levels, it's tension not contradiction
  // claim vs scheme = tension (different levels of discourse)
  // claim vs claim in same domain = keep as CONTRADICTS
  // scheme vs scheme = could be either, but lean toward tension
  if (srcScope !== tgtScope) return true;

  // Same scope, same level — keep as CONTRADICTS (genuine logical contradiction)
  return false;
}

// ── Domain/range validation ───────────────────────────────

function validateDomainRange(edge) {
  const srcCat = nodeCategoryIndex[edge.source];
  const tgtCat = nodeCategoryIndex[edge.target];
  const warnings = [];

  // SUPPORTS: source should be Data|Methods
  if (edge.type === 'SUPPORTS' && srcCat === 'Goals/Values') {
    warnings.push(`SUPPORTS source is Goals/Values (expected Data|Methods)`);
  }

  // INTERPRETS: target should start with cc-
  if (edge.type === 'INTERPRETS' && !edge.target.startsWith('cc-')) {
    warnings.push(`INTERPRETS target is not cross-cutting`);
  }

  return warnings;
}

// ── Main ──────────────────────────────────────────────────

function main() {
  console.log('Phase 5 — Edge Semantics Overhaul');
  console.log(`Total edges: ${edgesFile.edges.length} | Dry run: ${DRY_RUN}`);

  const stats = {
    total: edgesFile.edges.length,
    already_canonical: 0,
    mapped: 0,
    reclassified_to_tension: 0,
    archived: 0,
    unknown: 0,
    flipped: 0,
    domain_range_warnings: 0,
    orphan_edges: 0,
  };

  const archived = [];
  const migrated = [];
  const typeChanges = {};

  for (const edge of edgesFile.edges) {
    // Check for orphan edges (source or target doesn't exist)
    const srcExists = nodeScopeIndex[edge.source] !== undefined || edge.source.startsWith('pol-');
    const tgtExists = nodeScopeIndex[edge.target] !== undefined || edge.target.startsWith('pol-');
    if (!srcExists || !tgtExists) {
      stats.orphan_edges++;
    }

    if (CANONICAL.has(edge.type)) {
      // Already canonical — check for CONTRADICTS reclassification
      if (shouldReclassifyToTension(edge)) {
        const oldType = edge.type;
        if (!DRY_RUN) edge.type = 'TENSION_WITH';
        stats.reclassified_to_tension++;
        typeChanges[`${oldType}→TENSION_WITH`] = (typeChanges[`${oldType}→TENSION_WITH`] || 0) + 1;
      } else {
        stats.already_canonical++;
      }
      migrated.push(edge);
    } else if (TYPE_MAP[edge.type]) {
      const newType = TYPE_MAP[edge.type];
      const oldType = edge.type;

      if (newType === '_ARCHIVE') {
        stats.archived++;
        archived.push({ ...edge, _archived_reason: `Phase 5: ${edge.type} consolidated` });
      } else {
        // Flip direction if needed
        if (FLIP_DIRECTION.has(oldType)) {
          if (!DRY_RUN) {
            const tmp = edge.source;
            edge.source = edge.target;
            edge.target = tmp;
          }
          stats.flipped++;
        }
        if (!DRY_RUN) edge.type = newType;
        stats.mapped++;
        typeChanges[`${oldType}→${newType}`] = (typeChanges[`${oldType}→${newType}`] || 0) + 1;
        migrated.push(edge);
      }
    } else {
      // Unknown type — keep as-is, log
      stats.unknown++;
      console.warn(`  Unknown type: ${edge.type} (${edge.source} → ${edge.target})`);
      migrated.push(edge);
    }
  }

  // Domain/range validation on migrated edges
  for (const edge of migrated) {
    const warnings = validateDomainRange(edge);
    if (warnings.length > 0) stats.domain_range_warnings += warnings.length;
  }

  // Update edges in file
  if (!DRY_RUN) {
    edgesFile.edges = migrated;

    // Save archived edges
    if (archived.length > 0) {
      const archivePath = path.join(TAXONOMY_DIR, '_archived_edges.json');
      saveJsonAtomic(archivePath, {
        _doc: 'Archived edges from Phase 5 migration. These edges used citation-style types that were consolidated.',
        archived_at: new Date().toISOString(),
        edges: archived,
      });
      console.log(`  Archived ${archived.length} edges to _archived_edges.json`);
    }

    // Update edge_types in header to canonical only
    edgesFile.edge_types = [
      { type: 'SUPPORTS', description: 'Source provides evidence or reasoning for target', aif_equiv: 'RA (inference)', direction: 'directed', domain: 'Data|Methods → Any' },
      { type: 'CONTRADICTS', description: 'Source and target make logically incompatible claims at the same scope level', aif_equiv: 'CA (rebut)', direction: 'bidirectional', domain: 'Same scope level' },
      { type: 'ASSUMES', description: 'Source presupposes target as a prerequisite', aif_equiv: 'RA (presupposition)', direction: 'directed', domain: 'Any → Any' },
      { type: 'WEAKENS', description: 'Source undermines the credibility or relevance of target', aif_equiv: 'CA (undermine)', direction: 'directed', domain: 'Data|Methods → Any' },
      { type: 'RESPONDS_TO', description: 'Source engages with or addresses target in dialogue', aif_equiv: 'Dialogue', direction: 'directed', domain: 'Any → Any' },
      { type: 'TENSION_WITH', description: 'Source and target are in tension but not logically contradictory — different scope levels or value trade-offs', aif_equiv: 'CA (preference)', direction: 'bidirectional', domain: 'Any → Any' },
      { type: 'INTERPRETS', description: 'Source provides a POV-specific interpretation of a cross-cutting concept', aif_equiv: 'Scheme application', direction: 'directed', domain: 'POV → CC only' },
    ];

    saveJsonAtomic(edgesPath, edgesFile);
    console.log(`  Saved ${edgesPath}`);
  }

  // File manifest
  const manifest = {
    phase: 5,
    description: 'Edge semantics overhaul — consolidate to 7 canonical types',
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    items_total: stats.total,
    items_succeeded: stats.already_canonical + stats.mapped + stats.reclassified_to_tension,
    items_archived: stats.archived,
    items_unknown: stats.unknown,
    orphan_edges: stats.orphan_edges,
    domain_range_warnings: stats.domain_range_warnings,
    type_changes: typeChanges,
    reclassified_contradicts_to_tension: stats.reclassified_to_tension,
    edges_after_migration: migrated.length,
    notes: `${stats.mapped} non-canonical mapped, ${stats.reclassified_to_tension} CONTRADICTS→TENSION_WITH, ${stats.archived} archived, ${stats.unknown} unknown kept as-is, ${stats.flipped} direction-flipped.`,
  };

  if (!DRY_RUN) {
    fs.mkdirSync(MANIFEST_DIR, { recursive: true });
    saveJsonAtomic(path.join(MANIFEST_DIR, 'phase-5-manifest.json'), manifest);
    console.log(`  Manifest saved`);
  }

  // Summary
  console.log(`\n${'═'.repeat(55)}`);
  console.log('  SUMMARY');
  console.log(`${'═'.repeat(55)}`);
  console.log(`  Already canonical: ${stats.already_canonical}`);
  console.log(`  Mapped to canonical: ${stats.mapped}`);
  console.log(`  CONTRADICTS → TENSION_WITH: ${stats.reclassified_to_tension}`);
  console.log(`  Archived (CITES etc): ${stats.archived}`);
  console.log(`  Direction flipped: ${stats.flipped}`);
  console.log(`  Unknown (kept): ${stats.unknown}`);
  console.log(`  Orphan edges: ${stats.orphan_edges}`);
  console.log(`  Domain/range warnings: ${stats.domain_range_warnings}`);
  console.log(`  Edges after: ${migrated.length}`);
  console.log(`\n  Type changes:`);
  for (const [change, count] of Object.entries(typeChanges).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${change}: ${count}`);
  }
  if (DRY_RUN) console.log(`\n  ⚠ DRY RUN — no files modified`);
}

main();
