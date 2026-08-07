// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2242 — `resolveSpeaker` is the single speaker lookup replacing 3+ scattered
// label/color copies and the diagnostics `debaterColor` map. The alias cases
// matter most: `Prometheus`/`Sentinel`/`Cassandra` previously existed only in
// DebateExchangeRich's segmentation regex, so this table is now the source of
// truth for them (TL e/67#4).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../types/debate', () => ({
  POVER_INFO: {
    accelerationist: { label: 'Accelerationist', color: 'var(--color-acc)' },
    safetyist: { label: 'Safetyist', color: 'var(--color-saf)' },
    skeptic: { label: 'Skeptic', color: 'var(--color-skp)' },
  },
}));

import { SpeakerIdentity, resolveSpeaker } from './SpeakerIdentity';

describe('resolveSpeaker — POV speakers', () => {
  it.each([
    ['accelerationist', 'Accelerationist', 'acc'],
    ['safetyist', 'Safetyist', 'saf'],
    ['skeptic', 'Skeptic', 'skp'],
  ])('resolves %s to its label, color, and camp', (id, label, camp) => {
    const r = resolveSpeaker(id);
    expect(r).toMatchObject({ id, label, camp });
    expect(r.color).toBeTruthy();
  });

  it('accepts a display label, not just the canonical id', () => {
    expect(resolveSpeaker('Safetyist')).toMatchObject({ id: 'safetyist', label: 'Safetyist', camp: 'saf' });
  });
});

describe('resolveSpeaker — persona aliases (the regex this replaces)', () => {
  it.each([
    ['Prometheus', 'accelerationist', 'acc'],
    ['Sentinel', 'safetyist', 'saf'],
    ['Cassandra', 'skeptic', 'skp'],
  ])('maps %s to its camp', (alias, id, camp) => {
    expect(resolveSpeaker(alias)).toMatchObject({ id, camp });
  });

  it('is case- and whitespace-insensitive', () => {
    expect(resolveSpeaker('  pROMETHEUS ')).toMatchObject({ id: 'accelerationist', camp: 'acc' });
  });
});

describe('resolveSpeaker — non-POV participants', () => {
  it.each([
    ['user', 'You'],
    ['system', 'System'],
    ['document', 'Document'],
    ['moderator', 'Moderator'],
  ])('labels %s as %s', (id, label) => {
    expect(resolveSpeaker(id)).toMatchObject({ id, label });
  });

  it('gives none of them a camp, so no glyph is implied', () => {
    for (const id of ['user', 'system', 'document', 'moderator']) {
      expect(resolveSpeaker(id).camp).toBeUndefined();
    }
  });

  it('colors only the moderator', () => {
    expect(resolveSpeaker('moderator').color).toContain('--color-moderator');
    expect(resolveSpeaker('user').color).toBeUndefined();
    expect(resolveSpeaker('system').color).toBeUndefined();
  });
});

describe('resolveSpeaker — unknown speakers', () => {
  it('degrades to a titlecased label with NO color, never a fake camp accent', () => {
    const r = resolveSpeaker('nemesis');
    expect(r.label).toBe('Nemesis');
    expect(r.color).toBeUndefined();
    expect(r.camp).toBeUndefined();
  });
});

describe('SpeakerIdentity rendering', () => {
  it('renders glyph + label for a POV speaker', () => {
    const { container } = render(<SpeakerIdentity speaker="accelerationist" />);
    expect(screen.getByText('Accelerationist')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('omits the glyph for a speaker with no camp', () => {
    const { container } = render(<SpeakerIdentity speaker="moderator" />);
    expect(screen.getByText('Moderator')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('supports a glyph-only render', () => {
    const { container } = render(<SpeakerIdentity speaker="skeptic" showLabel={false} />);
    expect(screen.queryByText('Skeptic')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it.each(['inline', 'avatar', 'badge'] as const)('carries the %s variant and camp classes', (variant) => {
    const { container } = render(<SpeakerIdentity speaker="safetyist" variant={variant} />);
    const root = container.querySelector('.speaker-identity') as HTMLElement;
    expect(root.classList.contains(`speaker-identity-${variant}`)).toBe(true);
    expect(root.classList.contains('camp-saf')).toBe(true);
  });

  it('fills the badge with the accent, since its label reverses out to white', () => {
    const { container } = render(<SpeakerIdentity speaker="safetyist" variant="badge" />);
    const root = container.querySelector('.speaker-identity-badge') as HTMLElement;
    expect(root.style.background).toBeTruthy();
    expect(root.classList.contains('speaker-identity-badge-filled')).toBe(true);
  });

  // Legibility guard (TL e/67#7): white-on-white. An unknown speaker gets no
  // accent fill, so the badge keeps its `--bg-tertiary` background — reversing
  // the label out to white there would make it invisible in the light themes.
  it('does NOT reverse an unfilled badge to white, so an unknown speaker stays legible', () => {
    const { container } = render(<SpeakerIdentity speaker="nemesis" variant="badge" />);
    const root = container.querySelector('.speaker-identity-badge') as HTMLElement;
    expect(root.style.background).toBeFalsy();
    expect(root.classList.contains('speaker-identity-badge-filled')).toBe(false);
    expect(screen.getByText('Nemesis')).toBeInTheDocument();
  });

  it('resolves an alias end-to-end so a segmented transcript name renders correctly', () => {
    render(<SpeakerIdentity speaker="Cassandra" variant="badge" />);
    expect(screen.getByText('Skeptic')).toBeInTheDocument();
  });

  it('defaults its tooltip to the resolved label and lets a caller override', () => {
    const { rerender, container } = render(<SpeakerIdentity speaker="skeptic" />);
    expect(container.querySelector('.speaker-identity')).toHaveAttribute('title', 'Skeptic');

    rerender(<SpeakerIdentity speaker="skeptic" title="Turn 4 — Skeptic" />);
    expect(container.querySelector('.speaker-identity')).toHaveAttribute('title', 'Turn 4 — Skeptic');
  });
});

// t/2263 — the filled badge reverses white over the camp fill, which is light
// in the dark + bkc palettes, failing WCAG AA (2.39–3.18:1). jsdom doesn't apply
// the imported CSS, so assert the theme override that reverses label + glyph to
// --bg-primary in exactly those two themes (5.18–7.42:1), leaving light/harvard
// on white.
describe('SpeakerIdentity — filled-badge contrast override (t/2263)', () => {
  const css = readFileSync(join(import.meta.dirname, 'SpeakerIdentity.css'), 'utf8');

  it.each(['dark', 'bkc'] as const)(
    'reverses the filled badge label + glyph to --bg-primary in %s',
    (theme) => {
      for (const part of ['label', 'glyph']) {
        const rule = new RegExp(
          `\\[data-theme="${theme}"\\]\\s+\\.speaker-identity-badge-filled\\s+\\.speaker-identity-${part}\\b`,
        );
        expect(css).toMatch(rule);
      }
    },
  );

  it('sets the override color to var(--bg-primary)', () => {
    const block = css.slice(css.indexOf('[data-theme="dark"] .speaker-identity-badge-filled'));
    expect(block).toMatch(/color:\s*var\(--bg-primary\)/);
  });

  it('leaves the base filled-badge rule on white for light + harvard', () => {
    // The unconditional `#fff` rule (no [data-theme] prefix) still governs the
    // dark-fill themes; only dark + bkc override it.
    expect(css).toMatch(/\.speaker-identity-badge-filled \.speaker-identity-label,\n\s*\.speaker-identity-badge-filled \.speaker-identity-glyph \{\n\s*color: #fff;/);
  });
});
