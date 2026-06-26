import { extractTopicStructurePrompt } from './prompts.js';
import { parseJsonRobust } from './helpers.js';

export type TopicComplexity = 'simple' | 'structured';

export interface TopicStructure {
  core_proposition: string;
  structural_premises: string[];
  scope_constraints?: string[];
}

const SIMPLE_PREFIXES = [
  'situation:',
  'discuss:',
  'debate grounded in:',
];

export function classifyTopicComplexity(topic: string): TopicComplexity {
  const trimmed = topic.trim();

  if (trimmed.length <= 200) return 'simple';

  const lower = trimmed.toLowerCase();
  if (SIMPLE_PREFIXES.some(p => lower.startsWith(p))) return 'simple';

  const firstPeriod = trimmed.indexOf('.');
  if (trimmed.endsWith('?') && (firstPeriod === -1 || firstPeriod === trimmed.length - 1)) {
    return 'simple';
  }

  return 'structured';
}

export async function extractTopicStructure(
  topic: string,
  generate: (prompt: string, label: string) => Promise<string>,
): Promise<TopicStructure> {
  const prompt = extractTopicStructurePrompt(topic);
  const text = await generate(prompt, 'Topic structure extraction');

  let parsed: Record<string, unknown> | null;
  try {
    parsed = parseJsonRobust(text) as Record<string, unknown> | null;
  } catch {
    return { core_proposition: topic, structural_premises: [], scope_constraints: [] };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { core_proposition: topic, structural_premises: [], scope_constraints: [] };
  }

  const toStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];

  return {
    core_proposition: typeof parsed.core_proposition === 'string' ? parsed.core_proposition : topic,
    structural_premises: toStringArray(parsed.structural_premises),
    scope_constraints: toStringArray(parsed.scope_constraints),
  };
}
