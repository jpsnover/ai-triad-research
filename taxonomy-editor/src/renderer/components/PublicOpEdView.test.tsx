// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the public read-only op-ed share view (t/2728, sibling of PublicPovView).
// The load-bearing assertions are the TL binding invariants (t/1787#2): NO session
// is minted (raw fetch, no `/api/auth/anonymous`), and the view is read-only.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockRecord = vi.fn();
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: mockRecord }),
}));

const mockFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
vi.stubGlobal('fetch', mockFetch);

const { PublicOpEdView, shareIdFromOpEdPath } = await import('./PublicOpEdView');

interface FakeResponseInit { status?: number; body?: unknown }
function fakeResponse({ status = 200, body = {} }: FakeResponseInit): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const SHARE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const SAMPLE = {
  schema_version: 1 as const,
  shareId: SHARE_ID,
  topic: 'The pace of AI capability',
  outlet: 'The Atlantic',
  created_at: '2026-08-17T00:00:00Z',
  opeds: [
    { pov: 'acc', status: 'complete', headline: 'Ship the future', subtitle: 'Why acceleration wins', body: 'Accelerate now, the body argues.', wordCount: 800 },
    { pov: 'saf', status: 'failed', headline: '', subtitle: '', body: '', wordCount: 0 },
  ],
};

function goTo(pathname: string): void {
  window.history.pushState({}, '', pathname);
}

describe('shareIdFromOpEdPath', () => {
  it('extracts a valid shareId (uuid), with or without trailing slash', () => {
    expect(shareIdFromOpEdPath(`/share/oped/${SHARE_ID}`)).toBe(SHARE_ID);
    expect(shareIdFromOpEdPath(`/share/oped/${SHARE_ID}/`)).toBe(SHARE_ID);
  });
  it('returns null for non-share or malformed paths', () => {
    expect(shareIdFromOpEdPath('/')).toBeNull();
    expect(shareIdFromOpEdPath('/share/oped/')).toBeNull();
    expect(shareIdFromOpEdPath('/share/oped/a b')).toBeNull();
    expect(shareIdFromOpEdPath('/share/oped/../etc')).toBeNull();
    expect(shareIdFromOpEdPath('/share/pov/acc-Beliefs-001')).toBeNull();
  });
});

describe('PublicOpEdView (t/2728)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    goTo(`/share/oped/${SHARE_ID}`);
  });
  afterEach(() => {
    goTo('/');
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('fetches via a raw GET to the public endpoint — no session minted', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ body: SAMPLE }));
    render(<PublicOpEdView />);

    await screen.findByText(SAMPLE.topic);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`/api/public/oped/${SHARE_ID}`);
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store' });

    // The binding invariant: the session-recovery path is NEVER touched.
    const hitAnonymous = mockFetch.mock.calls.some(([u]) => String(u).includes('/api/auth/anonymous'));
    expect(hitAnonymous).toBe(false);
  });

  it('renders the shared set read-only (topic, complete voice on the default tab; no inputs/buttons)', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ body: SAMPLE }));
    render(<PublicOpEdView />);

    await screen.findByText(SAMPLE.topic);
    expect(screen.getByText('For The Atlantic')).toBeInTheDocument();
    expect(screen.getByText('Ship the future')).toBeInTheDocument();
    expect(screen.getByText('Why acceleration wins')).toBeInTheDocument();
    expect(screen.getByText('Accelerate now, the body argues.')).toBeInTheDocument();

    // Read-only: no plain inputs/buttons on the public path — tab controls carry an explicit
    // role="tab", not "button", so they don't trip this invariant.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  // t/3485: PI feedback on the deployed t/3477 fix — stacking traded one burial (situation
  // wall) for another (only the first op-ed visible, no indication two more exist).
  describe('camp tabs (t/3485)', () => {
    it('shows a tab per voice and defaults to the first (no scrolling needed to discover the rest)', async () => {
      mockFetch.mockResolvedValue(fakeResponse({ body: SAMPLE }));
      render(<PublicOpEdView />);
      await screen.findByText(SAMPLE.topic);

      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(2);
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
      expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
      // The failed voice's notice is NOT in the initial (first-tab) panel.
      expect(screen.queryByText(/failed to generate/)).toBeNull();
    });

    it('switches panels on click — the failed-voice notice appears behind its own tab', async () => {
      mockFetch.mockResolvedValue(fakeResponse({ body: SAMPLE }));
      const user = userEvent.setup();
      render(<PublicOpEdView />);
      await screen.findByText(SAMPLE.topic);

      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[1]);

      expect(screen.getByText(/failed to generate/)).toBeInTheDocument();
      expect(screen.queryByText('Accelerate now, the body argues.')).toBeNull();
      expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('supports ArrowRight/ArrowLeft keyboard navigation between tabs', async () => {
      mockFetch.mockResolvedValue(fakeResponse({ body: SAMPLE }));
      const user = userEvent.setup();
      render(<PublicOpEdView />);
      await screen.findByText(SAMPLE.topic);

      const tabs = screen.getAllByRole('tab');
      tabs[0].focus();
      await user.keyboard('{ArrowRight}');
      expect(screen.getByText(/failed to generate/)).toBeInTheDocument();
      await user.keyboard('{ArrowLeft}');
      expect(screen.getByText('Accelerate now, the body argues.')).toBeInTheDocument();
    });

    it('renders no tab strip for a single-voice set (matches the in-app ruling, t/2576#3)', async () => {
      mockFetch.mockResolvedValue(fakeResponse({ body: { ...SAMPLE, opeds: [SAMPLE.opeds[0]] } }));
      render(<PublicOpEdView />);
      await screen.findByText(SAMPLE.topic);

      expect(screen.queryByRole('tab')).toBeNull();
      expect(screen.getByText('Ship the future')).toBeInTheDocument();
    });
  });

  it('leads with the op-eds — the situation topic renders after them, not as the lead heading (t/3477)', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ body: SAMPLE }));
    render(<PublicOpEdView />);

    const headline = await screen.findByText('Ship the future');
    const topic = screen.getByText(SAMPLE.topic);

    // DOCUMENT_POSITION_FOLLOWING (4): topic comes after the op-ed headline in source order.
    expect(headline.compareDocumentPosition(topic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('shows a not-found state on 404 without erroring', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ status: 404 }));
    render(<PublicOpEdView />);
    await screen.findByText('Not available');
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('does not fetch for a malformed shareId', async () => {
    goTo('/share/oped/..');
    render(<PublicOpEdView />);
    await screen.findByText('Not available');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shows an error state and records to the flight recorder on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    render(<PublicOpEdView />);
    await screen.findByText(/Couldn’t load this op-ed/);
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'system.error', component: 'PublicOpEdView', level: 'error' }),
    );
  });

  it('aborts the in-flight fetch when the component unmounts (t/2755)', async () => {
    let resolveResponse!: (r: Response) => void;
    mockFetch.mockReturnValue(new Promise(res => { resolveResponse = res; }));

    const { unmount } = render(<PublicOpEdView />);
    await Promise.resolve();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const signal = mockFetch.mock.calls[0][1]?.signal as AbortSignal;
    expect(signal).toBeDefined();
    expect(signal.aborted).toBe(false);

    // Regression guard: cleanup must call controller.abort(), not merely
    // clearTimeout (which would suppress the timer-driven abort).
    unmount();
    expect(signal.aborted).toBe(true);

    resolveResponse(fakeResponse({ body: SAMPLE }));
  });
});
