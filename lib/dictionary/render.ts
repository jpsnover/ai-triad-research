import type { RenderLogEntry, RenderResult, RenderOptions } from './types';
import { parseQuotationMarkers } from './quotation';

const PROTECTED_BOUNDARY = /^[\s.,;:!?()\[\]{}"'`<>\/\\]$/;
const CANONICAL_RE = /[a-z][a-z0-9_]*/;

function isBoundary(ch: string | undefined, nextCh?: string): boolean {
  if (ch === undefined) return true; // start/end of input
  if (ch === '.' && nextCh !== undefined && /[a-zA-Z0-9]/.test(nextCh)) return false;
  return PROTECTED_BOUNDARY.test(ch);
}

interface ContextState {
  inCodeBlock: boolean;
  inInlineCode: boolean;
  inUrl: boolean;
  quotationDepth: number;
}

export function renderDisplay(
  input: string,
  displayFormMap: Map<string, string>,
  options?: RenderOptions,
): RenderResult {
  if (displayFormMap.size === 0) return { rendered: input, render_log: [] };

  const canonicalForms = new Set(displayFormMap.keys());
  const { spans: quotationSpans } = parseQuotationMarkers(input);

  const log: RenderLogEntry[] = [];
  const result: string[] = [];

  const ctx: ContextState = {
    inCodeBlock: false,
    inInlineCode: false,
    inUrl: false,
    quotationDepth: 0,
  };

  let i = 0;
  while (i < input.length) {
    // Fenced code block toggle: ```
    if (input.startsWith('```', i) && !ctx.inInlineCode) {
      ctx.inCodeBlock = !ctx.inCodeBlock;
      result.push('```');
      i += 3;
      if (ctx.inCodeBlock) {
        // consume the language tag and newline
        while (i < input.length && input[i] !== '\n') {
          result.push(input[i]);
          i++;
        }
      }
      continue;
    }

    if (ctx.inCodeBlock) {
      result.push(input[i]);
      i++;
      continue;
    }

    // Inline code toggle: `
    if (input[i] === '`' && !ctx.inCodeBlock) {
      ctx.inInlineCode = !ctx.inInlineCode;
      result.push('`');
      i++;
      continue;
    }

    if (ctx.inInlineCode) {
      result.push(input[i]);
      i++;
      continue;
    }

    // URL context: inside markdown link target ](...)
    if (input[i] === ']' && input[i + 1] === '(') {
      result.push('](');
      i += 2;
      while (i < input.length && input[i] !== ')') {
        result.push(input[i]);
        i++;
      }
      if (i < input.length) {
        result.push(')');
        i++;
      }
      continue;
    }

    // Quotation markers — track depth but emit them
    if (input.startsWith('<q canonical-bypass>', i)) {
      ctx.quotationDepth++;
      const tag = '<q canonical-bypass>';
      result.push(tag);
      i += tag.length;
      continue;
    }
    if (input.startsWith('</q>', i)) {
      ctx.quotationDepth = Math.max(0, ctx.quotationDepth - 1);
      result.push('</q>');
      i += 4;
      continue;
    }

    if (ctx.quotationDepth > 0) {
      result.push(input[i]);
      i++;
      continue;
    }

    // Escape: @@ prefix prevents rendering
    if (input[i] === '@' && input[i + 1] === '@') {
      i += 2; // consume @@
      // emit the following token literally
      const tokenStart = i;
      while (i < input.length && /[a-z0-9_]/.test(input[i])) {
        i++;
      }
      result.push(input.slice(tokenStart, i));
      continue;
    }

    // Try to match a canonical form at this position
    const prevChar = i > 0 ? input[i - 1] : undefined;
    if (isBoundary(prevChar) && /[a-z]/.test(input[i])) {
      const match = input.slice(i).match(/^([a-z][a-z0-9_]*)/);
      if (match) {
        const candidate = match[1];
        const afterIdx = i + candidate.length;
        const afterChar = afterIdx < input.length ? input[afterIdx] : undefined;
        const afterAfterChar = afterIdx + 1 < input.length ? input[afterIdx + 1] : undefined;
        if (canonicalForms.has(candidate) && isBoundary(afterChar, afterAfterChar)) {
          const displayForm = displayFormMap.get(candidate)!;
          log.push({
            offset: i,
            canonical_form: candidate,
            display_form: displayForm,
            context: 'prose',
          });
          result.push(displayForm);
          i = afterIdx;
          continue;
        }
      }
    }

    result.push(input[i]);
    i++;
  }

  return { rendered: result.join(''), render_log: log };
}

export function reverseRender(
  input: string,
  reverseMap: Map<string, string>,
): RenderResult {
  if (reverseMap.size === 0) return { rendered: input, render_log: [] };

  const log: RenderLogEntry[] = [];
  let rendered = input;

  const sortedEntries = Array.from(reverseMap.entries()).sort(
    (a, b) => b[0].length - a[0].length,
  );

  for (const [displayForm, canonicalForm] of sortedEntries) {
    const escaped = displayForm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<=^|[\\s.,;:!?()\\[\\]{}"'\`<>/\\\\])${escaped}(?=$|[\\s.,;:!?()\\[\\]{}"'\`<>/\\\\])`, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(rendered)) !== null) {
      log.push({
        offset: match.index,
        canonical_form: canonicalForm,
        display_form: displayForm,
        context: 'prose',
      });
    }
    rendered = rendered.replace(regex, canonicalForm);
  }

  return { rendered, render_log: log };
}

export function buildReverseMap(displayFormMap: Map<string, string>): Map<string, string> {
  const reverse = new Map<string, string>();
  for (const [canonical, display] of displayFormMap) {
    reverse.set(display, canonical);
  }
  return reverse;
}
