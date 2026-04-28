import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DictionaryLoader } from '../loader';
import { renderDisplay, reverseRender, buildReverseMap } from '../render';
import { parseQuotationMarkers, isInsideQuotation, stripQuotationMarkers } from '../quotation';
import { lintDictionary } from '../lint';
import type { StandardizedTerm, ColloquialTerm } from '../types';

// ── Test data ───────────────────────────────────────────

const FIXTURES_DIR = path.resolve(__dirname);
const RENDER_FIXTURES = path.join(FIXTURES_DIR, 'render_fixtures');
const QUOTATION_FIXTURES = path.join(FIXTURES_DIR, 'quotation_fixtures');

const TEST_DISPLAY_MAP = new Map<string, string>([
  ['safety_alignment', 'alignment (safety)'],
  ['commercial_alignment', 'alignment (commercial)'],
  ['alignment_compliance', 'compliance alignment'],
]);

// ── Helper to load fixture pairs ────────────────────────

function loadFixturePairs(dir: string): Array<{ name: string; input: string; expected: string }> {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.input.md'));
  return files.map((f) => {
    const name = f.replace('.input.md', '');
    const input = fs.readFileSync(path.join(dir, f), 'utf-8');
    const expectedFile = f.replace('.input.md', '.expected.md');
    const expected = fs.readFileSync(path.join(dir, expectedFile), 'utf-8');
    return { name, input, expected };
  });
}

// ── Renderer tests ──────────────────────────────────────

describe('renderDisplay', () => {
  it('returns input unchanged when display map is empty', () => {
    const result = renderDisplay('safety_alignment test', new Map());
    expect(result.rendered).toBe('safety_alignment test');
    expect(result.render_log).toEqual([]);
  });

  const renderFixtures = loadFixturePairs(RENDER_FIXTURES);
  for (const fixture of renderFixtures) {
    it(`fixture: ${fixture.name}`, () => {
      const result = renderDisplay(fixture.input, TEST_DISPLAY_MAP);
      expect(result.rendered).toBe(fixture.expected);
    });
  }

  it('records render log entries for each substitution', () => {
    const result = renderDisplay('The safety_alignment concept.', TEST_DISPLAY_MAP);
    expect(result.render_log).toHaveLength(1);
    expect(result.render_log[0].canonical_form).toBe('safety_alignment');
    expect(result.render_log[0].display_form).toBe('alignment (safety)');
    expect(result.render_log[0].context).toBe('prose');
  });

  it('does not match unregistered canonical forms', () => {
    const result = renderDisplay('unregistered_term here', TEST_DISPLAY_MAP);
    expect(result.rendered).toBe('unregistered_term here');
    expect(result.render_log).toHaveLength(0);
  });
});

// ── Reverse renderer tests ──────────────────────────────

describe('reverseRender', () => {
  it('converts display forms back to canonical forms', () => {
    const reverseMap = buildReverseMap(TEST_DISPLAY_MAP);
    const result = reverseRender('The alignment (safety) concept.', reverseMap);
    expect(result.rendered).toBe('The safety_alignment concept.');
  });

  it('handles multiple display forms', () => {
    const reverseMap = buildReverseMap(TEST_DISPLAY_MAP);
    const result = reverseRender(
      'Both alignment (safety) and alignment (commercial) matter.',
      reverseMap,
    );
    expect(result.rendered).toBe('Both safety_alignment and commercial_alignment matter.');
  });
});

// ── Quotation parser tests ──────────────────────────────

describe('parseQuotationMarkers', () => {
  it('returns empty spans for text without markers', () => {
    const result = parseQuotationMarkers('Plain text without markers');
    expect(result.spans).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('parses a single quotation span', () => {
    const input = '<q canonical-bypass>quoted text</q>';
    const result = parseQuotationMarkers(input);
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0].start).toBe(0);
    expect(result.spans[0].end).toBe(input.length);
    expect(result.spans[0].depth).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('parses nested quotation spans', () => {
    const input = '<q canonical-bypass>outer <q canonical-bypass>inner</q> outer</q>';
    const result = parseQuotationMarkers(input);
    expect(result.spans).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('reports error for unmatched closing tag', () => {
    const result = parseQuotationMarkers('text </q> more');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('without matching opening');
  });

  it('reports error for unmatched opening tag', () => {
    const result = parseQuotationMarkers('<q canonical-bypass>unclosed text');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('without matching');
  });
});

describe('isInsideQuotation', () => {
  it('returns true for offset inside quotation content', () => {
    const input = '<q canonical-bypass>quoted</q>';
    const { spans } = parseQuotationMarkers(input);
    expect(isInsideQuotation(20, spans)).toBe(true);
  });

  it('returns false for offset outside quotation', () => {
    const input = 'before <q canonical-bypass>quoted</q> after';
    const { spans } = parseQuotationMarkers(input);
    expect(isInsideQuotation(0, spans)).toBe(false);
  });
});

describe('stripQuotationMarkers', () => {
  it('removes all quotation markers', () => {
    const input = '<q canonical-bypass>text</q>';
    expect(stripQuotationMarkers(input)).toBe('text');
  });

  it('handles nested markers', () => {
    const input = '<q canonical-bypass>outer <q canonical-bypass>inner</q></q>';
    expect(stripQuotationMarkers(input)).toBe('outer inner');
  });
});

// ── Quotation + render fixture tests ────────────────────

describe('renderDisplay with quotation fixtures', () => {
  const quotationFixtures = loadFixturePairs(QUOTATION_FIXTURES);
  for (const fixture of quotationFixtures) {
    it(`fixture: ${fixture.name}`, () => {
      const result = renderDisplay(fixture.input, TEST_DISPLAY_MAP);
      expect(result.rendered).toBe(fixture.expected);
    });
  }
});

// ── Loader tests ────────────────────────────────────────

describe('DictionaryLoader', () => {
  const dataRoot = path.resolve(__dirname, '../../../../ai-triad-data');
  const dictionaryDir = path.join(dataRoot, 'dictionary');

  it('loads version', () => {
    const loader = new DictionaryLoader(dictionaryDir);
    const version = loader.getVersion();
    expect(version.schema_version).toBe('1.0.0');
  });

  it('returns null for non-existent standardized term', () => {
    const loader = new DictionaryLoader(dictionaryDir);
    expect(loader.getStandardized('nonexistent')).toBeNull();
  });

  it('returns null for non-existent colloquial term', () => {
    const loader = new DictionaryLoader(dictionaryDir);
    expect(loader.getColloquial('nonexistent')).toBeNull();
  });

  it('loads a known standardized term', () => {
    const loader = new DictionaryLoader(dictionaryDir);
    const term = loader.getStandardized('safety_alignment');
    expect(term).not.toBeNull();
    expect(term!.canonical_form).toBe('safety_alignment');
    expect(term!.display_form).toBe('alignment (safety)');
    expect(term!.coinage_status).toBe('accepted');
  });

  it('loads a known colloquial term', () => {
    const loader = new DictionaryLoader(dictionaryDir);
    const term = loader.getColloquial('alignment');
    expect(term).not.toBeNull();
    expect(term!.colloquial_term).toBe('alignment');
    expect(term!.status).toBe('do_not_use_bare');
    expect(term!.resolves_to.length).toBeGreaterThanOrEqual(2);
  });

  it('lists all standardized terms', () => {
    const loader = new DictionaryLoader(dictionaryDir);
    const terms = loader.listStandardized();
    expect(terms.length).toBe(32);
    const canonicals = terms.map(t => t.canonical_form);
    expect(canonicals).toContain('safety_alignment');
    expect(canonicals).toContain('commercial_alignment');
    expect(canonicals).toContain('alignment_compliance');
    expect(canonicals).toContain('autonomy_machine');
    expect(canonicals).toContain('bias_systemic');
    expect(canonicals).toContain('fairness_procedural');
  });

  it('lists all colloquial terms', () => {
    const loader = new DictionaryLoader(dictionaryDir);
    const terms = loader.listColloquial();
    expect(terms.length).toBe(14);
    const colloquials = terms.map(t => t.colloquial_term);
    expect(colloquials).toContain('alignment');
    expect(colloquials).toContain('risk');
    expect(colloquials).toContain('safety');
    expect(colloquials).toContain('autonomy');
    expect(colloquials).toContain('bias');
    expect(colloquials).toContain('fairness');
  });

  it('returns populated canonical form set', () => {
    const loader = new DictionaryLoader(dictionaryDir);
    const set = loader.getCanonicalFormSet();
    expect(set.size).toBe(32);
    expect(set.has('safety_alignment')).toBe(true);
  });

  it('returns populated display form map', () => {
    const loader = new DictionaryLoader(dictionaryDir);
    const map = loader.getDisplayFormMap();
    expect(map.size).toBe(32);
    expect(map.get('safety_alignment')).toBe('alignment (safety)');
  });

  it('invalidates cache and reloads', () => {
    const loader = new DictionaryLoader(dictionaryDir);
    loader.getVersion();
    loader.invalidateCache();
    const version = loader.getVersion();
    expect(version.schema_version).toBe('1.0.0');
  });
});

// ── Lint tests ──────────────────────────────────────────

describe('lintDictionary', () => {
  const dataRoot = path.resolve(__dirname, '../../../../ai-triad-data');
  const dictionaryDir = path.join(dataRoot, 'dictionary');

  it('populated dictionary produces no violations', () => {
    const loader = new DictionaryLoader(dictionaryDir);
    const violations = lintDictionary(loader);
    expect(violations).toEqual([]);
  });

  it('populated dictionary with taxonomy node set produces no constraint-2 violations', () => {
    const loader = new DictionaryLoader(dictionaryDir);
    const terms = loader.listStandardized();
    const allNodeIds = new Set(terms.flatMap(t => t.used_by_nodes));
    const violations = lintDictionary(loader, allNodeIds);
    expect(violations).toEqual([]);
  });

  it('respects constraint filter', () => {
    const loader = new DictionaryLoader(dictionaryDir);
    const violations = lintDictionary(loader, undefined, { constraints: [1] });
    expect(violations).toEqual([]);
  });
});

// ── Fixture count verification ──────────────────────────

describe('fixture counts', () => {
  it('has at least 20 render fixtures', () => {
    const count = fs.readdirSync(RENDER_FIXTURES).filter((f) => f.endsWith('.input.md')).length;
    expect(count).toBeGreaterThanOrEqual(20);
  });

  it('has at least 16 quotation fixtures', () => {
    const count = fs.readdirSync(QUOTATION_FIXTURES).filter((f) => f.endsWith('.input.md')).length;
    expect(count).toBeGreaterThanOrEqual(16);
  });

  it('every input fixture has a matching expected fixture', () => {
    for (const dir of [RENDER_FIXTURES, QUOTATION_FIXTURES]) {
      const inputs = fs.readdirSync(dir).filter((f) => f.endsWith('.input.md'));
      for (const input of inputs) {
        const expected = input.replace('.input.md', '.expected.md');
        expect(fs.existsSync(path.join(dir, expected)), `Missing ${expected}`).toBe(true);
      }
    }
  });
});
