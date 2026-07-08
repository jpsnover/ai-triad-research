// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ScoreBadge } from './ScoreBadge';

describe('ScoreBadge', () => {
  it('renders label and formatted value', () => {
    const { container } = render(<ScoreBadge value={0.83} label="utility" />);
    expect(container.querySelector('.score-badge-label')!.textContent).toBe('utility');
    expect(container.querySelector('.score-badge-value')!.textContent).toBe('0.83');
  });

  it('applies success class for value >= 0.7', () => {
    const { container } = render(<ScoreBadge value={0.7} label="test" />);
    expect(container.querySelector('.score-badge--success')).toBeInTheDocument();
  });

  it('applies warning class for value >= 0.4 and < 0.7', () => {
    const { container } = render(<ScoreBadge value={0.5} label="test" />);
    expect(container.querySelector('.score-badge--warning')).toBeInTheDocument();
  });

  it('applies danger class for value < 0.4', () => {
    const { container } = render(<ScoreBadge value={0.2} label="test" />);
    expect(container.querySelector('.score-badge--danger')).toBeInTheDocument();
  });

  it('clamps value at 0', () => {
    const { container } = render(<ScoreBadge value={-0.5} label="test" />);
    expect(container.querySelector('.score-badge-value')!.textContent).toBe('0.00');
    expect(container.querySelector('.score-badge--danger')).toBeInTheDocument();
  });

  it('clamps value at 1', () => {
    const { container } = render(<ScoreBadge value={1.5} label="test" />);
    expect(container.querySelector('.score-badge-value')!.textContent).toBe('1.00');
    expect(container.querySelector('.score-badge--success')).toBeInTheDocument();
  });

  it('shows abbreviated label in compact mode', () => {
    const { container } = render(<ScoreBadge value={0.8} label="evidence_quality" compact />);
    expect(container.querySelector('.score-badge-label')!.textContent).toBe('evid');
  });

  it('humanizes underscored labels in full mode', () => {
    const { container } = render(<ScoreBadge value={0.8} label="evidence_quality" />);
    expect(container.querySelector('.score-badge-label')!.textContent).toBe('evidence quality');
  });

  it('sets fill bar width via CSS custom property', () => {
    const { container } = render(<ScoreBadge value={0.6} label="test" />);
    const bar = container.querySelector('.score-badge-bar') as HTMLElement;
    expect(bar.style.getPropertyValue('--score-pct')).toBe('60%');
  });

  it('uses custom tooltip when provided', () => {
    const { container } = render(<ScoreBadge value={0.5} label="test" tooltip="Custom tip" />);
    expect(container.querySelector('.score-badge')!.getAttribute('title')).toBe('Custom tip');
  });

  it('generates default tooltip when none provided', () => {
    const { container } = render(<ScoreBadge value={0.5} label="test" />);
    expect(container.querySelector('.score-badge')!.getAttribute('title')).toContain('test: 0.50');
  });

  it('handles boundary value 0.4 as warning', () => {
    const { container } = render(<ScoreBadge value={0.4} label="test" />);
    expect(container.querySelector('.score-badge--warning')).toBeInTheDocument();
  });

  it('handles boundary value 0.39 as danger', () => {
    const { container } = render(<ScoreBadge value={0.39} label="test" />);
    expect(container.querySelector('.score-badge--danger')).toBeInTheDocument();
  });

  it('handles boundary value 0.69 as warning', () => {
    const { container } = render(<ScoreBadge value={0.69} label="test" />);
    expect(container.querySelector('.score-badge--warning')).toBeInTheDocument();
  });

  it('handles exact zero', () => {
    const { container } = render(<ScoreBadge value={0} label="test" />);
    expect(container.querySelector('.score-badge-value')!.textContent).toBe('0.00');
    const bar = container.querySelector('.score-badge-bar') as HTMLElement;
    expect(bar.style.getPropertyValue('--score-pct')).toBe('0%');
  });

  it('handles exact one', () => {
    const { container } = render(<ScoreBadge value={1} label="test" />);
    expect(container.querySelector('.score-badge-value')!.textContent).toBe('1.00');
    const bar = container.querySelector('.score-badge-bar') as HTMLElement;
    expect(bar.style.getPropertyValue('--score-pct')).toBe('100%');
  });
});
