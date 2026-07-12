export type Pov = 'accelerationist' | 'safetyist' | 'skeptic';
export type PovStance = { score: number; rationale?: string };
export interface TopicEngagement { topic_ref: string; stance?: string; description?: string }
export interface PolicyEngagement { policy_ref: string; stance: 'supports' | 'opposes' }

export interface Organization {
  id: string;
  name: string;
  short_name?: string;
  type?: string;
  description?: string;
  url?: string;
  headquarters?: string;
  founded?: number;
  status?: string;
  pov_alignment?: Partial<Record<Pov, PovStance>>;
  topic_engagement?: TopicEngagement[];
  policy_engagement?: PolicyEngagement[];
  key_figures?: unknown[];
  external_links?: unknown[];
  source_refs?: string[];
  tags?: string[];
  created_at?: string;
  last_modified?: string;
}

export type OrganizationEdgeType =
  | 'ADVOCATES_FOR' | 'OPPOSES' | 'SUPPORTS_POLICY' | 'OPPOSES_POLICY'
  | 'ENGAGED_WITH' | 'PUBLISHED' | 'ALLIED_WITH' | 'COMPETES_WITH' | 'FUNDS';

export interface OrganizationEdge {
  source: string;
  target: string;
  type: OrganizationEdgeType;
  rationale?: string;
  source_refs?: string[];
  status?: string;
  discovered_at?: string;
}
