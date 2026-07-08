// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CampGlyph, povToCamp } from './CampGlyph';
import type { CampKey } from './CampGlyph';

describe('CampGlyph', () => {
  const camps: CampKey[] = ['acc', 'saf', 'skp'];

  it.each(camps)('renders an SVG for camp "%s"', (camp) => {
    const { container } = render(<CampGlyph camp={camp} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveAttribute('height', '16');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses currentColor for stroke (theme-adaptive)', () => {
    const { container } = render(<CampGlyph camp="acc" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('fill', 'none');
  });

  it('accepts a custom size', () => {
    const { container } = render(<CampGlyph camp="saf" size={24} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
  });

  it('accepts a custom className', () => {
    const { container } = render(<CampGlyph camp="skp" className="test-cls" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('test-cls');
  });

  it('renders distinct SVG paths per camp', () => {
    const contents = camps.map((camp) => {
      const { container } = render(<CampGlyph camp={camp} />);
      return container.querySelector('svg')!.innerHTML;
    });
    expect(new Set(contents).size).toBe(3);
  });
});

describe('povToCamp', () => {
  it('maps full POV names to camp keys', () => {
    expect(povToCamp('accelerationist')).toBe('acc');
    expect(povToCamp('safetyist')).toBe('saf');
    expect(povToCamp('skeptic')).toBe('skp');
  });

  it('returns undefined for unknown POV names', () => {
    expect(povToCamp('unknown')).toBeUndefined();
    expect(povToCamp('')).toBeUndefined();
  });
});
