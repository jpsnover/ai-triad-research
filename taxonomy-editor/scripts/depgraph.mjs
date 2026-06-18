#!/usr/bin/env node
// Dependency graph generator for taxonomy-editor.
// Usage:
//   node scripts/depgraph.mjs                    # full graph as JSON
//   node scripts/depgraph.mjs --query App.tsx    # what does App.tsx import?
//   node scripts/depgraph.mjs --reverse bridge   # what imports "bridge"?
//   node scripts/depgraph.mjs --stats            # file counts + top importers
//   node scripts/depgraph.mjs --orphans          # files imported by nothing

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

// CLI
const args = process.argv.slice(2);

if (args.includes('--stats')) {
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

} else {
  console.log(JSON.stringify(graph, null, 2));
}
