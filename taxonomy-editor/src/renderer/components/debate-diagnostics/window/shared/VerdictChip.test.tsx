// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { VerdictChip, mapOutcomeToVerdict } from './VerdictChip';

describe('VerdictChip', () => {
  it('renders pass with default label', () => {
    const { container } = render(<VerdictChip verdict="pass" />);
    const chip = container.querySelector('.verdict-chip--pass')!;
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toBe('PASS');
  });

  it('renders flag with default label', () => {
    const { container } = render(<VerdictChip verdict="flag" />);
    const chip = container.querySelector('.verdict-chip--flag')!;
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toBe('FLAG');
  });

  it('renders fail with default label', () => {
    const { container } = render(<VerdictChip verdict="fail" />);
    const chip = container.querySelector('.verdict-chip--fail')!;
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toBe('FAIL');
  });

  it('renders custom label when provided', () => {
    const { container } = render(<VerdictChip verdict="pass" label="VERIFIED" />);
    expect(container.querySelector('.verdict-chip')!.textContent).toBe('VERIFIED');
  });

  it('renders tooltip when provided', () => {
    const { container } = render(<VerdictChip verdict="flag" tooltip="Accepted with caveats" />);
    expect(container.querySelector('.verdict-chip')!.getAttribute('title')).toBe('Accepted with caveats');
  });

  it('has no tooltip when none provided', () => {
    const { container } = render(<VerdictChip verdict="pass" />);
    expect(container.querySelector('.verdict-chip')!.getAttribute('title')).toBeNull();
  });
});

describe('mapOutcomeToVerdict', () => {
  it('maps pass to pass', () => {
    expect(mapOutcomeToVerdict('pass')).toBe('pass');
  });

  it('maps accept_with_flag to flag', () => {
    expect(mapOutcomeToVerdict('accept_with_flag')).toBe('flag');
  });

  it('maps retry to fail', () => {
    expect(mapOutcomeToVerdict('retry')).toBe('fail');
  });

  it('maps skipped to fail', () => {
    expect(mapOutcomeToVerdict('skipped')).toBe('fail');
  });

  it('maps unknown outcome to fail', () => {
    expect(mapOutcomeToVerdict('something_else')).toBe('fail');
  });
});
