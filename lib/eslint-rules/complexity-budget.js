// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Cyclomatic-complexity budget gate (t/3821).
// Mirrors ESLint built-in `complexity` rule node set exactly — drift caught by the drift test
// in taxonomy-editor/eslint-rules/__tests__/complexity-budget.test.ts.
//
// Q1 exit (ESLint major version bump): if `--drift-check` starts failing after an ESLint
// upgrade, the exit is fixing this mirror rule's INCREMENT_NODES to match the new built-in
// node set — NOT patching the baseline JSON to hide the mismatch. The baseline records actual
// source complexity; a parity fix must fix the mirror and then regenerate the baseline
// (regeneration restores correct values — parity fix alone is insufficient, e/240#12).

import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { isAcceptable } from './complexity-budget-predicate.js';

/** Node types that increment cyclomatic complexity (same set as ESLint built-in `complexity`). */
// Each optional-chaining `?.` is a separate MemberExpression[optional=true] or
// CallExpression[optional=true] node — NOT one ChainExpression wrapper per chain.
// a?.b?.c has TWO optional MemberExpressions; ChainExpression would count only one.
const INCREMENT_NODES = [
  'IfStatement',
  'ConditionalExpression',
  'WhileStatement',
  'DoWhileStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'LogicalExpression',
  'AssignmentPattern',
  'CatchClause',
  'MemberExpression[optional=true]',
  'CallExpression[optional=true]',
];

/**
 * Resolve a filename to the key used in the baseline JSON.
 * When the baseline is passed as an inline object (tests), the filename is used as-is.
 * When the baseline is a file path, the key is the repo-relative path with forward slashes.
 *
 * @param {string} filename
 * @param {string} cwd
 * @param {boolean} inline - true when baseline was passed as an object (not a file path)
 */
function resolveKey(filename, cwd, inline) {
  if (inline) return filename.replace(/\\/g, '/');
  // Absolute path → make relative
  if (filename.startsWith('/') || /^[A-Z]:\\/i.test(filename)) {
    return relative(cwd, filename).replace(/\\/g, '/');
  }
  return filename.replace(/\\/g, '/');
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Enforce per-file cyclomatic complexity budgets against a recorded baseline',
    },
    messages: {
      overThreshold:
        'File complexity max {{max}} exceeds threshold {{threshold}} (file not in baseline).',
      maxExceeded:
        'File complexity max {{max}} exceeds baseline max {{baselineMax}}.',
      countOverExceeded:
        'File countOver {{countOver}} exceeds baseline countOver {{baselineCountOver}}.',
      thresholdMismatch:
        'Baseline threshold {{baselineThreshold}} does not match configured threshold {{configThreshold}}. Regenerate the baseline with --threshold {{configThreshold}}.',
      baselineLoadError:
        'Could not load baseline "{{path}}": {{error}}. Fix the path or omit baseline for bootstrap mode.',
      scanScopeMismatch:
        'Baseline scan scope "{{baselineScan}}" does not cover this file ({{file}}). Regenerate the baseline with --scan covering this path, or narrow the eslint files: glob to match.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // string → path relative to context.cwd; object → inline baseline (for tests)
          baseline: {},
          threshold: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] ?? {};
    const threshold = options.threshold ?? 15;
    const baselineOpt = options.baseline;
    const isInline = baselineOpt !== null && typeof baselineOpt === 'object';

    let baseline = /** @type {Record<string, { max: number; countOver: number }>} */ ({});
    /** @type {{ threshold?: number } | null} */
    let baselineMeta = null;
    /** @type {string | null} */
    let baselineLoadErr = null;
    if (typeof baselineOpt === 'string') {
      try {
        const parsed = JSON.parse(readFileSync(join(context.cwd, baselineOpt), 'utf-8'));
        const { __meta__, ...files } = parsed;
        baseline = files;
        baselineMeta = __meta__ ?? null;
      } catch (err) {
        // Configured baseline unreadable or malformed — fail loudly in Program:exit.
        // Silently falling back to {} would disable the gate without any indication (Fallback-Path Logging).
        baselineLoadErr = err instanceof Error ? err.message : String(err);
      }
    } else if (isInline) {
      const { __meta__, ...files } = /** @type {any} */ (baselineOpt);
      baseline = files;
      baselineMeta = __meta__ ?? null;
    }

    /** @type {number[]} */
    const stack = [];
    /** @type {number[]} */
    const functionComplexities = [];

    const enter = () => stack.push(1);
    const exit = () => {
      if (stack.length > 0) functionComplexities.push(/** @type {number} */ (stack.pop()));
    };
    const inc = () => {
      if (stack.length > 0) stack[stack.length - 1]++;
    };

    /** @type {import('eslint').Rule.RuleListener} */
    const handlers = {
      FunctionDeclaration: enter,
      FunctionExpression: enter,
      ArrowFunctionExpression: enter,
      'FunctionDeclaration:exit': exit,
      'FunctionExpression:exit': exit,
      'ArrowFunctionExpression:exit': exit,
      SwitchCase(node) {
        if (node.test !== null) inc();
      },
      // Logical assignment operators (&&=, ||=, ??=) are AssignmentExpression nodes,
      // not LogicalExpression — the built-in complexity rule counts them as branches.
      AssignmentExpression(node) {
        if (node.operator === '&&=' || node.operator === '||=' || node.operator === '??=') inc();
      },
    };

    for (const nodeType of INCREMENT_NODES) {
      handlers[nodeType] = inc;
    }

    handlers['Program:exit'] = (programNode) => {
      if (functionComplexities.length === 0) return;

      // Configured baseline unreadable or malformed → fail loudly.
      // Falling through to {} would silently disable the gate (Fallback-Path Logging).
      if (baselineLoadErr !== null) {
        context.report({
          node: programNode,
          messageId: 'baselineLoadError',
          data: { path: /** @type {string} */ (baselineOpt), error: baselineLoadErr },
        });
        return;
      }

      // Threshold mismatch: baseline was generated at a different threshold than the gate
      // uses. Raising or lowering the configured threshold without regenerating re-creates
      // the sub-threshold freeze defect (e/240#19, t/3838). Fail loudly naming both values.
      if (baselineMeta?.threshold !== undefined && baselineMeta.threshold !== threshold) {
        context.report({
          node: programNode,
          messageId: 'thresholdMismatch',
          data: { baselineThreshold: baselineMeta.threshold, configThreshold: threshold },
        });
        return;
      }

      const max = Math.max(...functionComplexities);
      const countOver = functionComplexities.filter((c) => c > threshold).length;

      const filename = context.filename ?? context.getFilename?.() ?? '';
      const relKey = resolveKey(filename, context.cwd, isInline);

      // Scan-scope check: if the baseline recorded a --scan prefix and this file falls
      // outside it, the lint config has been broadened beyond what was baselined — report
      // a targeted error rather than the misleading "file not in baseline" overThreshold.
      // Note: this check fires only when the lint glob widens past the baseline's scope.
      // The symmetric case (glob narrows, baselined rows go unvisited) is silent — inherent,
      // not a design gap; narrowing reduces gate coverage and does not produce false errors.
      if (baselineMeta?.scan != null) {
        const scan = baselineMeta.scan;
        if (relKey !== scan && !relKey.startsWith(scan + '/')) {
          context.report({
            node: programNode,
            messageId: 'scanScopeMismatch',
            data: { baselineScan: scan, file: relKey },
          });
          return;
        }
      }

      const entry = baseline[relKey];

      if (!entry) {
        if (max > threshold) {
          context.report({
            node: programNode,
            messageId: 'overThreshold',
            data: { max, threshold },
          });
        }
        return;
      }

      if (!isAcceptable({ max, countOver }, entry, threshold)) {
        if (max > entry.max) {
          context.report({
            node: programNode,
            messageId: 'maxExceeded',
            data: { max, baselineMax: entry.max },
          });
        }
        if (countOver > entry.countOver) {
          context.report({
            node: programNode,
            messageId: 'countOverExceeded',
            data: { countOver, baselineCountOver: entry.countOver },
          });
        }
      }
    };

    return handlers;
  },
};
