// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Theme-token completeness gate (t/2567).
 *
 * Catches the recurring undefined-token class: a CSS custom property referenced
 * via `var(--x, <fallback>)` but defined in NO theme — so it silently renders the
 * hardcoded fallback in every theme (`--accent` t/2172, `--bar` t/2565,
 * `--error` t/2566). jsdom applies no stylesheet, so runtime tests are blind to
 * this; a static file scan is the only way to see it.
 *
 * Mechanism (TL design, t/2567#1) — definitions ANYWHERE, references EVERYWHERE:
 *   references = every `var(--x`   across renderer *.css / *.tsx / *.ts
 *   definitions = `--x:` in any renderer CSS  +  inline `'--x':` style keys
 *                 +  `setProperty('--x'` calls.
 * A token flags only if referenced and defined nowhere. Sourcing definitions
 * from inline TSX/setProperty (not just styles.css) structurally removes the
 * `--pov-color` / `--bar-h` false positives without a hand-tuned allowlist.
 *
 * Severity: BLOCKING with a shrink-only baseline (Block-C ratchet, TL t/2567#4).
 * The ~60 tokens undefined on the day this landed are grandfathered below, each
 * tagged with its burn-down ticket. Rules: new entries are FORBIDDEN (the ratchet
 * fails the build), and the baseline may only SHRINK — the stale-baseline guard
 * fails the build if an entry is no longer reported (i.e. it got defined; remove
 * it). Warn-first was rejected on precedent (t/2550: an ignored warning crashed
 * prod). Runs in `test-electron (taxonomy-editor)` + `npm run verify`, zero ci.yml.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const RENDERER_DIR = dirname(fileURLToPath(import.meta.url)); // this file lives at src/renderer/

// ── Grandfathered baseline — SHRINK ONLY, never add (t/2567#4) ──────────────
// (a) alias bugs → t/2568: wrong-name references to tokens that DO exist
//     (e.g. --border → --border-color). Live rendering bugs; fix = repoint.
// (b) undefined, need Design values → t/2569: genuinely-new tokens
//     (e.g. --error-* family). Fix = Design blesses per-theme values, then define.
const BASELINE_ALIAS_BUGS_T2568 = [
  // Emptied by the t/2568 sweep: 23 wrong-name refs renamed to their real token;
  // the other 16 were NOT wrong-names — reclassified to the (b) group below.
];
const BASELINE_NEED_VALUES_T2569 = [
  // EMPTY → class-(b) baseline is ZERO (t/2569 complete). The error family
  // (--error-bg/-border/-color/-text) was the final batch — Design-blessed per-theme at
  // t/2569#6 (correcting the earlier mis-deferral to t/2566, which only covered singular
  // --error) and now DEFINED in styles.css. Everything else was defined (Batch 1+3) or
  // repointed to existing tokens (accent family → --focus-ring, etc.) in prior landings.
];
const BASELINE = new Set<string>([...BASELINE_ALIAS_BUGS_T2568, ...BASELINE_NEED_VALUES_T2569]);

// Genuinely runtime-constructed token names (e.g. `setProperty(`--${k}`)`) that
// cannot be statically defined. Starts empty — the definitions-anywhere scan
// already resolves inline/setProperty static names. Add ONLY with justification.
const DYNAMIC_ALLOWLIST = new Set<string>([]);

// ── Scan primitives (exported shapes kept tiny + regex-based, no CSS parser) ──
const REF_RE = /var\(\s*(--[\w-]+)/g;
const CSS_DEF_RE = /(?:^|[;{])\s*(--[\w-]+)\s*:/gm; // allows leading whitespace after \n / ; / {
const TSX_DEF_RE = /['"](--[\w-]+)['"]\s*:/g;       // inline style object key: '--x':
const SETPROP_RE = /setProperty\(\s*['"](--[\w-]+)/g;

export function extractRefs(src: string): string[] {
  return [...src.matchAll(REF_RE)].map((m) => m[1]);
}
export function extractDefs(src: string, isCss: boolean): string[] {
  if (isCss) return [...src.matchAll(CSS_DEF_RE)].map((m) => m[1]);
  return [
    ...[...src.matchAll(TSX_DEF_RE)].map((m) => m[1]),
    ...[...src.matchAll(SETPROP_RE)].map((m) => m[1]),
  ];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (['.css', '.tsx', '.ts'].includes(extname(entry)) && !/\.test\.[cm]?tsx?$/.test(entry)) {
      out.push(p); // skip *.test.* — tests aren't UI, and this file's baseline strings must not self-reference
    }
  }
  return out;
}

function scan(): { undefinedRefs: Map<string, string[]> } {
  const refs = new Map<string, Set<string>>();
  const defs = new Set<string>();
  for (const file of walk(RENDERER_DIR)) {
    const src = readFileSync(file, 'utf8');
    const isCss = extname(file) === '.css';
    for (const t of extractRefs(src)) {
      if (!refs.has(t)) refs.set(t, new Set());
      refs.get(t)!.add(file.slice(RENDERER_DIR.length + 1).replace(/\\/g, '/'));
    }
    for (const t of extractDefs(src, isCss)) defs.add(t);
  }
  const undefinedRefs = new Map<string, string[]>();
  for (const [t, files] of refs) if (!defs.has(t)) undefinedRefs.set(t, [...files]);
  return { undefinedRefs };
}

const { undefinedRefs } = scan();
const undefinedSet = new Set(undefinedRefs.keys());

describe('theme-token completeness (t/2567)', () => {
  it('flags no NEW referenced-but-undefined tokens beyond the grandfathered baseline', () => {
    const offenders = [...undefinedSet].filter((t) => !BASELINE.has(t) && !DYNAMIC_ALLOWLIST.has(t)).sort();
    const detail = offenders
      .map((t) => `  ${t}\n      referenced in: ${(undefinedRefs.get(t) ?? []).slice(0, 8).join(', ')}`)
      .join('\n');
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `\nNew undefined CSS custom prop(s) — referenced via var(${offenders[0]}, …) but defined in no theme, ` +
            `so they render the hardcoded fallback in EVERY theme (jsdom can't see this — same class as --accent/--bar/--error):\n${detail}\n\n` +
            `Fix: define the token per-theme in src/renderer/styles.css (Design blesses values), OR — if it's a ` +
            `wrong-name reference — repoint it to the existing token (e.g. --border → --border-color). ` +
            `Do NOT add it to the baseline in this file: the baseline only shrinks (t/2567).`,
    ).toEqual([]);
  });

  it('has no stale baseline entries (baseline shrinks only — remove tokens once defined)', () => {
    const stale = [...BASELINE].filter((t) => !undefinedSet.has(t)).sort();
    expect(
      stale,
      stale.length === 0
        ? ''
        : `\nThese tokens are in the baseline but the scan no longer reports them undefined ` +
            `(they've been defined — burn-down progress!). Remove them from the baseline in this file to keep ` +
            `the ratchet honest:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });

  it('def-scan detects a whitespace-led declaration (regression for the t/2567 prototype bug)', () => {
    // The original prototype's CSS def regex missed `\n  --x: val;` (leading
    // whitespace after a newline), producing ~18 false positives. Keep it dead.
    expect(extractDefs('.a {\n  --foo: red;\n}', true)).toContain('--foo');
    expect(extractDefs(':root{--a:1;--b:2}', true)).toEqual(expect.arrayContaining(['--a', '--b']));
    expect(extractDefs("<div style={{'--bar': x}} />", false)).toContain('--bar');
    expect(extractDefs("el.style.setProperty('--baz', v)", false)).toContain('--baz');
  });
});
