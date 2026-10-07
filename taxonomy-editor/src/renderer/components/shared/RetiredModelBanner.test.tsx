// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

import { RetiredModelBanner } from './RetiredModelBanner';
import { reportRetiredModel, __resetRetiredModelNoticeForTests } from '../../utils/retiredModelNotice';

// t/4030
beforeEach(() => {
  localStorage.clear();
  __resetRetiredModelNoticeForTests();
});

describe('RetiredModelBanner (t/4030)', () => {
  it('renders nothing without a notice', () => {
    const { container } = render(<RetiredModelBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('names the retired and the fallback model, and dismisses', () => {
    render(<RetiredModelBanner />);
    act(() => reportRetiredModel('old-model', 'new-model'));
    expect(screen.getByRole('status').textContent).toMatch(/Your saved model old-model is no longer available; using new-model/);
    fireEvent.click(screen.getByLabelText('Dismiss retired-model notice'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
