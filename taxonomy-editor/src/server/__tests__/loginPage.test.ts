// @vitest-environment jsdom
//
// t/2474 — the login page's inline script must carry a URL fragment through the
// anonymous flow so a pasted community-debate deep link survives login, and
// auto-continue known deep-link routes past the interstitial. Both behaviours are
// gated on the anonymous option actually being offered (`.anon-link` present in the
// DOM ⇔ showAnonymous=true), and auto-continue has a one-shot loop breaker.
//
// We run the ACTUAL served script — extracted from buildLoginPage()'s HTML — inside
// jsdom against the ACTUAL served body markup, so the test tracks the shipped page,
// not a copy. location is stubbed (jsdom cannot navigate); sessionStorage is real.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { buildLoginPage, SW_HEAL_SCRIPT_CSP_HASH } from '../loginPage.js';

function extractScript(html: string): string {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('login page has no inline script');
  return m[1];
}
function extractBody(html: string): string {
  const m = html.match(/<body>([\s\S]*)<\/body>/);
  if (!m) throw new Error('login page has no body');
  return m[1];
}

// Render the served page into jsdom, stub location with the given hash, run the
// inline script, and return the location.replace spy + the (possibly rewritten)
// anon link element.
function runLoginScript(showAnonymous: boolean, hash: string) {
  const html = buildLoginPage(showAnonymous);
  document.body.innerHTML = extractBody(html);
  const replace = vi.fn();
  vi.stubGlobal('location', { hash, replace, reload: vi.fn() });
  // document.readyState is 'complete' under jsdom → the script's run() fires now.
  new Function(extractScript(html))();
  return { replace, anon: document.querySelector('.anon-link') as HTMLAnchorElement | null };
}

describe('t/2474 — login-page deep-link hash-carry + auto-continue', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hash-carry: a non-debate hash is appended to the anon link, no auto-continue', () => {
    const { replace, anon } = runLoginScript(true, '#pov/acc-beliefs-001');
    expect(anon?.getAttribute('href')).toBe('/.auth/anonymous#pov/acc-beliefs-001');
    expect(replace).not.toHaveBeenCalled();
  });

  it('auto-continue: a #debate-window hash carries AND replaces to the anon endpoint', () => {
    const hash = '#debate-window?id=e6547b31&source=community';
    const { replace, anon } = runLoginScript(true, hash);
    expect(anon?.getAttribute('href')).toBe('/.auth/anonymous' + hash);
    expect(replace).toHaveBeenCalledWith('/.auth/anonymous' + hash);
    // one-shot marker is set so a re-serve can't loop
    expect(sessionStorage.getItem('anon_autocontinue')).toBe('1');
  });

  it('loop breaker: with the marker already set, hash-carry still fires but auto-continue does NOT', () => {
    sessionStorage.setItem('anon_autocontinue', '1');
    const hash = '#debate-window?id=e6547b31&source=community';
    const { replace, anon } = runLoginScript(true, hash);
    expect(anon?.getAttribute('href')).toBe('/.auth/anonymous' + hash); // interstitial link still usable
    expect(replace).not.toHaveBeenCalled();
  });

  it('no hash: the anon link is untouched and nothing navigates', () => {
    const { replace, anon } = runLoginScript(true, '');
    expect(anon?.getAttribute('href')).toBe('/.auth/anonymous');
    expect(replace).not.toHaveBeenCalled();
  });

  it('required-auth mode (showAnonymous=false): no anon link, so no hash-carry and NO auto-continue even for a debate hash', () => {
    const { replace, anon } = runLoginScript(false, '#debate-window?id=e6547b31&source=community');
    expect(anon).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    // policy bypass guard: the login surface advertised no path toward /.auth/anonymous
    expect(document.body.innerHTML).not.toContain('/.auth/anonymous');
  });

  it('production path: script in <head> fires on DOMContentLoaded (readyState "loading")', () => {
    // In the served page the script runs during head-parse — body not yet present,
    // readyState="loading" — so the deep-link logic MUST defer to DOMContentLoaded.
    // The 'complete'-readyState tests above would pass even if that wiring broke.
    const html = buildLoginPage(true);
    document.body.innerHTML = extractBody(html);
    const hash = '#debate-window?id=e6547b31&source=community';
    const replace = vi.fn();
    vi.stubGlobal('location', { hash, replace, reload: vi.fn() });
    const rsSpy = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    try {
      new Function(extractScript(html))();
      expect(replace).not.toHaveBeenCalled(); // deferred — nothing yet
      document.dispatchEvent(new Event('DOMContentLoaded'));
      expect(replace).toHaveBeenCalledWith('/.auth/anonymous' + hash);
    } finally {
      rsSpy.mockRestore();
    }
  });

  it('CSP hash stays in sync with the actual served script (no drift)', () => {
    const script = extractScript(buildLoginPage(true));
    const expected = `'sha256-${crypto.createHash('sha256').update(script).digest('base64')}'`;
    expect(SW_HEAL_SCRIPT_CSP_HASH).toBe(expected);
  });
});
