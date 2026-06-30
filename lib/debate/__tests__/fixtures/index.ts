// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DebateSession } from '../../types.js';
import { ActionableError } from '../../errors.js';
import { getGlobalRecorder } from '../../../flight-recorder/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type FixtureName =
  | 'pre-synthesis'
  | 'post-synthesis-p1'
  | 'post-synthesis-p2'
  | 'post-synthesis-p3'
  | 'pre-finalization';

const EXPECTED_PHASE: Record<FixtureName, DebateSession['phase']> = {
  'pre-synthesis': 'debate',
  'post-synthesis-p1': 'debate',
  'post-synthesis-p2': 'debate',
  'post-synthesis-p3': 'debate',
  'pre-finalization': 'debate',
};

const REQUIRED_FIELDS: (keyof DebateSession)[] = [
  'id', 'title', 'topic', 'phase', 'transcript',
  'active_povers', 'diagnostics', 'argument_network',
];

export function loadFixture(name: FixtureName): DebateSession {
  const filePath = resolve(__dirname, `checkpoint-${name}.json`);

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'fixtures', level: 'error',
      message: `Fixture file not found: checkpoint-${name}.json`,
      error: { name: (err as Error).name ?? 'Error', message: String(err) },
    });
    throw new ActionableError({
      goal: `Load test fixture '${name}'`,
      problem: `Fixture file not found: checkpoint-${name}.json`,
      location: 'lib/debate/__tests__/fixtures/index.ts',
      nextSteps: [
        `Verify the fixture file exists at ${filePath}`,
        'Run the fixture generator if fixtures were not committed',
      ],
      innerError: err,
    });
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'fixtures', level: 'error',
      message: `Invalid JSON in checkpoint-${name}.json`,
      error: { name: (err as Error).name ?? 'Error', message: String(err) },
    });
    throw new ActionableError({
      goal: `Parse test fixture '${name}'`,
      problem: `Invalid JSON in checkpoint-${name}.json`,
      location: 'lib/debate/__tests__/fixtures/index.ts',
      nextSteps: ['Check the fixture file for JSON syntax errors'],
      innerError: err,
    });
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ActionableError({
      goal: `Parse test fixture '${name}'`,
      problem: `Fixture is not a JSON object: checkpoint-${name}.json`,
      location: 'lib/debate/__tests__/fixtures/index.ts',
      nextSteps: ['Verify the fixture file contains a JSON object, not a primitive or array'],
    });
  }

  const missing = REQUIRED_FIELDS.filter(f => !(f in data));
  if (missing.length > 0) {
    throw new ActionableError({
      goal: `Validate test fixture '${name}'`,
      problem: `Missing required fields: ${missing.join(', ')}`,
      location: 'lib/debate/__tests__/fixtures/index.ts',
      nextSteps: [
        `Add the missing fields to checkpoint-${name}.json`,
        'Compare against the DebateSession interface in types.ts',
      ],
    });
  }

  const expectedPhase = EXPECTED_PHASE[name];
  if (data.phase !== expectedPhase) {
    throw new ActionableError({
      goal: `Validate test fixture '${name}'`,
      problem: `session.phase is '${data.phase}' but fixture '${name}' expects '${expectedPhase}' — possible copy-paste drift`,
      location: 'lib/debate/__tests__/fixtures/index.ts',
      nextSteps: [
        `Set "phase": "${expectedPhase}" in checkpoint-${name}.json`,
        'Verify the fixture represents the correct lifecycle boundary',
      ],
    });
  }

  const diag = data.diagnostics as Record<string, unknown> | undefined;
  if (!diag || typeof diag !== 'object' || !('overview' in diag)) {
    throw new ActionableError({
      goal: `Validate test fixture '${name}'`,
      problem: 'diagnostics.overview is missing or malformed',
      location: 'lib/debate/__tests__/fixtures/index.ts',
      nextSteps: [
        `Add diagnostics.overview with total_ai_calls, total_response_time_ms to checkpoint-${name}.json`,
      ],
    });
  }

  return data as unknown as DebateSession;
}

export function loadAllFixtures(): Record<FixtureName, DebateSession> {
  const result = {} as Record<FixtureName, DebateSession>;
  for (const name of Object.keys(EXPECTED_PHASE) as FixtureName[]) {
    result[name] = loadFixture(name);
  }
  return result;
}
