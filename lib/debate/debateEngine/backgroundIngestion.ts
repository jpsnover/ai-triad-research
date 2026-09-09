import { getGlobalRecorder } from '../../flight-recorder/index.js';

const URL_RE = /^https?:\/\//i;
const BACKGROUND_CHAR_CAP = 4000;

/**
 * If `raw` is a URL, fetch the page, strip HTML, cap at 4000 chars, and return the text.
 * Falls back to the raw string on any error — never throws.
 * Plain text and undefined pass through unchanged.
 */
export async function resolveBackground(raw: string | undefined): Promise<string | undefined> {
  if (!raw) return undefined;
  if (!URL_RE.test(raw)) return raw;

  const url = raw;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'background-ingestion',
        level: 'warn',
        message: `URL background fetch failed (HTTP ${res.status}): ${url} — falling back to raw URL`,
      });
      return raw;
    }
    const html = await res.text();
    const text = extractText(html);
    if (!text) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'background-ingestion',
        level: 'warn',
        message: `URL background fetch returned empty body after stripping: ${url} — falling back to raw URL`,
      });
      return raw;
    }
    return text.length > BACKGROUND_CHAR_CAP
      ? text.slice(0, BACKGROUND_CHAR_CAP) + ' [content truncated]'
      : text;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'background-ingestion',
      level: 'warn',
      message: `URL background fetch error (${reason}): ${url} — falling back to raw URL`,
    });
    return raw;
  }
}

function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
