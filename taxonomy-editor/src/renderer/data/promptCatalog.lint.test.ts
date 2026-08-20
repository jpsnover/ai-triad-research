// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Prompt-catalog registry lint (t/2834). Anti-drift gate: fails when a prompt-builder or
// `.prompt` file exists but is neither catalogued in PROMPT_CATALOG nor allowlisted in
// promptCatalog.excluded.ts — the failure class t/2822 found (14+ silent misses). Runs inside
// the existing `test-electron (taxonomy-editor)` vitest job — no new ci.yml step (TL t/2834#3).
//
// Signal (TL-ruled A/B, t/2834#5):
//   • .prompt files  → referenced ⟺ basename ∈ some entry.promptFiles[]
//   • TS builders    → referenced ⟺ imported-and-used in promptCatalog.ts ∪ some entry.builders[]
//   • plus a no-dead-import arm (every imported *Prompt is actually used) and bidirectional
//     reverse checks (every promptFiles/source/builders reference resolves to a real file/export).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMPT_CATALOG } from './promptCatalog';
import { PROMPT_CATALOG_EXCLUDED } from './promptCatalog.excluded';

// ── Resolve the repo root deterministically (dir that holds both the .prompt and builder trees),
//    so the lint is independent of vitest's cwd. ──
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (
      fs.existsSync(path.join(dir, 'lib', 'debate', 'prompts')) &&
      fs.existsSync(path.join(dir, 'scripts', 'AITriad', 'Prompts'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`promptCatalog.lint: could not locate repo root walking up from ${start}`);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = findRepoRoot(HERE);
const CATALOG_PATH = 'taxonomy-editor/src/renderer/data/promptCatalog.ts';

// Discovered universe (TL-approved mechanism, t/2834#1): the two `.prompt` dirs + the two
// builder-fn trees. `.prompt` basenames drop the extension; builders are declaration-site exports.
const PROMPT_DIRS = ['scripts/AITriad/Prompts', 'lib/oped/prompts'];
const BUILDER_DIRS = ['lib/debate/prompts', 'taxonomy-editor/src/renderer/prompts'];
const BUILDER_EXPORT_RE = /export\s+(?:async\s+)?(?:function|const)\s+(\w+Prompt)\b/g;

function discoveredPromptFiles(): string[] {
  const out: string[] = [];
  for (const d of PROMPT_DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith('.prompt')) out.push(f.replace(/\.prompt$/, ''));
    }
  }
  return out;
}

function discoveredBuilders(): Set<string> {
  const set = new Set<string>();
  for (const d of BUILDER_DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
      const src = fs.readFileSync(path.join(abs, f), 'utf8');
      for (const m of src.matchAll(BUILDER_EXPORT_RE)) set.add(m[1]);
    }
  }
  return set;
}

// ── promptCatalog.ts source-text analysis: imported *Prompt identifiers + a body with the
//    import statements stripped (so "is this import used?" is a search over the rest of the file). ──
const CATALOG_SRC = fs.readFileSync(path.join(ROOT, CATALOG_PATH), 'utf8');
const IMPORT_BLOCK_RE = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"][^'"]*['"];?/g;

function importedBuilders(): string[] {
  const names = new Set<string>();
  for (const block of CATALOG_SRC.matchAll(IMPORT_BLOCK_RE)) {
    for (const raw of block[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (/^\w+Prompt$/.test(name)) names.add(name);
    }
  }
  return [...names];
}
const CATALOG_BODY_NO_IMPORTS = CATALOG_SRC.replace(IMPORT_BLOCK_RE, '');

function sourceResolves(src: string): boolean {
  // `source` is a display path with one of three roots: repo-root-relative (`lib/...`,
  // `lib/oped/prompts/*.prompt`), renderer-src-relative (`prompts/...`, `data/...`), or the
  // PS-prompt label form (`AITriad/Prompts/*.prompt`, which lives under `scripts/`). Accept a hit
  // against any of the three.
  return [
    path.join(ROOT, src),
    path.join(ROOT, 'taxonomy-editor', 'src', 'renderer', src),
    path.join(ROOT, 'scripts', src),
  ].some((c) => fs.existsSync(c));
}

// ── Derived reference sets ──
const referencedPromptFiles = new Set(PROMPT_CATALOG.flatMap((e) => e.promptFiles ?? []));
const declaredBuilders = new Set(PROMPT_CATALOG.flatMap((e) => e.builders ?? []));
const excludedNames = new Set(PROMPT_CATALOG_EXCLUDED.map((e) => e.name));

describe('promptCatalog registry lint (t/2834)', () => {
  const discovered = discoveredBuilders();
  const imported = importedBuilders();
  const referencedBuilders = new Set([...imported, ...declaredBuilders]);

  it('coverage integrity: every discovery dir exists (no vacuous forward arm) — TL t/2834#7', () => {
    // findRepoRoot anchors lib/debate/prompts + scripts/AITriad/Prompts, but lib/oped/prompts and
    // renderer/prompts are otherwise unanchored — if one is renamed/moved, its forward arm would
    // pass vacuously and coverage would shrink silently (the silent-degradation class). Fail loud.
    const missing = [...PROMPT_DIRS, ...BUILDER_DIRS].filter((d) => !fs.existsSync(path.join(ROOT, d)));
    expect(
      missing,
      `Discovery dir(s) missing — a moved/renamed dir makes that arm pass vacuously. Update the dir list:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('forward (builders): every discovered *Prompt builder is catalogued or allowlisted', () => {
    const orphans = [...discovered]
      .filter((b) => !referencedBuilders.has(b) && !excludedNames.has(b))
      .sort();
    expect(
      orphans,
      `Uncatalogued prompt builders — add a catalog entry (with builders:['name'] or a template call) ` +
        `or an exclusion in promptCatalog.excluded.ts:\n  ${orphans.join('\n  ')}`,
    ).toEqual([]);
  });

  it('forward (.prompt): every discovered .prompt file is catalogued or allowlisted', () => {
    const orphans = discoveredPromptFiles()
      .filter((p) => !referencedPromptFiles.has(p) && !excludedNames.has(p))
      .sort();
    expect(
      orphans,
      `Uncatalogued .prompt files — add promptFiles:[...] to an entry or an exclusion:\n  ${orphans.join('\n  ')}`,
    ).toEqual([]);
  });

  it('reverse (promptFiles): every catalog promptFiles basename resolves to a real .prompt', () => {
    const present = new Set(discoveredPromptFiles());
    const dangling = [...referencedPromptFiles].filter((p) => !present.has(p)).sort();
    expect(dangling, `Catalog promptFiles referencing a missing .prompt:\n  ${dangling.join('\n  ')}`).toEqual([]);
  });

  it('reverse (builders): every declared builders[] name resolves to a real exported builder', () => {
    const dangling = [...declaredBuilders].filter((b) => !discovered.has(b)).sort();
    expect(dangling, `builders[] names with no exported builder in the discovered trees:\n  ${dangling.join('\n  ')}`).toEqual([]);
  });

  it('reverse (source): every catalog entry.source resolves to a real file', () => {
    const bad = PROMPT_CATALOG.filter((e) => !sourceResolves(e.source))
      .map((e) => `${e.id} → ${e.source}`)
      .sort();
    expect(bad, `Catalog entries whose source path does not resolve:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('no dead prompt imports: every imported *Prompt is used in promptCatalog.ts', () => {
    const dead = imported.filter((name) => !new RegExp(`\\b${name}\\b`).test(CATALOG_BODY_NO_IMPORTS)).sort();
    expect(dead, `Imported but never used — remove the import or reference it (dead imports):\n  ${dead.join('\n  ')}`).toEqual([]);
  });

  it('every exclusion carries a non-empty reason (allowlist hygiene)', () => {
    const noReason = PROMPT_CATALOG_EXCLUDED.filter((e) => !e.reason?.trim()).map((e) => e.name);
    expect(noReason, `Exclusions missing a reason:\n  ${noReason.join('\n  ')}`).toEqual([]);
  });
});
