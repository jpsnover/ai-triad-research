// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Zod validation schemas for taxonomy and debate data structures.
 * Enforces ontological compliance on new data — prevents violations
 * without migrating existing data.
 */

import { z } from 'zod';

// ── Shared enums ──────────────────────────────────────────

export const CategorySchema = z.enum(['Beliefs', 'Desires', 'Intentions']);

export const PovSchema = z.enum(['accelerationist', 'safetyist', 'skeptic']);

export const BdiLayerSchema = z.enum(['belief', 'desire', 'intention']);

export const NodeScopeSchema = z.enum(['claim', 'scheme', 'bridging']);

export const FallacyTierSchema = z.enum([
  'formal', 'informal_structural', 'informal_contextual', 'cognitive_bias',
]);

export const DialecticalSchemeSchema = z.enum([
  'CONCEDE', 'DISTINGUISH', 'REFRAME', 'COUNTEREXAMPLE', 'REDUCE', 'ESCALATE',
]);

export const AttackTypeSchema = z.enum(['rebut', 'undercut', 'undermine']);

export const EdgeStatusSchema = z.enum(['proposed', 'approved', 'rejected']);

export const CanonicalEdgeTypeSchema = z.enum([
  'SUPPORTS', 'CONTRADICTS', 'ASSUMES', 'WEAKENS',
  'RESPONDS_TO', 'TENSION_WITH', 'INTERPRETS',
]);

export const ParentRelationshipSchema = z.enum(['is_a', 'part_of', 'specializes']);

export const DisagreementTypeSchema = z.enum(['definitional', 'interpretive', 'structural']);

// ── Genus-differentia description patterns ────────────────

/** POV node descriptions must follow: "A [Category] within [POV] discourse that [differentia]..." */
const povDescriptionPattern = /^A\s+(Desires|Beliefs|Intentions)\s+within\s+(accelerationist|safetyist|skeptic)\s+discourse\s+that\s+/i;

/** Situation node descriptions must follow: "A situation that [differentia]..." */
const situationDescriptionPattern = /^A\s+situation\s+that\s+/i;

// ── Graph attributes ──────────────────────────────────────

export const PossibleFallacySchema = z.object({
  fallacy: z.string().min(1),
  type: FallacyTierSchema.optional(),
  confidence: z.enum(['likely', 'possible', 'borderline']),
  explanation: z.string().min(1),
});

export const SteelmanVulnerabilitySchema = z.union([
  z.string(),
  z.object({
    from_accelerationist: z.string().optional(),
    from_safetyist: z.string().optional(),
    from_skeptic: z.string().optional(),
  }),
]);

export const GraphAttributesSchema = z.object({
  epistemic_type: z.string().optional(),
  rhetorical_strategy: z.string().optional(),
  assumes: z.array(z.string()).optional(),
  falsifiability: z.string().optional(),
  audience: z.string().optional(),
  emotional_register: z.string().optional(),
  policy_actions: z.array(z.object({
    policy_id: z.string().optional(),
    action: z.string(),
    framing: z.string(),
  })).optional(),
  intellectual_lineage: z.array(z.string()).optional(),
  steelman_vulnerability: SteelmanVulnerabilitySchema.optional(),
  possible_fallacies: z.array(PossibleFallacySchema).optional(),
  node_scope: NodeScopeSchema.optional(),
}).strict();

// ── Taxonomy node schemas ─────────────────────────────────

export const PovNodeSchema = z.object({
  id: z.string().min(1),
  category: CategorySchema,
  label: z.string().min(1),
  description: z.string().regex(povDescriptionPattern, 'Must follow genus-differentia pattern: "A [Category] within [POV] discourse that..."'),
  parent_id: z.string().nullable(),
  parent_relationship: ParentRelationshipSchema.nullable().optional(),
  parent_rationale: z.string().nullable().optional(),
  children: z.array(z.string()),
  situation_refs: z.array(z.string()),
  conflict_ids: z.array(z.string()).optional(),
  graph_attributes: GraphAttributesSchema.optional(),
  debate_refs: z.array(z.string()).optional(),
});

export const SituationNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().regex(situationDescriptionPattern, 'Must follow genus-differentia pattern: "A situation that..."'),
  interpretations: z.object({
    accelerationist: z.string(),
    safetyist: z.string(),
    skeptic: z.string(),
  }),
  linked_nodes: z.array(z.string()),
  conflict_ids: z.array(z.string()),
  graph_attributes: GraphAttributesSchema.optional(),
  disagreement_type: DisagreementTypeSchema.optional(),
  debate_refs: z.array(z.string()).optional(),
});

// ── Edge schemas ──────────────────────────────────────────

export const EdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.string().min(1), // Accept canonical + legacy
  bidirectional: z.boolean(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  status: EdgeStatusSchema,
  discovered_at: z.string(),
  model: z.string(),
  strength: z.enum(['strong', 'moderate', 'weak']).optional(),
  notes: z.string().optional(),
});

export const EdgesFileSchema = z.object({
  _schema_version: z.string(),
  _doc: z.string(),
  last_modified: z.string(),
  edge_types: z.array(z.object({
    type: z.string().min(1),
    bidirectional: z.boolean(),
    definition: z.string(),
    llm_proposed: z.boolean().optional(),
  })),
  edges: z.array(EdgeSchema),
  discovery_log: z.array(z.unknown()).optional(),
});

// ── Argument map schemas ──────────────────────────────────

export const ArgumentAttackSchema = z.object({
  claim_id: z.string().min(1),
  claim: z.string().min(1),
  claimant: z.string().min(1),
  attack_type: AttackTypeSchema,
  scheme: DialecticalSchemeSchema.optional(),
});

export const SupportLinkSchema = z.object({
  claim_id: z.string().min(1),
  scheme: DialecticalSchemeSchema.optional(),
  warrant: z.string().optional(),
  critical_questions: z.array(z.object({
    question: z.string(),
    addressed: z.boolean(),
  })).optional(),
});

export const ArgumentClaimSchema = z.object({
  claim_id: z.string().min(1),
  claim: z.string().min(1),
  claimant: z.string().min(1),
  type: z.enum(['empirical', 'normative', 'definitional']).optional(),
  supported_by: z.array(z.union([z.string(), SupportLinkSchema])).optional(),
  attacked_by: z.array(ArgumentAttackSchema).optional(),
});

// ── Synthesis schemas ─────────────────────────────────────

export const SynthesisDisagreementSchema = z.object({
  point: z.string(),
  positions: z.array(z.object({
    pover: z.string(),
    stance: z.string(),
  })),
  bdi_layer: BdiLayerSchema.optional(),
  resolvability: z.enum([
    'resolvable_by_evidence',
    'negotiable_via_tradeoffs',
    'requires_term_clarification',
  ]).optional(),
});
