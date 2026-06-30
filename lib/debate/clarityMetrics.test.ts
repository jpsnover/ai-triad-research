import { describe, it, expect } from 'vitest';
import { meanSentenceLength, lexicalDiversity, jargonDensity } from './clarityMetrics.js';

describe('meanSentenceLength', () => {
  it('counts average words per sentence', () => {
    const result = meanSentenceLength('Hello world. This is a test.');
    expect(result).toBe(3);
  });

  it('handles single sentence', () => {
    expect(meanSentenceLength('One two three four five.')).toBe(5);
  });

  it('handles exclamation and question marks', () => {
    const result = meanSentenceLength('Is this working? Yes it is! Great.');
    expect(result).toBeCloseTo(2.33, 1);
  });

  it('returns 0 for empty text', () => {
    expect(meanSentenceLength('')).toBe(0);
  });
});

describe('lexicalDiversity', () => {
  it('returns 1.0 for all unique words', () => {
    expect(lexicalDiversity('alpha beta gamma delta')).toBe(1.0);
  });

  it('returns less than 1.0 for repeated words', () => {
    const result = lexicalDiversity('the cat and the dog and the bird');
    expect(result).toBeLessThan(1.0);
    expect(result).toBeGreaterThan(0);
  });

  it('returns 0 for empty text', () => {
    expect(lexicalDiversity('')).toBe(0);
  });

  it('is case insensitive', () => {
    expect(lexicalDiversity('Hello hello HELLO')).toBeLessThan(1.0);
  });
});

describe('jargonDensity', () => {
  it('computes ratio of domain terms', () => {
    const terms = new Set(['ontology', 'epistemology']);
    const result = jargonDensity('The ontology defines epistemology boundaries', terms);
    expect(result).toBeCloseTo(2 / 5, 5);
  });

  it('returns 0 when no domain terms present', () => {
    const terms = new Set(['quantum']);
    expect(jargonDensity('Hello world today', terms)).toBe(0);
  });

  it('returns 0 for empty text', () => {
    expect(jargonDensity('', new Set(['test']))).toBe(0);
  });

  it('returns 0 for empty domain terms', () => {
    expect(jargonDensity('Hello world', new Set())).toBe(0);
  });
});
