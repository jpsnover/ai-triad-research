// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// These tests import speakerLabel/speakerColor from './speakerHelpers' and NOTHING
// from './utils'. Many sibling test files call vi.mock('./utils', () => ({
// speakerLabel: capitalize, ... })). Because './utils' re-exports the helpers from
// './speakerHelpers', a test file that imports BOTH './utils' and the helpers pulled
// a sibling's './utils' mock into its module graph and, under CI's threads pool,
// resolved the re-exported speakerLabel to that mock's capitalizer — flaking
// speakerLabel('unknown')→'Unknown' (t/2256). Keeping the speaker tests in a file
// whose graph never touches './utils' makes them immune by construction. The
// resolveSpeaker cross-check below pinpoints the layer if this ever regresses again.

import { describe, it, expect } from 'vitest';
import { speakerLabel, speakerColor } from './speakerHelpers';
import { resolveSpeaker } from '../shared/SpeakerIdentity';

// ── speakerLabel ─────────────────────────────────────────────

describe('speakerLabel', () => {
  it('returns "System" for system speaker', () => {
    expect(speakerLabel('system')).toBe('System');
  });

  it('returns "Moderator" for moderator speaker', () => {
    expect(speakerLabel('moderator')).toBe('Moderator');
  });

  it('returns "You" for user speaker', () => {
    expect(speakerLabel('user')).toBe('You');
  });

  it('returns "Document" for document speaker', () => {
    expect(speakerLabel('document')).toBe('Document');
  });

  it('returns the resolveSpeaker label for accelerationist', () => {
    expect(speakerLabel('accelerationist')).toBe('Accelerationist');
  });

  it('returns the resolveSpeaker label for safetyist', () => {
    expect(speakerLabel('safetyist')).toBe('Safetyist');
  });

  it('returns the resolveSpeaker label for skeptic', () => {
    expect(speakerLabel('skeptic')).toBe('Skeptic');
  });

  it('falls back to the raw speaker string for an unknown speaker', () => {
    // resolveSpeaker returns the raw id (no camp, no fixed role) for unknowns.
    expect(resolveSpeaker('unknown').label).toBe('unknown');
    expect(speakerLabel('unknown' as never)).toBe('unknown');
  });
});

// ── speakerColor ─────────────────────────────────────────────

describe('speakerColor', () => {
  it('returns undefined for system', () => {
    expect(speakerColor('system')).toBeUndefined();
  });

  it('returns undefined for user', () => {
    expect(speakerColor('user')).toBeUndefined();
  });

  it('returns undefined for document', () => {
    expect(speakerColor('document')).toBeUndefined();
  });

  it('returns the moderator CSS variable for moderator', () => {
    expect(speakerColor('moderator')).toBe('var(--color-moderator, #8b5cf6)');
  });

  it('returns the resolveSpeaker color for accelerationist', () => {
    expect(speakerColor('accelerationist')).toBe('var(--color-acc)');
  });

  it('returns the resolveSpeaker color for safetyist', () => {
    expect(speakerColor('safetyist')).toBe('var(--color-saf)');
  });

  it('returns the resolveSpeaker color for skeptic', () => {
    expect(speakerColor('skeptic')).toBe('var(--color-skp)');
  });
});
