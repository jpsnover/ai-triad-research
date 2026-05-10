import { describe, it, expect } from 'vitest';
import { checkDolceCompliance, type ComplianceViolation } from './dolceCompliance';

function rules(violations: ComplianceViolation[]): string[] {
  return violations.map(v => v.rule);
}

const COMPLIANT_POV = 'A Belief within safetyist discourse that asserts AI systems pose existential risk. Encompasses: alignment failure, power-seeking behavior, deceptive alignment. Excludes: narrow tool-use errors, user interface bugs.';
const COMPLIANT_SITUATION = 'A situation where governance frameworks lag behind technological deployment. Encompasses: regulatory capture, institutional inertia. Excludes: deliberate non-regulation.';

describe('checkDolceCompliance', () => {
  it('returns empty for compliant POV node', () => {
    expect(checkDolceCompliance(COMPLIANT_POV, 'saf-beliefs-001')).toEqual([]);
  });

  it('returns empty for compliant situation node', () => {
    expect(checkDolceCompliance(COMPLIANT_SITUATION, 'cc-001')).toEqual([]);
  });

  it('returns MISSING for empty description', () => {
    const v = checkDolceCompliance('', 'saf-beliefs-001');
    expect(rules(v)).toContain('MISSING');
  });

  // Rule 1: Genus
  it('flags missing genus for POV node', () => {
    const v = checkDolceCompliance('A governance framework that combines institutions. Encompasses: x, y. Excludes: z.', 'saf-beliefs-001');
    expect(rules(v)).toContain('GENUS');
  });

  it('accepts "An Intention" (article agreement)', () => {
    const v = checkDolceCompliance('An Intention within skeptic discourse that advocates caution. Encompasses: a, b. Excludes: c.', 'skp-intentions-001');
    expect(rules(v)).not.toContain('GENUS');
  });

  it('accepts "A situation where" for cc- nodes', () => {
    const v = checkDolceCompliance('A situation where regulators face information asymmetry. Encompasses: x, y. Excludes: z.', 'cc-040');
    expect(rules(v)).not.toContain('GENUS');
  });

  it('flags wrong genus for situation node', () => {
    const v = checkDolceCompliance('A critique of regulatory optimism. Encompasses: x, y. Excludes: z.', 'cc-051');
    expect(rules(v)).toContain('GENUS');
  });

  // Rule 2: Encompasses
  it('flags missing encompasses', () => {
    const v = checkDolceCompliance('A Belief within safetyist discourse that AI is risky. Excludes: minor bugs.', 'saf-beliefs-001');
    expect(rules(v)).toContain('ENCOMPASSES');
  });

  it('flags too few encompasses items', () => {
    const v = checkDolceCompliance('A Belief within safetyist discourse that AI is risky. Encompasses: alignment failure. Excludes: bugs.', 'saf-beliefs-001');
    expect(rules(v)).toContain('ENCOMPASSES');
  });

  it('flags too many encompasses items', () => {
    const v = checkDolceCompliance('A Belief within safetyist discourse that AI is risky. Encompasses: a, b, c, d, e, f, g, h. Excludes: z.', 'saf-beliefs-001');
    expect(rules(v)).toContain('ENCOMPASSES');
  });

  // Rule 3: Excludes
  it('flags missing excludes', () => {
    const v = checkDolceCompliance('A Belief within safetyist discourse that AI is risky. Encompasses: x, y.', 'saf-beliefs-001');
    expect(rules(v)).toContain('EXCLUDES');
  });

  it('flags too many excludes items', () => {
    const v = checkDolceCompliance('A Belief within safetyist discourse that AI is risky. Encompasses: x, y. Excludes: a, b, c, d, e, f.', 'saf-beliefs-001');
    expect(rules(v)).toContain('EXCLUDES');
  });

  // Rule 4: Forbidden sections
  it('flags forbidden sections', () => {
    const v = checkDolceCompliance('A Belief within safetyist discourse that AI is risky. Encompasses: x, y. Excludes: z.\nQualified by: some caveat', 'saf-beliefs-001');
    expect(rules(v)).toContain('FORBIDDEN');
  });

  // Rule 5: Causal connectors
  it('flags causal connectors in differentia', () => {
    const v = checkDolceCompliance('A Belief within safetyist discourse that AI advances thereby create risk. Encompasses: x, y. Excludes: z.', 'saf-beliefs-001');
    expect(rules(v)).toContain('CAUSAL');
  });

  it('does not flag causal connectors after Encompasses', () => {
    const v = checkDolceCompliance('A Belief within safetyist discourse that AI is risky. Encompasses: things that thereby cause harm, other risks. Excludes: z.', 'saf-beliefs-001');
    expect(rules(v)).not.toContain('CAUSAL');
  });

  // Rule 6: Multi-concept
  it('flags semicolons in differentia', () => {
    const v = checkDolceCompliance('A Belief within safetyist discourse that AI is risky; models may deceive. Encompasses: x, y. Excludes: z.', 'saf-beliefs-001');
    expect(rules(v)).toContain('MULTI_CONCEPT');
  });

  it('flags overloaded differentia (>300 chars)', () => {
    const longDiff = 'A Belief within safetyist discourse that ' + 'a'.repeat(280) + '. Encompasses: x, y. Excludes: z.';
    const v = checkDolceCompliance(longDiff, 'saf-beliefs-001');
    expect(rules(v)).toContain('MULTI_CONCEPT');
  });

  // Rule 7: Editorial in excludes
  it('flags editorial language in excludes', () => {
    const v = checkDolceCompliance('A Belief within safetyist discourse that AI is risky. Encompasses: x, y. Excludes: approaches that functions as safety theater.', 'saf-beliefs-001');
    expect(rules(v)).toContain('EDITORIAL');
  });

  it('does not flag clean excludes', () => {
    const v = checkDolceCompliance(COMPLIANT_POV, 'saf-beliefs-001');
    expect(rules(v)).not.toContain('EDITORIAL');
  });

  // Severity checks
  it('assigns error severity to GENUS violations', () => {
    const v = checkDolceCompliance('Bad description. Encompasses: x, y. Excludes: z.', 'saf-beliefs-001');
    const genus = v.find(x => x.rule === 'GENUS');
    expect(genus?.severity).toBe('error');
  });

  it('assigns warning severity to CAUSAL violations', () => {
    const v = checkDolceCompliance('A Belief within safetyist discourse that thereby causes harm. Encompasses: x, y. Excludes: z.', 'saf-beliefs-001');
    const causal = v.find(x => x.rule === 'CAUSAL');
    expect(causal?.severity).toBe('warning');
  });
});
