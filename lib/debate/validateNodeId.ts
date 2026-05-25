// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Node ID validation for taxonomy writes.
 *
 * POV node IDs must follow `{pov}-{category}-{NNN}` where:
 *   pov      = acc | saf | skp
 *   category = beliefs | desires | intentions
 *   NNN      = 3+ digit zero-padded number
 *
 * Other node types:
 *   sit-{NNN}  — Situation nodes
 *   cc-{NNN}   — Cross-cutting nodes (legacy)
 *   pol-{NNN}  — Policy action nodes
 */

import type { Category } from './taxonomyTypes.js';

// ── Constants ───────────────────────────────────────────

const VALID_POVS = new Set(['acc', 'saf', 'skp']);
const VALID_CATEGORIES = new Set(['beliefs', 'desires', 'intentions']);

/** Category segment in node ID → canonical Category type. */
const CATEGORY_ID_TO_TYPE: Record<string, Category> = {
  beliefs: 'Beliefs',
  desires: 'Desires',
  intentions: 'Intentions',
};

/** Canonical Category type → expected ID segment. */
const CATEGORY_TYPE_TO_ID: Record<string, string> = {
  Beliefs: 'beliefs',
  Desires: 'desires',
  Intentions: 'intentions',
};

// ── Regex patterns ──────────────────────────────────────

/** POV node: acc-beliefs-001, saf-desires-012, skp-intentions-100, etc. */
const POV_NODE_RE = /^(acc|saf|skp)-(beliefs|desires|intentions)-(\d{3,})$/;

/** Situation node: sit-001, sit-142, etc. */
const SITUATION_NODE_RE = /^sit-(\d{3,})$/;

/** Cross-cutting node (legacy): cc-001, cc-121, etc. */
const CC_NODE_RE = /^cc-(\d{3,})$/;

/** Policy action node: pol-001, pol-093, etc. */
const POLICY_NODE_RE = /^pol-(\d{3,})$/;

// ── Validation result ───────────────────────────────────

export interface NodeIdValidation {
  valid: boolean;
  /** Present when invalid — human-readable explanation. */
  error?: string;
  /** Parsed POV prefix (acc/saf/skp) — only for POV nodes. */
  pov?: string;
  /** Parsed category from ID — only for POV nodes. */
  idCategory?: Category;
  /** Node type determined from ID format. */
  nodeType?: 'pov' | 'situation' | 'cross-cutting' | 'policy';
}

// ── Validators ──────────────────────────────────────────

/**
 * Validate a node ID format. Does NOT check category consistency —
 * use `validatePovNodeId` for POV nodes where the category must match.
 */
export function validateNodeId(id: string): NodeIdValidation {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: 'Node ID is empty or not a string' };
  }

  const povMatch = POV_NODE_RE.exec(id);
  if (povMatch) {
    return {
      valid: true,
      pov: povMatch[1],
      idCategory: CATEGORY_ID_TO_TYPE[povMatch[2]],
      nodeType: 'pov',
    };
  }

  if (SITUATION_NODE_RE.test(id)) {
    return { valid: true, nodeType: 'situation' };
  }

  if (CC_NODE_RE.test(id)) {
    return { valid: true, nodeType: 'cross-cutting' };
  }

  if (POLICY_NODE_RE.test(id)) {
    return { valid: true, nodeType: 'policy' };
  }

  return {
    valid: false,
    error: `Invalid node ID "${id}". Expected format: {acc|saf|skp}-{beliefs|desires|intentions}-{NNN}, sit-{NNN}, cc-{NNN}, or pol-{NNN}`,
  };
}

/**
 * Validate a POV node ID and ensure its category segment matches the node's actual category.
 * This is the primary guard for taxonomy writes — call it before creating or updating POV nodes.
 *
 * @param id - The node ID to validate
 * @param category - The node's BDI category (Beliefs, Desires, Intentions)
 * @returns Validation result with error message if invalid
 */
export function validatePovNodeId(id: string, category: Category): NodeIdValidation {
  const result = validateNodeId(id);
  if (!result.valid) return result;

  if (result.nodeType !== 'pov') {
    return {
      valid: false,
      error: `Node ID "${id}" is a ${result.nodeType} ID, not a POV node ID. POV nodes must use format: {acc|saf|skp}-{beliefs|desires|intentions}-{NNN}`,
    };
  }

  if (result.idCategory !== category) {
    const expectedSegment = CATEGORY_TYPE_TO_ID[category];
    return {
      valid: false,
      error: `Category mismatch: node ID "${id}" has category "${result.idCategory}" but node.category is "${category}". Expected ID to contain "-${expectedSegment}-"`,
    };
  }

  return result;
}

/**
 * Extract the POV prefix from a node ID. Returns undefined for non-POV nodes.
 */
export function extractPovFromId(id: string): string | undefined {
  const match = POV_NODE_RE.exec(id);
  return match?.[1];
}

/**
 * Extract the BDI category from a POV node ID. Returns undefined for non-POV nodes.
 */
export function extractCategoryFromId(id: string): Category | undefined {
  const match = POV_NODE_RE.exec(id);
  return match ? CATEGORY_ID_TO_TYPE[match[2]] : undefined;
}
