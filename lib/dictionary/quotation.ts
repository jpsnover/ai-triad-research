export interface QuotationSpan {
  start: number;
  end: number;
  depth: number;
}

export interface QuotationParseResult {
  spans: QuotationSpan[];
  errors: QuotationParseError[];
}

export interface QuotationParseError {
  offset: number;
  message: string;
}

const OPEN_TAG = '<q canonical-bypass>';
const CLOSE_TAG = '</q>';

export function parseQuotationMarkers(input: string): QuotationParseResult {
  const spans: QuotationSpan[] = [];
  const errors: QuotationParseError[] = [];
  const openStack: number[] = [];

  let pos = 0;
  while (pos < input.length) {
    const openIdx = input.indexOf(OPEN_TAG, pos);
    const closeIdx = input.indexOf(CLOSE_TAG, pos);

    if (openIdx === -1 && closeIdx === -1) break;

    if (openIdx !== -1 && (closeIdx === -1 || openIdx < closeIdx)) {
      openStack.push(openIdx);
      pos = openIdx + OPEN_TAG.length;
    } else if (closeIdx !== -1) {
      if (openStack.length === 0) {
        errors.push({ offset: closeIdx, message: 'Closing </q> without matching opening <q canonical-bypass>' });
        pos = closeIdx + CLOSE_TAG.length;
      } else {
        const openPos = openStack.pop()!;
        spans.push({
          start: openPos,
          end: closeIdx + CLOSE_TAG.length,
          depth: openStack.length + 1,
        });
        pos = closeIdx + CLOSE_TAG.length;
      }
    }
  }

  for (const unclosed of openStack) {
    errors.push({ offset: unclosed, message: 'Opening <q canonical-bypass> without matching </q>' });
  }

  spans.sort((a, b) => a.start - b.start);
  return { spans, errors };
}

export function isInsideQuotation(offset: number, spans: QuotationSpan[]): boolean {
  for (const span of spans) {
    const contentStart = span.start + OPEN_TAG.length;
    const contentEnd = span.end - CLOSE_TAG.length;
    if (offset >= contentStart && offset < contentEnd) return true;
  }
  return false;
}

export function stripQuotationMarkers(input: string): string {
  return input.replace(/<q canonical-bypass>/g, '').replace(/<\/q>/g, '');
}
