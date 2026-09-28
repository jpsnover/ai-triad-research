import { describe, it, expect } from 'vitest';
import {
  fkGrade,
  maxParagraphWords,
  maxSentenceWords,
  needsEdit,
  findIntroducedTells,
  buildViolationsText,
} from '../readabilityMeasure.js';

describe('fkGrade', () => {
  it('returns 0 for empty text', () => {
    expect(fkGrade('')).toBe(0);
  });

  it('returns a lower grade for simple short-sentence text', () => {
    const simple = 'The cat sat. Dogs run. Birds fly. Trees grow. Sun shines.';
    expect(fkGrade(simple)).toBeLessThan(5);
  });

  it('returns a higher grade for complex long-sentence text', () => {
    const complex =
      'The unprecedented proliferation of sophisticated algorithmic systems '
      + 'necessitates a comprehensive reevaluation of our institutional frameworks '
      + 'to ensure adequate oversight of transformative technological developments. '
      + 'Furthermore, the multifaceted implications of these advancements require '
      + 'unprecedented collaboration between governmental authorities and private stakeholders.';
    expect(fkGrade(complex)).toBeGreaterThan(12);
  });
});

describe('maxParagraphWords', () => {
  it('returns 0 for empty text', () => {
    expect(maxParagraphWords('')).toBe(0);
  });

  it('returns word count of longest paragraph', () => {
    const text = 'Short para.\n\nThis is a longer paragraph with quite a few more words in it, making it notably longer than the first one.';
    const result = maxParagraphWords(text);
    expect(result).toBeGreaterThan(5);
    expect(result).toBeLessThan(30);
  });

  it('flags a 337-word paragraph as over the 90-word limit', () => {
    const longPara = Array(337).fill('word').join(' ');
    expect(maxParagraphWords(longPara)).toBe(337);
    expect(maxParagraphWords(longPara)).toBeGreaterThan(90);
  });
});

describe('maxSentenceWords', () => {
  it('returns 0 for empty text', () => {
    expect(maxSentenceWords('')).toBe(0);
  });

  it('returns word count of longest sentence', () => {
    const text = 'Short. This is a somewhat longer sentence with several words in it.';
    expect(maxSentenceWords(text)).toBeGreaterThan(5);
  });
});

describe('needsEdit', () => {
  it('returns false when all checks pass', () => {
    expect(needsEdit({ fkGrade: 9.5, maxParaWords: 80, maxSentWords: 25 })).toBe(false);
  });

  it('returns true when FK grade exceeds 11', () => {
    expect(needsEdit({ fkGrade: 11.1, maxParaWords: 80, maxSentWords: 25 })).toBe(true);
  });

  it('returns true when a paragraph exceeds 90 words', () => {
    expect(needsEdit({ fkGrade: 9.0, maxParaWords: 91, maxSentWords: 25 })).toBe(true);
  });

  it('returns true when a sentence exceeds 30 words', () => {
    expect(needsEdit({ fkGrade: 9.0, maxParaWords: 80, maxSentWords: 31 })).toBe(true);
  });
});

describe('findIntroducedTells', () => {
  it('returns empty array when no tells introduced', () => {
    expect(findIntroducedTells('original text', 'edited text is cleaner')).toEqual([]);
  });

  it('detects a tell introduced by the edit', () => {
    const orig = 'This is the original text without forbidden phrases.';
    const edited = 'Furthermore, this is the edited text that added a banned phrase.';
    expect(findIntroducedTells(orig, edited)).toContain('furthermore');
  });

  it('does not flag a tell that was already in the original', () => {
    const orig = 'Furthermore, the original text already had this.';
    const edited = 'Furthermore, the edit kept this tell from the original.';
    expect(findIntroducedTells(orig, edited)).toEqual([]);
  });

  it('is case-insensitive', () => {
    const orig = 'Clean original text.';
    const edited = 'In Conclusion, the edit added a tell.';
    expect(findIntroducedTells(orig, edited)).toContain('in conclusion');
  });
});

describe('buildViolationsText', () => {
  it('lists all three violations when all fail', () => {
    const text = buildViolationsText({ fkGrade: 14.2, maxParaWords: 128, maxSentWords: 42 });
    expect(text).toContain('14.2');
    expect(text).toContain('128');
    expect(text).toContain('42');
  });

  it('lists only the failing checks', () => {
    const text = buildViolationsText({ fkGrade: 9.5, maxParaWords: 128, maxSentWords: 25 });
    expect(text).not.toContain('9.5');
    expect(text).toContain('128');
    expect(text).not.toContain('25');
  });
});
