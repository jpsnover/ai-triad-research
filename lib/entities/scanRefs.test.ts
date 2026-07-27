import { describe, it, expect } from 'vitest';
import { scanRefs } from './scanRefs.js';

const kinds = (t: string) => scanRefs(t).map(s => s.ref.kind);
const raws = (t: string) => scanRefs(t).map(s => s.raw);

describe('scanRefs — kind detection', () => {
  it('detects all six kinds', () => {
    const text = 'see acc-beliefs-001 and sit-002 (legacy cc-042), pol-001, ent-123, org-openai, term:compute-governance.';
    expect(kinds(text)).toEqual(['node', 'situation', 'situation', 'policy', 'entity', 'organization', 'term']);
  });

  it('returns accurate start/end/raw offsets', () => {
    const text = 'ref pol-006 here';
    const spans = scanRefs(text);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ raw: 'pol-006', start: 4, end: 11 });
    expect(text.slice(spans[0].start, spans[0].end)).toBe('pol-006');
    expect(spans[0].ref).toEqual({ kind: 'policy', id: 'pol-006' });
  });

  it('accepts term slugs with interior hyphens', () => {
    expect(raws('topic term:labor-policy-2026 x')).toEqual(['term:labor-policy-2026']);
  });
});

describe('scanRefs — refusal (never emit a non-parsing token)', () => {
  it('drops invalid node category / pov', () => {
    expect(scanRefs('acc-foo-001 xyz-beliefs-001')).toEqual([]);
  });
  it('drops bare prefixes and random words', () => {
    expect(scanRefs('pol sit the org discussed term:')).toEqual([]);
  });
});

describe('scanRefs — token boundaries', () => {
  it('does not match a ref embedded in a larger alphanumeric run', () => {
    expect(scanRefs('xpol-001 foopol-002 sit-003abcZ')).toEqual([]); // preceded/followed by alnum
  });
  it('matches refs bounded by punctuation/whitespace', () => {
    expect(raws('(sit-001),pol-002.')).toEqual(['sit-001', 'pol-002']);
  });
});

describe('scanRefs — adjacency & ordering', () => {
  it('emits adjacent tokens as separate, non-overlapping, left-to-right spans', () => {
    const text = 'acc-desires-005 sit-009';
    const spans = scanRefs(text);
    expect(spans.map(s => s.raw)).toEqual(['acc-desires-005', 'sit-009']);
    expect(spans[0].end).toBeLessThanOrEqual(spans[1].start); // non-overlapping
  });
  it('handles comma-adjacent tokens', () => {
    expect(raws('pol-001,pol-002')).toEqual(['pol-001', 'pol-002']);
  });
  it('returns [] for empty / ref-free text', () => {
    expect(scanRefs('')).toEqual([]);
    expect(scanRefs('a plain sentence with no ids')).toEqual([]);
  });
});
