// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RemoteDriverOverlay } from './RemoteDriverOverlay';

// t/3967 (c): the pop-out, when it is the viewer, used to say "running in popout window"
// and tell the user to close a pop-out that didn't exist.
describe('RemoteDriverOverlay', () => {
  afterEach(() => cleanup());

  it('(c) in the pop-out, names the main window as the driver', () => {
    render(<RemoteDriverOverlay show inPopout />);
    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('running in the main window');
    expect(banner.textContent).not.toMatch(/popout/i);
  });

  it('in the main window, keeps naming the pop-out as the driver', () => {
    render(<RemoteDriverOverlay show inPopout={false} />);
    expect(screen.getByRole('status').textContent).toContain('Debate running in popout window');
  });

  it('renders nothing when this window drives', () => {
    const { container } = render(<RemoteDriverOverlay show={false} inPopout />);
    expect(container.firstChild).toBeNull();
  });
});
