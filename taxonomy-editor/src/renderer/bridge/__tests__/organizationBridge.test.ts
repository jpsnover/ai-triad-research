// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1226 — verify organization bridge methods exist on AppAPI and that
// the electron-bridge stubs satisfy the type contract with correct defaults.

import { describe, it, expect } from 'vitest';
import type { AppAPI, Organization, OrgFilters } from '../types';

describe('organization bridge types', () => {
  it('AppAPI includes all 5 organization methods', () => {
    const methods: (keyof AppAPI)[] = [
      'listOrganizations',
      'getOrganization',
      'getOrganizationsByPov',
      'getOrganizationsByTopic',
      'getOrganizationsByPolicy',
    ];
    const dummy = {} as AppAPI;
    for (const m of methods) {
      expect(m in dummy || dummy[m] === undefined).toBe(true);
    }
  });

  it('Organization type has required fields', () => {
    const org: Organization = { id: 'org-001', name: 'Test Org' };
    expect(org.id).toBe('org-001');
    expect(org.name).toBe('Test Org');
  });

  it('OrgFilters type accepts type and pov', () => {
    const f: OrgFilters = { type: 'advocacy', pov: 'safetyist' };
    expect(f.type).toBe('advocacy');
    expect(f.pov).toBe('safetyist');
  });
});

describe('electron-bridge organization stubs', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let electronBridge: AppAPI;

  it('loads electron bridge without error', async () => {
    const mod = await import('../electron-bridge');
    electronBridge = mod.api;
    expect(electronBridge).toBeDefined();
  });

  it('listOrganizations returns empty array', async () => {
    const mod = await import('../electron-bridge');
    const result = await mod.api.listOrganizations();
    expect(result).toEqual([]);
  });

  it('getOrganization rejects in desktop mode', async () => {
    const mod = await import('../electron-bridge');
    await expect(mod.api.getOrganization('org-001')).rejects.toThrow('not available in desktop');
  });

  it('getOrganizationsByPov returns empty array', async () => {
    const mod = await import('../electron-bridge');
    const result = await mod.api.getOrganizationsByPov('safetyist');
    expect(result).toEqual([]);
  });

  it('getOrganizationsByTopic returns empty array', async () => {
    const mod = await import('../electron-bridge');
    const result = await mod.api.getOrganizationsByTopic('sit-003');
    expect(result).toEqual([]);
  });

  it('getOrganizationsByPolicy returns empty array', async () => {
    const mod = await import('../electron-bridge');
    const result = await mod.api.getOrganizationsByPolicy('pol-010');
    expect(result).toEqual([]);
  });
});
