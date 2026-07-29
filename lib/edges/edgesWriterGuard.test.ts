// @vitest-environment node

// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/1960 — guard against a 16th edges.json writer regressing the hybrid format.
 *
 * `edges.json` is written in three languages by many cmdlets/handlers. t/673 routed
 * all 15 of them through a single serializer per language:
 *   - TypeScript: `serializeEdgesJson` (lib/edges/serializeEdges.ts)
 *   - PowerShell: `Write-EdgesFile`    (scripts/AITriad/Private/Write-EdgesFile.ps1)
 * so the 14.48 MB file stays byte-identical no matter which writer touches it.
 *
 * Every existing writer has its own byte-parity test, so each is correct *today*.
 * Nothing stops someone adding a SIXTEENTH writer that serializes edges raw
 * (`JSON.stringify(data, null, 2)` / `ConvertTo-Json -Depth 20 | Set-Content`).
 * That writer would silently revert the file from 14.48 MB back to 17.34 MB, and
 * the next converted writer would flip it back — the whole file churning on
 * alternate writes, with every existing test still green because each writer is
 * internally consistent. t/673 found writers that THREE separate inventories
 * missed; a grep-based gate finds them in milliseconds, forever.
 *
 * This is that gate. It scans the source trees and fails when a file outside the
 * two serializers writes an edges path with raw serialization.
 *
 * The byte contract itself lives in docs/edges-json-format.md — a failure here
 * points there.
 *
 * ── Heuristic (documented so an author who trips it knows how to respond) ───────
 * A "violation" is a source line that is either:
 *   (A) a WRITE SINK whose target on that line is an edges path (`edges.json`
 *       literal / `edgesPath` / `getEdgesPath()`), in a file that never references
 *       a sanctioned serializer — catches a brand-new writer, even if the sink and
 *       the serialization sit on different lines; or
 *   (B) an edges-path token on the same line as a RAW serializer
 *       (`JSON.stringify(x, …)` with args / `ConvertTo-Json`) and NOT the sanctioned
 *       serializer — catches a raw write bolted onto a file that already, legitimately,
 *       imports the serializer for another edges write.
 *
 * Known blind spot (accepted — the ticket asks for noisy-over-silent): a write whose
 * destination is a fully-aliased variable (`const p = edgesPath; write(p, raw)`) with
 * the raw serialization on a separate line escapes both flags. Naming the destination
 * recognizably (which every real writer does) is what makes it catchable. The gate
 * favours a few false positives an author silences with a documented EXEMPT_FILES
 * entry over a false negative that lets a silent format-reverter through.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// lib/edges/ → repo root is two levels up. Resolve relative to this file
// (deterministic) rather than cwd, which varies under vitest (see keysValidation.test.ts).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Trees that contain edges.json writers. Kept narrow on purpose: the data repo,
// build output, and other packages never write edges.json through project code.
const SCAN_DIRS = ['lib', 'taxonomy-editor/src', 'scripts/AITriad'];

// Source extensions that can write files. .ts/.tsx for the Electron apps + shared lib,
// .ps1/.psm1 for the AITriad module.
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.ps1', '.psm1']);

// Directory names skipped entirely during the walk. `archive/` holds one-shot
// migration scripts that are dead and intentionally use their own serialization;
// __tests__/fixtures never write the LIVE file (they build fixtures/temp), so a raw
// serializer there cannot cause the format-revert regression this gate exists to stop.
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage',
  '.tsbuildinfo', '.vite', '.git', '.claude',
  '__tests__', 'fixtures', 'archive',
]);

// Files exempt from the gate, each with the reason it is allowed to serialize raw.
// Co-located here (not in ticket history) so the exemption and its justification
// travel with the gate — the property that makes LOCAL_ONLY in keysValidation.test.ts
// a good example. Paths are repo-relative with forward slashes.
const EXEMPT_FILES = new Map<string, string>([
  // The TypeScript serializer IS the hybrid format — it must use JSON.stringify.
  ['lib/edges/serializeEdges.ts', 'the TS serializer itself (implements the contract)'],
  // The PowerShell serializer IS the hybrid format — it must use ConvertTo-Json.
  ['scripts/AITriad/Private/Write-EdgesFile.ps1', 'the PS serializer itself (implements the contract)'],
]);

// A destination edges path on a line. `edges.json` must be preceded by a non-word,
// non-hyphen char so `organization_edges.json` and `_archived_edges.json` (different,
// pretty-printed files) do NOT match. The `edgesPath` / `getEdgesPath` tokens require
// a non-letter before them so `OrgEdgesPath` / `getOrgEdgesPath` do NOT match.
const EDGES_TOKEN = /(?<![\w-])edges\.json|(?<![A-Za-z])edgesPath\b|(?<![A-Za-z])getEdgesPath\s*\(/i;

// The sanctioned serializers. A file/line that routes through one of these is compliant.
const SANCTIONED = /serializeEdgesJson|Write-EdgesFile|writeEdgesFile/i;

// Write sinks by language. TS: fs + the project's atomic writers. PS: the cmdlets and
// .NET methods that persist a string to disk.
const TS_WRITE_SINK =
  /\b(?:writeFileSync|writeFile|writeStringAtomic|writeJsonFileAtomic|appendFileSync|appendFile|outputFileSync|outputFile|createWriteStream|writeSync)\s*\(/;
const PS_WRITE_SINK =
  /\b(?:Set-Content|Add-Content|Out-File)\b|Write-Utf8NoBom|::(?:WriteAll(?:Text|Lines|Bytes)|AppendAllText)/i;

// Raw serializers by language. TS: JSON.stringify with a SECOND argument (an indent
// or replacer) — single-arg `JSON.stringify(edge)` is the contract-correct per-edge
// form and must NOT match. PS: any ConvertTo-Json (the hybrid format is hand-rolled;
// ConvertTo-Json on edges content, compressed or not, is non-conforming).
const TS_RAW_SERIALIZER = /JSON\.stringify\s*\([^)]*,/;
const PS_RAW_SERIALIZER = /ConvertTo-Json/i;

function isPowerShell(relPath: string): boolean {
  return relPath.endsWith('.ps1') || relPath.endsWith('.psm1');
}

function walk(absDir: string, acc: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return; // a scan dir may be absent in a partial checkout; that's fine.
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(absDir, entry.name), acc);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!SOURCE_EXTS.has(ext)) continue;
      // Test files never write the live edges.json; they build fixtures/temp data.
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      if (/\.Tests\.ps1$/i.test(entry.name)) continue;
      if (entry.name.endsWith('.d.ts')) continue;
      acc.push(path.join(absDir, entry.name));
    }
  }
}

interface Violation {
  relPath: string;
  line: number;
  text: string;
  flag: 'A' | 'B';
}

function scan(): { violations: Violation[]; writeSites: string[] } {
  const violations: Violation[] = [];
  const writeSites: string[] = []; // positive control: every edges write-sink line seen

  for (const dir of SCAN_DIRS) {
    const files: string[] = [];
    walk(path.join(REPO_ROOT, dir), files);

    for (const abs of files) {
      const relPath = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
      if (EXEMPT_FILES.has(relPath)) continue;

      const content = fs.readFileSync(abs, 'utf-8');
      const ps = isPowerShell(relPath);
      const writeSink = ps ? PS_WRITE_SINK : TS_WRITE_SINK;
      const rawSerializer = ps ? PS_RAW_SERIALIZER : TS_RAW_SERIALIZER;
      const fileHasSanctioned = SANCTIONED.test(content);

      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const hasEdges = EDGES_TOKEN.test(line);
        if (!hasEdges) continue;

        const isSinkLine = writeSink.test(line);
        if (isSinkLine) writeSites.push(`${relPath}:${i + 1}`);

        // Flag A: a write to an edges path in a file that never imports the serializer.
        if (isSinkLine && !fileHasSanctioned) {
          violations.push({ relPath, line: i + 1, text: line.trim(), flag: 'A' });
          continue; // one report per line
        }
        // Flag B: a raw serializer on the same line as an edges path, not the sanctioned one.
        if (rawSerializer.test(line) && !SANCTIONED.test(line)) {
          violations.push({ relPath, line: i + 1, text: line.trim(), flag: 'B' });
        }
      }
    }
  }
  return { violations, writeSites };
}

describe('edges.json writer guard (t/1960)', () => {
  const { violations, writeSites } = scan();

  it('no source file outside the serializer writes an edges path with raw serialization', () => {
    const report = violations
      .map(v => `  [${v.flag}] ${v.relPath}:${v.line}\n        ${v.text}`)
      .join('\n');

    expect(
      violations,
      violations.length === 0
        ? ''
        : `Found ${violations.length} edges.json write(s) that bypass the shared serializer:\n${report}\n\n` +
          `edges.json uses a hybrid byte format (docs/edges-json-format.md). Every writer MUST route through\n` +
          `serializeEdgesJson (TypeScript, lib/edges/serializeEdges.ts) or Write-EdgesFile (PowerShell,\n` +
          `scripts/AITriad/Private/Write-EdgesFile.ps1). A raw JSON.stringify(data, null, 2) or ConvertTo-Json\n` +
          `write reverts the 14.48 MB file to 17.34 MB and churns all 33k lines on the next alternate write.\n` +
          `Fix: serialize through the shared path. If this is a genuine exception, add the file to EXEMPT_FILES\n` +
          `in this test with a one-line reason.`,
    ).toEqual([]);
  });

  // Positive control: prove the scanner actually reached the known writers rather than
  // passing vacuously (a bad REPO_ROOT/skip rule would read nothing and report green).
  it('reaches the known edges write sites (guards against a vacuous pass)', () => {
    expect(writeSites.length, 'scan found zero edges write sites — REPO_ROOT or the walk is broken').toBeGreaterThan(0);
    for (const known of [
      'lib/debate/modulateEdgeWeights.ts',
      'taxonomy-editor/src/main/fileIO.ts',
      'taxonomy-editor/src/server/storage/fileIO.ts',
    ]) {
      expect(
        writeSites.some(site => site.startsWith(known + ':')),
        `expected to see the known edges writer ${known} among scanned write sites — the scan may be skipping it`,
      ).toBe(true);
    }
  });
});
