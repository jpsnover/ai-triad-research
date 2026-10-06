// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// POV-tag validation CLI (t/3955). This is the BLOCKING gate the tagging writer (t/3969) shells out to
// before writing any `pov_tags` (TL t/3955#4 cond 1; SO e/249). The warn-first data-repo hook (t/3970)
// can call it too. It runs the same rule as every other writer: validatePovTags.
//
//   tsx lib/schema/pov-tags-cli.ts --input <file.json>
//   … | tsx lib/schema/pov-tags-cli.ts            (JSON on stdin)
//
// Input: a JSON array of { "id": "<node id>", "pov_tags": <value> }, or a whole taxonomy file
// ({ "nodes": [ … ] }), which is checked node by node. `pov_tags` is passed through untouched, so a
// scalar where an array belongs is reported, not repaired.
//
// Output contract: stdout's LAST line is exactly one JSON object:
//   { "checked": <nodes examined>, "invalid": <nodes with problems>, "errors": [ "<message>", … ] }
// Exit 0 = every node valid; exit 1 = one or more invalid (errors lists them); any other exit = the check
// could not run (bad input, unreadable registry). Callers must treat anything but 0 as "do not write".
//
// ── Orphan-scan mode (t/3985; SO e/253#2 + #4) ──
//   tsx lib/schema/pov-tags-cli.ts --scan-data <taxonomy/Origin dir> [--base-registry <pov-tags.json>]
// Scans the taxonomy node files (accelerationist/safetyist/skeptic/situations only) against THIS checkout's
// registry. With --base-registry it is differential: only orphans this registry INTRODUCES fail; orphans
// already present under the base and structural problems are warnings. Last stdout line: the
// OrphanScanResult JSON (povTagScan.ts). Exit 0 = pass (warnings allowed); 1 = fail; 2 = could not run
// (a missing or malformed taxonomy file, or an invalid base registry, never reads as "0 orphans").

import { readFileSync } from 'node:fs';
import { validatePovTags, loadPovTagRegistry } from './povTags.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';

/** The value after `flag`, or undefined when the flag is absent. Throws when the flag has no value. */
function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${flag} needs a value`);
  return argv[i + 1];
}

/** Orphan-scan mode. Returns the exit code; throws (→ exit 2) when the scan cannot run.
 *  povTagScan is imported HERE, dynamically, never at the top of the file (t/4021). The data repo's
 *  pov-tags-check hook copies only the validate path's STATIC import closure (its CLOSURE list) and runs
 *  the CLI from there. A static import of povTagScan pulls in extractors.ts and ../debate/schemas.ts, and
 *  the CLI then fails to load in the hook. pov-tags-cli.closure.test.ts pins that closure. */
async function runOrphanScan(argv: string[], dataDir: string): Promise<0 | 1> {
  const { readTaxonomyNodes, readRegistryFile, scanPovTagOrphans, orphanScanExitCode } = await import('./povTagScan.js');
  const basePath = flagValue(argv, '--base-registry');
  const base = basePath ? readRegistryFile(basePath) : undefined;
  const result = scanPovTagOrphans(readTaxonomyNodes(dataDir), loadPovTagRegistry(), base);
  process.stdout.write(JSON.stringify(result) + '\n');
  return orphanScanExitCode(result);
}

function readInput(argv: string[]): string {
  const i = argv.indexOf('--input');
  if (i >= 0) {
    if (!argv[i + 1]) throw new Error('--input needs a file path');
    return readFileSync(argv[i + 1], 'utf8');
  }
  return readFileSync(0, 'utf8');
}

function nodesOf(doc: unknown): { id: unknown; pov_tags?: unknown }[] {
  if (Array.isArray(doc)) return doc as { id: unknown; pov_tags?: unknown }[];
  if (doc && typeof doc === 'object' && Array.isArray((doc as { nodes?: unknown }).nodes)) {
    return (doc as { nodes: { id: unknown; pov_tags?: unknown }[] }).nodes;
  }
  throw new Error('input must be a JSON array of { id, pov_tags } or an object with a "nodes" array');
}

try {
  const argv = process.argv.slice(2);
  const scanDir = flagValue(argv, '--scan-data');
  if (scanDir !== undefined) {
    process.exitCode = await runOrphanScan(argv, scanDir);
  } else {
    runValidation(argv);
  }
} catch (err) {
  getGlobalRecorder()?.record({
    type: 'system.error', component: 'pov-tags-cli', level: 'error',
    message: `pov-tags-cli could not run the check: ${(err as Error).message}`,
    error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
  });
  process.stderr.write(`pov-tags-cli: could not run the check: ${(err as Error).message}\n`);
  process.exitCode = 2;
}

/** The original validation mode (t/3955), unchanged: --input <file> or JSON on stdin. */
function runValidation(argv: string[]): void {
  const registry = loadPovTagRegistry();
  const nodes = nodesOf(JSON.parse(readInput(argv)));
  const errors: string[] = [];
  let invalid = 0;
  for (const n of nodes) {
    if (!n || typeof n !== 'object' || typeof n.id !== 'string') { errors.push(`entry without a string "id": ${JSON.stringify(n)}`); invalid++; continue; }
    const problems = validatePovTags(n.id, n.pov_tags, registry);
    if (problems.length > 0) { errors.push(...problems); invalid++; }
  }
  process.stdout.write(JSON.stringify({ checked: nodes.length, invalid, errors }) + '\n');
  process.exitCode = invalid > 0 ? 1 : 0;
}
