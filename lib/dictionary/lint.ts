import type { LintViolation, LintOptions, StandardizedTerm, ColloquialTerm } from './types';
import type { DictionaryLoader } from './loader';

/**
 * Lint the dictionary for internal consistency.
 * Phase 1 enforces constraints 1-3 only.
 *
 * Constraint 1: Every standardized term has unique canonical_form and display_form.
 * Constraint 2: Every node ID in used_by_nodes exists in the taxonomy.
 * Constraint 3: Every standardized term referenced by resolves_to exists.
 */
export function lintDictionary(
  loader: DictionaryLoader,
  taxonomyNodeIds?: Set<string>,
  options?: LintOptions,
): LintViolation[] {
  const constraints = options?.constraints ?? [1, 2, 3];
  const violations: LintViolation[] = [];

  const standardized = loader.listStandardized();
  const colloquial = loader.listColloquial();

  if (constraints.includes(1)) {
    violations.push(...checkConstraint1(standardized));
  }
  if (constraints.includes(2)) {
    violations.push(...checkConstraint2(standardized, taxonomyNodeIds));
  }
  if (constraints.includes(3)) {
    violations.push(...checkConstraint3(colloquial, standardized));
  }

  return violations;
}

function checkConstraint1(terms: StandardizedTerm[]): LintViolation[] {
  const violations: LintViolation[] = [];

  const canonicalSeen = new Map<string, string>();
  const displaySeen = new Map<string, string>();

  for (const term of terms) {
    const existing = canonicalSeen.get(term.canonical_form);
    if (existing) {
      violations.push({
        constraint_id: 1,
        severity: 'error',
        file: `standardized/${term.canonical_form}.json`,
        message: `Duplicate canonical_form '${term.canonical_form}' — also defined in ${existing}`,
        violation_text: term.canonical_form,
      });
    } else {
      canonicalSeen.set(term.canonical_form, `standardized/${term.canonical_form}.json`);
    }

    const existingDisplay = displaySeen.get(term.display_form);
    if (existingDisplay) {
      violations.push({
        constraint_id: 1,
        severity: 'error',
        file: `standardized/${term.canonical_form}.json`,
        message: `Duplicate display_form '${term.display_form}' — also defined in ${existingDisplay}`,
        violation_text: term.display_form,
      });
    } else {
      displaySeen.set(term.display_form, `standardized/${term.canonical_form}.json`);
    }
  }

  return violations;
}

function checkConstraint2(
  terms: StandardizedTerm[],
  taxonomyNodeIds?: Set<string>,
): LintViolation[] {
  if (!taxonomyNodeIds) return [];
  const violations: LintViolation[] = [];

  for (const term of terms) {
    for (const nodeId of term.used_by_nodes) {
      if (!taxonomyNodeIds.has(nodeId)) {
        violations.push({
          constraint_id: 2,
          severity: 'error',
          file: `standardized/${term.canonical_form}.json`,
          message: `used_by_nodes references non-existent taxonomy node '${nodeId}'`,
          violation_text: nodeId,
          suggested_fix: `Remove '${nodeId}' from used_by_nodes or create the missing node`,
        });
      }
    }
  }

  return violations;
}

function checkConstraint3(
  colloquialTerms: ColloquialTerm[],
  standardizedTerms: StandardizedTerm[],
): LintViolation[] {
  const violations: LintViolation[] = [];
  const canonicalForms = new Set(standardizedTerms.map((t) => t.canonical_form));

  for (const term of colloquialTerms) {
    for (const resolution of term.resolves_to) {
      if (!canonicalForms.has(resolution.standardized_term)) {
        violations.push({
          constraint_id: 3,
          severity: 'error',
          file: `colloquial/${term.colloquial_term}.json`,
          message: `resolves_to references non-existent standardized term '${resolution.standardized_term}'`,
          violation_text: resolution.standardized_term,
          suggested_fix: `Create standardized/${resolution.standardized_term}.json or remove the reference`,
        });
      }
    }
  }

  return violations;
}

export function lintText(
  text: string,
  loader: DictionaryLoader,
  options?: LintOptions,
): LintViolation[] {
  const constraints = options?.constraints ?? [1, 2, 3];
  if (!constraints.includes(4)) return [];

  // Constraint 4 is deferred to Phase 3 — this is a placeholder
  // that will scan for do_not_use_bare colloquial terms in text
  return [];
}
