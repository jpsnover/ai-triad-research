// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const openExternal = vi.fn().mockResolvedValue(undefined);
vi.mock('@bridge', () => ({ api: { openExternal: (url: string) => openExternal(url) } }));
const { recorderRecord } = vi.hoisted(() => ({ recorderRecord: vi.fn() }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: recorderRecord }) }));

import { TheoryLink, DocLink, buildDocUrl, humanizeDocName, type TheoryLinkProps } from './TheoryLink';

const BASE = 'https://github.com/jpsnover/ai-triad-research/blob/main';
const URL = `${BASE}/docs/debate-system-overview.md`;

describe('buildDocUrl', () => {
  it('builds a jpsnover blob URL from a repo-relative path', () => {
    expect(buildDocUrl('docs/x.md')).toBe(`${BASE}/docs/x.md`);
  });
  it('appends the anchor with a # when provided', () => {
    expect(buildDocUrl('docs/x.md', 'sec-1')).toBe(`${BASE}/docs/x.md#sec-1`);
  });
});

describe('humanizeDocName', () => {
  it('Title-Cases the filename stem, dropping path, .md, and anchor', () => {
    expect(humanizeDocName('docs/debate-system-overview.md')).toBe('Debate System Overview');
    expect(humanizeDocName(`${BASE}/docs/reading-the-argument-network.md`)).toBe('Reading The Argument Network');
    expect(humanizeDocName('docs/scope_enforcement.md#anchor')).toBe('Scope Enforcement');
  });
});

describe('TheoryLink', () => {
  beforeEach(() => { openExternal.mockClear(); recorderRecord.mockClear(); });

  it('DocLink is an alias of TheoryLink', () => {
    expect(DocLink).toBe(TheoryLink);
  });

  // ── url form (existing callers) ──
  it('renders with an explicit label + dynamic tooltip from the url', () => {
    render(<TheoryLink url={URL} label="Help: debate overview" />);
    const btn = screen.getByRole('button', { name: 'Help: debate overview' });
    expect(btn).toHaveAttribute('title', 'Open Debate System Overview in GitHub');
    expect(btn).toHaveAttribute('data-theory-link');
  });

  it('opens the url externally on click (via bridge, not window/shell)', async () => {
    const user = userEvent.setup();
    render(<TheoryLink url={URL} label="Help" />);
    await user.click(screen.getByRole('button', { name: 'Help' }));
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(URL);
  });

  it('activates on Enter and Space (native button keyboard)', async () => {
    const user = userEvent.setup();
    render(<TheoryLink url={URL} label="Help" />);
    screen.getByRole('button', { name: 'Help' }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(openExternal).toHaveBeenCalledWith(URL);
  });

  // ── docPath form (diagnostics + migrated callers) ──
  it('builds the URL from docPath (+anchor) and opens it on click', async () => {
    const user = userEvent.setup();
    render(<TheoryLink docPath="docs/scope-enforcement.md" anchor="draft-scope-check" label="H" />);
    await user.click(screen.getByRole('button', { name: 'H' }));
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(`${BASE}/docs/scope-enforcement.md#draft-scope-check`);
  });

  it('derives the dynamic tooltip from docPath', () => {
    render(<TheoryLink docPath="docs/reading-the-argument-network.md" label="H" />);
    expect(screen.getByRole('button', { name: 'H' })).toHaveAttribute('title', 'Open Reading The Argument Network in GitHub');
  });

  // ── label / tooltip defaulting ──
  it('defaults the aria-label to the tooltip when label is omitted', () => {
    render(<TheoryLink docPath="docs/debate-system-overview.md" />);
    const btn = screen.getByRole('button', { name: 'Open Debate System Overview in GitHub' });
    expect(btn).toHaveAttribute('title', 'Open Debate System Overview in GitHub');
  });

  it('uses a custom tooltip when provided', () => {
    render(<TheoryLink url={URL} label="Help" tooltip="Read the spec" />);
    expect(screen.getByRole('button', { name: 'Help' })).toHaveAttribute('title', 'Read the spec');
  });

  // ── misc ──
  it('appends className to the base class (never replaces it)', () => {
    render(<TheoryLink url={URL} label="H" className="inline-heading" />);
    const btn = screen.getByRole('button', { name: 'H' });
    expect(btn.className).toContain('theory-link');
    expect(btn.className).toContain('inline-heading');
  });

  it('clamps size to 12–16px', () => {
    const { rerender } = render(<TheoryLink url={URL} label="H" size={40} />);
    expect(screen.getByRole('button').style.fontSize).toBe('16px');
    rerender(<TheoryLink url={URL} label="H" size={2} />);
    expect(screen.getByRole('button').style.fontSize).toBe('12px');
    rerender(<TheoryLink url={URL} label="H" size={12} />);
    expect(screen.getByRole('button').style.fontSize).toBe('12px');
  });

  // ── runtime guard (t/2410 blocker): exactly one of url/docPath ──
  it('records a system.error and renders nothing when NEITHER url nor docPath is given', () => {
    const { container } = render(<TheoryLink {...({ label: 'X' } as unknown as TheoryLinkProps)} />);
    expect(container).toBeEmptyDOMElement();
    expect(recorderRecord).toHaveBeenCalledWith(expect.objectContaining({ type: 'system.error', component: 'theory-link' }));
  });

  it('records a system.error and renders nothing when BOTH url and docPath are given', () => {
    const { container } = render(<TheoryLink {...({ url: URL, docPath: 'docs/x.md' } as unknown as TheoryLinkProps)} />);
    expect(container).toBeEmptyDOMElement();
    expect(recorderRecord).toHaveBeenCalledWith(expect.objectContaining({ type: 'system.error', component: 'theory-link' }));
  });
});
