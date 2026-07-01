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

describe('computeAffectAppropriateness', () => {
  it('returns 1.0 for profile matching baseline exactly', () => {
    const baseline = AFFECT_PHASE_BASELINES.argumentation;
    const score = computeAffectAppropriateness(baseline, 'argumentation');
    expect(score).toBeCloseTo(1.0, 5);
  });

  it('returns lower score for mismatched profile', () => {
    const confrontationProfile: AffectProfile = {
      urgency: 0.30, fear: 0.25, hope: 0.20, outrage: 0.20, empathy: 0.15,
    };
    const inPhase = computeAffectAppropriateness(confrontationProfile, 'confrontation')!;
    const outPhase = computeAffectAppropriateness(confrontationProfile, 'concluding')!;
    expect(inPhase).toBeGreaterThan(outPhase);
  });

  it('returns null for terminated phase', () => {
    const profile: AffectProfile = { urgency: 0, fear: 0, hope: 0, outrage: 0, empathy: 0 };
    expect(computeAffectAppropriateness(profile, 'terminated')).toBeNull();
  });

  it('returns 0 for extreme deviation', () => {
    const extreme: AffectProfile = { urgency: 1.0, fear: 1.0, hope: 0, outrage: 1.0, empathy: 0 };
    const score = computeAffectAppropriateness(extreme, 'concluding')!;
    expect(score).toBeLessThanOrEqual(0.2);
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
});
