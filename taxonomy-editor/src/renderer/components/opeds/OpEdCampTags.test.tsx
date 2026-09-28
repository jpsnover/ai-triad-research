// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { OpEdCampTags } from './OpEdCampTags';

describe('OpEdCampTags (t/3703)', () => {
  it('renders one tag per camp with the fixed-palette class', () => {
    const { container } = render(<OpEdCampTags camps={['acc', 'saf']} />);
    expect(container.querySelectorAll('.oped-camptag').length).toBe(2);
    expect(container.querySelector('.oped-camptag-acc')).toHaveTextContent('ACC');
    expect(container.querySelector('.oped-camptag-saf')).toHaveTextContent('SAF');
  });

  it('renders nothing for an unresolvable camp key rather than crashing', () => {
    const { container } = render(<OpEdCampTags camps={['not-a-camp']} />);
    expect(container.querySelectorAll('.oped-camptag').length).toBe(0);
  });

  it('renders an empty wrapper for zero camps', () => {
    const { container } = render(<OpEdCampTags camps={[]} />);
    expect(container.querySelector('.oped-camptags')).toBeInTheDocument();
    expect(container.querySelectorAll('.oped-camptag').length).toBe(0);
  });
});
