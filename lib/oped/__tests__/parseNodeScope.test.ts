import { describe, it, expect } from 'vitest';
import { parseNodeScope } from '../generate.js';

describe('parseNodeScope', () => {
  it('returns full description as core when no markers present', () => {
    const desc = 'A plain description with no scope lines.';
    expect(parseNodeScope(desc)).toEqual({ core: desc, encompasses: '', excludes: '' });
  });

  it('extracts Encompasses when present alone', () => {
    const desc = 'Core text.\nEncompasses: Open-weight ecosystems, decentralized oversight.';
    const result = parseNodeScope(desc);
    expect(result.core).toBe('Core text.');
    expect(result.encompasses).toBe('Open-weight ecosystems, decentralized oversight.');
    expect(result.excludes).toBe('');
  });

  it('extracts Excludes when present alone', () => {
    const desc = 'Core text.\nExcludes: State-owned public utility infrastructure.';
    const result = parseNodeScope(desc);
    expect(result.core).toBe('Core text.');
    expect(result.encompasses).toBe('');
    expect(result.excludes).toBe('State-owned public utility infrastructure.');
  });

  it('extracts both Encompasses and Excludes', () => {
    const desc =
      'Core description.\nEncompasses: Open-weight ecosystems.\nExcludes: State-owned utilities.';
    const result = parseNodeScope(desc);
    expect(result.core).toBe('Core description.');
    expect(result.encompasses).toBe('Open-weight ecosystems.');
    expect(result.excludes).toBe('State-owned utilities.');
  });

  it('handles Excludes before Encompasses (splits at first marker)', () => {
    const desc =
      'Core text.\nExcludes: State-owned utilities.\nEncompasses: Open-weight ecosystems.';
    const result = parseNodeScope(desc);
    expect(result.core).toBe('Core text.');
    expect(result.excludes).toBe('State-owned utilities.');
    expect(result.encompasses).toBe('Open-weight ecosystems.');
  });

  it('trims whitespace from extracted scope values', () => {
    const desc = 'Core.\nEncompasses:   Padded value.   \nExcludes:   Also padded.   ';
    const result = parseNodeScope(desc);
    expect(result.encompasses).toBe('Padded value.');
    expect(result.excludes).toBe('Also padded.');
  });

  it('returns empty string for encompasses/excludes on empty description', () => {
    expect(parseNodeScope('')).toEqual({ core: '', encompasses: '', excludes: '' });
  });
});
