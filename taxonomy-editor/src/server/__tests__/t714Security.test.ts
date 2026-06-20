// @vitest-environment node

/**
 * t/714 — server input validation: path traversal (M1, M2) + reflected XSS (M3).
 */

import { describe, it, expect } from 'vitest';
import * as fileIO from '../fileIO.js';
import * as community from '../community.js';
import { escapeForInlineScript } from '../flightRecorderViewer.js';

describe('M1 — readPsPrompt path traversal', () => {
  it('rejects traversal in promptName with a 400', async () => {
    await expect(fileIO.readPsPrompt('../../../etc/passwd')).rejects.toMatchObject({ statusCode: 400 });
    await expect(fileIO.readPsPrompt('..\\..\\secrets')).rejects.toThrow(/invalid/i);
  });

  it('allows a safe prompt name (returns object, not a validation throw)', async () => {
    // A safe (but likely nonexistent) name passes validation and resolves to the
    // {text,error} shape rather than throwing.
    const r = await fileIO.readPsPrompt('triad-system');
    expect(r).toHaveProperty('text');
  });
});

describe('M2 — loadCommunityItem path traversal', () => {
  it('rejects traversal in id with a 400', async () => {
    await expect(community.loadCommunityItem('chats', '../../../etc/passwd')).rejects.toMatchObject({ statusCode: 400 });
    await expect(community.loadCommunityItem('debates', '../secret')).rejects.toThrow(/invalid/i);
  });
});

describe('validation helpers throw 400', () => {
  it('assertSafeId rejects unsafe ids', () => {
    expect(() => fileIO.assertSafeId('../x', 'id')).toThrow(/invalid/i);
    expect(() => fileIO.assertSafeId('a/b', 'id')).toThrow();
    expect(() => fileIO.assertSafeId('ok-id_1', 'id')).not.toThrow();
  });
  it('assertSafeFilename rejects traversal + slashes', () => {
    expect(() => fileIO.assertSafeFilename('a/../b', 'f')).toThrow();
    expect(() => fileIO.assertSafeFilename('safe.name-1', 'f')).not.toThrow();
  });
});

describe('M3 — escapeForInlineScript (reflected XSS)', () => {
  it('neutralizes </script> so it cannot break out of the script block', () => {
    const out = escapeForInlineScript('</script><img src=x onerror=alert(1)>');
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<'); // every "<" is escaped to <
    expect(out).toContain('\\u003c');
  });

  it('escapes template-literal + single-quote breakout chars', () => {
    expect(escapeForInlineScript('`${x}`')).toBe('\\`\\${x}\\`');
    expect(escapeForInlineScript("it's")).toBe("it\\'s");
    expect(escapeForInlineScript('a\\b')).toBe('a\\\\b');
  });

  it('leaves safe JSONL content semantically intact (decodes back to original)', () => {
    const original = '{"type":"x","msg":"hello world"}';
    const escaped = escapeForInlineScript(original);
    // No special chars here → unchanged.
    expect(escaped).toBe(original);
  });
});
