// t/2680 step 4 — degeneracy re-check for the v2 (pruned-lexicon) baseline refit.
// GATE: a neutral / affect-free debate turn must NOT score ~1.0 appropriateness against
// the NEW baselines (the original t/1771 "no-lose bucket" failure). Uses the SHIPPED
// computeAffectProfile (post-t/2677 pruned lexicon) so the lexicon under test is real.
//
// Run: cd research/comp-linguist/analyses/t1771-affect && npx tsx degeneracy-check-v2.mts

import {
  computeAffectProfile,
  computeAffectAppropriateness,
  AFFECT_CATEGORIES,
  AFFECT_PHASE_BASELINES,
  type AffectProfile,
  type AffectCategory,
} from '../../../../lib/debate/affectSignals.js';

const MAX_DEV = 0.35; // mirrored from affectSignals.ts (not exported)

// v2 fit (turn-weighted, 66 debates). Concluding has NO corpus data — kept at current
// provisional value, flagged. conf/arg are the derived candidates.
const NEW_BASELINES: Record<string, AffectProfile> = {
  confrontation: { urgency: 0.18, fear: 0.39, hope: 0.16, outrage: 0.09, empathy: 0.18 },
  argumentation: { urgency: 0.19, fear: 0.37, hope: 0.23, outrage: 0.06, empathy: 0.15 },
  concluding:    AFFECT_PHASE_BASELINES.concluding, // unchanged — no data
};

function appropriateness(profile: AffectProfile, baseline: AffectProfile): number | null {
  const total = AFFECT_CATEGORIES.reduce((s, c) => s + profile[c], 0);
  if (total <= 0) return null;
  const meanDev =
    AFFECT_CATEGORIES.reduce((s, c) => s + Math.abs(profile[c] / total - baseline[c]), 0) /
    AFFECT_CATEGORIES.length;
  return Math.max(0, 1 - meanDev / MAX_DEV);
}

const CASES: { label: string; text: string }[] = [
  {
    label: 'NEUTRAL academic (degeneracy gate)',
    text:
      'The committee reviewed the quarterly dataset and tabulated the results according to the ' +
      'standard methodology. The report was then circulated to the relevant departments for their ' +
      'scheduled procedural assessment and subsequent archival within the documented framework.',
  },
  {
    label: 'HIGH-affect rhetorical',
    text:
      'This is a catastrophic and terrifying threat that endangers everyone; we must act with extreme ' +
      'urgency before this dangerous crisis destroys the vulnerable communities we are desperate to protect ' +
      'and safeguard from imminent devastating harm.',
  },
  {
    label: 'MIXED balanced argument',
    text:
      'There is a real risk that rushed deployment could harm workers, and I share the hope that careful ' +
      'oversight helps. But we should weigh the urgency of innovation against the danger of overreach, ' +
      'and remain calm about the tradeoffs rather than alarmed.',
  },
];

console.log('cat order:', AFFECT_CATEGORIES.join(', '));
for (const c of CASES) {
  const p = computeAffectProfile(c.text);
  console.log(`\n### ${c.label}`);
  if (!p) {
    console.log('  profile = null (below MIN_WORD_COUNT)'); continue;
  }
  const total = AFFECT_CATEGORIES.reduce((s, cat) => s + p[cat], 0);
  console.log('  profile   :', AFFECT_CATEGORIES.map(cat => `${cat}=${p[cat].toFixed(3)}`).join(' '));
  console.log('  total     :', total.toFixed(3), total <= 0 ? '→ appropriateness=null (no-evidence)' : '');
  for (const phase of ['confrontation', 'argumentation'] as const) {
    const cur = computeAffectAppropriateness(p, phase);          // shipped, current baselines
    const nw = appropriateness(p, NEW_BASELINES[phase]);         // new baselines
    const fmt = (x: number | null) => (x === null ? 'null' : x.toFixed(3));
    console.log(`  ${phase.padEnd(13)} current=${fmt(cur)}  NEW=${fmt(nw)}`);
  }
}

// Explicit gate verdict on the neutral case.
const neutral = computeAffectProfile(CASES[0].text);
const neutralTotal = neutral ? AFFECT_CATEGORIES.reduce((s, c) => s + neutral[c], 0) : 0;
const neutralScore = neutral ? appropriateness(neutral, NEW_BASELINES.confrontation) : null;
console.log('\n=== DEGENERACY GATE ===');
if (neutral === null || neutralTotal <= 0) {
  console.log('PASS — neutral text yields null (no-evidence), not a spurious high score.');
} else if (neutralScore !== null && neutralScore >= 0.9) {
  console.log(`FAIL — neutral text scores ${neutralScore.toFixed(3)} (~1.0) against new baselines → stays stipulated.`);
} else {
  console.log(`PASS — neutral text scores ${neutralScore?.toFixed(3)} (< 0.9), not a no-lose bucket.`);
}
