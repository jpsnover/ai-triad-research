// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Runs in the node environment (not the renderer default jsdom) so `import.meta.url` is a
// file:// URL and the fixture JSON can be read from disk; this is a pure file-integrity check
// with no DOM. Self-check for mentionTextFixtures.json (t/1904) — guards the golden-fixture FILE's own
// integrity: that its two expected representations agree and the schema is well-formed.
//
// It deliberately does NOT re-implement the container-text reconstruction recipe. Recipe
// CONFORMANCE is asserted by the two runtime consumers — B (PowerShell/Pester) and E
// (taxonomy-editor/vitest) — each of which reconstructs from `input` per the mentionTypes.ts
// recipe and checks against these goldens (cross-check green: t/1904#3 PowerShell, t/1904#4
// Taxonomy Editor). This test guards only that the file can't rot silently: a corrupted
// codepoint array or a stale sha256 would otherwise slip past a consumer that trusts one
// field. The goldens are spec-derived (reconstruct per recipe -> NFC the whole string ->
// code points + sha256 over UTF-8 bytes); do not hand-edit expected_* — regenerate.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

interface Fixture {
  id: string;
  kind: 'node' | 'sei';
  input: Record<string, unknown>;
  expected_nfc_codepoints: number[];
  expected_sha256: string;
}

const raw = readFileSync(new URL('./mentionTextFixtures.json', import.meta.url), 'utf8');

describe('mentionTextFixtures.json — file integrity', () => {
  it('has no BOM and parses as JSON', () => {
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  const doc = JSON.parse(raw) as { sha256_encoding: string; fixtures: Fixture[] };

  it('pins the sha256 encoding to utf-8', () => {
    expect(doc.sha256_encoding).toBe('utf-8');
  });

  it('has at least the node + sei coverage and unique ids', () => {
    const ids = doc.fixtures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(doc.fixtures.some((f) => f.kind === 'node')).toBe(true);
    expect(doc.fixtures.some((f) => f.kind === 'sei')).toBe(true);
  });

  it.each(doc.fixtures.map((f) => [f.id, f] as const))(
    '%s: schema valid, already-NFC, and codepoints reproduce the stored sha256',
    (_id, f) => {
      expect(['node', 'sei']).toContain(f.kind);
      if (f.kind === 'sei') {
        expect(Array.isArray((f.input as { claims?: unknown }).claims)).toBe(true);
      } else {
        expect(typeof (f.input as { label?: unknown }).label).toBe('string');
      }
      expect(Array.isArray(f.expected_nfc_codepoints)).toBe(true);
      expect(f.expected_nfc_codepoints.every((cp) => Number.isInteger(cp) && cp >= 0)).toBe(true);

      const s = String.fromCodePoint(...f.expected_nfc_codepoints);
      // expected_nfc_codepoints must already be NFC — re-normalizing is a no-op.
      expect(s.normalize('NFC')).toBe(s);
      // The two expected representations must agree: sha256(UTF-8 bytes) === expected_sha256.
      const sha = createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
      expect(sha).toBe(f.expected_sha256);
    },
  );
});
