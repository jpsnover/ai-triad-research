// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the public op-ed index view (t/3482, sibling of PublicOpEdView.test.tsx). The
// load-bearing assertions are the TL binding invariant (t/1787#2): NO session is minted (raw
// fetch, no `/api/auth/anonymous`), and ADR-001 graceful-empty on a zero-entry list.
//
// t/3481 (GET /api/public/opeds) hasn't landed yet — these tests mock the fetch against the
// documented contract shape (t/3481's ticket description) so this view is ready to integrate
// the moment the real endpoint lands.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockRecord = vi.fn();
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: mockRecord }),
}));

const mockFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
vi.stubGlobal('fetch', mockFetch);

const { PublicOpEdIndexView } = await import('./PublicOpEdIndexView');

interface FakeResponseInit { status?: number; body?: unknown }
function fakeResponse({ status = 200, body = {} }: FakeResponseInit): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const SAMPLE = {
  opeds: [
    { shareId: 'a1', title: 'Ship the future', outlet: 'The Atlantic', camps: ['acc', 'saf'] },
    { shareId: 'a2', title: 'Slow down and think', outlet: 'Wired', camps: ['skp'] },
  ],
};

describe('PublicOpEdIndexView (t/3482)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('fetches via a raw GET to the public index endpoint — no session minted', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ body: SAMPLE }));
    render(<PublicOpEdIndexView />);

    await screen.findByText('Ship the future');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/public/opeds');
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store' });

    const hitAnonymous = mockFetch.mock.calls.some(([u]) => String(u).includes('/api/auth/anonymous'));
    expect(hitAnonymous).toBe(false);
  });

  it('renders every entry, each linking to its /share/oped/:shareId page', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ body: SAMPLE }));
    render(<PublicOpEdIndexView />);

    const link1 = await screen.findByRole('link', { name: /Ship the future/ });
    expect(link1).toHaveAttribute('href', '/share/oped/a1');
    const link2 = screen.getByRole('link', { name: /Slow down and think/ });
    expect(link2).toHaveAttribute('href', '/share/oped/a2');
  });

  it('shows an explicit empty state — never a blank page (ADR-001)', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ body: { opeds: [] } }));
    render(<PublicOpEdIndexView />);
    await screen.findByText('No op-eds have been shared yet.');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows an error state and records to the flight recorder on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    render(<PublicOpEdIndexView />);
    await screen.findByText(/Couldn’t load shared op-eds/);
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'system.error', component: 'PublicOpEdIndexView', level: 'error' }),
    );
  });

  it('shows an error state on a non-ok HTTP response', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ status: 500 }));
    render(<PublicOpEdIndexView />);
    await screen.findByText(/Couldn’t load shared op-eds/);
  });

  it('aborts the in-flight fetch when the component unmounts', async () => {
    let resolveResponse!: (r: Response) => void;
    mockFetch.mockReturnValue(new Promise(res => { resolveResponse = res; }));

    const { unmount } = render(<PublicOpEdIndexView />);
    await Promise.resolve();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const signal = mockFetch.mock.calls[0][1]?.signal as AbortSignal;
    expect(signal).toBeDefined();
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);

    resolveResponse(fakeResponse({ body: SAMPLE }));
  });
});
