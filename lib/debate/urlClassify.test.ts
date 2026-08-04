import { describe, it, expect } from 'vitest';
import { classifyUrl } from './urlClassify.js';

describe('classifyUrl', () => {
  describe('doi.org', () => {
    it('accepts canonical doi.org', () => {
      expect(classifyUrl('https://doi.org/10.1234/test')).toBe('doi');
    });
    it('accepts doi.org subdomains (e.g. dx.doi.org)', () => {
      expect(classifyUrl('https://dx.doi.org/10.1234/test')).toBe('doi');
    });
    it('rejects typosquatting: doi.org.evil.com', () => {
      expect(classifyUrl('https://doi.org.evil.com/path')).toBe('direct');
    });
    it('rejects domain that merely contains doi.org as substring', () => {
      expect(classifyUrl('https://notdoi.org/path')).toBe('direct');
    });
  });

  describe('arxiv.org', () => {
    it('accepts arxiv.org', () => {
      expect(classifyUrl('https://arxiv.org/abs/2401.12345')).toBe('arxiv');
    });
    it('accepts export.arxiv.org subdomain', () => {
      expect(classifyUrl('https://export.arxiv.org/abs/2401.12345')).toBe('arxiv');
    });
    it('rejects arxiv.org.evil.com typosquatting', () => {
      expect(classifyUrl('https://arxiv.org.evil.com/abs/1234')).toBe('direct');
    });
  });

  describe('ssrn.com', () => {
    it('accepts ssrn.com', () => {
      expect(classifyUrl('https://ssrn.com/abstract=1234')).toBe('ssrn');
    });
    it('accepts papers.ssrn.com subdomain', () => {
      expect(classifyUrl('https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1234')).toBe('ssrn');
    });
    it('rejects ssrn.com.attacker.com typosquatting', () => {
      expect(classifyUrl('https://ssrn.com.attacker.com/abstract')).toBe('direct');
    });
  });

  describe('scholar.google.com', () => {
    it('accepts scholar.google.com', () => {
      expect(classifyUrl('https://scholar.google.com/scholar?q=test')).toBe('scholar_fallback');
    });
    it('rejects scholar.google.com.evil.com typosquatting', () => {
      expect(classifyUrl('https://scholar.google.com.evil.com/path')).toBe('direct');
    });
  });

  describe('google.com/search', () => {
    it('accepts google.com/search', () => {
      expect(classifyUrl('https://google.com/search?q=test')).toBe('google_fallback');
    });
    it('accepts www.google.com/search', () => {
      expect(classifyUrl('https://www.google.com/search?q=test')).toBe('google_fallback');
    });
    it('rejects google.com without /search path', () => {
      expect(classifyUrl('https://google.com/maps')).toBe('direct');
    });
  });

  describe('scheme allowlist', () => {
    it('rejects javascript: URI', () => {
      expect(classifyUrl('javascript:alert(1)')).toBe('direct');
    });
    it('rejects data: URI', () => {
      expect(classifyUrl('data:text/html,<script>evil()</script>')).toBe('direct');
    });
    it('rejects file: URI', () => {
      expect(classifyUrl('file:///etc/passwd')).toBe('direct');
    });
    it('accepts http: scheme (not just https)', () => {
      expect(classifyUrl('http://doi.org/10.1234/test')).toBe('doi');
    });
  });

  describe('fallbacks', () => {
    it('returns none for empty string', () => {
      expect(classifyUrl('')).toBe('none');
    });
    it('returns direct for an invalid URL', () => {
      expect(classifyUrl('not-a-url')).toBe('direct');
    });
    it('returns direct for an unrecognized domain', () => {
      expect(classifyUrl('https://example.com/paper')).toBe('direct');
    });
  });
});
