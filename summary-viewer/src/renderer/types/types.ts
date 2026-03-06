export type Theme = 'light' | 'dark' | 'bkc' | 'system';

export type PovCamp = 'accelerationist' | 'safetyist' | 'skeptic';

export interface SourceInfo {
  id: string;
  title: string;
  sourceType: string;
  url: string | null;
  authors: string[];
  dateIngested: string;
  povTags: string[];
  topicTags: string[];
  oneLiner: string;
  hasSummary: boolean;
}

export interface KeyPoint {
  taxonomy_node_id: string | null;
  category: string;
  point: string;
  verbatim?: string;
  excerpt_context: string;
  stance: string;
}

export interface PovSummary {
  stance?: string;
  key_points: KeyPoint[];
}

export interface PipelineSummary {
  doc_id: string;
  taxonomy_version: string;
  generated_at: string;
  ai_model: string;
  temperature: number;
  pov_summaries: Record<string, PovSummary>;
  factual_claims: Array<{
    claim: string;
    doc_position: string;
    potential_conflict_id: string | null;
  }>;
  unmapped_concepts: Array<{
    concept: string;
    suggested_label?: string;
    suggested_description?: string;
    suggested_pov: string;
    suggested_category: string;
    reason: string;
    'Accelerationist Interpretation'?: string;
    'Safetyist Interpretation'?: string;
    'Skeptic Interpretation'?: string;
  }>;
}

export interface TaxonomyNode {
  id: string;
  category: string;
  label: string;
  description: string;
}

export interface SelectedKeyPoint {
  docId: string;
  pov: string;
  index: number;
}
