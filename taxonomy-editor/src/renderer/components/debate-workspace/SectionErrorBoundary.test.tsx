// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3419 — a render throw in one section must degrade to an inline fallback
// for that section only, and record the failure at `error` (not `fatal`) so
// it's diagnosable without triggering the top-level crash/dump flow.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const record = vi.fn();
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record }),
}));

import { SectionErrorBoundary } from './SectionErrorBoundary';

function Boom(): never {
  throw new Error('boom');
}

beforeEach(() => { vi.clearAllMocks(); });

describe('SectionErrorBoundary (t/3419)', () => {
  it('renders children normally when there is no error', () => {
    render(
      <SectionErrorBoundary section="Test Section">
        <div data-testid="ok">fine</div>
      </SectionErrorBoundary>
    );
    expect(screen.getByTestId('ok')).toBeInTheDocument();
  });

  it('catches a render throw and shows an inline fallback naming the section', () => {
    // React logs the caught error to console.error by default — silence it for this test.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <SectionErrorBoundary section="Anticipated Challenges">
        <Boom />
      </SectionErrorBoundary>
    );
    expect(screen.getByRole('alert').textContent).toContain('Anticipated Challenges');
    consoleSpy.mockRestore();
  });

  it('does not unmount a sibling section when one section throws', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <>
        <SectionErrorBoundary section="Broken"><Boom /></SectionErrorBoundary>
        <SectionErrorBoundary section="Fine"><div data-testid="sibling">still here</div></SectionErrorBoundary>
      </>
    );
    expect(screen.getByTestId('sibling')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('records the caught error at level "error" (not "fatal") with the section name', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <SectionErrorBoundary section="Anticipated Challenges">
        <Boom />
      </SectionErrorBoundary>
    );
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      type: 'system.error',
      component: 'debate-workspace',
      level: 'error',
      data: expect.objectContaining({ section: 'Anticipated Challenges' }),
    }));
    consoleSpy.mockRestore();
  });
});
