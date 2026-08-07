// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { resolveSpeaker, SpeakerIdentity } from './SpeakerIdentity';

describe('resolveSpeaker', () => {
  it('resolves canonical camp IDs', () => {
    expect(resolveSpeaker('accelerationist')).toEqual({ label: 'Accelerationist', camp: 'acc', color: 'var(--color-acc)' });
    expect(resolveSpeaker('safetyist')).toEqual({ label: 'Safetyist', camp: 'saf', color: 'var(--color-saf)' });
    expect(resolveSpeaker('skeptic')).toEqual({ label: 'Skeptic', camp: 'skp', color: 'var(--color-skp)' });
  });

  it('resolves legacy persona aliases case-insensitively', () => {
    expect(resolveSpeaker('Prometheus').camp).toBe('acc');
    expect(resolveSpeaker('prometheus').camp).toBe('acc');
    expect(resolveSpeaker('Sentinel').camp).toBe('saf');
    expect(resolveSpeaker('CASSANDRA').camp).toBe('skp');
  });

  it('resolves fixed speakers', () => {
    expect(resolveSpeaker('user')).toEqual({ label: 'You', camp: undefined, color: undefined });
    expect(resolveSpeaker('moderator')).toEqual({ label: 'Moderator', camp: undefined, color: 'var(--color-moderator, #8b5cf6)' });
    expect(resolveSpeaker('system')).toEqual({ label: 'System', camp: undefined, color: undefined });
    expect(resolveSpeaker('document')).toEqual({ label: 'Document', camp: undefined, color: undefined });
  });

  it('falls back to the raw string for unknown speakers', () => {
    expect(resolveSpeaker('unknown-bot')).toEqual({ label: 'unknown-bot', camp: undefined, color: undefined });
    expect(resolveSpeaker('')).toEqual({ label: '', camp: undefined, color: undefined });
  });

  it('all three camps return distinct colors', () => {
    const colors = ['accelerationist', 'safetyist', 'skeptic'].map(s => resolveSpeaker(s).color);
    expect(new Set(colors).size).toBe(3);
  });
});

describe('SpeakerIdentity — inline variant (default)', () => {
  it('renders the resolved label', () => {
    const { getByText } = render(<SpeakerIdentity speaker="accelerationist" />);
    expect(getByText('Accelerationist')).toBeInTheDocument();
  });

  it('resolves legacy alias and renders camp label', () => {
    const { getByText } = render(<SpeakerIdentity speaker="Prometheus" />);
    expect(getByText('Accelerationist')).toBeInTheDocument();
  });

  it('applies si-inline class and camp modifier', () => {
    const { container } = render(<SpeakerIdentity speaker="safetyist" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('si-inline');
    expect(el.className).toContain('si-camp-saf');
  });

  it('forwards custom className', () => {
    const { container } = render(<SpeakerIdentity speaker="skeptic" className="custom" />);
    expect((container.firstChild as HTMLElement).className).toContain('custom');
  });
});

describe('SpeakerIdentity — badge variant', () => {
  it('applies si-badge class', () => {
    const { container } = render(<SpeakerIdentity speaker="safetyist" variant="badge" />);
    expect(container.querySelector('.si-badge')).toBeInTheDocument();
  });

  it('uses camp color as background', () => {
    const { container } = render(<SpeakerIdentity speaker="safetyist" variant="badge" />);
    const el = container.querySelector('.si-badge') as HTMLElement;
    expect(el.style.background).toBe('var(--color-saf)');
  });
});

describe('SpeakerIdentity — avatar variant', () => {
  it('applies si-avatar class', () => {
    const { container } = render(<SpeakerIdentity speaker="skeptic" variant="avatar" />);
    expect(container.querySelector('.si-avatar')).toBeInTheDocument();
  });

  it('sets aria-label to the resolved label', () => {
    const { container } = render(<SpeakerIdentity speaker="skeptic" variant="avatar" />);
    const el = container.querySelector('.si-avatar') as HTMLElement;
    expect(el.getAttribute('aria-label')).toBe('Skeptic');
  });
});
