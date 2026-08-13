// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { NewOpEdDialog } from './NewOpEdDialog';

// ── Bridge / hook mocks ───────────────────────────────────────────────────────

type ProgressEvent = { set_id: string; voice: string; stage: string; error?: string };

const h = vi.hoisted(() => {
  const state: { cb: ((e: ProgressEvent) => void) | null } = { cb: null };
  return {
    state,
    hasApiKey: vi.fn().mockResolvedValue(true),
    createOpEdSet: vi.fn(),
    cancelOpEdSet: vi.fn(),
    refreshAIModels: vi.fn().mockResolvedValue(undefined),
    onOpEdProgress: vi.fn((cb: (e: ProgressEvent) => void) => {
      state.cb = cb;
      return () => { state.cb = null; };
    }),
  };
});

const { hasApiKey, createOpEdSet, cancelOpEdSet, onOpEdProgress } = h;
const fireProgress = (e: ProgressEvent) => h.state.cb?.(e);

vi.mock('@bridge', () => ({
  api: {
    hasApiKey: h.hasApiKey,
    createOpEdSet: h.createOpEdSet,
    cancelOpEdSet: h.cancelOpEdSet,
    refreshAIModels: h.refreshAIModels,
    onOpEdProgress: h.onOpEdProgress,
  },
  isElectronMode: () => true,
}));

vi.mock('../../hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: 'u', anonymous: false, idp: 'github' }),
}));

function open(props: Partial<Parameters<typeof NewOpEdDialog>[0]> = {}) {
  return render(
    <NewOpEdDialog open onClose={vi.fn()} onCreated={vi.fn()} {...props} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasApiKey.mockResolvedValue(true);
  h.state.cb = null;
});

describe('NewOpEdDialog — visibility', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<NewOpEdDialog open={false} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the create dialog when open', () => {
    open();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('New op-ed')).toBeTruthy();
  });
});

describe('NewOpEdDialog — voices + live count', () => {
  it('shows the empty prompt then the 1-op-ed line', () => {
    open();
    expect(screen.getByText('Select at least one voice.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Safetyist' }));
    expect(screen.getByText('Will create 1 op-ed — Safetyist.')).toBeTruthy();
  });

  it('shows the multi-voice line and relabels the submit button', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Safetyist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skeptic' }));
    expect(screen.getByText(/Will create 2 op-eds on the same topic/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Draft 2 op-eds' })).toBeTruthy();
  });

  it('marks a selected chip aria-pressed', () => {
    open();
    const chip = screen.getByRole('button', { name: 'Skeptic' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('NewOpEdDialog — Draft enablement', () => {
  it('disables Draft without a topic or voice, enables it with both', () => {
    open();
    const draft = () => screen.getByRole('button', { name: /Draft/ });
    expect((draft() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Topic/), { target: { value: 'Mandatory audits' } });
    expect((draft() as HTMLButtonElement).disabled).toBe(true); // still no voice
    fireEvent.click(screen.getByRole('button', { name: 'Safetyist' }));
    expect((draft() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('NewOpEdDialog — topic / URL toggle', () => {
  it('swaps the topic textarea for a URL input and back', () => {
    open();
    expect(screen.getByLabelText(/Topic/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /From a web page instead/ }));
    expect(screen.getByLabelText(/Web page URL/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Use a topic instead/ }));
    expect(screen.getByLabelText(/Topic/)).toBeTruthy();
  });
});

describe('NewOpEdDialog — settings drawer', () => {
  it('opens the More options drawer and applies changes', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /More options/ }));
    expect(screen.getByRole('dialog', { name: 'More options' })).toBeTruthy();
    // Angle section is reachable
    fireEvent.click(screen.getByRole('button', { name: 'Angle' }));
    fireEvent.change(screen.getByLabelText('Thesis'), { target: { value: 'Audits are the floor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    // Back on Screen A the modified badge reflects one changed section
    expect(screen.getByLabelText(/1 setting changed/)).toBeTruthy();
  });
});

describe('NewOpEdDialog — draft + progress + cancel', () => {
  it('creates, subscribes to progress, and reports the new set id', async () => {
    let resolveCreate!: (v: { set_id: string }) => void;
    createOpEdSet.mockReturnValue(new Promise<{ set_id: string }>(res => { resolveCreate = res; }));
    const onCreated = vi.fn();
    const onClose = vi.fn();
    open({ onCreated, onClose });

    fireEvent.change(screen.getByLabelText(/Topic/), { target: { value: 'Mandatory audits' } });
    fireEvent.click(screen.getByRole('button', { name: 'Safetyist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Draft op-ed' }));

    // Progress panel appears and the subscription is active.
    expect(screen.getByText('Drafting your op-ed…')).toBeTruthy();
    expect(onOpEdProgress).toHaveBeenCalledTimes(1);

    // A progress tick renders the voice's stage.
    act(() => { fireProgress({ set_id: 'set-9', voice: 'safetyist', stage: 'generating' }); });
    expect(screen.getByText('Writing the Safetyist op-ed')).toBeTruthy();

    await act(async () => { resolveCreate({ set_id: 'set-9' }); });

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('set-9'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Cancel aborts the run with the id from the first progress event', async () => {
    createOpEdSet.mockReturnValue(new Promise<{ set_id: string }>(() => { /* never resolves */ }));
    open();

    fireEvent.change(screen.getByLabelText(/Topic/), { target: { value: 'Mandatory audits' } });
    fireEvent.click(screen.getByRole('button', { name: 'Safetyist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Draft op-ed' }));

    act(() => { fireProgress({ set_id: 'set-42', voice: 'safetyist', stage: 'queued' }); });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancelOpEdSet).toHaveBeenCalledWith('set-42');
  });

  it('surfaces an ActionableError Next Steps list on failure', async () => {
    createOpEdSet.mockRejectedValue(Object.assign(new Error('boom'), {
      problem: 'The generator could not be reached.',
      nextSteps: ['Check that PowerShell is installed', 'Retry in a moment'],
    }));
    open();

    fireEvent.change(screen.getByLabelText(/Topic/), { target: { value: 'Mandatory audits' } });
    fireEvent.click(screen.getByRole('button', { name: 'Safetyist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Draft op-ed' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('The generator could not be reached.')).toBeTruthy();
    expect(screen.getByText('Check that PowerShell is installed')).toBeTruthy();
  });
});
