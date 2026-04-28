import type { ColloquialTerm } from '../dictionary/types';
import type { OccurrenceLocation } from './types';
import { parseQuotationMarkers, isInsideQuotation } from '../dictionary/quotation';

const BOUNDARY_RE = /[\s.,;:!?()\[\]{}"'`<>\/\\]/;
const CONTEXT_CHARS_DEFAULT = 400;

function isBoundaryChar(ch: string | undefined): boolean {
  if (ch === undefined) return true;
  return BOUNDARY_RE.test(ch);
}

export function locateOccurrences(
  text: string,
  colloquialTerms: ColloquialTerm[],
  contextChars: number = CONTEXT_CHARS_DEFAULT,
): OccurrenceLocation[] {
  const bareTerms = colloquialTerms.filter(t => t.status === 'do_not_use_bare');
  if (bareTerms.length === 0) return [];

  const { spans: quotationSpans } = parseQuotationMarkers(text);

  const codeBlockRanges = findCodeBlockRanges(text);
  const inlineCodeRanges = findInlineCodeRanges(text);

  const occurrences: OccurrenceLocation[] = [];
  const textLower = text.toLowerCase();

  const sortedTerms = [...bareTerms].sort(
    (a, b) => b.colloquial_term.length - a.colloquial_term.length,
  );

  const consumed = new Set<number>();

  for (const term of sortedTerms) {
    const needle = term.colloquial_term.toLowerCase();
    let searchFrom = 0;

    while (searchFrom < textLower.length) {
      const idx = textLower.indexOf(needle, searchFrom);
      if (idx === -1) break;

      searchFrom = idx + 1;

      if (consumed.has(idx)) continue;

      const prevChar = idx > 0 ? text[idx - 1] : undefined;
      const afterIdx = idx + needle.length;
      const afterChar = afterIdx < text.length ? text[afterIdx] : undefined;

      if (!isBoundaryChar(prevChar) || !isBoundaryChar(afterChar)) continue;

      if (isInsideQuotation(idx, quotationSpans)) continue;
      if (isInsideRange(idx, codeBlockRanges)) continue;
      if (isInsideRange(idx, inlineCodeRanges)) continue;

      const contextStart = Math.max(0, idx - contextChars);
      const contextEnd = Math.min(text.length, afterIdx + contextChars);

      occurrences.push({
        colloquial_term: term.colloquial_term,
        offset: idx,
        length: needle.length,
        context_before: text.slice(contextStart, idx),
        context_after: text.slice(afterIdx, contextEnd),
        section_heading: findSectionHeading(text, idx),
      });

      for (let i = idx; i < afterIdx; i++) consumed.add(i);
    }
  }

  occurrences.sort((a, b) => a.offset - b.offset);
  return occurrences;
}

function findCodeBlockRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const fence = /```/g;
  let match: RegExpExecArray | null;
  let openPos: number | null = null;

  while ((match = fence.exec(text)) !== null) {
    if (openPos === null) {
      openPos = match.index;
    } else {
      ranges.push([openPos, match.index + 3]);
      openPos = null;
    }
  }
  return ranges;
}

function findInlineCodeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('```', i)) {
      i += 3;
      const end = text.indexOf('```', i);
      i = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text[i] === '`') {
      const start = i;
      i++;
      while (i < text.length && text[i] !== '`') i++;
      if (i < text.length) {
        ranges.push([start, i + 1]);
        i++;
      }
      continue;
    }
    i++;
  }
  return ranges;
}

function isInsideRange(offset: number, ranges: Array<[number, number]>): boolean {
  for (const [start, end] of ranges) {
    if (offset >= start && offset < end) return true;
  }
  return false;
}

function findSectionHeading(text: string, offset: number): string | undefined {
  const before = text.slice(0, offset);
  const headingMatch = before.match(/(?:^|\n)(#{1,6}\s+.+)(?:\n|$)/g);
  if (!headingMatch) return undefined;
  const last = headingMatch[headingMatch.length - 1].trim();
  return last.replace(/^#+\s+/, '');
}
