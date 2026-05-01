// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  stripCodeFences,
  parseAIJson,
  extractArraysFromPartialJson,
  parsePoverResponse,
  parseJsonRobust,
  looksTruncated,
  wordOverlap,
  hashString,
  getMoveName,
  maxOverlapVsExisting,
} from './helpers';

// ── Helpers ───────────────────────────────────────────────

/** Build a minimal valid POVer response JSON string */
function makePoverJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    statement: 'AI governance requires multi-stakeholder engagement.',
    taxonomy_refs: [{ node_id: 'acc-B-001', relevance: 'direct' }],
    move_types: ['DISTINGUISH'],
    ...overrides,
  });
}

/** Wrap text in markdown code fences */
function fenced(json: string, lang = 'json'): string {
  return `\`\`\`${lang}\n${json}\n\`\`\``;
}

// ── stripCodeFences ─────────────────────────────────────

describe('stripCodeFences', () => {
  it('removes ```json ... ``` wrapping', () => {
    const input = '```json\n{"a":1}\n```';
    expect(stripCodeFences(input)).toBe('{"a":1}');
  });

  it('removes ```typescript ... ``` wrapping', () => {
    // stripCodeFences only strips ```json and ``` generically
    const input = '```typescript\n{"a":1}\n```';
    // The ```typescript is not matched by the ```json regex, but ``` is matched
    // by the second regex. So "typescript\n{...}" remains after first pass,
    // then ``` is stripped.
    expect(stripCodeFences(input)).toBe('typescript\n{"a":1}');
  });

  it('removes multiple code fence blocks', () => {
    const input = '```json\n{"a":1}\n```\ntext\n```json\n{"b":2}\n```';
    // After stripping, the \n between ``` and text becomes an extra blank line
    expect(stripCodeFences(input)).toBe('{"a":1}\n\ntext\n{"b":2}');
  });

  it('passes through text with no code fences', () => {
    const input = '{"a":1}';
    expect(stripCodeFences(input)).toBe('{"a":1}');
  });

  it('handles empty string', () => {
    expect(stripCodeFences('')).toBe('');
  });

  it('handles whitespace-only string', () => {
    expect(stripCodeFences('   \n  ')).toBe('');
  });

  it('handles nested code fence markers in content', () => {
    // Edge case: content that mentions ``` inside
    const input = '```json\n{"code": "use ``` for fences"}\n```';
    const result = stripCodeFences(input);
    expect(result).toContain('"code"');
  });
});

// ── parseAIJson ─────────────────────────────────────────

describe('parseAIJson', () => {
  // -- Strategy 1: direct parse after fence stripping --

  it('parses valid JSON unchanged', () => {
    const obj = { key: 'value', num: 42 };
    const result = parseAIJson<typeof obj>(JSON.stringify(obj));
    expect(result).toEqual(obj);
  });

  it('parses JSON wrapped in markdown code fences', () => {
    const json = '{"statement":"hello"}';
    const result = parseAIJson(fenced(json));
    expect(result).toEqual({ statement: 'hello' });
  });

  it('parses nested objects and arrays', () => {
    const obj = {
      outer: { inner: [1, 2, { deep: true }] },
      list: ['a', 'b'],
    };
    const result = parseAIJson(JSON.stringify(obj));
    expect(result).toEqual(obj);
  });

  it('parses a bare array', () => {
    const arr = [1, 'two', { three: 3 }];
    const result = parseAIJson(JSON.stringify(arr));
    expect(result).toEqual(arr);
  });

  it('returns null for empty input', () => {
    expect(parseAIJson('')).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(parseAIJson('   \n\t  ')).toBeNull();
  });

  it('returns null for completely invalid input', () => {
    expect(parseAIJson('This is just plain text with no JSON at all.')).toBeNull();
  });

  it('returns null for random garbage', () => {
    expect(parseAIJson('abc !@#$ %^& *()_+')).toBeNull();
  });

  // -- Strategy 2: repair common issues --

  it('repairs trailing commas before } and ]', () => {
    const input = '{"a": 1, "b": [2, 3,], }';
    const result = parseAIJson(input);
    expect(result).toEqual({ a: 1, b: [2, 3] });
  });

  it('repairs bare newlines inside string values', () => {
    // LLMs often produce newlines inside JSON string values
    const input = '{"statement": "line one\nline two"}';
    const result = parseAIJson<{ statement: string }>(input);
    expect(result).not.toBeNull();
    expect(result!.statement).toContain('line one');
    expect(result!.statement).toContain('line two');
  });

  it('repairs unescaped double quotes inside string values', () => {
    // Heuristic: a quote followed by non-structural characters is inside the string
    const input = '{"statement": "She said "hello" to the crowd"}';
    const result = parseAIJson<{ statement: string }>(input);
    expect(result).not.toBeNull();
    expect(result!.statement).toContain('hello');
  });

  it('repairs multiple issues together (trailing comma + bare newlines)', () => {
    const input = '{"statement": "line1\nline2", "extra": true,}';
    const result = parseAIJson<{ statement: string; extra: boolean }>(input);
    expect(result).not.toBeNull();
    expect(result!.extra).toBe(true);
  });

  // -- Strategy 3: extract outermost JSON from preamble/postamble --

  it('extracts JSON object preceded by preamble text', () => {
    const input = 'Here is my response:\n\n{"statement": "test"}';
    const result = parseAIJson<{ statement: string }>(input);
    expect(result).toEqual({ statement: 'test' });
  });

  it('extracts JSON object followed by postamble text', () => {
    const input = '{"statement": "test"}\n\nI hope this helps!';
    const result = parseAIJson<{ statement: string }>(input);
    expect(result).toEqual({ statement: 'test' });
  });

  it('extracts JSON object surrounded by preamble and postamble', () => {
    const input = 'Sure, here you go:\n{"key": "value"}\nLet me know if you need more.';
    const result = parseAIJson<{ key: string }>(input);
    expect(result).toEqual({ key: 'value' });
  });

  it('extracts JSON array from preamble text', () => {
    const input = 'Here are the results:\n[1, 2, 3]';
    const result = parseAIJson(input);
    expect(result).toEqual([1, 2, 3]);
  });

  it('prefers object over array when object appears first', () => {
    const input = 'text {"a":1} text [1,2] text';
    const result = parseAIJson(input);
    expect(result).toEqual({ a: 1 });
  });

  it('prefers array over object when array appears first', () => {
    const input = 'text [1,2] text {"a":1} text';
    const result = parseAIJson(input);
    expect(result).toEqual([1, 2]);
  });

  it('handles deeply nested objects extracted from prose', () => {
    const obj = { a: { b: { c: { d: [1, 2, 3] } } } };
    const input = `Some text before ${JSON.stringify(obj)} and after`;
    const result = parseAIJson(input);
    expect(result).toEqual(obj);
  });

  it('handles JSON with embedded escaped quotes in strings', () => {
    const input = '{"text": "She said \\"hello\\" to them"}';
    const result = parseAIJson<{ text: string }>(input);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('hello');
  });

  it('handles fenced JSON with trailing commas', () => {
    const input = fenced('{"a": 1, "b": 2,}');
    const result = parseAIJson(input);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('extracts and repairs JSON from preamble with trailing commas', () => {
    const input = 'Sure:\n{"a": 1, "b": 2,}\nDone.';
    const result = parseAIJson(input);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('returns null for truncated JSON without a matching close bracket', () => {
    const input = '{"statement": "test", "items": [1, 2, 3';
    const result = parseAIJson(input);
    expect(result).toBeNull();
  });

  it('parses a realistic POVer response with code fences', () => {
    const response = fenced(makePoverJson());
    const result = parseAIJson<{ statement: string; taxonomy_refs: unknown[]; move_types: string[] }>(response);
    expect(result).not.toBeNull();
    expect(result!.statement).toContain('multi-stakeholder');
    expect(result!.taxonomy_refs).toHaveLength(1);
    expect(result!.move_types).toEqual(['DISTINGUISH']);
  });

  it('parses a POVer response with preamble and postamble', () => {
    const response = `Here is my analysis as Prometheus:

${makePoverJson({ statement: 'Innovation drives progress.' })}

I have provided my response in the required format.`;
    const result = parseAIJson<{ statement: string }>(response);
    expect(result).not.toBeNull();
    expect(result!.statement).toBe('Innovation drives progress.');
  });

  it('handles boolean and null values correctly', () => {
    const input = '{"flag": true, "empty": null, "count": 0}';
    const result = parseAIJson<{ flag: boolean; empty: null; count: number }>(input);
    expect(result).toEqual({ flag: true, empty: null, count: 0 });
  });

  it('handles unicode in strings', () => {
    const input = '{"text": "caf\\u00e9 \\u2603"}';
    const result = parseAIJson<{ text: string }>(input);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('caf');
  });

  it('handles empty object', () => {
    expect(parseAIJson('{}')).toEqual({});
  });

  it('handles empty array', () => {
    expect(parseAIJson('[]')).toEqual([]);
  });
});

// ── parseJsonRobust ─────────────────────────────────────

describe('parseJsonRobust', () => {
  it('parses valid JSON', () => {
    expect(parseJsonRobust('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips code fences and parses', () => {
    expect(parseJsonRobust(fenced('{"a":1}'))).toEqual({ a: 1 });
  });

  it('repairs trailing commas', () => {
    expect(parseJsonRobust('{"a":1,}')).toEqual({ a: 1 });
  });

  it('extracts JSON between first { and last }', () => {
    const input = 'preamble {"a":1} postamble';
    expect(parseJsonRobust(input)).toEqual({ a: 1 });
  });

  it('throws on completely unparseable input', () => {
    expect(() => parseJsonRobust('not json at all')).toThrow(/Cannot parse JSON/);
  });

  it('error message includes input preview', () => {
    const badInput = 'totally broken input that is not JSON';
    expect(() => parseJsonRobust(badInput)).toThrow(/Input preview/);
  });

  it('repairs bare newlines in string values', () => {
    const input = '{"statement": "line1\nline2"}';
    const result = parseJsonRobust(input) as { statement: string };
    expect(result.statement).toContain('line1');
    expect(result.statement).toContain('line2');
  });
});

// ── extractArraysFromPartialJson ────────────────────────

describe('extractArraysFromPartialJson', () => {
  it('extracts complete arrays from valid JSON', () => {
    const json = JSON.stringify({
      areas_of_agreement: [{ point: 'Both agree on X' }],
      areas_of_disagreement: [{ point: 'They differ on Y' }],
      cruxes: [{ crux: 'Core question Z' }],
      unresolved_questions: [],
      taxonomy_coverage: [],
      argument_map: [],
      preferences: [],
      policy_implications: [],
    });
    const result = extractArraysFromPartialJson(json);
    expect(result.areas_of_agreement).toHaveLength(1);
    expect(result.areas_of_disagreement).toHaveLength(1);
    expect(result.cruxes).toHaveLength(1);
  });

  it('extracts arrays from truncated JSON (missing closing brace)', () => {
    // Simulate token-limit truncation: the JSON is cut off after cruxes
    const json = `{
      "areas_of_agreement": [{"point": "A"}, {"point": "B"}],
      "areas_of_disagreement": [{"point": "C"}],
      "cruxes": [{"crux": "D"}],
      "unresolved_questions": [{"q": "E"`;
    const result = extractArraysFromPartialJson(json);
    expect(result.areas_of_agreement).toHaveLength(2);
    expect(result.areas_of_disagreement).toHaveLength(1);
    expect(result.cruxes).toHaveLength(1);
    // The truncated array should return empty
    expect(result.unresolved_questions).toEqual([]);
  });

  it('returns empty arrays when no matching keys found', () => {
    const result = extractArraysFromPartialJson('{"other": "data"}');
    expect(result.areas_of_agreement).toEqual([]);
    expect(result.cruxes).toEqual([]);
    expect(result.argument_map).toEqual([]);
  });

  it('handles empty input', () => {
    const result = extractArraysFromPartialJson('');
    expect(result.areas_of_agreement).toEqual([]);
    expect(result.areas_of_disagreement).toEqual([]);
  });

  it('handles arrays with various spacing around colon', () => {
    // extractArrayFromJson checks both `"key": [` and `"key":[`
    const json1 = '{"cruxes": [1, 2]}';
    const json2 = '{"cruxes":[1, 2]}';
    expect(extractArraysFromPartialJson(json1).cruxes).toEqual([1, 2]);
    expect(extractArraysFromPartialJson(json2).cruxes).toEqual([1, 2]);
  });

  it('extracts nested arrays correctly', () => {
    const json = '{"argument_map": [{"claims": [1, 2]}, {"claims": [3]}]}';
    const result = extractArraysFromPartialJson(json);
    expect(result.argument_map).toHaveLength(2);
  });
});

// ── parsePoverResponse ──────────────────────────────────

describe('parsePoverResponse', () => {
  it('parses a well-formed POVer response', () => {
    const json = makePoverJson();
    const result = parsePoverResponse(json);
    expect(result.statement).toContain('multi-stakeholder');
    expect(result.taxonomyRefs).toHaveLength(1);
    expect(result.taxonomyRefs[0].node_id).toBe('acc-B-001');
    expect(result.taxonomyRefs[0].relevance).toBe('direct');
  });

  it('extracts move_types metadata', () => {
    const json = makePoverJson({ move_types: ['DISTINGUISH', 'REFRAME'] });
    const result = parsePoverResponse(json);
    expect(result.meta.move_types).toEqual(['DISTINGUISH', 'REFRAME']);
  });

  it('normalizes move_type aliases', () => {
    const json = makePoverJson({ move_types: ['CONCEDE_AND_PIVOT', 'EMPIRICAL-CHALLENGE'] });
    const result = parsePoverResponse(json);
    expect(result.meta.move_types).toEqual(['CONCEDE-AND-PIVOT', 'EMPIRICAL CHALLENGE']);
  });

  it('handles annotated move objects', () => {
    const json = makePoverJson({
      move_types: [{ move: 'DISTINGUISH', target: 'prometheus', detail: 'scope narrowing' }],
    });
    const result = parsePoverResponse(json);
    expect(result.meta.move_types).toHaveLength(1);
    const move = result.meta.move_types![0];
    expect(typeof move).toBe('object');
    if (typeof move === 'object') {
      expect(move.move).toBe('DISTINGUISH');
      expect(move.target).toBe('prometheus');
      expect(move.detail).toBe('scope narrowing');
    }
  });

  it('extracts key_assumptions', () => {
    const json = makePoverJson({
      key_assumptions: [{ assumption: 'Markets are efficient', if_wrong: 'Need regulation' }],
    });
    const result = parsePoverResponse(json);
    expect(result.meta.key_assumptions).toHaveLength(1);
    expect(result.meta.key_assumptions![0].assumption).toBe('Markets are efficient');
  });

  it('extracts policy_refs', () => {
    const json = makePoverJson({ policy_refs: ['pol-001', 'pol-002'] });
    const result = parsePoverResponse(json);
    expect(result.meta.policy_refs).toEqual(['pol-001', 'pol-002']);
  });

  it('filters invalid taxonomy_refs (missing node_id)', () => {
    const json = makePoverJson({
      taxonomy_refs: [
        { node_id: 'acc-B-001', relevance: 'direct' },
        { relevance: 'indirect' }, // missing node_id
        { node_id: '', relevance: 'none' }, // empty node_id (falsy)
      ],
    });
    const result = parsePoverResponse(json);
    expect(result.taxonomyRefs).toHaveLength(1);
    expect(result.taxonomyRefs[0].node_id).toBe('acc-B-001');
  });

  it('extracts turn_symbols when valid', () => {
    const json = makePoverJson({
      turn_symbols: [{ symbol: '!', tooltip: 'strong claim' }],
    });
    const result = parsePoverResponse(json);
    expect(result.meta.turn_symbols).toHaveLength(1);
    expect(result.meta.turn_symbols![0].symbol).toBe('!');
  });

  it('filters invalid turn_symbols', () => {
    const json = makePoverJson({
      turn_symbols: [
        { symbol: '!', tooltip: 'ok' },
        { symbol: 42 }, // invalid: tooltip missing and symbol not string
      ],
    });
    const result = parsePoverResponse(json);
    expect(result.meta.turn_symbols).toHaveLength(1);
  });

  it('falls back to raw text when JSON is unparseable', () => {
    const plain = 'This is just a plain text response without JSON.';
    const result = parsePoverResponse(plain);
    expect(result.statement).toBe(plain);
    expect(result.taxonomyRefs).toEqual([]);
    expect(result.meta).toEqual({});
  });

  it('handles preamble text before JSON with "statement" key', () => {
    const preamble = "I'll respond as Prometheus now.\n";
    const json = makePoverJson({ statement: 'Innovation is key.' });
    const result = parsePoverResponse(preamble + json);
    expect(result.statement).toBe('Innovation is key.');
  });

  it('handles response in code fences', () => {
    const result = parsePoverResponse(fenced(makePoverJson()));
    expect(result.statement).toContain('multi-stakeholder');
    expect(result.taxonomyRefs).toHaveLength(1);
  });

  it('extracts position_update', () => {
    const json = makePoverJson({ position_update: 'I now partially agree with Sentinel.' });
    const result = parsePoverResponse(json);
    expect(result.meta.position_update).toBe('I now partially agree with Sentinel.');
  });

  it('handles missing optional metadata fields gracefully', () => {
    const json = JSON.stringify({ statement: 'Simple response.' });
    const result = parsePoverResponse(json);
    expect(result.statement).toBe('Simple response.');
    expect(result.meta.move_types).toBeUndefined();
    expect(result.meta.key_assumptions).toBeUndefined();
    expect(result.meta.policy_refs).toBeUndefined();
  });
});

// ── looksTruncated ──────────────────────────────────────

describe('looksTruncated', () => {
  it('returns false for complete JSON object', () => {
    expect(looksTruncated('{"a": 1}')).toBe(false);
  });

  it('returns false for complete JSON array', () => {
    expect(looksTruncated('[1, 2, 3]')).toBe(false);
  });

  it('returns true for unclosed object', () => {
    expect(looksTruncated('{"a": 1, "b":')).toBe(true);
  });

  it('returns true for unclosed array', () => {
    expect(looksTruncated('[1, 2, 3')).toBe(true);
  });

  it('returns true for unclosed nested structures', () => {
    expect(looksTruncated('{"a": [1, 2')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(looksTruncated('')).toBe(false);
  });

  it('returns false for string ending with quote', () => {
    expect(looksTruncated('"hello"')).toBe(false);
  });

  it('returns true for string ending mid-value', () => {
    expect(looksTruncated('{"key": "val')).toBe(true);
  });

  it('handles trailing whitespace correctly', () => {
    expect(looksTruncated('{"a": 1}   \n')).toBe(false);
    expect(looksTruncated('[1, 2   \n')).toBe(true);
  });
});

// ── wordOverlap ─────────────────────────────────────────

describe('wordOverlap', () => {
  it('returns 1 for identical strings', () => {
    const text = 'governance requires careful multi stakeholder engagement';
    expect(wordOverlap(text, text)).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    expect(wordOverlap('apple banana cherry', 'delta echo foxtrot')).toBe(0);
  });

  it('is case insensitive', () => {
    expect(wordOverlap('GOVERNANCE requires', 'governance REQUIRES')).toBe(1);
  });

  it('ignores short words (3 chars or less)', () => {
    // Words with length <= 3 are filtered out; "the", "big", "fox", "cat" are all <= 3 chars
    // so the overlap set is empty, yielding 0
    expect(wordOverlap('the big fox', 'the big cat')).toBe(0);
    // But longer words are kept
    expect(wordOverlap('the governance model', 'the governance approach')).toBeGreaterThan(0);
  });

  it('returns 0 for empty first string', () => {
    expect(wordOverlap('', 'some words here')).toBe(0);
  });

  it('computes partial overlap correctly', () => {
    const a = 'innovation drives economic growth significantly';
    const b = 'innovation causes environmental growth damage';
    const overlap = wordOverlap(a, b);
    // "innovation" and "growth" overlap; "drives", "economic", "significantly" don't
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBeLessThan(1);
  });
});

// ── hashString ──────────────────────────────────────────

describe('hashString', () => {
  it('returns consistent hash for same input', () => {
    expect(hashString('hello')).toBe(hashString('hello'));
  });

  it('returns different hashes for different inputs', () => {
    expect(hashString('hello')).not.toBe(hashString('world'));
  });

  it('returns a hex string', () => {
    expect(hashString('test')).toMatch(/^[0-9a-f]+$/);
  });

  it('handles empty string', () => {
    const result = hashString('');
    expect(result).toMatch(/^[0-9a-f]+$/);
  });
});

// ── getMoveName ─────────────────────────────────────────

describe('getMoveName', () => {
  it('returns string as-is for plain string', () => {
    expect(getMoveName('DISTINGUISH')).toBe('DISTINGUISH');
  });

  it('returns move property from MoveAnnotation', () => {
    expect(getMoveName({ move: 'REFRAME', detail: 'test' })).toBe('REFRAME');
  });
});

// ── maxOverlapVsExisting ────────────────────────────────

describe('maxOverlapVsExisting', () => {
  it('returns 0 for empty existing array', () => {
    expect(maxOverlapVsExisting('some text here', [])).toBe(0);
  });

  it('returns maximum overlap across all existing items', () => {
    const existing = [
      { text: 'completely different words unrelated' },
      { text: 'some text here exactly matching' },
    ];
    const result = maxOverlapVsExisting('some text here', existing);
    expect(result).toBeGreaterThan(0);
  });
});

// ── repairJson (tested indirectly through parseAIJson) ──

describe('repairJson (via parseAIJson)', () => {
  it('handles carriage returns inside strings', () => {
    const input = '{"statement": "line1\r\nline2"}';
    const result = parseAIJson<{ statement: string }>(input);
    expect(result).not.toBeNull();
    expect(result!.statement).toContain('line1');
  });

  it('handles multiple unescaped quotes in a single string', () => {
    const input = '{"statement": "The "quick" brown "fox" jumped"}';
    const result = parseAIJson<{ statement: string }>(input);
    expect(result).not.toBeNull();
    expect(result!.statement).toContain('quick');
    expect(result!.statement).toContain('fox');
  });

  it('handles trailing comma in nested arrays', () => {
    const input = '{"items": [{"a": 1,}, {"b": 2,},]}';
    const result = parseAIJson(input);
    expect(result).not.toBeNull();
    expect(result).toEqual({ items: [{ a: 1 }, { b: 2 }] });
  });

  it('handles a mix of trailing commas and bare newlines', () => {
    const input = '{"statement": "line1\nline2", "list": [1, 2,],}';
    const result = parseAIJson<{ statement: string; list: number[] }>(input);
    expect(result).not.toBeNull();
    expect(result!.list).toEqual([1, 2]);
  });

  it('handles already properly escaped content', () => {
    const input = '{"statement": "She said \\\"hello\\\" properly"}';
    const result = parseAIJson<{ statement: string }>(input);
    expect(result).not.toBeNull();
  });

  it('repairs LLM response with statement containing newlines and quotes', () => {
    // Realistic LLM output: multi-paragraph statement with embedded quotes
    const input = `{
  "statement": "First paragraph about "innovation" in AI.\nSecond paragraph continues.\nThird paragraph mentions "safety" concerns.",
  "taxonomy_refs": [],
  "move_types": ["DISTINGUISH"]
}`;
    const result = parseAIJson<{ statement: string; move_types: string[] }>(input);
    expect(result).not.toBeNull();
    expect(result!.statement).toContain('innovation');
    expect(result!.statement).toContain('safety');
    expect(result!.move_types).toEqual(['DISTINGUISH']);
  });
});
