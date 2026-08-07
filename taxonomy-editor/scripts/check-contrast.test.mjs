// Self-test for the token-contrast checker (t/2264).
//
// The checker exists because contrast defects are invisible to the rest of our
// suite. That makes its own detection the thing most worth guarding: a silent
// regression here would restore the blind spot while still reporting green.
//
// Each case mirrors one shape from the real t/2234 defect corpus.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from './check-contrast.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'contrast');

const result = check({
  rendererDir: FIXTURES,
  stylesFile: join(FIXTURES, 'theme-tokens.css'),
});

const contrastOn = (selector) =>
  result.findings.filter((f) => f.kind === 'contrast' && f.selector === selector);

describe('token-contrast checker — detection', () => {
  it('flags white over a light fill in the same block', () => {
    const hits = contrastOn('.fx-fail-same-block');
    assert.ok(hits.length > 0, 'expected at least one finding');
    assert.ok(hits.every((f) => f.ratio < 4.5), 'all findings should be below AA');
  });

  it('flags a fill on the ancestor with the text on a descendant', () => {
    // The badge defects had this shape; same-block-only matching misses them.
    assert.ok(contrastOn('.fx-ancestor .fx-child').length > 0);
  });

  it('flags a runtime fill declared via a contrast-fill annotation', () => {
    // The filled-badge defect: the fill arrives as an inline style, so CSS-only
    // analysis cannot see it without the annotation.
    assert.ok(contrastOn('.fx-annotated .fx-label').length > 0);
  });

  it('reports an undefined fill token instead of silently skipping it', () => {
    const hits = result.findings.filter(
      (f) => f.kind === 'undefined-fill' && f.selector === '.fx-undefined-fill',
    );
    assert.ok(hits.length > 0, 'expected at least one finding');
    assert.ok([...result.undefinedTokens.keys()].includes('--fx-does-not-exist'));
  });
});

describe('token-contrast checker — no false positives', () => {
  it('passes white over a dark fill', () => {
    assert.equal(contrastOn('.fx-ok-same-block').length, 0);
  });

  it('passes a theme-scoped override that inverts the glyph', () => {
    // The shape of both shipped fixes: [data-theme=…] overriding the base rule.
    assert.equal(contrastOn('.fx-scoped').length, 0);
  });

  it('composites a translucent fill rather than comparing it raw', () => {
    // Without alpha compositing, a 12% tint of C under `color: C` resolves to
    // the same two colors and reads as an impossible 1:1 — the shape of ~70
    // false positives on the real tree. The tint may still legitimately fail on
    // a dark surface, so the assertion is that compositing HAPPENED, not that
    // the pair passes.
    const hits = contrastOn('.fx-alpha');
    assert.ok(
      hits.every((f) => f.ratio !== 1),
      'a translucent fill must be flattened onto the surface before comparison',
    );
  });
});
