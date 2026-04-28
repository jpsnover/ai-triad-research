export type CampOrigin = 'safetyist' | 'accelerationist' | 'skeptic';
export type CoinageStatus = 'provisional' | 'accepted' | 'contested' | 'deprecated';
export type ColloquialStatus = 'do_not_use_bare' | 'acceptable_in_quotation' | 'safe';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface StandardizedTerm {
  $schema_version: string;
  canonical_form: string;
  display_form: string;
  definition: string;
  coined_for_taxonomy: boolean;
  primary_camp_origin: CampOrigin;
  rationale_for_coinage: string;
  characteristic_phrases: string[];
  used_by_nodes: string[];
  translates_from_colloquial: string[];
  see_also?: string[];
  do_not_confuse_with?: Array<{ term: string; note: string }>;
  contested_aspects?: string[];
  coinage_status: CoinageStatus;
  coined_at: string;
  coined_by: string;
  coinage_log_ref: string;
  replaced_by?: string;
}

export interface ColloquialResolution {
  standardized_term: string;
  when: string;
  default_for_camp?: CampOrigin;
  confidence_typical?: ConfidenceLevel;
}

export interface ColloquialTerm {
  $schema_version: string;
  colloquial_term: string;
  status: ColloquialStatus;
  translation_required: boolean;
  resolves_to: ColloquialResolution[];
  translation_ambiguous_when?: string[];
  first_added: string;
  last_reviewed: string;
}

export interface DictionaryVersion {
  schema_version: string;
  created_at: string;
  updated_at: string;
}

export interface SenseEmbeddingEntry {
  hash: string;
  embedding: number[];
}

export interface SenseEmbeddingsFile {
  $schema_version: string;
  model: string;
  dimensions: number;
  entries: Record<string, SenseEmbeddingEntry>;
}

export type RenderContext = 'prose' | 'code_inline' | 'code_block' | 'url' | 'quotation' | 'escape';

export interface RenderLogEntry {
  offset: number;
  canonical_form: string;
  display_form: string;
  context: RenderContext;
}

export interface RenderResult {
  rendered: string;
  render_log: RenderLogEntry[];
}

export interface RenderOptions {
  context?: RenderContext;
  dictionary_version?: string;
}

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintViolation {
  constraint_id: number;
  severity: LintSeverity;
  file?: string;
  line?: number;
  message: string;
  violation_text?: string;
  suggested_fix?: string;
}

export interface LintOptions {
  constraints?: number[];
  mode?: 'warning' | 'soft_fail' | 'enforcing';
}

export interface StandardizedTermFilter {
  primary_camp_origin?: CampOrigin;
  coinage_status?: CoinageStatus;
  contains_term?: string;
}

export interface ColloquialTermFilter {
  status?: ColloquialStatus;
  standardized_target?: string;
}
