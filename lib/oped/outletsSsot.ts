// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { OutletBand } from './outletBands.js';

export type { OutletBand };

/** Prose style defaults applied to outlets that carry no per-outlet Style block. */
export interface OutletStyleDefaults {
  audience: string;
  readingLevel: string;
  sentenceMechanics: string;
  paragraphMechanics: string;
  jargonGuidance: string;
  bodyFormat: string;
  readability: { fkMax: number; maxSentWords: number; maxParaWords: number };
}

export interface OutletsMeta {
  generated: string;
  /** Must equal Object.keys(outlets).length. Consumers assert this. */
  outlets_count: number;
  /** Must equal the number of prose keys in styleDefaults (excluding readability). */
  styleDefaults_fields: number;
  description?: string;
}

/** Shape of lib/oped/outlets.json. */
export interface OutletsData {
  __meta__: OutletsMeta;
  /** Key of the outlet used when none is specified. */
  defaultOutlet: string;
  /** Style applied to outlets lacking a per-outlet Style block. */
  styleDefaults: OutletStyleDefaults;
  outlets: Record<string, OutletBand>;
}
