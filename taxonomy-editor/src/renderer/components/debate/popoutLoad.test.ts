// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { parseDebateHash, shouldShowLoadError } from './popoutLoad';

describe('parseDebateHash', () => {
  it('returns null when no id is present', () => {
    expect(parseDebateHash('')).toBeNull();
    expect(parseDebateHash('#/debate')).toBeNull();
    expect(parseDebateHash('#/debate?source=community')).toBeNull();
  });

  it('parses a plain debate id', () => {
    expect(parseDebateHash('#/debate?id=abc-123')).toEqual({ id: 'abc-123', community: false });
  });

  it('detects the community source flag', () => {
    expect(parseDebateHash('#/debate?id=abc-123&source=community')).toEqual({ id: 'abc-123', community: true });
  });

  it('url-decodes the id', () => {
    expect(parseDebateHash('#/debate?id=a%2Fb')).toEqual({ id: 'a/b', community: false });
  });
});

describe('shouldShowLoadError', () => {
  it('shows the full-screen error only when no debate is active (load failure)', () => {
    expect(shouldShowLoadError('Failed to load debate', null)).toBe(true);
  });

  it('does NOT hijack the screen once a debate is active (t/953)', () => {
    expect(shouldShowLoadError('AI service temporarily overloaded', 'debate-1')).toBe(false);
  });

  it('shows nothing when there is no error', () => {
    expect(shouldShowLoadError(null, null)).toBe(false);
    expect(shouldShowLoadError(null, 'debate-1')).toBe(false);
  });
});
