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
