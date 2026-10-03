// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { OutletsData } from './outletsSsot.js';
import { ActionableError } from '../debate/errors.js';
import outletsRaw from './outlets.json' with { type: 'json' };

export function validateOutletsData(data: OutletsData): void {
  const actual = Object.keys(data.outlets).length;
  if (actual !== data.__meta__.outlets_count) {
    throw new ActionableError({
      goal: 'Load outlet definitions from SSOT',
      problem: `outlets_count mismatch: __meta__.outlets_count is ${data.__meta__.outlets_count} but outlets has ${actual} keys`,
      location: 'lib/oped/loadOutlets.ts — validateOutletsData',
      nextSteps: [
        `Update __meta__.outlets_count in lib/oped/outlets.json to match the number of outlet keys (currently ${actual}).`,
      ],
    });
  }
}

let _cached: OutletsData | undefined;

export function loadOutletsData(): OutletsData {
  if (_cached) return _cached;
  const data = outletsRaw as unknown as OutletsData;
  validateOutletsData(data);
  _cached = data;
  return _cached;
}
