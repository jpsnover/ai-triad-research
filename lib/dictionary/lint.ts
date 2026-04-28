import type { LintViolation, LintOptions, StandardizedTerm, ColloquialTerm } from './types';
import type { DictionaryLoader } from './loader';
import { parseQuotationMarkers, isInsideQuotation } from './quotation';
import { renderDisplay, reverseRender, buildReverseMap } from './render';

const BOUNDARY_RE = /[\s.,;:!?()\[\]{}"'`<>\/\\]/;

function isBoundaryChar(ch: string | undefined): boolean {
  if (ch === undefined) return true;
  return BOUNDARY_RE.test(ch);
}

/**
 * Lint the dictionary for internal consistency.
 *
 * Constraint 1: Every standardized term has unique canonical_form and display_form.
 * Constraint 2: Every node ID in used_by_nodes exists in the taxonomy.
 * Constraint 3: Every standardized term referenced by resolves_to exists.
 * Constraint 4: No text contains bare do_not_use_bare colloquial terms outside quotation/code.
 * Constraint 5: (Persona prompts) — checked via lintText.
 * Constraint 6: (Synthesis outputs) — checked via lintText.
 * Constraint 7: Every accepted standardized term has a coinage_log_ref.
 * Constraint 8: Schema version in entries matches current version.
 * Constraint 9: Round-trip rendering produces identical output.
 * Constraint 10: All quotation markers are well-formed.
 */
export function lintDictionary(
  loader: DictionaryLoader,
  taxonomyNodeIds?: Set<string>,
  options?: LintOptions,
): LintViolation[] {
  const constraints = options?.constraints ?? [1, 2, 3, 7, 8, 9, 10];
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
  if (constraints.includes(7)) {
    violations.push(...checkConstraint7(standardized));
  }
  if (constraints.includes(8)) {
    violations.push(...checkConstraint8(standardized, colloquial, loader));
  }

  return violations;
}

/**
 * Lint text for bare colloquial terms (constraint 4).
 * Used for node fields, persona prompts, synthesis outputs.
 */
export function lintText(
  text: string,
  loader: DictionaryLoader,
  options?: LintOptions & { file?: string; fieldName?: string },
): LintViolation[] {
  const constraints = options?.constraints ?? [4, 10];
  const violations: LintViolation[] = [];

  if (constraints.includes(4)) {
    violations.push(...checkConstraint4(text, loader, options?.file, options?.fieldName));
  }
  if (constraints.includes(9)) {
    violations.push(...checkConstraint9(text, loader, options?.file));
  }
  if (constraints.includes(10)) {
    violations.push(...checkConstraint10(text, options?.file));
  }

  return violations;
}

/**
 * Lint a set of taxonomy node objects for constraint 4.
 * @param options.skipFields — field names to exclude from linting (e.g. ['label'] for titles).
 */
export function lintNodes(
  nodes: Array<{ id: string; label?: string; description?: string; graph_attributes?: { characteristic_language?: string[] } }>,
  loader: DictionaryLoader,
  options?: LintOptions & { skipFields?: string[] },
): LintViolation[] {
  const violations: LintViolation[] = [];
  const skip = new Set(options?.skipFields ?? []);
  for (const node of nodes) {
    const fields: Array<[string, string]> = [];
    if (node.label && !skip.has('label')) fields.push(['label', node.label]);
    if (node.description && !skip.has('description')) fields.push(['description', node.description]);
    if (node.graph_attributes?.characteristic_language && !skip.has('characteristic_language')) {
      for (const phrase of node.graph_attributes.characteristic_language) {
        fields.push(['characteristic_language', phrase]);
      }
    }

    for (const [fieldName, text] of fields) {
      const textViolations = lintText(text, loader, {
        ...options,
        file: node.id,
        fieldName,
        constraints: [4],
      });
      violations.push(...textViolations);
    }
  }
  return violations;
}

// ── Constraint implementations ──────────────────────────

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

function buildDisplayFormContext(loader: DictionaryLoader): {
  prefixes: Map<string, string[]>;
  qualifiers: Map<string, string[]>;
} {
  const prefixes = new Map<string, string[]>();
  const qualifiers = new Map<string, string[]>();
  const displayMap = loader.getDisplayFormMap();
  for (const displayForm of displayMap.values()) {
    const lower = displayForm.toLowerCase();
    const parenIdx = lower.indexOf(' (');
    if (parenIdx === -1) continue;
    const prefix = lower.slice(0, parenIdx);
    const closeIdx = lower.indexOf(')', parenIdx);
    if (closeIdx === -1) continue;
    const qualifier = lower.slice(parenIdx + 2, closeIdx);

    const existingPfx = prefixes.get(prefix) ?? [];
    existingPfx.push(lower);
    prefixes.set(prefix, existingPfx);

    const existingQual = qualifiers.get(prefix) ?? [];
    existingQual.push(qualifier);
    qualifiers.set(prefix, existingQual);
  }
  return { prefixes, qualifiers };
}

function checkConstraint4(
  text: string,
  loader: DictionaryLoader,
  file?: string,
  fieldName?: string,
): LintViolation[] {
  const violations: LintViolation[] = [];
  const colloquials = loader.listColloquial({ status: 'do_not_use_bare' });
  if (colloquials.length === 0) return violations;

  const { spans: quotationSpans } = parseQuotationMarkers(text);
  const codeBlockRanges = findCodeBlockRanges(text);
  const inlineCodeRanges = findInlineCodeRanges(text);
  const textLower = text.toLowerCase();
  const { prefixes: displayPrefixes, qualifiers: displayQualifiers } = buildDisplayFormContext(loader);

  // Pre-scan for display form ranges — bare terms inside display forms are not violations
  const displayFormRanges: Array<[number, number]> = [];
  const displayMap = loader.getDisplayFormMap();
  for (const displayForm of displayMap.values()) {
    const lower = displayForm.toLowerCase();
    let pos = 0;
    while (pos < textLower.length) {
      const found = textLower.indexOf(lower, pos);
      if (found === -1) break;
      displayFormRanges.push([found, found + lower.length]);
      pos = found + 1;
    }
  }

  for (const term of colloquials) {
    const needle = term.colloquial_term.toLowerCase();
    let searchFrom = 0;

    while (searchFrom < textLower.length) {
      const idx = textLower.indexOf(needle, searchFrom);
      if (idx === -1) break;
      searchFrom = idx + 1;

      const prevChar = idx > 0 ? text[idx - 1] : undefined;
      const afterIdx = idx + needle.length;
      const afterChar = afterIdx < text.length ? text[afterIdx] : undefined;

      if (!isBoundaryChar(prevChar) || !isBoundaryChar(afterChar)) continue;
      if (isInsideQuotation(idx, quotationSpans)) continue;
      if (isInsideRange(idx, codeBlockRanges)) continue;
      if (isInsideRange(idx, inlineCodeRanges)) continue;
      if (isInsideRange(idx, displayFormRanges)) continue;

      // Skip if this bare term is part of a known display form like "capabilities (scaling)"
      const knownForms = displayPrefixes.get(needle);
      if (knownForms) {
        const textAtIdx = textLower.slice(idx);
        if (knownForms.some(form => textAtIdx.startsWith(form))) continue;
      }

      // Skip if a display-form qualifier appears within 50 chars (handles "existential risk")
      const knownQualifiers = displayQualifiers.get(needle);
      if (knownQualifiers) {
        const windowStart = Math.max(0, idx - 50);
        const windowEnd = Math.min(textLower.length, afterIdx + 50);
        const window = textLower.slice(windowStart, windowEnd);
        if (knownQualifiers.some(q => window.includes(q))) continue;
      }

      const resolvesTo = term.resolves_to.map(r => r.standardized_term).join(', ');
      const ctx = text.slice(Math.max(0, idx - 30), Math.min(text.length, afterIdx + 30)).replace(/\n/g, ' ');
      const location = fieldName ? `${file ?? ''}:${fieldName}` : file;

      violations.push({
        constraint_id: 4,
        severity: 'warning',
        file: location,
        message: `Bare colloquial term '${term.colloquial_term}' at offset ${idx}. Resolves to: ${resolvesTo}. Context: "...${ctx}..."`,
        violation_text: term.colloquial_term,
        suggested_fix: `Replace with the appropriate standardized term (${resolvesTo}) or wrap in <q canonical-bypass>...</q>`,
      });
    }
  }

  return violations;
}

function checkConstraint7(terms: StandardizedTerm[]): LintViolation[] {
  const violations: LintViolation[] = [];
  for (const term of terms) {
    if (term.coinage_status === 'accepted' && !term.coinage_log_ref) {
      violations.push({
        constraint_id: 7,
        severity: 'error',
        file: `standardized/${term.canonical_form}.json`,
        message: `Accepted term '${term.canonical_form}' has no coinage_log_ref`,
        violation_text: term.canonical_form,
        suggested_fix: 'Add a coinage_log_ref pointing to the coinage log entry',
      });
    }
    if (term.coinage_log_ref && !/^log-entry-\d+$/.test(term.coinage_log_ref)) {
      violations.push({
        constraint_id: 7,
        severity: 'error',
        file: `standardized/${term.canonical_form}.json`,
        message: `coinage_log_ref '${term.coinage_log_ref}' does not match expected format 'log-entry-NNN'`,
        violation_text: term.coinage_log_ref,
      });
    }
  }
  return violations;
}

function checkConstraint8(
  standardized: StandardizedTerm[],
  colloquial: ColloquialTerm[],
  loader: DictionaryLoader,
): LintViolation[] {
  const violations: LintViolation[] = [];
  const version = loader.getVersion().schema_version;

  for (const term of standardized) {
    if (term.$schema_version !== version) {
      violations.push({
        constraint_id: 8,
        severity: 'error',
        file: `standardized/${term.canonical_form}.json`,
        message: `Schema version '${term.$schema_version}' does not match current '${version}'`,
        violation_text: term.$schema_version,
        suggested_fix: 'Run the migration script to update entries',
      });
    }
  }

  for (const term of colloquial) {
    if (term.$schema_version !== version) {
      violations.push({
        constraint_id: 8,
        severity: 'error',
        file: `colloquial/${term.colloquial_term}.json`,
        message: `Schema version '${term.$schema_version}' does not match current '${version}'`,
        violation_text: term.$schema_version,
        suggested_fix: 'Run the migration script to update entries',
      });
    }
  }

  return violations;
}

function checkConstraint9(
  text: string,
  loader: DictionaryLoader,
  file?: string,
): LintViolation[] {
  const displayMap = loader.getDisplayFormMap();
  if (displayMap.size === 0) return [];

  const rendered = renderDisplay(text, displayMap);
  const reverseMap = buildReverseMap(displayMap);
  const roundTripped = reverseRender(rendered.rendered, reverseMap);

  if (roundTripped.rendered !== text) {
    return [{
      constraint_id: 9,
      severity: 'error',
      file,
      message: 'Round-trip rendering (render → reverse) does not reproduce original text',
      violation_text: roundTripped.rendered.slice(0, 200),
    }];
  }

  return [];
}

function checkConstraint10(text: string, file?: string): LintViolation[] {
  const { errors } = parseQuotationMarkers(text);
  return errors.map(err => ({
    constraint_id: 10,
    severity: 'error',
    file,
    message: `Malformed quotation marker at offset ${err.offset}: ${err.message}`,
    violation_text: text.slice(err.offset, err.offset + 40),
  }));
}

// ── Helpers ─────────────────────────────────────────────

function findCodeBlockRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const fence = /```/g;
  let match: RegExpExecArray | null;
  let openPos: number | null = null;

  while ((match = fence.exec(text)) !== null) {
    if (openPos === null) {
      openPos = match.index;
    } else {
      ranges.push([openPos, match.index + 3]);
      openPos = null;
    }
  }
  return ranges;
}

function findInlineCodeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('```', i)) {
      i += 3;
      const end = text.indexOf('```', i);
      i = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text[i] === '`') {
      const start = i;
      i++;
      while (i < text.length && text[i] !== '`') i++;
      if (i < text.length) {
        ranges.push([start, i + 1]);
        i++;
      }
      continue;
    }
    i++;
  }
  return ranges;
}

function isInsideRange(offset: number, ranges: Array<[number, number]>): boolean {
  for (const [start, end] of ranges) {
    if (offset >= start && offset < end) return true;
  }
  return false;
}
