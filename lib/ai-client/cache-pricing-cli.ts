// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Pricing completeness checks, run by scripts/Verify-Config.ps1 as WARN-only lanes:
// cache-read prices (t/3945) and the pricing-key contract (t/3946).
//
//   tsx lib/ai-client/cache-pricing-cli.ts [--repo-root <dir>]
//
// Output contract (consumed by Verify-Config.ps1; t/3945#3 condition 1, fail closed):
//   success → exit 0 and stdout's LAST line is exactly one JSON object:
//     { "checked":   <pricing entries on cache-reporting backends>,
//       "issues":    [ { modelId, referenceSite, message } ],   cache-read price missing (t/3945)
//       "models":    <models[] count>,
//       "keyIssues": [ { modelId, referenceSite, message } ],   pricing-key contract warnings (t/3946)
//       "keyInfo":   [ { modelId, referenceSite, message } ] }  informational only (t/3946)
//   `checked` and `models` let the caller tell "evaluated, clean" from "evaluated nothing"; an empty
//   result and a crashed script must never look the same.
//   any fault (registry missing or unparseable, import failure) → non-zero exit. The caller then
//   reports "could not be evaluated" as a WARN, never as clean.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModelRegistry, findPricingMissingCacheRate, findPricingKeyIssues, CACHE_REPORTING_BACKENDS, type ConfigIssue } from './registry.js';

function repoRootFromArgs(argv: string[]): string {
  const i = argv.indexOf('--repo-root');
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

const slim = ({ modelId, referenceSite, message }: ConfigIssue) => ({ modelId, referenceSite, message });

const registry = loadModelRegistry(repoRootFromArgs(process.argv.slice(2)));
const byId = new Map(registry.models.map((m) => [m.id, m]));
const checked = Object.keys(registry.pricing ?? {}).filter((k) => {
  if (k.startsWith('_')) return false;
  const m = byId.get(k);
  return !!m && CACHE_REPORTING_BACKENDS.has(m.backend);
}).length;
const issues = findPricingMissingCacheRate(registry).map(slim);
const keyAll = findPricingKeyIssues(registry);
const keyIssues = keyAll.filter((i) => i.severity === 'warning').map(slim);
const keyInfo = keyAll.filter((i) => i.severity === 'info').map(slim);
process.stdout.write(JSON.stringify({ checked, issues, models: registry.models.length, keyIssues, keyInfo }) + '\n');
