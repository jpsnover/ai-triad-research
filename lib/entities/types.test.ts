import { describe, it, expect } from 'vitest';
import { parseEntityRef, isEntityRefKind } from './types.js';

describe('parseEntityRef', () => {
  it('classifies each kind by its prefix/shape', () => {
    expect(parseEntityRef('acc-desires-001')).toEqual({ kind: 'node', id: 'acc-desires-001' });
    expect(parseEntityRef('saf-beliefs-012')).toEqual({ kind: 'node', id: 'saf-beliefs-012' });
    expect(parseEntityRef('skp-intentions-100')).toEqual({ kind: 'node', id: 'skp-intentions-100' });
    expect(parseEntityRef('sit-001')).toEqual({ kind: 'situation', id: 'sit-001' });
    expect(parseEntityRef('cc-042')).toEqual({ kind: 'situation', id: 'cc-042' });
    expect(parseEntityRef('pol-006')).toEqual({ kind: 'policy', id: 'pol-006' });
    expect(parseEntityRef('ent-123')).toEqual({ kind: 'entity', id: 'ent-123' });
    expect(parseEntityRef('org-openai')).toEqual({ kind: 'entity', id: 'org-openai' });
    expect(parseEntityRef('term:compute-governance')).toEqual({ kind: 'term', id: 'term:compute-governance' });
  });

  it('returns null on unrecognized/ambiguous tokens — never guesses (refusal discipline)', () => {
    expect(parseEntityRef('')).toBeNull();
    expect(parseEntityRef('random-string')).toBeNull();
    expect(parseEntityRef('acc-foo-001')).toBeNull();        // wrong category word
    expect(parseEntityRef('acc-desires')).toBeNull();        // missing NNN
    expect(parseEntityRef('xyz-beliefs-001')).toBeNull();    // wrong pov
    expect(parseEntityRef('compute-governance')).toBeNull(); // bare slug, no term: prefix
  });
});

describe('isEntityRefKind', () => {
  it('accepts the five kinds and rejects others', () => {
    for (const k of ['node', 'situation', 'policy', 'entity', 'term']) {
      expect(isEntityRefKind(k)).toBe(true);
    }
    expect(isEntityRefKind('vocab')).toBe(false);
    expect(isEntityRefKind('')).toBe(false);
  });
});
