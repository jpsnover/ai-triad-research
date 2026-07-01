// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import { api } from '@bridge';
import type { Organization, OrgFilters } from '../bridge/types';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

interface OrganizationState {
  organizations: Organization[];
  selectedOrg: Organization | null;
  loading: boolean;
  error: string | null;
  filters: OrgFilters;
  searchQuery: string;
  fetchOrganizations: () => Promise<void>;
  selectOrganization: (id: string) => void;
  clearSelection: () => void;
  setFilters: (f: OrgFilters) => void;
  setSearchQuery: (q: string) => void;
}

export const useOrganizationStore = create<OrganizationState>((set, get) => ({
  organizations: [],
  selectedOrg: null,
  loading: false,
  error: null,
  filters: {},
  searchQuery: '',

  fetchOrganizations: async () => {
    set({ loading: true, error: null });
    try {
      const orgs = await api.listOrganizations(get().filters);
      set({ organizations: orgs, loading: false });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'state.error',
        component: 'organization-store',
        level: 'error',
        message: 'Failed to fetch organizations',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      set({ loading: false, error: 'Failed to load organizations' });
    }
  },

  selectOrganization: (id: string) => {
    const org = get().organizations.find((o) => o.id === id) ?? null;
    set({ selectedOrg: org });
  },

  clearSelection: () => {
    set({ selectedOrg: null });
  },

  setFilters: (f: OrgFilters) => {
    set({ filters: f });
  },

  setSearchQuery: (q: string) => {
    set({ searchQuery: q });
  },
}));
