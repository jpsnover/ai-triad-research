// @vitest-environment jsdom
//
// t/2474 — login-page hash-carry + auto-continue for community debate deep links.
// Tests the hash-carry IIFE appended to SW_HEAL_SCRIPT:
//   1. .anon-link href is rewritten when location.hash is present (always)
//   2. location.replace fires for #debate-window hashes (auto-continue)
//   3. No-op when location.hash is empty
//   4. Non-debate hashes: hash-carry only, no auto-replace
//   5. Loop breaker: anon_deeplink_continued marker suppresses auto-replace
//   6. Gating: no-op when .anon-link is absent (showAnonymous=false policy)
//
// Strategy: extract the hash-carry IIFE from the full SW_HEAL_SCRIPT string
// (the portion after the SW-heal IIFE's closing `})();`), then execute it via
// the Function constructor with injected mock document/location/sessionStorage.
// This tests the ACTUAL script text without jsdom's non-configurable location
// restriction getting in the way.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildLoginPage } from '../loginPage.js';

function extractHashCarryIife(): string {
  const html = buildLoginPage(true);
  const scriptContent = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  // The SW-heal IIFE ends with the first `})();` in the script.
  // Everything after that is the hash-carry IIFE (t/2474 addition).
  const healEndIdx = scriptContent.indexOf('})();') + 5;
  return scriptContent.slice(healEndIdx);
}

type MockSS = { getItem(k: string): string | null; setItem(k: string, v: string): void };

function runHashCarry(
  domHtml: string,
  hash: string,
  ssEntries: Record<string, string> = {},
): { replaceCalls: string[]; anonLinkHref: string | null; ss: Map<string, string> } {
  document.body.innerHTML = domHtml;

  const replaceCalls: string[] = [];
  const ss = new Map(Object.entries(ssEntries));
  const mockLoc = { hash, replace: (url: string) => replaceCalls.push(url) };
  const mockSS: MockSS = {
    getItem: (k: string) => ss.get(k) ?? null,
    setItem: (k: string, v: string) => { ss.set(k, v); },
  };

  // Execute the hash-carry IIFE with injected globals. Named Function parameters
  // shadow globalThis references inside the IIFE (no actual window.location access).
  // eslint-disable-next-line no-new-func
  const fn = new Function('document', 'location', 'sessionStorage', extractHashCarryIife());
  fn(document, mockLoc, mockSS);

  return {
    replaceCalls,
    anonLinkHref: document.querySelector<HTMLAnchorElement>('.anon-link')?.getAttribute('href') ?? null,
    ss,
  };
}

const ANON_DOM = '<a class="anon-link" href="/.auth/anonymous">Browse</a>';
const NO_ANON_DOM = '<div></div>';

describe('login-page hash-carry + auto-continue (t/2474)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('hash-carry: rewrites .anon-link href to include hash', () => {
    const { anonLinkHref } = runHashCarry(ANON_DOM, '#debate-window?id=abc123');
    expect(anonLinkHref).toBe('/.auth/anonymous#debate-window?id=abc123');
  });

  it('no-hash: does not modify .anon-link href', () => {
    const { anonLinkHref, replaceCalls } = runHashCarry(ANON_DOM, '');
    expect(anonLinkHref).toBe('/.auth/anonymous');
    expect(replaceCalls).toHaveLength(0);
  });

  it('auto-continue: calls location.replace for #debate-window hash', () => {
    const { replaceCalls } = runHashCarry(ANON_DOM, '#debate-window?id=abc123');
    expect(replaceCalls).toEqual(['/.auth/anonymous#debate-window?id=abc123']);
  });

  it('non-debate hash: hash-carry applies, no auto-replace', () => {
    const { anonLinkHref, replaceCalls } = runHashCarry(ANON_DOM, '#some-other-view');
    expect(anonLinkHref).toBe('/.auth/anonymous#some-other-view');
    expect(replaceCalls).toHaveLength(0);
  });

  it('loop breaker: marker set → no auto-replace, but hash-carry still applies', () => {
    const { replaceCalls, anonLinkHref } = runHashCarry(
      ANON_DOM,
      '#debate-window?id=abc123',
      { anon_deeplink_continued: '1' },
    );
    expect(replaceCalls).toHaveLength(0);
    expect(anonLinkHref).toBe('/.auth/anonymous#debate-window?id=abc123');
  });

  it('loop breaker: marker is SET on first auto-continue so a reload cannot loop', () => {
    const { ss } = runHashCarry(ANON_DOM, '#debate-window?id=abc123');
    expect(ss.get('anon_deeplink_continued')).toBe('1');
  });

  it('gating: no-op when .anon-link absent (showAnonymous=false — policy-disabled)', () => {
    const { replaceCalls, anonLinkHref } = runHashCarry(NO_ANON_DOM, '#debate-window?id=abc123');
    expect(replaceCalls).toHaveLength(0);
    expect(anonLinkHref).toBeNull();
  });
});
