import { z } from 'zod';

const categoryEnum = z.enum(['Goals/Values', 'Data/Facts', 'Methods']);

const povNodeSchema = z.object({
  id: z.string().min(1, 'ID is required'),
  category: categoryEnum,
  label: z.string().min(1, 'Label is required'),
  description: z.string().min(1, 'Description is required'),
  parent_id: z.string().nullable(),
  children: z.array(z.string()),
  cross_cutting_refs: z.array(z.string()),
  conflict_ids: z.array(z.string()).optional(),
});

export const povTaxonomyFileSchema = z.object({
  _schema_version: z.string(),
  _doc: z.string(),
  pov: z.enum(['accelerationist', 'safetyist', 'skeptic']),
  color_hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  last_modified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nodes: z.array(povNodeSchema),
});

const crossCuttingNodeSchema = z.object({
  id: z.string().min(1, 'ID is required'),
  label: z.string().min(1, 'Label is required'),
  description: z.string().min(1, 'Description is required'),
  interpretations: z.object({
    accelerationist: z.string().min(1, 'Accelerationist interpretation is required'),
    safetyist: z.string().min(1, 'Safetyist interpretation is required'),
    skeptic: z.string().min(1, 'Skeptic interpretation is required'),
  }),
  linked_nodes: z.array(z.string()),
  conflict_ids: z.array(z.string()),
});

export const crossCuttingFileSchema = z.object({
  _schema_version: z.string(),
  _doc: z.string(),
  last_modified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nodes: z.array(crossCuttingNodeSchema),
});

const conflictInstanceSchema = z.object({
  doc_id: z.string().min(1, 'Document ID is required'),
  position: z.string().min(1, 'Position is required'),
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

export function extractZodErrors(error: z.ZodError): ValidationErrors {
  const errors: ValidationErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    errors[path] = issue.message;
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
    errors[parts.join('.')] = issue.message;
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
    errors[`${claimId}.${path}`] = issue.message;
  }
  return errors;
}
