// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Cyclomatic-complexity budget gate (t/3821).
// Mirrors ESLint built-in `complexity` rule node set exactly — drift caught by the drift test
// in taxonomy-editor/eslint-rules/__tests__/complexity-budget.test.ts.

import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { isAcceptable } from './complexity-budget-predicate.js';

/** Node types that increment cyclomatic complexity (same set as ESLint built-in `complexity`). */
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
  'ChainExpression',
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
    },
    schema: [
      {
        type: 'object',
        properties: {
          // string → path relative to context.cwd; object → inline baseline (for tests)
          baseline: {},
          threshold: { type: 'integer', minimum: 0 },
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
    if (typeof baselineOpt === 'string') {
      try {
        baseline = JSON.parse(readFileSync(join(context.cwd, baselineOpt), 'utf-8'));
      } catch {
        // Missing or unreadable baseline → treat as empty (no baselined files)
      }
    } else if (isInline) {
      baseline = baselineOpt;
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

      const max = Math.max(...functionComplexities);
      const countOver = functionComplexities.filter((c) => c > threshold).length;

      const filename = context.filename ?? context.getFilename?.() ?? '';
      const relKey = resolveKey(filename, context.cwd, isInline);
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

      if (!isAcceptable({ max, countOver }, entry)) {
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
