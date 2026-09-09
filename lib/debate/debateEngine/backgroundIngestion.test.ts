import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveBackground } from './backgroundIngestion.js';

describe('resolveBackground', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns undefined for undefined input', async () => {
    expect(await resolveBackground(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', async () => {
    expect(await resolveBackground('')).toBeUndefined();
  });

  it('returns plain text unchanged', async () => {
    const text = 'Some user-provided context about the debate.';
    expect(await resolveBackground(text)).toBe(text);
  });

  it('fetches and strips HTML from a URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body><h1>Guardian Article</h1><p>AI safety researchers warn of risks.</p></body></html>',
    }));
    const result = await resolveBackground('https://example.com/article');
    expect(result).toContain('Guardian Article');
    expect(result).toContain('AI safety researchers warn of risks');
    expect(result).not.toContain('<');
  });

  it('strips script and style tags', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<style>.foo{color:red}</style><script>alert(1)</script><p>Clean</p>',
    }));
    const result = await resolveBackground('https://example.com/page');
    expect(result).toContain('Clean');
    expect(result).not.toContain('alert');
    expect(result).not.toContain('.foo');
  });

  it('caps content at 4000 chars with truncation marker', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<p>${'A'.repeat(5000)}</p>`,
    }));
    const result = await resolveBackground('https://example.com/long');
    expect(result).toBeDefined();
    expect(result!.length).toBeLessThanOrEqual(4100);
    expect(result).toContain('[content truncated]');
  });

  it('falls back to raw URL on non-ok HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const url = 'https://example.com/missing';
    expect(await resolveBackground(url)).toBe(url);
  });

  it('falls back to raw URL on fetch network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const url = 'https://example.com/article';
    expect(await resolveBackground(url)).toBe(url);
  });

  it('falls back to raw URL when extracted text is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><head></head><body></body></html>',
    }));
    const url = 'https://example.com/empty';
    expect(await resolveBackground(url)).toBe(url);
  });
});
