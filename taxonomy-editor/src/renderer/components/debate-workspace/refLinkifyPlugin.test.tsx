// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1776 — remarkLinkifyRefs detects ID-token refs in transcript text via the
// shared scanRefs util and wraps them in `span.ref-link` nodes. These tests run
// the plugin through react-markdown with the REAL scanRefs (lib/entities), so
// they exercise the true detection contract + the v1 render-boundary kind filter.

import type { ReactNode } from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkLinkifyRefs, REF_LINK_CLASS } from './refLinkifyPlugin';

/** Surfaces only the ref-link spans the plugin emits (plain spans get no testid). */
function TestSpan({ className, children }: { className?: string; children?: ReactNode; node?: unknown }) {
  const isRef = (className ?? '').split(/\s+/).includes(REF_LINK_CLASS);
  return <span data-testid={isRef ? 'ref' : 'plain'} className={className}>{children}</span>;
}

function renderMd(text: string) {
  return render(
    <Markdown remarkPlugins={[remarkGfm, remarkLinkifyRefs]} components={{ span: TestSpan }}>{text}</Markdown>,
  );
}

function refTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid="ref"]')).map(el => el.textContent ?? '');
}

describe('remarkLinkifyRefs', () => {
  it('linkifies a bare node id, preserving the source token as display text', () => {
    const { container } = renderMd('The Accelerationist cites acc-beliefs-001 as support.');
    expect(refTexts(container)).toEqual(['acc-beliefs-001']);
  });

  it('detects a token inside brackets (punctuation boundary)', () => {
    const { container } = renderMd('See [acc-beliefs-001] for the claim.');
    expect(refTexts(container)).toEqual(['acc-beliefs-001']);
  });

  it('linkifies situation and policy ids', () => {
    const { container } = renderMd('Grounded in sit-001 and pol-002.');
    expect(refTexts(container).sort()).toEqual(['pol-002', 'sit-001']);
  });

  it('does NOT linkify entity/organization ids (v1 render-boundary filter)', () => {
    const { container } = renderMd('org-001 and ent-002 are entity-layer refs.');
    expect(refTexts(container)).toEqual([]);
  });

  it('leaves non-ref text untouched', () => {
    const { container } = renderMd('Just some ordinary prose with no references.');
    expect(refTexts(container)).toEqual([]);
  });

  it('does not linkify tokens inside inline code', () => {
    const { container } = renderMd('The id `acc-beliefs-001` is written in code.');
    expect(refTexts(container)).toEqual([]);
  });

  it('does not linkify a token embedded in a larger word (scanRefs boundary rule)', () => {
    const { container } = renderMd('xpol-002 is not a policy ref.');
    expect(refTexts(container)).toEqual([]);
  });
});
