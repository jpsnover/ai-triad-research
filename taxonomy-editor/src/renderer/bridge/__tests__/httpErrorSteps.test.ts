// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { nextStepsForStatus } from '../httpErrorSteps';

describe('nextStepsForStatus — empty-body 5xx (t/3083)', () => {
  it('returns overload/restart steps for a 500 with an empty body (infra-generated)', () => {
    const steps = nextStepsForStatus(500, '');
    expect(steps[0]).toMatch(/overloaded or restarting/i);
    expect(steps.join(' ')).toMatch(/production health/i);
    // the misleading auth line must NOT appear for an infra outage
    expect(steps.join(' ')).not.toMatch(/authentication/i);
  });

  it('treats a whitespace-only body as empty (Connection reset → blank payload)', () => {
    expect(nextStepsForStatus(503, '   \n ')[0]).toMatch(/overloaded or restarting/i);
  });

  it('applies to any 5xx, not just 500', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(nextStepsForStatus(status, '')[0]).toMatch(/overloaded or restarting/i);
    }
  });

  it('does NOT trigger for a 5xx that carries a body — a JSON error body is an app error, use generic', () => {
    const steps = nextStepsForStatus(500, '{"error":"boom"}');
    expect(steps).toEqual(['Check the server is running', 'Verify your authentication']);
  });

  it('does NOT treat a non-5xx empty body as an overload (e.g. a bare 400)', () => {
    expect(nextStepsForStatus(400, '')).toEqual(['Check the server is running', 'Verify your authentication']);
  });
});

describe('nextStepsForStatus — existing branches still hold', () => {
  it('403 → auth-oriented steps', () => {
    expect(nextStepsForStatus(403, '')).toEqual(['Verify your authentication', 'Check your API key tier supports this backend']);
  });

  it('404 with a "not found" body → resource-gone steps, not the generic server/auth copy', () => {
    const steps = nextStepsForStatus(404, '{"error":"Debate not found"}');
    expect(steps[0]).toMatch(/was not found/i);
    expect(steps.join(' ')).not.toMatch(/Check the server is running/);
  });
});
