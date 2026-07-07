#!/usr/bin/env node
// Mechanical migration: raw font-size / border-radius / box-shadow literals → design tokens.
// Run: node scripts/migrate-tokens.mjs [--dry-run]
// Writes result back to src/renderer/styles.css unless --dry-run.

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(__dirname, '../src/renderer/styles.css');
const DRY_RUN = process.argv.includes('--dry-run');

let css = readFileSync(CSS_PATH, 'utf8');
const stats = { fontSize: 0, borderRadius: 0, boxShadow: 0, skipped: [] };

// ── Token block boundary — skip replacements inside the token definition ──
const TOKEN_START = '/* ─── Design tokens (theme-independent) ────────────────── */';
const TOKEN_END_MARKER = '* {'; // first rule after token block

const tokenBlockStart = css.indexOf(TOKEN_START);
const tokenBlockEnd = css.indexOf(TOKEN_END_MARKER, tokenBlockStart);

function isInTokenBlock(index) {
  return index >= tokenBlockStart && index < tokenBlockEnd;
}

// ── Font-size migration ──
// Map rem ranges to tokens per §3 table
function remToToken(val) {
  if (val < 0.5) return null;   // too small, skip
  if (val <= 0.68) return 'var(--text-2xs)';
  if (val <= 0.76) return 'var(--text-xs)';
  if (val <= 0.82) return 'var(--text-sm)';
  if (val <= 0.94) return 'var(--text-md)';
  if (val <= 1.1)  return 'var(--text-lg)';
  if (val <= 1.5)  return 'var(--text-xl)';
  return 'var(--text-2xl)'; // anything above 1.5rem → largest token
}

function emToToken(val) {
  // em is relative; approximate as rem for migration
  return remToToken(val);
}

function pxFontToToken(val) {
  // Convert px to rem (base 16px)
  return remToToken(val / 16);
}

// Replace font-size declarations with raw values
css = css.replace(
  /font-size:\s*([0-9.]+)(rem|em|px)\s*;/g,
  (match, numStr, unit, offset) => {
    if (isInTokenBlock(offset)) return match;
    const num = parseFloat(numStr);
    let token;
    if (unit === 'rem') token = remToToken(num);
    else if (unit === 'em') token = emToToken(num);
    else if (unit === 'px') token = pxFontToToken(num);
    if (token) {
      stats.fontSize++;
      return `font-size: ${token};`;
    }
    stats.skipped.push(`font-size: ${numStr}${unit} (no mapping)`);
    return match;
  }
);

// ── Border-radius migration ──
// Simple single-value cases: Npx → token
function pxRadiusToToken(val) {
  if (val <= 0) return null;
  if (val <= 5)  return 'var(--radius-sm)';
  if (val <= 10) return 'var(--radius-md)';
  if (val <= 20) return 'var(--radius-lg)';
  return null; // > 20px, skip
}

// Single-value border-radius: `border-radius: Npx;`
css = css.replace(
  /border-radius:\s*([0-9.]+)px\s*;/g,
  (match, numStr, offset) => {
    if (isInTokenBlock(offset)) return match;
    const num = parseFloat(numStr);
    const token = pxRadiusToToken(num);
    if (token) {
      stats.borderRadius++;
      return `border-radius: ${token};`;
    }
    stats.skipped.push(`border-radius: ${numStr}px (out of range)`);
    return match;
  }
);

// Multi-value border-radius: `border-radius: Apx Bpx Cpx Dpx;`
// Replace each value independently
css = css.replace(
  /border-radius:\s*((?:[0-9.]+px\s*){2,4})\s*;/g,
  (match, valuesStr, offset) => {
    if (isInTokenBlock(offset)) return match;
    const values = valuesStr.trim().split(/\s+/);
    let changed = false;
    const mapped = values.map(v => {
      const m = v.match(/^([0-9.]+)px$/);
      if (!m) return v;
      const num = parseFloat(m[1]);
      if (num === 0) return '0';
      const token = pxRadiusToToken(num);
      if (token) { changed = true; return token; }
      return v;
    });
    if (changed) {
      stats.borderRadius++;
      return `border-radius: ${mapped.join(' ')};`;
    }
    return match;
  }
);

// border-radius with rem values (less common)
css = css.replace(
  /border-radius:\s*([0-9.]+)rem\s*;/g,
  (match, numStr, offset) => {
    if (isInTokenBlock(offset)) return match;
    const px = parseFloat(numStr) * 16;
    const token = pxRadiusToToken(px);
    if (token) {
      stats.borderRadius++;
      return `border-radius: ${token};`;
    }
    return match;
  }
);

// ── Box-shadow migration ──
// Classify shadows by blur radius:
//   blur <= 3px → --shadow-1 (subtle)
//   blur 4–15px → --shadow-2 (medium)
//   blur > 15px → --shadow-3 (heavy)
// Skip: none, inset, var() references, multi-shadow (comma-separated)

css = css.replace(
  /box-shadow:\s*([^;]+);/g,
  (match, value, offset) => {
    if (isInTokenBlock(offset)) return match;
    const trimmed = value.trim();

    // Skip special cases
    if (trimmed === 'none') return match;
    if (trimmed.startsWith('inset')) return match;
    if (trimmed.includes('var(')) return match;
    // Multi-shadow (contains comma not inside parens)
    let parenDepth = 0;
    let hasTopLevelComma = false;
    for (const ch of trimmed) {
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
      else if (ch === ',' && parenDepth === 0) { hasTopLevelComma = true; break; }
    }
    if (hasTopLevelComma) {
      stats.skipped.push(`box-shadow: multi-shadow (${trimmed.slice(0, 40)}...)`);
      return match;
    }

    // Parse: [x] [y] [blur] [spread?] [color]
    // Extract numeric values (px or unitless 0) before the color function
    const colorIdx = trimmed.search(/rgba?\s*\(|#[0-9a-fA-F]/);
    const numPart = colorIdx >= 0 ? trimmed.slice(0, colorIdx) : trimmed;
    const nums = numPart.match(/-?[0-9.]+(?:px)?/g);
    if (!nums || nums.length < 3) {
      stats.skipped.push(`box-shadow: can't parse (${trimmed.slice(0, 40)})`);
      return match;
    }
    const blur = Math.abs(parseFloat(nums[2]));

    let token;
    if (blur <= 3) token = 'var(--shadow-1)';
    else if (blur <= 15) token = 'var(--shadow-2)';
    else token = 'var(--shadow-3)';

    stats.boxShadow++;
    return `box-shadow: ${token};`;
  }
);

// ── Write result ──
if (!DRY_RUN) {
  writeFileSync(CSS_PATH, css, 'utf8');
  console.log('Written to', CSS_PATH);
} else {
  console.log('[DRY RUN] Would write to', CSS_PATH);
}

console.log('\n=== Migration Stats ===');
console.log(`font-size replacements:    ${stats.fontSize}`);
console.log(`border-radius replacements: ${stats.borderRadius}`);
console.log(`box-shadow replacements:    ${stats.boxShadow}`);
console.log(`TOTAL:                      ${stats.fontSize + stats.borderRadius + stats.boxShadow}`);
if (stats.skipped.length > 0) {
  console.log(`\nSkipped (${stats.skipped.length}):`);
  // Deduplicate
  const counts = {};
  for (const s of stats.skipped) { counts[s] = (counts[s] || 0) + 1; }
  for (const [msg, count] of Object.entries(counts)) {
    console.log(`  ${msg}${count > 1 ? ` (x${count})` : ''}`);
  }
}
