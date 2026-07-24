// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Organization handlers (t/1689 split of ipcHandlers.ts, ADR-007).
// Local read of taxonomy/Origin/organizations.json + edges (t/1544), mirroring
// server/organizations.ts with graceful degradation to []. Handler bodies moved
// verbatim; channel names unchanged.

import { ipcMain } from 'electron';
import { listOrganizations, getOrganizationById, organizationsByPov, organizationsByTopic, organizationsByPolicy, organizationEdges, isPov } from '../organizations.js';

export function registerOrganizationHandlers(): void {
  ipcMain.handle('list-organizations', (_event, filters?: { type?: string; pov?: string }) =>
    listOrganizations(filters ?? {}));
  ipcMain.handle('get-organization', (_event, id: string) => {
    const org = getOrganizationById(id);
    if (!org) throw new Error(`Organization not found: ${id}`);
    return org;
  });
  ipcMain.handle('get-organizations-by-pov', (_event, pov: string) =>
    isPov(pov) ? organizationsByPov(pov) : []);
  ipcMain.handle('get-organizations-by-topic', (_event, topicRef: string) =>
    organizationsByTopic(topicRef));
  ipcMain.handle('get-organizations-by-policy', (_event, policyId: string) =>
    organizationsByPolicy(policyId));
  ipcMain.handle('get-organization-edges', (_event, orgId: string) =>
    organizationEdges(orgId));
}
