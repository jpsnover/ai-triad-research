// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { SettingsSlice } from './slices/settingsSlice';
import type { SearchSlice } from './slices/searchSlice';
import type { AnalysisSlice } from './slices/analysisSlice';
import type { TaxonomyDataSlice } from './slices/taxonomyDataSlice';

export type TaxonomyStore = SettingsSlice & SearchSlice & AnalysisSlice & TaxonomyDataSlice;

export type ToolbarPanel = 'search' | 'related' | 'attrFilter' | 'attrInfo' | 'lineage' | 'prompts' | 'console' | 'fallacy' | 'edges' | 'policyAlignment' | 'policyDashboard' | 'vocabulary' | 'calibration' | null;
