// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import type { TaxonomyStore } from './types';
import { createSettingsSlice } from './slices/settingsSlice';
import { createSearchSlice } from './slices/searchSlice';
import { createAnalysisSlice } from './slices/analysisSlice';
import { createTaxonomyDataSlice } from './slices/taxonomyDataSlice';

export const useTaxonomyStore = create<TaxonomyStore>()((...a) => ({
  ...createSettingsSlice(...a),
  ...createSearchSlice(...a),
  ...createAnalysisSlice(...a),
  ...createTaxonomyDataSlice(...a),
}));

((window as unknown as { __ZUSTAND_STORES__?: Record<string, unknown> }).__ZUSTAND_STORES__ ??= {} as Record<string, unknown>).taxonomy = useTaxonomyStore;
