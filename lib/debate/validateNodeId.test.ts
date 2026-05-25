import { describe, it, expect } from 'vitest';
import {
  validateNodeId,
  validatePovNodeId,
  extractPovFromId,
  extractCategoryFromId,
} from './validateNodeId.js';

// ── validateNodeId ──────────────────────────────────────

describe('validateNodeId', () => {
  it('accepts valid POV Belief IDs', () => {
    expect(validateNodeId('acc-beliefs-001')).toMatchObject({ valid: true, pov: 'acc', idCategory: 'Beliefs', nodeType: 'pov' });
    expect(validateNodeId('saf-beliefs-042')).toMatchObject({ valid: true, pov: 'saf', idCategory: 'Beliefs' });
    expect(validateNodeId('skp-beliefs-100')).toMatchObject({ valid: true, pov: 'skp', idCategory: 'Beliefs' });
  });

  it('accepts valid POV Desire IDs', () => {
    expect(validateNodeId('acc-desires-001')).toMatchObject({ valid: true, idCategory: 'Desires' });
    expect(validateNodeId('saf-desires-019')).toMatchObject({ valid: true, idCategory: 'Desires' });
  });

  it('accepts valid POV Intention IDs', () => {
    expect(validateNodeId('skp-intentions-061')).toMatchObject({ valid: true, idCategory: 'Intentions' });
    expect(validateNodeId('acc-intentions-174')).toMatchObject({ valid: true, idCategory: 'Intentions' });
  });

  it('accepts 4+ digit numbers', () => {
    expect(validateNodeId('acc-beliefs-1000')).toMatchObject({ valid: true });
    expect(validateNodeId('saf-desires-00001')).toMatchObject({ valid: true });
  });

  it('accepts situation node IDs', () => {
    expect(validateNodeId('sit-001')).toMatchObject({ valid: true, nodeType: 'situation' });
    expect(validateNodeId('sit-142')).toMatchObject({ valid: true, nodeType: 'situation' });
  });

  it('accepts cross-cutting node IDs', () => {
    expect(validateNodeId('cc-001')).toMatchObject({ valid: true, nodeType: 'cross-cutting' });
    expect(validateNodeId('cc-121')).toMatchObject({ valid: true, nodeType: 'cross-cutting' });
  });

  it('accepts policy node IDs', () => {
    expect(validateNodeId('pol-001')).toMatchObject({ valid: true, nodeType: 'policy' });
    expect(validateNodeId('pol-093')).toMatchObject({ valid: true, nodeType: 'policy' });
  });

  it('rejects invalid POV prefix', () => {
    const r = validateNodeId('foo-beliefs-001');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('Invalid node ID');
  });

  it('rejects invalid category segment', () => {
    expect(validateNodeId('saf-goals-001').valid).toBe(false);
    expect(validateNodeId('skp-data-001').valid).toBe(false);
    expect(validateNodeId('acc-values-001').valid).toBe(false);
  });

  it('rejects IDs with fewer than 3 digits', () => {
    expect(validateNodeId('acc-beliefs-01').valid).toBe(false);
    expect(validateNodeId('sit-1').valid).toBe(false);
    expect(validateNodeId('cc-42').valid).toBe(false);
  });

  it('rejects empty and non-string inputs', () => {
    expect(validateNodeId('').valid).toBe(false);
    expect(validateNodeId(null as unknown as string).valid).toBe(false);
    expect(validateNodeId(undefined as unknown as string).valid).toBe(false);
  });

  it('rejects freeform strings', () => {
    expect(validateNodeId('some-random-thing').valid).toBe(false);
    expect(validateNodeId('AN-001').valid).toBe(false);
    expect(validateNodeId('beliefs-acc-001').valid).toBe(false);
  });
});

// ── validatePovNodeId ───────────────────────────────────

describe('validatePovNodeId', () => {
  it('passes when ID category matches node category', () => {
    expect(validatePovNodeId('acc-beliefs-001', 'Beliefs')).toMatchObject({ valid: true });
    expect(validatePovNodeId('saf-desires-003', 'Desires')).toMatchObject({ valid: true });
    expect(validatePovNodeId('skp-intentions-010', 'Intentions')).toMatchObject({ valid: true });
  });

  it('fails on category mismatch', () => {
    const r = validatePovNodeId('acc-beliefs-001', 'Desires');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('Category mismatch');
    expect(r.error).toContain('Beliefs');
    expect(r.error).toContain('Desires');
  });

  it('fails on non-POV node ID', () => {
    const r = validatePovNodeId('sit-001', 'Beliefs');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('situation');
  });

  it('fails on invalid ID format', () => {
    const r = validatePovNodeId('saf-goals-001', 'Desires');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('Invalid node ID');
  });
});

// ── extractPovFromId ────────────────────────────────────

describe('extractPovFromId', () => {
  it('extracts POV prefix from valid POV node IDs', () => {
    expect(extractPovFromId('acc-beliefs-001')).toBe('acc');
    expect(extractPovFromId('saf-desires-019')).toBe('saf');
    expect(extractPovFromId('skp-intentions-061')).toBe('skp');
  });

  it('returns undefined for non-POV IDs', () => {
    expect(extractPovFromId('sit-001')).toBeUndefined();
    expect(extractPovFromId('cc-042')).toBeUndefined();
    expect(extractPovFromId('pol-001')).toBeUndefined();
  });
});

// ── extractCategoryFromId ───────────────────────────────

describe('extractCategoryFromId', () => {
  it('extracts category from valid POV node IDs', () => {
    expect(extractCategoryFromId('acc-beliefs-001')).toBe('Beliefs');
    expect(extractCategoryFromId('saf-desires-003')).toBe('Desires');
    expect(extractCategoryFromId('skp-intentions-010')).toBe('Intentions');
  });

  it('returns undefined for non-POV IDs', () => {
    expect(extractCategoryFromId('sit-001')).toBeUndefined();
    expect(extractCategoryFromId('cc-042')).toBeUndefined();
  });
});
