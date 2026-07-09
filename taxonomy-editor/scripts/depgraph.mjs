#!/usr/bin/env node
// Dependency graph generator for taxonomy-editor.
// Usage:
//   node scripts/depgraph.mjs                    # full graph as JSON
//   node scripts/depgraph.mjs --query App.tsx    # what does App.tsx import?
//   node scripts/depgraph.mjs --reverse bridge   # what imports "bridge"?
//   node scripts/depgraph.mjs --stats            # file counts + top importers
//   node scripts/depgraph.mjs --orphans          # files imported by nothing
//   node scripts/depgraph.mjs --blast-radius App.tsx [--depth N]   # transitive importers (default: full closure)
//   node scripts/depgraph.mjs --path A.ts B.ts   # shortest import dependency path between two files
//   node scripts/depgraph.mjs --cycles           # detect circular imports

import fs from 'fs';
import path from 'path';

const SRC = path.resolve(import.meta.dirname, '..', 'src');
const LIB = path.resolve(import.meta.dirname, '..', '..', 'lib');
const EXTENSIONS = ['.ts', '.tsx', '.cts', '.mts'];

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(full, results);
    } else if (EXTENSIONS.some(e => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

const IMPORT_RE = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractImports(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const imports = new Set();
  for (const re of [IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      imports.add(m[1]);
    }
  }
  return [...imports];
}

function resolveImport(specifier, fromFile) {
  if (specifier.startsWith('@bridge')) return 'src/renderer/bridge/index.ts';
  if (specifier.startsWith('@renderer/')) return 'src/renderer/' + specifier.slice(10);
  if (specifier.startsWith('@lib/')) return '../lib/' + specifier.slice(5);

  if (specifier.startsWith('.')) {
    const dir = path.dirname(fromFile);
    let resolved = path.resolve(dir, specifier);
    // strip .js/.jsx extensions that map to .ts/.tsx
    resolved = resolved.replace(/\.js$/, '.ts').replace(/\.jsx$/, '.tsx');
    for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const candidate = resolved + ext;
      if (fs.existsSync(candidate)) return candidate;
    }
    return resolved;
  }
  return null; // external package
}

function relPath(absPath) {
  const base = path.resolve(SRC, '..');
  return path.relative(base, absPath).replace(/\\/g, '/');
}

// Build the graph
const srcFiles = walk(SRC);
const libFiles = walk(LIB);
const allFiles = [...srcFiles, ...libFiles];
const graph = {};

for (const file of allFiles) {
  const key = relPath(file);
  const rawImports = extractImports(file);
  const resolved = [];
  for (const spec of rawImports) {
    const abs = resolveImport(spec, file);
    if (abs) {
      resolved.push(relPath(abs));
    }
  }
  graph[key] = { imports: resolved, rawImports };
}

// Reverse index: file → who imports it
function buildReverseIndex() {
  const rev = {};
  for (const [file, { imports }] of Object.entries(graph)) {
    for (const dep of imports) {
      if (!rev[dep]) rev[dep] = [];
      rev[dep].push(file);
    }
  }
  return rev;
}

function extractExports(filePath) {
  let content;
  try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return []; }
  const exports = [];
  const namedRe = /export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+(\w+)/g;
  let m;
  while ((m = namedRe.exec(content)) !== null) exports.push(m[1]);
  const reExportRe = /export\s*\{([^}]+)\}/g;
  while ((m = reExportRe.exec(content)) !== null) {
    for (const name of m[1].split(',')) {
      const trimmed = name.trim().split(/\s+as\s+/).pop().trim();
      if (trimmed && !trimmed.startsWith('type ')) exports.push(trimmed);
    }
  }
  if (/export\s+default\s/.test(content)) exports.push('default');
  return [...new Set(exports)];
}

function resolveOne(pattern, keys) {
  if (keys.includes(pattern)) return pattern;
  const matches = keys.filter(k => k.includes(pattern));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    console.error(`No file matches "${pattern}"`);
    process.exit(1);
  }
  console.error(`Ambiguous pattern "${pattern}" matches ${matches.length} files:\n${matches.slice(0, 20).join('\n')}`);
  process.exit(1);
}

function bfsImportPath(startGraph, start, target) {
  const queue = [[start]];
  const visited = new Set([start]);
  while (queue.length) {
    const path = queue.shift();
    const node = path[path.length - 1];
    if (node === target) return path;
    for (const next of (startGraph[node]?.imports || [])) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return null;
}

// CLI
const args = process.argv.slice(2);

if (args.includes('--repomap')) {
  const rev = buildReverseIndex();
  const groups = {};
  for (const [file, { imports }] of Object.entries(graph)) {
    if (file.includes('__tests__') || file.includes('.test.') || file.includes('.spec.')) continue;
    const dir = path.dirname(file);
    if (!groups[dir]) groups[dir] = [];
    const importedBy = (rev[file] || []).length;
    const absPath = path.resolve(SRC, '..', file);
    const exports = extractExports(absPath);
    groups[dir].push({ file: path.basename(file), importedBy, exports });
  }
  const dirOrder = Object.keys(groups).sort();
  const lines = ['# Repository Map', '', 'Auto-generated from import graph. Files ranked by import count within each directory (top 8 per directory — leaf components with no importers are omitted).', '', '**Coverage:** taxonomy-editor + lib only. poviewer and summary-viewer are NOT indexed here.', ''];
  for (const dir of dirOrder) {
    const entries = groups[dir].sort((a, b) => b.importedBy - a.importedBy);
    if (entries.length === 0) continue;
    const topEntries = entries.filter(e => e.importedBy > 0 || e.exports.length > 0).slice(0, 8);
    if (topEntries.length === 0) continue;
    lines.push(`## ${dir}/`);
    for (const e of topEntries) {
      const exList = e.exports.slice(0, 5).join(', ');
      const more = e.exports.length > 5 ? ` +${e.exports.length - 5} more` : '';
      lines.push(`- **${e.file}** (${e.importedBy}) — ${exList}${more}`);
    }
    lines.push('');
  }
  console.log(lines.join('\n'));

} else if (args.includes('--stats')) {
  const rev = buildReverseIndex();
  const byProcess = { main: 0, server: 0, renderer: 0, lib: 0 };
  for (const f of Object.keys(graph)) {
    if (f.startsWith('src/main/')) byProcess.main++;
    else if (f.startsWith('src/server/')) byProcess.server++;
    else if (f.startsWith('src/renderer/')) byProcess.renderer++;
    else byProcess.lib++;
  }
  const topImported = Object.entries(rev)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15)
    .map(([f, importers]) => ({ file: f, importedBy: importers.length }));
  const topImporting = Object.entries(graph)
    .sort((a, b) => b[1].imports.length - a[1].imports.length)
    .slice(0, 15)
    .map(([f, { imports }]) => ({ file: f, imports: imports.length }));

  console.log(JSON.stringify({ fileCount: Object.keys(graph).length, byProcess, topImported, topImporting }, null, 2));

} else if (args.includes('--orphans')) {
  const rev = buildReverseIndex();
  const orphans = Object.keys(graph).filter(f =>
    !rev[f] &&
    !f.includes('index.ts') &&
    !f.endsWith('main.ts') &&
    !f.endsWith('server.ts') &&
    !f.endsWith('preload.cts')
  );
  console.log(JSON.stringify(orphans, null, 2));

} else if (args.includes('--reverse')) {
  const pattern = args[args.indexOf('--reverse') + 1];
  if (!pattern) { console.error('Usage: --reverse <pattern>'); process.exit(1); }
  const rev = buildReverseIndex();
  const matches = Object.entries(rev)
    .filter(([f]) => f.includes(pattern))
    .reduce((acc, [f, importers]) => ({ ...acc, [f]: importers }), {});
  console.log(JSON.stringify(matches, null, 2));

} else if (args.includes('--query')) {
  const pattern = args[args.indexOf('--query') + 1];
  if (!pattern) { console.error('Usage: --query <pattern>'); process.exit(1); }
  const matches = Object.entries(graph)
    .filter(([f]) => f.includes(pattern))
    .reduce((acc, [f, data]) => ({ ...acc, [f]: data.imports }), {});
  console.log(JSON.stringify(matches, null, 2));

} else if (args.includes('--blast-radius')) {
  const pattern = args[args.indexOf('--blast-radius') + 1];
  if (!pattern) { console.error('Usage: --blast-radius <pattern> [--depth N]'); process.exit(1); }
  const depthIdx = args.indexOf('--depth');
  const maxDepth = depthIdx !== -1 ? parseInt(args[depthIdx + 1], 10) : Infinity;
  const start = resolveOne(pattern, Object.keys(graph));
  const rev = buildReverseIndex();
  const distance = new Map([[start, 0]]);
  let frontier = [start];
  let depth = 0;
  while (frontier.length && depth < maxDepth) {
    depth++;
    const next = [];
    for (const f of frontier) {
      for (const importer of (rev[f] || [])) {
        if (!distance.has(importer)) {
          distance.set(importer, depth);
          next.push(importer);
        }
      }
    }
    frontier = next;
  }
  distance.delete(start);
  const affected = [...distance.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([file, dist]) => ({ file, distance: dist }));
  console.log(JSON.stringify({ start, maxDepth: maxDepth === Infinity ? null : maxDepth, affectedCount: affected.length, affected }, null, 2));

} else if (args.includes('--path')) {
  const idx = args.indexOf('--path');
  const fromPattern = args[idx + 1];
  const toPattern = args[idx + 2];
  if (!fromPattern || !toPattern) { console.error('Usage: --path <fromPattern> <toPattern>'); process.exit(1); }
  const keys = Object.keys(graph);
  const from = resolveOne(fromPattern, keys);
  const to = resolveOne(toPattern, keys);

  const forwardPath = bfsImportPath(graph, from, to);
  if (forwardPath) {
    console.log(JSON.stringify({ direction: `${from} -> ${to}`, path: forwardPath }, null, 2));
  } else {
    const reversePath = bfsImportPath(graph, to, from);
    if (reversePath) {
      console.log(JSON.stringify({ direction: `${to} -> ${from} (reversed for display)`, path: [...reversePath].reverse() }, null, 2));
    } else {
      console.log(JSON.stringify({ direction: null, path: null, note: 'no import path found in either direction' }, null, 2));
    }
  }

} else if (args.includes('--cycles')) {
  const GRAY = 1, BLACK = 2;
  const color = {};
  const stack = [];
  const cycles = [];
  function dfs(node) {
    color[node] = GRAY;
    stack.push(node);
    for (const dep of (graph[node]?.imports || [])) {
      if (!(dep in graph)) continue;
      if (color[dep] === GRAY) {
        const idx = stack.indexOf(dep);
        cycles.push([...stack.slice(idx), dep]);
      } else if (color[dep] !== BLACK) {
        dfs(dep);
      }
    }
    stack.pop();
    color[node] = BLACK;
  }
  for (const node of Object.keys(graph)) {
    if (!color[node]) dfs(node);
  }
  const seen = new Set();
  const deduped = [];
  for (const cyc of cycles) {
    const core = cyc.slice(0, -1);
    const sorted = [...core].sort();
    const minIdx = core.indexOf(sorted[0]);
    const rotated = [...core.slice(minIdx), ...core.slice(0, minIdx)];
    const key = rotated.join('>');
    if (!seen.has(key)) { seen.add(key); deduped.push(rotated); }
  }
  console.log(JSON.stringify({ cycleCount: deduped.length, cycles: deduped }, null, 2));

} else {
  console.log(JSON.stringify(graph, null, 2));
}
