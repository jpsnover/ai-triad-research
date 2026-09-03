// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { z } from 'zod';
import { POV_KEYS } from '@lib/debate/types';
import { logicalFormSchema } from '@lib/entities/logicalForm';

const categoryEnum = z.enum(['Desires', 'Beliefs', 'Intentions']);

// t/3157 forward-grounding link refs — Zod mirror of lib/entities EntityLinkRef/ConceptLinkRef so a
// reflection/node write validates + KEEPS them. The node schema already .passthrough()es unknowns,
// but making these explicit is what G1 gates the forward write on. Inner .passthrough() = fwd-compat.
const entityLinkRefSchema = z.object({
  ref: z.string(),
  surface: z.string(),
  method: z.enum(['exact', 'alias', 'embedding']),
  link_confidence: z.number(),
  match_level: z.enum(['exact', 'instance_of', 'subclass', 'superclass', 'related']),
  status: z.enum(['linked', 'proposed']),
}).passthrough();
const conceptLinkRefSchema = z.object({
  ref: z.string(),
  surface: z.string(),
  method: z.enum(['surface', 'embedding']),
  link_confidence: z.number(),
  status: z.enum(['linked', 'proposed']),
}).passthrough();

const povNodeSchema = z.object({
  id: z.string().regex(/^(acc|saf|skp)-(desires|beliefs|intentions)-\d{3}$/, 'ID must match {pov}-{category}-{NNN}'),
  category: categoryEnum,
  label: z.string().min(1, 'Label is required'),
  description: z.string().min(1, 'Description is required'),
  parent_id: z.string().nullable(),
  parent_relationship: z.enum(['is_a', 'part_of', 'specializes']).nullable().optional(),
  children: z.array(z.string()),
  situation_refs: z.array(z.string().regex(/^sit-\d{3}$/, 'Situation ref must match sit-NNN')),
  conflict_ids: z.array(z.string().regex(/^conflict-[a-z0-9-]+$/, 'Conflict ID must match conflict-{slug}')).optional(),
  confidence: z.number().min(0).max(1).nullish(),
  priority: z.number().int().min(1).max(5).nullish(),
  operationality: z.number().int().min(1).max(5).nullish(),
  entity_refs: z.array(entityLinkRefSchema).optional(),   // t/3157 forward grounding
  concept_refs: z.array(conceptLinkRefSchema).optional(), // t/3157 forward grounding
  // t/3250 (TL G6): the canonical neo-Davidsonian frame, ONE definition shared with the claim path
  // (`@lib/entities/logicalForm`). Replaces silent `.passthrough()` acceptance — defined fields are
  // now strictly validated. A malformed frame is degraded gracefully at load (see
  // stripInvalidLogicalForm), so it never reaches this schema to drop the node.
  logical_form: logicalFormSchema.optional(),
}).passthrough();

export const povTaxonomyFileSchema = z.object({
  _schema_version: z.string(),
  _doc: z.string(),
  pov: z.enum(POV_KEYS),
  color_hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  last_modified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nodes: z.array(povNodeSchema),
});

/**
 * t/3250 graceful-degrade (TL hard condition, t/3250#2): a malformed *proposed* `logical_form`
 * must NOT drop the whole node from the editor. Runs a SEPARATED `logicalFormSchema.safeParse` on
 * the field only; on failure it strips `logical_form` from the node (mutated in place, matching the
 * load-path normalize convention) so the node still loads, and returns the first issue for the
 * caller to WARN (fallback-logging rule — observable, not silent). A node with no `logical_form`,
 * or a valid one, is left untouched. This decouples node loading from frame validation, so one bad
 * proposed frame can never reject the whole `povNode` (blast-radius + the t/3165 anti-silent lesson).
 */
export function stripInvalidLogicalForm(node: Record<string, unknown>): { removed: boolean; issue?: string } {
  const lf = node.logical_form;
  if (lf === undefined || lf === null) return { removed: false };
  const result = logicalFormSchema.safeParse(lf);
  if (result.success) return { removed: false };
  delete node.logical_form;
  const first = result.error.issues[0];
  const issue = first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid logical_form';
  return { removed: true, issue };
}

const bdiInterpretation = z.object({ belief: z.string().optional(), desire: z.string().optional(), intention: z.string().optional(), summary: z.string().optional() });
const interpretationField = z.union([z.string(), bdiInterpretation]);

const situationNodeSchema = z.object({
  id: z.string().min(1, 'ID is required'),
  label: z.string().min(1, 'Label is required'),
  description: z.string().default(''),
  interpretations: z.object({
    accelerationist: interpretationField,
    safetyist: interpretationField,
    skeptic: interpretationField,
  }),
  linked_nodes: z.array(z.string()).default([]),
  conflict_ids: z.array(z.string()).default([]),
  disagreement_type: z.enum(['definitional', 'interpretive', 'structural']).optional(),
});

export const situationsFileSchema = z.object({
  _schema_version: z.string(),
  _doc: z.string(),
  last_modified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nodes: z.array(situationNodeSchema),
});

/** @deprecated Use situationsFileSchema */
export const crossCuttingFileSchema = situationsFileSchema;

const conflictInstanceSchema = z.object({
  doc_id: z.string().min(1, 'Document ID is required'),
  stance: z.enum(['supports', 'disputes', 'neutral', 'qualifies'], { message: 'Stance is required' }),
  assertion: z.string().min(1, 'Assertion is required'),
  date_flagged: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid date is required'),
});

const conflictNoteSchema = z.object({
  author: z.string().min(1, 'Author is required'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid date is required'),
  note: z.string().min(1, 'Note is required'),
});

export const conflictFileSchema = z.object({
  claim_id: z.string().min(1, 'Claim ID is required'),
  claim_label: z.string().min(1, 'Claim label is required'),
  description: z.string().min(1, 'Description is required'),
  status: z.enum(['open', 'resolved', 'wont-fix']),
  linked_taxonomy_nodes: z.array(z.string()),
  instances: z.array(conflictInstanceSchema),
  human_notes: z.array(conflictNoteSchema),
});

export type ValidationErrors = Record<string, string>;

function describeInput(input: unknown): string {
  if (input === null) return 'null';
  if (input === undefined) return 'undefined';
  if (Array.isArray(input)) return 'array';
  return typeof input;
}

function enrichZodMessage(issue: z.ZodIssue): string {
  const msg = issue.message;
  if (issue.code === 'invalid_type' && !msg.includes('expected')) {
    const received = describeInput(issue.input);
    return `${msg} (expected ${issue.expected}, received ${received})`;
  }
  return msg;
}

export function extractZodErrors(error: z.ZodError): ValidationErrors {
  const errors: ValidationErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    errors[path] = enrichZodMessage(issue);
  }
  return errors;
}

/**
 * Extract Zod errors but remap `nodes.{index}.field` to `nodes.{nodeId}.field`
 * so the UI can look up errors by node ID instead of array index.
 */
export function extractPovErrors(
  error: z.ZodError,
  nodes: { id: string }[],
): ValidationErrors {
  const errors: ValidationErrors = {};
  for (const issue of error.issues) {
    const parts = [...issue.path];
    // Remap nodes.INDEX.field → nodes.NODE_ID.field
    if (parts[0] === 'nodes' && typeof parts[1] === 'number' && nodes[parts[1]]) {
      parts[1] = nodes[parts[1]].id;
    }
    errors[parts.join('.')] = enrichZodMessage(issue);
  }
  return errors;
}

/**
 * Extract Zod errors for conflict files, keeping array indices for instances/notes
 * but prefixing with the claim_id so the UI can match.
 */
export function extractConflictErrors(
  error: z.ZodError,
  claimId: string,
): ValidationErrors {
  const errors: ValidationErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    errors[`${claimId}.${path}`] = enrichZodMessage(issue);
  }
  return errors;
}
