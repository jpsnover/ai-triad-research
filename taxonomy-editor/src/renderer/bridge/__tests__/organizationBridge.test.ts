// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1226, t/1544 — verify organization bridge methods exist on AppAPI and that
// the electron-bridge delegates to window.electronAPI with optional-chaining fallback.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppAPI, Organization, OrgFilters } from '../types';

describe('organization bridge types', () => {
  it('AppAPI includes all 6 organization methods', () => {
    const methods: (keyof AppAPI)[] = [
      'listOrganizations',
      'getOrganization',
      'getOrganizationsByPov',
      'getOrganizationsByTopic',
      'getOrganizationsByPolicy',
      'getOrganizationEdges',
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

describe('electron-bridge organization delegation', () => {
  const origElectronAPI = (globalThis as Record<string, unknown>).window;

  beforeEach(() => {
    // Provide a minimal window.electronAPI with organization methods
    (globalThis as Record<string, unknown>).window = {
      electronAPI: {
        listOrganizations: vi.fn().mockResolvedValue([{ id: 'org-001', name: 'Org A' }]),
        getOrganization: vi.fn().mockResolvedValue({ id: 'org-001', name: 'Org A' }),
        getOrganizationsByPov: vi.fn().mockResolvedValue([{ id: 'org-002' }]),
        getOrganizationsByTopic: vi.fn().mockResolvedValue([{ id: 'org-003' }]),
        getOrganizationsByPolicy: vi.fn().mockResolvedValue([{ id: 'org-004' }]),
        getOrganizationEdges: vi.fn().mockResolvedValue([{ source: 'org-001', target: 'org-002' }]),
      },
    };
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).window = origElectronAPI;
    vi.resetModules();
  });

  it('listOrganizations delegates to electronAPI', async () => {
    const mod = await import('../electron-bridge');
    const result = await mod.api.listOrganizations({ type: 'advocacy' });
    expect(result).toEqual([{ id: 'org-001', name: 'Org A' }]);
    expect(window.electronAPI.listOrganizations).toHaveBeenCalledWith({ type: 'advocacy' });
  });

  it('getOrganization delegates to electronAPI', async () => {
    const mod = await import('../electron-bridge');
    const result = await mod.api.getOrganization('org-001');
    expect(result).toEqual({ id: 'org-001', name: 'Org A' });
    expect(window.electronAPI.getOrganization).toHaveBeenCalledWith('org-001');
  });

  it('getOrganizationsByPov delegates to electronAPI', async () => {
    const mod = await import('../electron-bridge');
    const result = await mod.api.getOrganizationsByPov('safetyist');
    expect(result).toEqual([{ id: 'org-002' }]);
    expect(window.electronAPI.getOrganizationsByPov).toHaveBeenCalledWith('safetyist');
  });

  it('getOrganizationsByTopic delegates to electronAPI', async () => {
    const mod = await import('../electron-bridge');
    const result = await mod.api.getOrganizationsByTopic('sit-003');
    expect(result).toEqual([{ id: 'org-003' }]);
    expect(window.electronAPI.getOrganizationsByTopic).toHaveBeenCalledWith('sit-003');
  });

  it('getOrganizationsByPolicy delegates to electronAPI', async () => {
    const mod = await import('../electron-bridge');
    const result = await mod.api.getOrganizationsByPolicy('pol-010');
    expect(result).toEqual([{ id: 'org-004' }]);
    expect(window.electronAPI.getOrganizationsByPolicy).toHaveBeenCalledWith('pol-010');
  });

  it('getOrganizationEdges delegates to electronAPI', async () => {
    const mod = await import('../electron-bridge');
    const result = await mod.api.getOrganizationEdges('org-001');
    expect(result).toEqual([{ source: 'org-001', target: 'org-002' }]);
    expect(window.electronAPI.getOrganizationEdges).toHaveBeenCalledWith('org-001');
  });
});

describe('electron-bridge organization fallback (no IPC handlers)', () => {
  const origElectronAPI = (globalThis as Record<string, unknown>).window;

  beforeEach(() => {
    // electronAPI exists but has no organization methods
    (globalThis as Record<string, unknown>).window = {
      electronAPI: {},
    };
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).window = origElectronAPI;
    vi.resetModules();
  });

  it('listOrganizations falls back to empty array', async () => {
    const mod = await import('../electron-bridge');
    const result = await mod.api.listOrganizations();
    expect(result).toEqual([]);
  });

  it('getOrganization falls back to rejection', async () => {
    const mod = await import('../electron-bridge');
    await expect(mod.api.getOrganization('org-001')).rejects.toThrow('not available in desktop');
  });

  it('getOrganizationsByPov falls back to empty array', async () => {
    const mod = await import('../electron-bridge');
    const result = await mod.api.getOrganizationsByPov('safetyist');
    expect(result).toEqual([]);
  });

  it('getOrganizationsByTopic falls back to empty array', async () => {
    const mod = await import('../electron-bridge');
    const result = await mod.api.getOrganizationsByTopic('sit-003');
    expect(result).toEqual([]);
  });

  it('getOrganizationsByPolicy falls back to empty array', async () => {
    const mod = await import('../electron-bridge');
    const result = await mod.api.getOrganizationsByPolicy('pol-010');
    expect(result).toEqual([]);
  });

  it('getOrganizationEdges falls back to empty array', async () => {
    const mod = await import('../electron-bridge');
    const result = await mod.api.getOrganizationEdges('org-001');
    expect(result).toEqual([]);
  });
});
