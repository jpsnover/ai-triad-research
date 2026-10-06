// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PovTagFilterSelect } from './PovTagFilterSelect';

describe('PovTagFilterSelect (t/3961)', () => {
  afterEach(() => cleanup());

  it('renders nothing when the POV has no tags', () => {
    const { container } = render(<PovTagFilterSelect options={[]} value="all" onChange={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the options and reports the chosen filter', () => {
    const onChange = vi.fn();
    render(<PovTagFilterSelect
      options={[{ value: 'all', label: 'Tags: All' }, { value: 'untagged', label: 'Tags: Untagged' }, { value: 'tag:critical', label: 'Tag: Critical' }]}
      value="all"
      onChange={onChange}
    />);
    fireEvent.change(screen.getByLabelText('Filter by POV tag'), { target: { value: 'tag:critical' } });
    expect(onChange).toHaveBeenCalledWith('tag:critical');
  });
});
