// @vitest-environment node
//
// t/1225 — organizations index/query layer. Drives the query helpers the REST
// routes call, against a mocked readOrganizations() (t/1229, Server Storage).
// Covers: list + type/pov filters, by-id, by-pov direction/threshold/sort,
// topic + policy reverse indexes, and graceful degradation to [] on read failure.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { readOrganizationsMock, readOrganizationEdgesMock, recordMock } = vi.hoisted(() => ({
  readOrganizationsMock: vi.fn(),
  readOrganizationEdgesMock: vi.fn(),
  recordMock: vi.fn(),
}));
vi.mock('../storage/fileIO.js', () => ({ readOrganizations: readOrganizationsMock, readOrganizationEdges: readOrganizationEdgesMock }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: recordMock }) }));

import * as orgs from '../organizations.js';

const FIXTURE = [
  {
    id: 'org-001', name: 'Electronic Frontier Foundation', short_name: 'EFF', type: 'advocacy',
    pov_alignment: { skeptic: { tier: 'champions', rationale: 'Strong skeptic alignment' }, accelerationist: { tier: 'opposes', rationale: 'Opposes accelerationist agenda' } },
    topic_engagement: [{ topic_ref: 'sit-003' }],
    policy_engagement: [{ policy_ref: 'pol-010', stance: 'opposes' }],
  },
  {
    id: 'org-002', name: 'Future of Life Institute', short_name: 'FLI', type: 'advocacy',
    pov_alignment: { safetyist: { tier: 'champions', rationale: 'Strong safetyist alignment' } },
    topic_engagement: [{ topic_ref: 'sit-003' }, { topic_ref: 'sit-007' }],
    policy_engagement: [{ policy_ref: 'pol-010', stance: 'supports' }, { policy_ref: 'pol-020', stance: 'supports' }],
  },
  {
    id: 'org-003', name: 'a16z', type: 'corporate',
    pov_alignment: { accelerationist: { tier: 'champions', rationale: 'Strong accelerationist alignment' } },
    topic_engagement: [{ topic_ref: 'sit-001' }],
    policy_engagement: [{ policy_ref: 'pol-020', stance: 'opposes' }],
  },
  {
    id: 'org-004', name: 'Mid Accelerator', type: 'think_tank',
    pov_alignment: { accelerationist: { tier: 'leans_toward', rationale: 'Moderate accelerationist alignment' } },
  },
];

// t/1530 edges over the FIXTURE orgs. Mix of org-to-org (indexed under source AND
// target) and org-to-nonorg (indexed under source only).
const EDGE_FIXTURE = [
  { source: 'org-003', target: 'org-001', type: 'COMPETES_WITH' }, // a16z ⟷ EFF
  { source: 'org-002', target: 'org-001', type: 'ALLIED_WITH' },   // FLI → EFF
  { source: 'org-003', target: 'org-002', type: 'FUNDS' },         // a16z funds FLI
  { source: 'org-001', target: 'sit-003', type: 'ADVOCATES_FOR' }, // EFF → situation (non-org target)
  { source: 'org-002', target: 'src-042', type: 'PUBLISHED' },     // FLI → source (non-org target)
];

describe('organizations query layer (t/1225)', () => {
  beforeEach(() => {
    readOrganizationsMock.mockReset();
    readOrganizationEdgesMock.mockReset();
    recordMock.mockReset();
    readOrganizationsMock.mockResolvedValue({ organizations: FIXTURE });
    readOrganizationEdgesMock.mockResolvedValue(EDGE_FIXTURE);
    orgs.resetOrganizationsCache();
  });

  it('lists all orgs, and filters by type', async () => {
    expect((await orgs.listOrganizations()).map(o => o.id)).toEqual(['org-001', 'org-002', 'org-003', 'org-004']);
    expect((await orgs.listOrganizations({ type: 'advocacy' })).map(o => o.id)).toEqual(['org-001', 'org-002']);
  });

  it('filters the list by pov alignment (leans_toward or champions)', async () => {
    expect((await orgs.listOrganizations({ pov: 'safetyist' })).map(o => o.id)).toEqual(['org-002']);
    expect((await orgs.listOrganizations({ pov: 'accelerationist' })).map(o => o.id)).toEqual(['org-003', 'org-004']);
  });

  it('gets an org by id, null when absent', async () => {
    expect((await orgs.getOrganizationById('org-002'))?.short_name).toBe('FLI');
    expect(await orgs.getOrganizationById('org-999')).toBeNull();
  });

  it('by-pov: direction for/against, sorted by tier strength desc', async () => {
    // for: acc leans_toward|champions → org-003 (champions) then org-004 (leans_toward)
    expect((await orgs.organizationsByPov('accelerationist', 'for')).map(o => o.id)).toEqual(['org-003', 'org-004']);
    // against: acc opposes|leans_against → org-001 (opposes)
    expect((await orgs.organizationsByPov('accelerationist', 'against')).map(o => o.id)).toEqual(['org-001']);
  });

  it('by-pov: mixed_or_silent tier is excluded from both directions', async () => {
    readOrganizationsMock.mockResolvedValue({ organizations: [
      { id: 'org-X', name: 'Neutral Corp', pov_alignment: { accelerationist: { tier: 'mixed_or_silent', rationale: 'No clear stance' } } },
      ...FIXTURE,
    ] });
    orgs.resetOrganizationsCache();
    expect((await orgs.organizationsByPov('accelerationist', 'for')).map(o => o.id)).toEqual(['org-003', 'org-004']);
    expect((await orgs.organizationsByPov('accelerationist', 'against')).map(o => o.id)).toEqual(['org-001']);
  });

  it('by-topic reverse index returns engaged orgs (empty for unknown)', async () => {
    expect((await orgs.organizationsByTopic('sit-003')).map(o => o.id)).toEqual(['org-001', 'org-002']);
    expect(await orgs.organizationsByTopic('sit-999')).toEqual([]);
  });

  it('by-policy reverse index indexes both supports and opposes', async () => {
    expect((await orgs.organizationsByPolicy('pol-010')).map(o => o.id)).toEqual(['org-001', 'org-002']);
    expect((await orgs.organizationsByPolicy('pol-020')).map(o => o.id)).toEqual(['org-002', 'org-003']);
    expect(await orgs.organizationsByPolicy('pol-999')).toEqual([]);
  });

  it('organizationEdges returns edges incident as source or as org-to-org target (t/1530)', async () => {
    // org-001 (EFF): target of COMPETES_WITH (org-003) + ALLIED_WITH (org-002), source of ADVOCATES_FOR
    expect((await orgs.organizationEdges('org-001')).map(e => e.type))
      .toEqual(['COMPETES_WITH', 'ALLIED_WITH', 'ADVOCATES_FOR']);
    // org-002 (FLI): source of ALLIED_WITH + PUBLISHED, target of FUNDS
    expect((await orgs.organizationEdges('org-002')).map(e => e.type))
      .toEqual(['ALLIED_WITH', 'FUNDS', 'PUBLISHED']);
  });

  it('does not index a non-org edge target (sit-*/src-*) as an org (t/1530)', async () => {
    expect(await orgs.organizationEdges('sit-003')).toEqual([]);
    expect(await orgs.organizationEdges('src-042')).toEqual([]);
  });

  it('allies/competitors/funders derive by filtering edges on type (t/1530)', async () => {
    const edges = await orgs.organizationEdges('org-002');
    expect(edges.filter(e => e.type === 'ALLIED_WITH').map(e => e.target)).toEqual(['org-001']);
    expect(edges.filter(e => e.type === 'FUNDS').map(e => e.source)).toEqual(['org-003']); // org-002 funded BY org-003
  });

  it('organizationEdges is empty for an org with no edges and for an unknown org (t/1530)', async () => {
    expect(await orgs.organizationEdges('org-004')).toEqual([]);
    expect(await orgs.organizationEdges('org-999')).toEqual([]);
  });

  it('degrades to empty edges when the edges file is absent, orgs still load (t/1530)', async () => {
    readOrganizationEdgesMock.mockResolvedValue(null);
    orgs.resetOrganizationsCache();
    expect(await orgs.organizationEdges('org-001')).toEqual([]);
    expect((await orgs.listOrganizations()).map(o => o.id)).toEqual(['org-001', 'org-002', 'org-003', 'org-004']);
  });

  it('degrades to empty set when the data file is absent', async () => {
    readOrganizationsMock.mockResolvedValue(null);
    orgs.resetOrganizationsCache();
    expect(await orgs.listOrganizations()).toEqual([]);
    expect(await orgs.getOrganizationById('org-001')).toBeNull();
    expect(await orgs.organizationsByTopic('sit-003')).toEqual([]);
  });

  it('degrades to empty set and records to the flight recorder on read failure', async () => {
    readOrganizationsMock.mockRejectedValue(new Error('blob unreachable'));
    orgs.resetOrganizationsCache();
    expect(await orgs.listOrganizations()).toEqual([]);
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ component: 'organizations', level: 'error' }));
  });
});
