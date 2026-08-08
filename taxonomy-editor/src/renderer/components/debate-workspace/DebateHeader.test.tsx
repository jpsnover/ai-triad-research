// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { humanizeUrl, deriveHeaderTitle } from './DebateHeader';

// ── humanizeUrl ─────────────────────────────────────────────

describe('humanizeUrl', () => {
  it('drops scheme, www., and trailing slash', () => {
    expect(humanizeUrl('https://www.techpolicy.press/why-new-mexico-v-meta-matters/'))
      .toBe('techpolicy.press/why-new-mexico-v-meta-matters');
  });
  it('handles http and no-www', () => {
    expect(humanizeUrl('http://example.com/a/b')).toBe('example.com/a/b');
  });
  it('leaves a non-URL untouched', () => {
    expect(humanizeUrl('Why New Mexico v. Meta Matters')).toBe('Why New Mexico v. Meta Matters');
  });
});

// ── deriveHeaderTitle (t/2293 review — title/source dedup) ───

describe('deriveHeaderTitle', () => {
  it('humanizes a raw-URL "Discuss:" topic and suppresses the duplicate source line', () => {
    const r = deriveHeaderTitle(
      'Discuss: https://www.techpolicy.press/why-new-mexico-v-meta-matters/',
      'https://www.techpolicy.press/why-new-mexico-v-meta-matters/'
    );
    expect(r.displayTitle).toBe('techpolicy.press/why-new-mexico-v-meta-matters');
    expect(r.sourceDisplay).toBeNull();
  });

  it('keeps a clean refined title and shows the humanized source when they differ', () => {
    const r = deriveHeaderTitle(
      'Why New Mexico v. Meta Matters',
      'https://www.techpolicy.press/why-new-mexico-v-meta-matters/'
    );
    expect(r.displayTitle).toBe('Why New Mexico v. Meta Matters');
    expect(r.sourceDisplay).toBe('techpolicy.press/why-new-mexico-v-meta-matters');
  });

  it('returns null source when there is no source_ref', () => {
    const r = deriveHeaderTitle('Some plain topic', null);
    expect(r.displayTitle).toBe('Some plain topic');
    expect(r.sourceDisplay).toBeNull();
  });

  it('strips a leading "Discuss:" case-insensitively for a non-URL topic', () => {
    const r = deriveHeaderTitle('discuss: The ethics of AI', undefined);
    expect(r.displayTitle).toBe('The ethics of AI');
    expect(r.sourceDisplay).toBeNull();
  });

  it('falls back to the original topic when stripping would leave it empty', () => {
    const r = deriveHeaderTitle('Discuss:', null);
    expect(r.displayTitle).toBe('Discuss:');
  });
});
