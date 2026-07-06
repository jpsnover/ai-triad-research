#!/usr/bin/env node
// Schema validation script for CI (report-only mode).
// Validates taxonomy data files against their JSON Schemas.
// Exit 0 always — flip to exit 1 in B-404.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ajv = require('ajv/dist/2020');

const ROOT = resolve(import.meta.dirname, '..');
const configPath = join(ROOT, '.aitriad.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const dataRoot = resolve(ROOT, config.data_root);
const taxonomyDir = join(dataRoot, config.taxonomy_dir);
const conflictsDir = join(dataRoot, config.conflicts_dir);
const schemasDir = join(ROOT, 'taxonomy', 'schemas');

const ajv = new Ajv({ allErrors: true, strict: false });

const VALIDATIONS = [
  {
    name: 'POV taxonomy',
    schema: 'pov-taxonomy.schema.json',
    files: () => ['accelerationist.json', 'safetyist.json', 'skeptic.json'].map(f => join(taxonomyDir, f)),
  },
  {
    name: 'Situations',
    schema: 'situations-taxonomy.schema.json',
    files: () => [join(taxonomyDir, 'situations.json')],
  },
  {
    name: 'Conflicts',
    schema: 'conflict.schema.json',
    files: () => {
      if (!existsSync(conflictsDir)) return [];
      return readdirSync(conflictsDir)
        .filter(f => f.startsWith('conflict-') && f.endsWith('.json'))
        .map(f => join(conflictsDir, f));
    },
  },
  {
    name: 'Edges',
    schema: 'edges.schema.json',
    files: () => {
      const p = join(taxonomyDir, 'edges.json');
      return existsSync(p) ? [p] : [];
    },
  },
];

let totalFiles = 0;
let totalViolations = 0;
const report = [];

for (const v of VALIDATIONS) {
  const schemaPath = join(schemasDir, v.schema);
  if (!existsSync(schemaPath)) {
    report.push(`⚠ Schema not found: ${v.schema} — skipping ${v.name}`);
    continue;
  }

  let validate;
  try {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    validate = ajv.compile(schema);
  } catch (err) {
    report.push(`⚠ Schema compile error for ${v.schema}: ${err.message}`);
    continue;
  }

  const files = v.files().filter(f => existsSync(f));
  for (const filePath of files) {
    totalFiles++;
    let data;
    try {
      data = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (err) {
      report.push(`✗ ${basename(filePath)}: JSON parse error — ${err.message}`);
      totalViolations++;
      continue;
    }

    const valid = validate(data);
    if (valid) {
      report.push(`✓ ${basename(filePath)}`);
    } else {
      totalViolations++;
      const additionalProps = new Map();
      const otherErrors = [];
      for (const err of validate.errors) {
        if (err.keyword === 'additionalProperties' && err.params?.additionalProperty) {
          const prop = err.params.additionalProperty;
          additionalProps.set(prop, (additionalProps.get(prop) || 0) + 1);
        } else {
          otherErrors.push(err);
        }
      }
      report.push(`✗ ${basename(filePath)}: ${validate.errors.length} violation(s)`);
      if (additionalProps.size > 0) {
        const sorted = [...additionalProps.entries()].sort((a, b) => b[1] - a[1]);
        report.push(`    additionalProperties (${sorted.reduce((s, [, c]) => s + c, 0)} hits): ${sorted.map(([p, c]) => `${p}(${c})`).join(', ')}`);
      }
      for (const err of otherErrors.slice(0, 10)) {
        report.push(`    ${err.instancePath || '/'} — ${err.message}`);
      }
      if (otherErrors.length > 10) {
        report.push(`    ... and ${otherErrors.length - 10} more non-additionalProperties errors`);
      }
    }
  }
}

console.log('=== Schema Validation Report ===');
console.log(`Files checked: ${totalFiles}`);
console.log(`Violations: ${totalViolations}`);
console.log('');
for (const line of report) {
  console.log(line);
}
console.log('');

if (totalViolations > 0) {
  console.log(`⚠ ${totalViolations} file(s) have schema violations (report-only — not failing CI).`);
  console.log('Known expected: 10 skp-intentions-* nodes with operationality=6 (t/1320).');
} else {
  console.log('✓ All files pass schema validation.');
}

// Report-only: always exit 0. B-404 will flip to exit(totalViolations > 0 ? 1 : 0).
process.exit(0);
