// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * DOLCE genus-differentia compliance checker.
 * 7 rules ported from research/comp-linguist/audit_dolce_compliance.py.
 * Pure function — no external dependencies, no side effects.
 */

export interface ComplianceViolation {
  rule: 'GENUS' | 'ENCOMPASSES' | 'EXCLUDES' | 'FORBIDDEN' | 'CAUSAL' | 'MULTI_CONCEPT' | 'EDITORIAL' | 'MISSING';
  severity: 'error' | 'warning';
  message: string;
}

// ── Patterns ────────────────────────────────────────────

const GENUS_RE = /^an?\s+(belief|desire|intention|situation)\s+within\s+/i;
const SITUATION_GENUS_RE = /^a\s+situation\s+(within|that|concept|in|where)\s+/i;
const CAUSAL_CONNECTORS_RE = /\b(rendering|thereby|thus|therefore|which means|contingent on|hence)\b/gi;
const FORBIDDEN_SECTIONS_RE = /^(Qualified by|Note|However|Additionally|Furthermore|Moreover)\s*:/gim;
const EDITORIAL_IN_EXCLUDES_RE = /that\s+(functions? as|serves? as|acts? as|is essentially|amounts? to|which means)/gi;

// ── Helpers ─────────────────────────────────────────────

function countItems(content: string): number {
  const stripped = content.trim().replace(/\.$/, '');
  const items = stripped.split(',').map(s => s.trim()).filter(Boolean);
  if (items.length > 0 && items[items.length - 1].includes(' and ')) {
    const lastParts = items[items.length - 1].split(' and ').map(s => s.trim()).filter(Boolean);
    return items.length - 1 + lastParts.length;
  }
  return items.length;
}

function getDifferentia(desc: string): string {
  const firstLine = desc.split('\n')[0] ?? '';
  return firstLine.includes('Encompasses:') ? firstLine.split('Encompasses:')[0] : firstLine;
}

function isSituationNode(nodeId: string): boolean {
  return nodeId.startsWith('sit-') || nodeId.startsWith('cc-');
}

// ── Rule checks ─────────────────────────────────────────

function checkGenus(desc: string, nodeId: string): ComplianceViolation[] {
  if (!desc) return [{ rule: 'MISSING', severity: 'error', message: 'No description' }];
  const firstLine = desc.split('\n')[0].trim();
  if (isSituationNode(nodeId)) {
    if (!SITUATION_GENUS_RE.test(firstLine) && !GENUS_RE.test(firstLine)) {
      return [{ rule: 'GENUS', severity: 'error', message: `Doesn't start with 'A situation...' or 'A(n) [B/D/I] within...' — starts with: "${firstLine.slice(0, 60)}"` }];
    }
  } else {
    if (!GENUS_RE.test(firstLine)) {
      return [{ rule: 'GENUS', severity: 'error', message: `Doesn't start with 'A(n) [Belief|Desire|Intention] within...' — starts with: "${firstLine.slice(0, 60)}"` }];
    }
  }
  return [];
}

function checkEncompasses(desc: string): ComplianceViolation[] {
  if (!/encompasses:/i.test(desc)) {
    return [{ rule: 'ENCOMPASSES', severity: 'error', message: 'Clause missing' }];
  }
  const match = desc.match(/Encompasses:\s*(.+?)(?:\n|Excludes:|$)/is);
  if (!match) {
    return [{ rule: 'ENCOMPASSES', severity: 'warning', message: 'Clause found but couldn\'t parse content' }];
  }
  const count = countItems(match[1]);
  if (count < 2) return [{ rule: 'ENCOMPASSES', severity: 'warning', message: `Only ${count} item(s) — need 2-5` }];
  if (count > 6) return [{ rule: 'ENCOMPASSES', severity: 'warning', message: `${count} items — should be 2-5 (may be too broad)` }];
  return [];
}

function checkExcludes(desc: string): ComplianceViolation[] {
  if (!/excludes:/i.test(desc)) {
    return [{ rule: 'EXCLUDES', severity: 'error', message: 'Clause missing' }];
  }
  const match = desc.match(/Excludes:\s*(.+?)$/is);
  if (!match) {
    return [{ rule: 'EXCLUDES', severity: 'warning', message: 'Clause found but couldn\'t parse content' }];
  }
  const count = countItems(match[1]);
  if (count < 1) return [{ rule: 'EXCLUDES', severity: 'warning', message: 'No items found' }];
  if (count > 4) return [{ rule: 'EXCLUDES', severity: 'warning', message: `${count} items — should be 1-3` }];
  return [];
}

function checkForbiddenSections(desc: string): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];
  let m: RegExpExecArray | null;
  FORBIDDEN_SECTIONS_RE.lastIndex = 0;
  while ((m = FORBIDDEN_SECTIONS_RE.exec(desc)) !== null) {
    violations.push({ rule: 'FORBIDDEN', severity: 'error', message: `'${m[1]}:' found — content belongs in assumes field or separate node` });
  }
  return violations;
}

function checkCausalConnectors(desc: string): ComplianceViolation[] {
  const differentia = getDifferentia(desc);
  const violations: ComplianceViolation[] = [];
  let m: RegExpExecArray | null;
  CAUSAL_CONNECTORS_RE.lastIndex = 0;
  while ((m = CAUSAL_CONNECTORS_RE.exec(differentia)) !== null) {
    violations.push({ rule: 'CAUSAL', severity: 'warning', message: `'${m[0]}' in differentia — state what the position IS, not why it's correct` });
  }
  return violations;
}

function checkSingleConcept(desc: string): ComplianceViolation[] {
  const differentia = getDifferentia(desc);
  const violations: ComplianceViolation[] = [];

  if (differentia.includes(';')) {
    violations.push({ rule: 'MULTI_CONCEPT', severity: 'warning', message: 'Semicolon in differentia suggests multiple concepts packed together' });
  }

  const thatCount = (differentia.toLowerCase().match(/ that /g) ?? []).length;
  if (thatCount > 2) {
    violations.push({ rule: 'MULTI_CONCEPT', severity: 'warning', message: `${thatCount} 'that' clauses in differentia — may be overloaded` });
  }

  if (differentia.length > 300) {
    violations.push({ rule: 'MULTI_CONCEPT', severity: 'warning', message: `Differentia is ${differentia.length} chars — consider simplifying` });
  }

  return violations;
}

function checkExcludesEditorial(desc: string): ComplianceViolation[] {
  const match = desc.match(/Excludes:\s*(.+?)$/is);
  if (!match) return [];
  const violations: ComplianceViolation[] = [];
  let m: RegExpExecArray | null;
  EDITORIAL_IN_EXCLUDES_RE.lastIndex = 0;
  while ((m = EDITORIAL_IN_EXCLUDES_RE.exec(match[1])) !== null) {
    violations.push({ rule: 'EDITORIAL', severity: 'warning', message: `'${m[1]}' — name the excluded concept neutrally, don't argue why it's excluded` });
  }
  return violations;
}

// ── Public API ──────────────────────────────────────────

export function checkDolceCompliance(description: string, nodeId: string): ComplianceViolation[] {
  if (!description) return [{ rule: 'MISSING', severity: 'error', message: 'No description' }];

  return [
    ...checkGenus(description, nodeId),
    ...checkEncompasses(description),
    ...checkExcludes(description),
    ...checkForbiddenSections(description),
    ...checkCausalConnectors(description),
    ...checkSingleConcept(description),
    ...checkExcludesEditorial(description),
  ];
}
