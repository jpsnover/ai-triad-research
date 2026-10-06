// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// TS side of the TS–PS pricing parity test (t/3946#5 item 4). For every model in ai-models.json,
// prints the pricing key the TS reader resolves when that model is called (by models[].id), so a
// Pester test can compare it with the PS reader's resolution of the same record by (backend, apiModelId).
//
//   tsx lib/ai-client/pricing-resolve-cli.ts [--repo-root <dir>] [--registry <ai-models.json path>]
//
// Output: exit 0 and stdout's LAST line is one JSON array:
//   [ { "id", "backend", "apiModelId", "pricingKey": <string | null> } ]   one row per models[] entry
// `--registry` lets a test pass a fixture file (e.g. the duplicated azure/openai pairs, priced
// differently per backend). Any fault → non-zero exit.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModelRegistry, resolvePricingKey, type ModelRegistry } from './registry.js';

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
}

const argv = process.argv.slice(2);
const fixture = arg(argv, '--registry');
const registry: ModelRegistry = fixture
  ? (JSON.parse(fs.readFileSync(path.resolve(fixture), 'utf8')) as ModelRegistry)
  : loadModelRegistry(path.resolve(arg(argv, '--repo-root') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')));

const rows = registry.models.map((m) => ({
  id: m.id,
  backend: m.backend,
  apiModelId: m.apiModelId,
  pricingKey: resolvePricingKey(registry, m.id) ?? null,
}));
process.stdout.write(JSON.stringify(rows) + '\n');
