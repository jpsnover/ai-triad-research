// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the public read-only POV share view (t/1790, child C of t/1787).
// The load-bearing assertions are the TL binding invariants: NO session is
// minted (raw fetch, no `/api/auth/anonymous`), and the view is read-only.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockRecord = vi.fn();
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: mockRecord }),
}));

const mockFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
vi.stubGlobal('fetch', mockFetch);

const { PublicPovView, nodeIdFromSharePath } = await import('./PublicPovView');

interface FakeResponseInit { status?: number; body?: unknown; setCookie?: string | null }
function fakeResponse({ status = 200, body = {}, setCookie = null }: FakeResponseInit): Response {
  const headers = new Headers();
  if (setCookie) headers.set('set-cookie', setCookie);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const SAMPLE = {
  nodeId: 'acc-Beliefs-001',
  pov: 'accelerationist',
  category: 'Beliefs',
  label: 'Faster capability gains are net-positive',
  description: 'A belief that accelerating AI capability yields broad benefit.',
  aphorism: 'Ship the future.',
};

function goTo(pathname: string): void {
  window.history.pushState({}, '', pathname);
}

describe('nodeIdFromSharePath', () => {
  it('extracts a valid node id', () => {
    expect(nodeIdFromSharePath('/share/pov/acc-Beliefs-001')).toBe('acc-Beliefs-001');
    expect(nodeIdFromSharePath('/share/pov/saf-Desires-042/')).toBe('saf-Desires-042');
  });
  it('returns null for non-share or malformed paths', () => {
    expect(nodeIdFromSharePath('/')).toBeNull();
    expect(nodeIdFromSharePath('/share/pov/')).toBeNull();
    expect(nodeIdFromSharePath('/share/pov/a b')).toBeNull();
    expect(nodeIdFromSharePath('/share/pov/../etc')).toBeNull();
  });
});

describe('PublicPovView (t/1790)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    goTo('/share/pov/acc-Beliefs-001');
  });
  afterEach(() => {
    goTo('/');
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('fetches the node via a raw GET to the public endpoint — no session minted', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ body: SAMPLE }));
    render(<PublicPovView />);

    await screen.findByText(SAMPLE.label);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/public/pov/accelerationist/node/acc-Beliefs-001');
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store' });

    // The binding invariant: the session-recovery path is NEVER touched.
    const hitAnonymous = mockFetch.mock.calls.some(([u]) => String(u).includes('/api/auth/anonymous'));
    expect(hitAnonymous).toBe(false);
  });

  it('renders the allowlist fields read-only (no edit controls)', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ body: SAMPLE }));
    render(<PublicPovView />);

    await screen.findByText(SAMPLE.label);
    expect(screen.getByText('Accelerationist')).toBeInTheDocument();
    expect(screen.getByText('Beliefs')).toBeInTheDocument();
    expect(screen.getByText(SAMPLE.description)).toBeInTheDocument();
    expect(screen.getByText(`“${SAMPLE.aphorism}”`)).toBeInTheDocument();
    expect(screen.getByText(SAMPLE.nodeId)).toBeInTheDocument();

    // Read-only: no inputs, textareas, or actionable buttons on this path.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a not-found state on 404 without erroring', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ status: 404 }));
    render(<PublicPovView />);
    await screen.findByText('Not available');
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('does not fetch for a non-POV id (v1 is POV-only)', async () => {
    goTo('/share/pov/sit-001');
    render(<PublicPovView />);
    await screen.findByText('Not available');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shows an error state and records to the flight recorder on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    render(<PublicPovView />);
    await screen.findByText(/Couldn’t load this item/);
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'system.error', component: 'PublicPovView', level: 'error' }),
    );
  });
});
