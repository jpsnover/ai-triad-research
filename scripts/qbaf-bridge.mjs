#!/usr/bin/env node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * QBAF Bridge — stdin/stdout JSON interface for PowerShell.
 *
 * Reads a JSON object from stdin with {nodes, edges, options?}, calls
 * computeQbafStrengths from lib/debate/qbaf.ts, and writes the result
 * to stdout as JSON.
 *
 * Usage: echo '{"nodes":[...],"edges":[...]}' | node scripts/qbaf-bridge.mjs
 */

import { computeQbafStrengths } from '../lib/debate/qbaf.js';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const result = computeQbafStrengths(
      data.nodes || [],
      data.edges || [],
      data.options || {}
    );

    // Convert Map to plain object for JSON serialization
    const strengths = {};
    for (const [id, strength] of result.strengths) {
      strengths[id] = strength;
    }

    const output = {
      strengths,
      iterations: result.iterations,
      converged: result.converged,
    };

    process.stdout.write(JSON.stringify(output));
  } catch (err) {
    process.stderr.write(`qbaf-bridge error: ${err.message}\n`);
    process.exit(1);
  }
});
