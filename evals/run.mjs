#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REGRESSION_DIR = join(__dirname, 'regression');

function resolve(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

const CHECKERS = {
  json_valid(_parsed, _check, raw) {
    try {
      JSON.parse(raw);
      return { pass: true };
    } catch (e) {
      return { pass: false, detail: `Invalid JSON: ${e.message}` };
    }
  },

  has_fields(parsed, check) {
    const missing = check.fields.filter(f => resolve(parsed, f) === undefined);
    if (missing.length === 0) return { pass: true };
    return { pass: false, detail: `Missing fields: ${missing.join(', ')}` };
  },

  field_type(parsed, check) {
    const val = resolve(parsed, check.field);
    const actual = Array.isArray(val) ? 'array' : typeof val;
    if (actual === check.expected) return { pass: true };
    return { pass: false, detail: `${check.field}: expected ${check.expected}, got ${actual}` };
  },

  min_length(parsed, check) {
    const val = resolve(parsed, check.field);
    if (typeof val !== 'string') return { pass: false, detail: `${check.field}: not a string` };
    if (val.length >= check.min) return { pass: true };
    return { pass: false, detail: `${check.field}: length ${val.length} < min ${check.min}` };
  },

  array_min_length(parsed, check) {
    const val = resolve(parsed, check.field);
    if (!Array.isArray(val)) return { pass: false, detail: `${check.field}: not an array` };
    if (val.length >= check.min) return { pass: true };
    return { pass: false, detail: `${check.field}: length ${val.length} < min ${check.min}` };
  },

  matches(parsed, check) {
    const val = resolve(parsed, check.field);
    if (val == null) return { pass: false, detail: `${check.field}: is null/undefined` };
    const re = new RegExp(check.pattern);
    if (re.test(String(val))) return { pass: true };
    return { pass: false, detail: `${check.field}: "${String(val).slice(0, 80)}" !~ /${check.pattern}/` };
  },

  contains(parsed, check) {
    const val = resolve(parsed, check.field);
    if (typeof val !== 'string') return { pass: false, detail: `${check.field}: not a string` };
    if (val.includes(check.substring)) return { pass: true };
    return { pass: false, detail: `${check.field}: does not contain "${check.substring}"` };
  },

  array_items_have(parsed, check) {
    const val = resolve(parsed, check.field);
    if (!Array.isArray(val)) return { pass: false, detail: `${check.field}: not an array` };
    const failures = [];
    for (let i = 0; i < val.length; i++) {
      const item = val[i];
      if (item == null || typeof item !== 'object') {
        failures.push(`[${i}]: not an object`);
        continue;
      }
      const missing = check.required_fields.filter(f => item[f] === undefined);
      if (missing.length > 0) failures.push(`[${i}]: missing ${missing.join(', ')}`);
    }
    if (failures.length === 0) return { pass: true };
    return { pass: false, detail: `${check.field}: ${failures.join('; ')}` };
  },

  not_empty(parsed, check) {
    const val = resolve(parsed, check.field);
    if (val == null) return { pass: false, detail: `${check.field}: is null/undefined` };
    if (val === '') return { pass: false, detail: `${check.field}: is empty string` };
    if (Array.isArray(val) && val.length === 0) return { pass: false, detail: `${check.field}: is empty array` };
    return { pass: true };
  },
};

function runChecks(testCase) {
  const results = [];
  let parsed = null;

  try {
    parsed = JSON.parse(testCase.mock_response);
  } catch {
    // json_valid check will catch this
  }

  for (const check of testCase.checks) {
    const checker = CHECKERS[check.type];
    if (!checker) {
      results.push({ check: check.type, pass: false, detail: `Unknown check type: ${check.type}` });
      continue;
    }

    if (check.type === 'json_valid') {
      results.push({ check: 'json_valid', ...CHECKERS.json_valid(parsed, check, testCase.mock_response) });
    } else if (parsed == null) {
      results.push({ check: check.type, pass: false, detail: 'Skipped — JSON parse failed' });
    } else {
      const label = check.field ? `${check.type}(${check.field})` : check.type;
      results.push({ check: label, ...checker(parsed, check, testCase.mock_response) });
    }
  }

  return results;
}

async function main() {
  const files = (await readdir(REGRESSION_DIR)).filter(f => f.endsWith('.json')).sort();

  if (files.length === 0) {
    console.log('No regression cases found in evals/regression/');
    process.exit(1);
  }

  let totalPass = 0;
  let totalFail = 0;
  let casePass = 0;
  let caseFail = 0;

  console.log(`\nDebate Engine Regression Evals`);
  console.log(`${'='.repeat(50)}\n`);

  for (const file of files) {
    const raw = await readFile(join(REGRESSION_DIR, file), 'utf-8');
    const testCase = JSON.parse(raw);

    const results = runChecks(testCase);
    const allPassed = results.every(r => r.pass);

    const icon = allPassed ? '✓' : '✗';
    console.log(`${icon} ${testCase.name} (${basename(file)})`);
    console.log(`  ${testCase.description}`);

    if (allPassed) {
      casePass++;
      totalPass += results.length;
      console.log(`  ${results.length}/${results.length} checks passed\n`);
    } else {
      caseFail++;
      const passed = results.filter(r => r.pass).length;
      const failed = results.filter(r => !r.pass);
      totalPass += passed;
      totalFail += failed.length;

      console.log(`  ${passed}/${results.length} checks passed`);
      for (const f of failed) {
        console.log(`  FAIL: ${f.check} — ${f.detail}`);
      }
      console.log();
    }
  }

  console.log(`${'='.repeat(50)}`);
  console.log(`Cases:  ${casePass} passed, ${caseFail} failed (${files.length} total)`);
  console.log(`Checks: ${totalPass} passed, ${totalFail} failed (${totalPass + totalFail} total)\n`);

  process.exit(totalFail > 0 ? 1 : 0);
}

main();
