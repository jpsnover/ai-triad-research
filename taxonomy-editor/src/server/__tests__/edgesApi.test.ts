import { describe, it, expect } from 'vitest';
import { stripEdgeRationale } from '../edgesApi';

describe('stripEdgeRationale', () => {
  it('removes rationale from every edge but keeps all other fields', () => {
    const input = {
      version: 1,
      edges: [
        { source: 'a', target: 'b', status: 'pending', rationale: 'long text 1' },
        { source: 'c', target: 'd', status: 'approved', rationale: 'long text 2' },
      ],
    };
    const out = stripEdgeRationale(input) as { version: number; edges: Record<string, unknown>[] };
    expect(out.version).toBe(1);
    expect(out.edges).toHaveLength(2);
    for (const e of out.edges) {
      expect(e).not.toHaveProperty('rationale');
    }
    expect(out.edges[0]).toEqual({ source: 'a', target: 'b', status: 'pending' });
    expect(out.edges[1]).toEqual({ source: 'c', target: 'd', status: 'approved' });
  });

  it('does not mutate the input (cache must stay full)', () => {
    const input = { edges: [{ source: 'a', target: 'b', rationale: 'keep me' }] };
    stripEdgeRationale(input);
    expect(input.edges[0].rationale).toBe('keep me');
  });

  it('preserves top-level metadata siblings of edges', () => {
    const input = { generatedAt: '2026-01-01', model: 'x', edges: [{ id: 1, rationale: 'r' }] };
    const out = stripEdgeRationale(input) as Record<string, unknown>;
    expect(out.generatedAt).toBe('2026-01-01');
    expect(out.model).toBe('x');
  });

  it('handles edges with no rationale gracefully', () => {
    const input = { edges: [{ source: 'a', target: 'b' }] };
    const out = stripEdgeRationale(input) as { edges: Record<string, unknown>[] };
    expect(out.edges[0]).toEqual({ source: 'a', target: 'b' });
  });

  it('returns null/non-object input unchanged', () => {
    expect(stripEdgeRationale(null)).toBeNull();
    expect(stripEdgeRationale(undefined)).toBeUndefined();
    expect(stripEdgeRationale('nope')).toBe('nope');
  });

  it('returns input unchanged when edges is missing or not an array', () => {
    const noEdges = { version: 1 };
    expect(stripEdgeRationale(noEdges)).toBe(noEdges);
    const badEdges = { edges: 'not-an-array' };
    expect(stripEdgeRationale(badEdges)).toBe(badEdges);
  });

  it('handles an empty edges array', () => {
    const out = stripEdgeRationale({ edges: [] }) as { edges: unknown[] };
    expect(out.edges).toEqual([]);
  });
});
