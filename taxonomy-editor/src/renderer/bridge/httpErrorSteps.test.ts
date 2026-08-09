// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { nextStepsForStatus } from './httpErrorSteps';

describe('nextStepsForStatus', () => {
  const GENERIC = ['Check the server is running', 'Verify your authentication'];

  describe('404 — resource not found (t/2366)', () => {
    it('gives debate-specific steps for a "Debate not found" body (not generic server/auth copy)', () => {
      const steps = nextStepsForStatus(404, JSON.stringify({ error: 'Debate not found', requestId: 'r1' }));
      expect(steps[0]).toMatch(/debate session was not found/i);
      expect(steps[1]).toMatch(/anonymously.*rotated your session/i);
      expect(steps).not.toEqual(GENERIC);
    });

    it('matches "Debate session not found" phrasing too', () => {
      const steps = nextStepsForStatus(404, JSON.stringify({ error: 'Debate session not found' }));
      expect(steps[0]).toMatch(/debate session was not found/i);
    });

    it('gives generic-not-found (non-debate) steps for other structured not-found bodies', () => {
      const steps = nextStepsForStatus(404, JSON.stringify({ error: 'Crux not found: x' }));
      expect(steps[0]).toMatch(/requested item was not found/i);
      expect(steps[0]).not.toMatch(/debate/i);
      expect(steps).not.toEqual(GENERIC);
    });

    it('detects "not found" even when the body is plain text, not JSON', () => {
      const steps = nextStepsForStatus(404, 'Debate not found');
      expect(steps[0]).toMatch(/debate session was not found/i);
    });

    it('falls back to generic copy for an unexpected 404 (missing route, no "not found" in body)', () => {
      expect(nextStepsForStatus(404, '<html>404</html>')).toEqual(GENERIC);
      expect(nextStepsForStatus(404, JSON.stringify({ error: 'Route /api/nope is not registered' }))).toEqual(GENERIC);
    });
  });

  describe('403 — unchanged behavior', () => {
    it('returns the anon_route_blocked detail', () => {
      const steps = nextStepsForStatus(403, JSON.stringify({ reason: 'anon_route_blocked', detail: 'Sign in first' }));
      expect(steps).toEqual(['Sign in first']);
    });

    it('surfaces the server error message + tier hint', () => {
      const steps = nextStepsForStatus(403, JSON.stringify({ error: 'Backend not allowed on your tier' }));
      expect(steps).toEqual(['Backend not allowed on your tier', 'Check your API key tier supports this backend']);
    });

    it('uses generic auth copy when the body is unparseable', () => {
      expect(nextStepsForStatus(403, 'nope')).toEqual([
        'Verify your authentication',
        'Check your API key tier supports this backend',
      ]);
    });
  });

  it('returns generic copy for other statuses (e.g. 500)', () => {
    expect(nextStepsForStatus(500, 'boom')).toEqual(GENERIC);
  });
});
