import { describe, it, expect } from 'vitest';
import {
  classifyVenueTier,
  venueTierScore,
  extractYear,
  computeRecency,
  computeEvidenceBreadth,
  computeSourceAuthority,
} from './sourceAuthority.js';
import type { ArgumentNetworkNode } from './types.js';

describe('classifyVenueTier', () => {
  it('classifies peer-reviewed journal', () => {
    expect(classifyVenueTier({ title: 'Nature Medicine 2024 Study' })).toBe('peer_reviewed');
    expect(classifyVenueTier({ title: 'IEEE Transactions on AI' })).toBe('peer_reviewed');
    expect(classifyVenueTier({ title: 'Science Advances 2023' })).toBe('peer_reviewed');
  });

  it('does not false-positive on bare nature/science', () => {
    expect(classifyVenueTier({ title: 'Data Science Blog Post' })).toBe('blog_news');
    expect(classifyVenueTier({ title: 'The Nature of Intelligence' })).toBe('unknown');
  });

  it('classifies conference papers', () => {
    expect(classifyVenueTier({ title: 'NeurIPS 2024 Proceedings' })).toBe('conference');
    expect(classifyVenueTier({ title: 'AAAI Conference Paper' })).toBe('conference');
  });

  it('classifies preprints', () => {
    expect(classifyVenueTier({ title: 'Model Safety', provenance_label: 'arXiv:2025.12345' })).toBe('preprint');
  });

  it('classifies policy documents', () => {
    expect(classifyVenueTier({ title: 'EU AI Act Directive 2024' })).toBe('policy_doc');
    expect(classifyVenueTier({ title: 'OECD Policy Brief on AI' })).toBe('policy_doc');
  });

  it('classifies blog/news', () => {
    expect(classifyVenueTier({ title: 'TechCrunch AI Coverage' })).toBe('blog_news');
    expect(classifyVenueTier({ title: 'Blog Post on AI Safety' })).toBe('blog_news');
  });

  it('returns unknown for unclassifiable', () => {
    expect(classifyVenueTier({ title: 'Some Document' })).toBe('unknown');
  });
});

describe('venueTierScore', () => {
  it('returns correct scores', () => {
    expect(venueTierScore('peer_reviewed')).toBe(1.0);
    expect(venueTierScore('conference')).toBe(0.8);
    expect(venueTierScore('preprint')).toBe(0.6);
    expect(venueTierScore('policy_doc')).toBe(0.7);
    expect(venueTierScore('blog_news')).toBe(0.4);
    expect(venueTierScore('unknown')).toBe(0.3);
  });
});

describe('extractYear', () => {
  it('extracts year from provenance label', () => {
    expect(extractYear({ title: 'Paper', provenance_label: 'arXiv:2025.12345' })).toBe(2025);
  });

  it('extracts year from title', () => {
    expect(extractYear({ title: 'AI Safety Report 2023' })).toBe(2023);
  });

  it('returns null when no year found', () => {
    expect(extractYear({ title: 'Untitled Document' })).toBeNull();
  });

  it('prefers provenance label year over title year', () => {
    expect(extractYear({ title: 'Report 2020', provenance_label: 'Published 2024' })).toBe(2024);
  });
});

describe('computeRecency', () => {
  it('returns 1.0 for current year', () => {
    expect(computeRecency(2026, 2026)).toBe(1.0);
  });

  it('returns 0.5 for half-life age (5 years)', () => {
    expect(computeRecency(2021, 2026)).toBeCloseTo(0.5, 5);
  });

  it('returns ~0.25 for 10 years old', () => {
    expect(computeRecency(2016, 2026)).toBeCloseTo(0.25, 5);
  });

  it('handles future dates gracefully', () => {
    expect(computeRecency(2027, 2026)).toBe(1.0);
  });
});

describe('computeEvidenceBreadth', () => {
  it('returns null for empty nodes', () => {
    expect(computeEvidenceBreadth([])).toBeNull();
  });

  it('returns null when no nodes have evidence', () => {
    const nodes = [{ id: 'n1', text: 'claim' }] as ArgumentNetworkNode[];
    expect(computeEvidenceBreadth(nodes)).toBeNull();
  });

  it('counts distinct sources per node', () => {
    const nodes = [
      {
        id: 'n1', text: 'claim1',
        evidence_graph: {
          evidence_items: [
            { id: 'e1', source_doc_id: 'docA', text: 'ev1', relation: 'support' as const, similarity: 0.9 },
            { id: 'e2', source_doc_id: 'docB', text: 'ev2', relation: 'support' as const, similarity: 0.8 },
            { id: 'e3', source_doc_id: 'docA', text: 'ev3', relation: 'support' as const, similarity: 0.7 },
          ],
          computed_strength: 0.8, qbaf_iterations: 3,
        },
      },
      {
        id: 'n2', text: 'claim2',
        evidence_graph: {
          evidence_items: [
            { id: 'e4', source_doc_id: 'docC', text: 'ev4', relation: 'support' as const, similarity: 0.9 },
          ],
          computed_strength: 0.7, qbaf_iterations: 3,
        },
      },
    ] as ArgumentNetworkNode[];
    expect(computeEvidenceBreadth(nodes)).toBe(1.5);
  });
});

describe('computeSourceAuthority', () => {
  it('returns all nulls for empty nodes', () => {
    const result = computeSourceAuthority([]);
    expect(result.source_authority_mean).toBeNull();
    expect(result.source_recency_mean).toBeNull();
    expect(result.evidence_breadth_per_claim).toBeNull();
  });

  it('returns only evidence breadth when no docMeta', () => {
    const nodes = [{
      id: 'n1', text: 'claim',
      evidence_graph: {
        evidence_items: [
          { id: 'e1', source_doc_id: 'docA', text: 'ev', relation: 'support' as const, similarity: 0.9 },
        ],
        computed_strength: 0.8, qbaf_iterations: 3,
      },
    }] as ArgumentNetworkNode[];
    const result = computeSourceAuthority(nodes);
    expect(result.source_authority_mean).toBeNull();
    expect(result.source_recency_mean).toBeNull();
    expect(result.evidence_breadth_per_claim).toBe(1.0);
  });

  it('computes venue tier and recency from docMeta', () => {
    const nodes = [{
      id: 'n1', text: 'claim',
      evidence_graph: {
        evidence_items: [
          { id: 'e1', source_doc_id: 'docA', text: 'ev', relation: 'support' as const, similarity: 0.9 },
          { id: 'e2', source_doc_id: 'docB', text: 'ev2', relation: 'support' as const, similarity: 0.8 },
        ],
        computed_strength: 0.8, qbaf_iterations: 3,
      },
    }] as ArgumentNetworkNode[];
    const docMeta = {
      docA: { title: 'Nature Medicine 2024 Paper' },
      docB: { title: 'Blog Post', provenance_label: 'Medium, 2023' },
    };
    const result = computeSourceAuthority(nodes, docMeta);
    expect(result.source_authority_mean).toBe((1.0 + 0.4) / 2);
    expect(result.source_recency_mean).not.toBeNull();
    expect(result.evidence_breadth_per_claim).toBe(2.0);
  });

  it('uses unknown tier for doc_ids not in docMeta', () => {
    const nodes = [{
      id: 'n1', text: 'claim',
      evidence_graph: {
        evidence_items: [
          { id: 'e1', source_doc_id: 'missing', text: 'ev', relation: 'support' as const, similarity: 0.9 },
        ],
        computed_strength: 0.8, qbaf_iterations: 3,
      },
    }] as ArgumentNetworkNode[];
    const result = computeSourceAuthority(nodes, { otherDoc: { title: 'Something' } });
    expect(result.source_authority_mean).toBe(0.3);
    expect(result.source_recency_mean).toBeNull();
  });
});
