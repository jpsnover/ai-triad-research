import { describe, it, expect, vi } from 'vitest';
import { classifyTopicComplexity, extractTopicStructure } from './topicStructure.js';
import type { TopicComplexity } from './topicStructure.js';

describe('classifyTopicComplexity', () => {
  it('classifies short topics as simple', () => {
    expect(classifyTopicComplexity('Should AI be regulated?')).toBe('simple');
  });

  it('classifies topics at exactly 200 chars as simple', () => {
    const topic = 'x'.repeat(200);
    expect(classifyTopicComplexity(topic)).toBe('simple');
  });

  it('classifies topics over 200 chars without simple markers as structured', () => {
    const topic = 'x'.repeat(201);
    expect(classifyTopicComplexity(topic)).toBe('structured');
  });

  it('classifies Situation: prefix as simple regardless of length', () => {
    const topic = 'Situation: ' + 'x'.repeat(300);
    expect(classifyTopicComplexity(topic)).toBe('simple');
  });

  it('classifies Discuss: prefix as simple regardless of length', () => {
    const topic = 'Discuss: ' + 'x'.repeat(300);
    expect(classifyTopicComplexity(topic)).toBe('simple');
  });

  it('classifies "Debate grounded in:" prefix as simple regardless of length', () => {
    const topic = 'Debate grounded in: ' + 'x'.repeat(300);
    expect(classifyTopicComplexity(topic)).toBe('simple');
  });

  it('is case-insensitive for prefix matching', () => {
    const topic = 'SITUATION: ' + 'x'.repeat(300);
    expect(classifyTopicComplexity(topic)).toBe('simple');
  });

  it('classifies single question sentence over 200 chars as simple', () => {
    const topic = 'Should we ' + 'x'.repeat(200) + '?';
    expect(classifyTopicComplexity(topic)).toBe('simple');
  });

  it('classifies multi-sentence topic over 200 chars as structured', () => {
    const topic = 'AI systems should be regulated. ' + 'x'.repeat(200) + '?';
    expect(classifyTopicComplexity(topic)).toBe('structured');
  });

  it('trims whitespace before classification', () => {
    expect(classifyTopicComplexity('  Should AI be regulated?  ')).toBe('simple');
  });

  it('returns correct type', () => {
    const result: TopicComplexity = classifyTopicComplexity('test');
    expect(['simple', 'structured']).toContain(result);
  });

  describe('corpus-representative examples', () => {
    const cases: [string, TopicComplexity][] = [
      ['Should AI be regulated?', 'simple'],
      ['Discuss: the role of safety testing in AI deployment', 'simple'],
      ['Situation: A major tech company has released a powerful new AI model without safety testing', 'simple'],
      [
        'The EU AI Act should require all foundation model providers to maintain a permanent safety team of at least 5% of engineering headcount, with veto power over model releases. Companies that do not adhere to safety standards are not covered by the EU liability shield.',
        'structured',
      ],
      [
        'Governments should mandate that all AI systems used in hiring decisions undergo annual third-party bias audits, with results published publicly. Systems that fail the audit must be withdrawn within 90 days. Exemptions apply to companies with fewer than 50 employees.',
        'structured',
      ],
    ];

    for (const [topic, expected] of cases) {
      it(`classifies "${topic.slice(0, 60)}..." as ${expected}`, () => {
        expect(classifyTopicComplexity(topic)).toBe(expected);
      });
    }
  });
});

describe('extractTopicStructure', () => {
  it('parses valid LLM JSON response', async () => {
    const generate = vi.fn().mockResolvedValue(JSON.stringify({
      core_proposition: 'Whether AI should be regulated',
      structural_premises: ['The team is established', 'The timeline is 90 days'],
      scope_constraints: ['Consumer software only'],
    }));

    const result = await extractTopicStructure('test topic', generate);
    expect(result.core_proposition).toBe('Whether AI should be regulated');
    expect(result.structural_premises).toEqual(['The team is established', 'The timeline is 90 days']);
    expect(result.scope_constraints).toEqual(['Consumer software only']);
    expect(generate).toHaveBeenCalledWith(expect.stringContaining('test topic'), 'Topic structure extraction');
  });

  it('returns fallback on unparseable response', async () => {
    const generate = vi.fn().mockResolvedValue('not json at all');
    const result = await extractTopicStructure('my topic', generate);
    expect(result.core_proposition).toBe('my topic');
    expect(result.structural_premises).toEqual([]);
    expect(result.scope_constraints).toEqual([]);
  });

  it('returns empty structural_premises when LLM returns empty array', async () => {
    const generate = vi.fn().mockResolvedValue(JSON.stringify({
      core_proposition: 'Congress should mandate X',
      structural_premises: [],
      scope_constraints: [],
    }));

    const result = await extractTopicStructure('test', generate);
    expect(result.structural_premises).toEqual([]);
  });

  it('filters non-string values from arrays', async () => {
    const generate = vi.fn().mockResolvedValue(JSON.stringify({
      core_proposition: 'test',
      structural_premises: ['valid', 123, null, 'also valid'],
      scope_constraints: [true, 'constraint'],
    }));

    const result = await extractTopicStructure('test', generate);
    expect(result.structural_premises).toEqual(['valid', 'also valid']);
    expect(result.scope_constraints).toEqual(['constraint']);
  });

  it('falls back to raw topic when core_proposition is missing', async () => {
    const generate = vi.fn().mockResolvedValue(JSON.stringify({
      structural_premises: ['a premise'],
    }));

    const result = await extractTopicStructure('original topic', generate);
    expect(result.core_proposition).toBe('original topic');
    expect(result.structural_premises).toEqual(['a premise']);
  });
});
