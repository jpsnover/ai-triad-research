// @vitest-environment node
//
// t/1225 — organizations index/query layer. Drives the query helpers the REST
// routes call, against a mocked readOrganizations() (t/1229, Server Storage).
// Covers: list + type/pov filters, by-id, by-pov direction/threshold/sort,
// topic + policy reverse indexes, and graceful degradation to [] on read failure.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { readOrganizationsMock, recordMock } = vi.hoisted(() => ({
  readOrganizationsMock: vi.fn(),
  recordMock: vi.fn(),
}));
vi.mock('../storage/fileIO.js', () => ({ readOrganizations: readOrganizationsMock }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: recordMock }) }));

import * as orgs from '../organizations.js';

const FIXTURE = [
  {
    id: 'org-001', name: 'Electronic Frontier Foundation', short_name: 'EFF', type: 'advocacy',
    pov_alignment: { skeptic: { score: 0.8 }, accelerationist: { score: -0.5 } },
    topic_engagement: [{ topic_ref: 'sit-003' }],
    policy_engagement: [{ policy_ref: 'pol-010', stance: 'opposes' }],
  },
  {
    id: 'org-002', name: 'Future of Life Institute', short_name: 'FLI', type: 'advocacy',
    pov_alignment: { safetyist: { score: 0.9 } },
    topic_engagement: [{ topic_ref: 'sit-003' }, { topic_ref: 'sit-007' }],
    policy_engagement: [{ policy_ref: 'pol-010', stance: 'supports' }, { policy_ref: 'pol-020', stance: 'supports' }],
  },
  {
    id: 'org-003', name: 'a16z', type: 'corporate',
    pov_alignment: { accelerationist: { score: 0.7 } },
    topic_engagement: [{ topic_ref: 'sit-001' }],
    policy_engagement: [{ policy_ref: 'pol-020', stance: 'opposes' }],
  },
  {
    id: 'org-004', name: 'Mid Accelerator', type: 'think_tank',
    pov_alignment: { accelerationist: { score: 0.4 } },
  },
];

describe('organizations query layer (t/1225)', () => {
  beforeEach(() => {
    readOrganizationsMock.mockReset();
    recordMock.mockReset();
    readOrganizationsMock.mockResolvedValue({ organizations: FIXTURE });
    orgs.resetOrganizationsCache();
  });

  it('lists all orgs, and filters by type', async () => {
    expect((await orgs.listOrganizations()).map(o => o.id)).toEqual(['org-001', 'org-002', 'org-003', 'org-004']);
    expect((await orgs.listOrganizations({ type: 'advocacy' })).map(o => o.id)).toEqual(['org-001', 'org-002']);
  });

  it('filters the list by pov alignment (score > 0.3)', async () => {
    expect((await orgs.listOrganizations({ pov: 'safetyist' })).map(o => o.id)).toEqual(['org-002']);
    expect((await orgs.listOrganizations({ pov: 'accelerationist' })).map(o => o.id)).toEqual(['org-003', 'org-004']);
  });

  it('gets an org by id, null when absent', async () => {
    expect((await orgs.getOrganizationById('org-002'))?.short_name).toBe('FLI');
    expect(await orgs.getOrganizationById('org-999')).toBeNull();
  });

  it('by-pov: direction for/against, sorted by |score| desc', async () => {
    // for: acc >= 0.3 → org-003 (0.7) then org-004 (0.4)
    expect((await orgs.organizationsByPov('accelerationist', 'for')).map(o => o.id)).toEqual(['org-003', 'org-004']);
    // against: acc <= -0.3 → org-001 (-0.5)
    expect((await orgs.organizationsByPov('accelerationist', 'against')).map(o => o.id)).toEqual(['org-001']);
  });

  it('by-pov: honors a custom threshold', async () => {
    // threshold 0.5 → only org-003 (0.7) qualifies; org-004 (0.4) drops out
    expect((await orgs.organizationsByPov('accelerationist', 'for', 0.5)).map(o => o.id)).toEqual(['org-003']);
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
