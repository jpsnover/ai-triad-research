// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { resolve } from 'path';

const BRIDGE = resolve(__dirname, '../../scripts/qbaf-bridge.mjs');

function runBridge(input: object): any {
  const result = execSync(`node --import tsx ${BRIDGE}`, {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 10_000,
  });
  return JSON.parse(result);
}

describe('qbaf-bridge passthrough', () => {
  it('includes oscillationDetected and dampingLevel in single-mode output', () => {
    const input = {
      nodes: [
        { id: 'A', base_strength: 0.8 },
        { id: 'B', base_strength: 0.6 },
      ],
      edges: [
        { source: 'A', target: 'B', type: 'attacks', weight: 0.5 },
      ],
    };
    const output = runBridge(input);
    expect(output).toHaveProperty('strengths');
    expect(output).toHaveProperty('iterations');
    expect(output).toHaveProperty('converged');
    expect(output).toHaveProperty('oscillationDetected');
    expect(output).toHaveProperty('dampingLevel');
    expect(typeof output.oscillationDetected).toBe('boolean');
    expect(typeof output.dampingLevel).toBe('number');
  });

  it('includes oscillationDetected and dampingLevel in batch-mode output', () => {
    const input = {
      batch: [
        {
          nodes: [{ id: 'X', base_strength: 0.5 }],
          edges: [],
        },
      ],
    };
    const output = runBridge(input);
    expect(Array.isArray(output)).toBe(true);
    expect(output[0]).toHaveProperty('oscillationDetected');
    expect(output[0]).toHaveProperty('dampingLevel');
  });
});
