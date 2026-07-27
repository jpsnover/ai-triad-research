import { describe, it, expect } from 'vitest';
import {
  computeAffectProfile,
  computeAffectIntensity,
  computeAffectAppropriateness,
  computeAffectEvidence,
  AFFECT_PHASE_BASELINES,
  type AffectProfile,
} from './affectSignals.js';

const pad = (text: string) => text + ' word'.repeat(20);

describe('computeAffectProfile', () => {
  it('returns null for short text', () => {
    expect(computeAffectProfile('Too short.')).toBeNull();
  });

  it('detects urgency terms', () => {
    const text = pad('We must act immediately. This is urgent and critically important. The crisis demands immediate action.');
    const profile = computeAffectProfile(text);
    expect(profile).not.toBeNull();
    expect(profile!.urgency).toBeGreaterThan(0);
    expect(profile!.urgency).toBeGreaterThan(profile!.outrage);
  });

  it('detects fear terms', () => {
    const text = pad('The existential threat is catastrophic and dangerous. This disaster could be devastating and irreversible.');
    const profile = computeAffectProfile(text);
    expect(profile).not.toBeNull();
    expect(profile!.fear).toBeGreaterThan(0);
    expect(profile!.fear).toBeGreaterThan(profile!.hope);
  });

  it('detects hope terms', () => {
    const text = pad('This promising solution could transform our approach. The potential for improvement and progress is beneficial.');
    const profile = computeAffectProfile(text);
    expect(profile).not.toBeNull();
    expect(profile!.hope).toBeGreaterThan(0);
    expect(profile!.hope).toBeGreaterThan(profile!.fear);
  });

  it('detects outrage terms', () => {
    const text = pad('This is outrageous and unacceptable. Such reckless negligence is inexcusable and deplorable.');
    const profile = computeAffectProfile(text);
    expect(profile).not.toBeNull();
    expect(profile!.outrage).toBeGreaterThan(0);
  });

  it('detects empathy terms', () => {
    const text = pad('Real people and vulnerable communities suffer. The impact on families and workers affects their dignity and welfare.');
    const profile = computeAffectProfile(text);
    expect(profile).not.toBeNull();
    expect(profile!.empathy).toBeGreaterThan(0);
  });

  it('returns low scores for neutral text', () => {
    const text = pad('The analysis considers multiple perspectives on the regulatory framework and its implications for governance structures.');
    const profile = computeAffectProfile(text);
    expect(profile).not.toBeNull();
    for (const score of Object.values(profile!)) {
      expect(score).toBeLessThan(0.5);
    }
  });
});

describe('computeAffectIntensity', () => {
  it('returns null for short text', () => {
    expect(computeAffectIntensity('Short text.')).toBeNull();
  });

  it('returns higher intensity for emotionally charged text', () => {
    const charged = pad('This catastrophic danger is urgent. The outrageous threat endangers all. We must act immediately.');
    const neutral = pad('The analysis considers multiple perspectives on the regulatory framework and its implications for governance.');
    const chargedI = computeAffectIntensity(charged)!;
    const neutralI = computeAffectIntensity(neutral)!;
    expect(chargedI).toBeGreaterThan(neutralI);
  });

  it('returns value in [0,1]', () => {
    const text = pad('Urgent crisis demands immediate action to prevent catastrophic existential disaster threatening vulnerable communities.');
    const intensity = computeAffectIntensity(text)!;
    expect(intensity).toBeGreaterThanOrEqual(0);
    expect(intensity).toBeLessThanOrEqual(1);
  });
});

describe('computeAffectAppropriateness (share-normalized, t/1785)', () => {
  const scale = (p: AffectProfile, k: number): AffectProfile => ({
    urgency: p.urgency * k, fear: p.fear * k, hope: p.hope * k, outrage: p.outrage * k, empathy: p.empathy * k,
  });

  it('scores near 1.0 for a profile proportional to the phase baseline (AC1)', () => {
    // A profile proportional to the baseline has baseline-matching SHARES. (Not exactly 1.0:
    // the baseline vector sums to ~0.95, so its own shares deviate ~0.01 from it — near, not equal.)
    const proportional = { ...AFFECT_PHASE_BASELINES.argumentation };
    const score = computeAffectAppropriateness(proportional, 'argumentation')!;
    expect(score).toBeGreaterThan(0.95);
  });

  it('returns null for a zero-affect profile — no emotion is not inappropriate emotion (AC2)', () => {
    const zero: AffectProfile = { urgency: 0, fear: 0, hope: 0, outrage: 0, empathy: 0 };
    expect(computeAffectAppropriateness(zero, 'argumentation')).toBeNull();
  });

  it('returns null for terminated phase', () => {
    const profile: AffectProfile = { urgency: 0.2, fear: 0.1, hope: 0.3, outrage: 0.1, empathy: 0.2 };
    expect(computeAffectAppropriateness(profile, 'terminated')).toBeNull();
  });

  it('depends on balance, not magnitude — same shares score identically at 5× intensity (AC3)', () => {
    // Regression against the pre-t/1785 defect where the metric was dominated by absolute
    // magnitude: two profiles with identical BALANCE but 5× different intensity must score equal.
    const low: AffectProfile = { urgency: 0.10, fear: 0.05, hope: 0.02, outrage: 0.02, empathy: 0.01 };
    const high = scale(low, 5);
    const s1 = computeAffectAppropriateness(low, 'confrontation')!;
    const s2 = computeAffectAppropriateness(high, 'confrontation')!;
    expect(s1).toBeCloseTo(s2, 10);
  });

  it('distinguishes different balances at the same magnitude (AC3)', () => {
    // Concluding baseline is hope-dominant (0.39) and outrage-minimal (0.04).
    const hopeDominant: AffectProfile = { urgency: 0.10, fear: 0.03, hope: 0.40, outrage: 0.02, empathy: 0.25 };
    const outrageDominant: AffectProfile = { urgency: 0.10, fear: 0.10, hope: 0.05, outrage: 0.60, empathy: 0.05 };
    const sHope = computeAffectAppropriateness(hopeDominant, 'concluding')!;
    const sOutrage = computeAffectAppropriateness(outrageDominant, 'concluding')!;
    expect(sHope).toBeGreaterThan(sOutrage);
  });

  it('scores ~0 for a balance far from the phase baseline', () => {
    // All mass in outrage; concluding rates outrage lowest (0.04) → maximal share deviation.
    const allOutrage: AffectProfile = { urgency: 0, fear: 0, hope: 0, outrage: 1, empathy: 0 };
    const score = computeAffectAppropriateness(allOutrage, 'concluding')!;
    expect(score).toBeLessThanOrEqual(0.05);
  });
});

describe('computeAffectEvidence', () => {
  it('returns empty arrays for short text', () => {
    const ev = computeAffectEvidence('Too short.');
    for (const terms of Object.values(ev)) {
      expect(terms).toEqual([]);
    }
  });

  it('returns matched urgency terms', () => {
    const text = pad('We must act immediately. This is urgent and the crisis demands swift action.');
    const ev = computeAffectEvidence(text);
    expect(ev.urgency).toContain('immediately');
    expect(ev.urgency).toContain('urgent');
    expect(ev.urgency).toContain('crisis');
    expect(ev.urgency).toContain('swift');
  });

  it('returns matched hope terms', () => {
    const text = pad('This promising opportunity could transform our approach. A real breakthrough with positive potential.');
    const ev = computeAffectEvidence(text);
    expect(ev.hope).toContain('promising');
    expect(ev.hope).toContain('opportunity');
    expect(ev.hope).toContain('transform');
    expect(ev.hope).toContain('breakthrough');
    expect(ev.hope).toContain('positive');
    expect(ev.hope).toContain('potential');
  });

  it('returns empty arrays for categories with no matches', () => {
    const text = pad('This promising opportunity could transform our approach with positive potential for progress.');
    const ev = computeAffectEvidence(text);
    expect(ev.hope.length).toBeGreaterThan(0);
    expect(ev.outrage).toEqual([]);
  });

  it('is consistent with computeAffectProfile scores', () => {
    const text = pad('The catastrophic danger threatens vulnerable communities. This urgent crisis demands immediate action.');
    const ev = computeAffectEvidence(text);
    const profile = computeAffectProfile(text)!;
    for (const cat of Object.keys(ev) as (keyof typeof ev)[]) {
      if (ev[cat].length > 0) expect(profile[cat]).toBeGreaterThan(0);
      if (ev[cat].length === 0) expect(profile[cat]).toBe(0);
    }
  });

  it('excludes fragment false-positives (dire→"direct")', () => {
    const text = pad('The direct approach takes a different direction from the previous strategy.');
    const ev = computeAffectEvidence(text);
    expect(ev.fear).not.toContain('dire');
  });

  it('keeps inflected forms (risk→"risks")', () => {
    const text = pad('The risks of this approach are significant and the threats multiply as benefits decrease.');
    const ev = computeAffectEvidence(text);
    expect(ev.fear).toContain('risk');
    expect(ev.fear).toContain('threat');
  });
});
