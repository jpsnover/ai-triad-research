// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, act } from '@testing-library/react';

const openExternal = vi.fn().mockResolvedValue(undefined);
vi.mock('@bridge', () => ({ api: { openExternal: (url: string) => openExternal(url) } }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

import { TheoryLink } from '../components/shared/TheoryLink';
import { useTheoryLinkHotkey } from './useTheoryLinkHotkey';

// jsdom does no layout: offsetParent is null and getClientRects() is empty, so the
// hook's visibility filter would drop every link. Make attached elements report visible.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return this.parentNode; },
  });
});

function HookMount() { useTheoryLinkHotkey(); return null; }

function pressF1() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }));
  });
}

function stubRect(el: Element, left: number, top: number) {
  el.getBoundingClientRect = () => ({ left, top, right: left + 10, bottom: top + 10, width: 10, height: 10, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
}

describe('useTheoryLinkHotkey', () => {
  beforeEach(() => { openExternal.mockClear(); });
  afterEach(() => { document.body.innerHTML = ''; });

  it('F1 activates the TheoryLink in the focused element\'s enclosing section', () => {
    render(
      <>
        <HookMount />
        <section data-testid="sec-a">
          <input data-testid="input-a" />
          <TheoryLink url="https://x/a" label="A" />
        </section>
        <section>
          <TheoryLink url="https://x/b" label="B" />
        </section>
      </>,
    );
    (document.querySelector('[data-testid="input-a"]') as HTMLElement).focus();
    pressF1();
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://x/a');
  });

  it('is a no-op (does not open anything) when no TheoryLink is present', () => {
    render(<><HookMount /><input /></>);
    (document.querySelector('input') as HTMLElement).focus();
    pressF1();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('falls back to the geometrically nearest link when focus has no enclosing link', () => {
    render(
      <>
        <HookMount />
        <TheoryLink url="https://x/near" label="near" />
        <TheoryLink url="https://x/far" label="far" />
        <input data-testid="anchor" />
      </>,
    );
    const anchor = document.querySelector('[data-testid="anchor"]') as HTMLElement;
    const [near, far] = Array.from(document.querySelectorAll('.theory-link')) as HTMLElement[];
    stubRect(anchor, 100, 100);
    stubRect(near, 110, 105); // close to anchor
    stubRect(far, 900, 900);  // far away
    anchor.focus();
    pressF1();
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://x/near');
  });

  it('fires exactly once even when the hook is registered by two components (ref-counted single listener)', () => {
    render(
      <>
        <HookMount />
        <HookMount />
        <TheoryLink url="https://x/solo" label="solo" />
      </>,
    );
    (document.querySelector('.theory-link') as HTMLElement).focus();
    pressF1();
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://x/solo');
  });

  it('removes the listener on unmount', () => {
    const { unmount } = render(<><HookMount /><TheoryLink url="https://x/a" label="A" /></>);
    unmount();
    pressF1();
    expect(openExternal).not.toHaveBeenCalled();
  });
});
