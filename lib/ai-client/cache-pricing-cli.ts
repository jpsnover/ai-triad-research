// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Cache-read pricing completeness check (t/3945), run by scripts/Verify-Config.ps1 as a WARN-only lane.
//
//   tsx lib/ai-client/cache-pricing-cli.ts [--repo-root <dir>]
//
// Output contract (consumed by Verify-Config.ps1; t/3945#3 condition 1, fail closed):
//   success → exit 0 and stdout's LAST line is exactly one JSON object:
//     { "checked": <pricing entries on cache-reporting backends>, "issues": [ { modelId, referenceSite, message } ] }
//   `checked` lets the caller tell "evaluated, clean" from "evaluated nothing"; an empty
//   result and a crashed script must never look the same.
//   any fault (registry missing or unparseable, import failure) → non-zero exit. The caller then
//   reports "could not be evaluated" as a WARN, never as clean.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModelRegistry, findPricingMissingCacheRate, CACHE_REPORTING_BACKENDS } from './registry.js';

function repoRootFromArgs(argv: string[]): string {
  const i = argv.indexOf('--repo-root');
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

const registry = loadModelRegistry(repoRootFromArgs(process.argv.slice(2)));
const byId = new Map(registry.models.map((m) => [m.id, m]));
const byApi = new Map(registry.models.map((m) => [m.apiModelId, m]));
const checked = Object.keys(registry.pricing ?? {}).filter((k) => {
  if (k.startsWith('_')) return false;
  const m = byId.get(k) ?? byApi.get(k);
  return !!m && CACHE_REPORTING_BACKENDS.has(m.backend);
}).length;
const issues = findPricingMissingCacheRate(registry).map(({ modelId, referenceSite, message }) => ({ modelId, referenceSite, message }));
process.stdout.write(JSON.stringify({ checked, issues }) + '\n');
