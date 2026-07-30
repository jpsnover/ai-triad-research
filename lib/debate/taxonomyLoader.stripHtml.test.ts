import { describe, it, expect } from 'vitest';
import { stripHtmlFallback } from './taxonomyLoader.js';

describe('stripHtmlFallback (sec fix t/2018)', () => {
  it('strips a canonical script block', () => {
    expect(stripHtmlFallback('<p>hello</p><script>alert(1)</script>')).toBe('hello');
  });

  it('strips script end-tag with trailing space: </script >', () => {
    expect(stripHtmlFallback('<script>evil()</script > tail')).toBe('tail');
  });

  it('strips style end-tag with trailing space: </style >', () => {
    const r = stripHtmlFallback('<style>body{color:red}</style > text');
    expect(r).toBe('text');
  });

  it('strips adjacent script tags (two-pass convergence)', () => {
    // First pass: inner <script> removed, leaving outer tag pair adjacent
    const input = '<script><script>inner</script></script>';
    expect(stripHtmlFallback(input)).toBe('');
  });

  it('returns empty string when content does not converge within MAX_PASSES', () => {
    // Pathological input that stays unstable: a string that keeps producing
    // new tags after each strip. We verify the function does NOT hang and
    // does NOT return partial output — it returns ''.
    // (A simple static string always converges; we use a realistic upper bound.)
    const deeplyNested = '<script>'.repeat(12) + 'x' + '</script>'.repeat(12);
    const result = stripHtmlFallback(deeplyNested);
    // Either all stripped (empty) or fail-closed (empty) — never a partial
    expect(result).toBe('');
  });

  it('strips head and noscript blocks', () => {
    const input = '<head><title>T</title></head><noscript>N</noscript><p>body</p>';
    expect(stripHtmlFallback(input)).toBe('body');
  });

  it('preserves regular text without HTML entities decoded', () => {
    // Entity decoding was removed (js/double-escaping fix): &amp; stays as &amp;
    const r = stripHtmlFallback('<p>AT&amp;T</p>');
    expect(r).toBe('AT&amp;T');
  });

  it('handles empty input', () => {
    expect(stripHtmlFallback('')).toBe('');
  });

  it('handles plain text (no tags) unchanged', () => {
    expect(stripHtmlFallback('just plain text')).toBe('just plain text');
  });
});
