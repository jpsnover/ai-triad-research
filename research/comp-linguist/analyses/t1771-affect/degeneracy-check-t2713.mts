// t/2713 — degeneracy re-check for the CONCLUDING baseline refit (moderate-pacing corpus).
// Mirrors degeneracy-check-v2.mts (t/2680 AC3) but exercises the NEW concluding row.
// GATE: a neutral / affect-free turn must NOT score ~1.0 appropriateness — it must yield
// null (no-evidence). Uses the SHIPPED computeAffectProfile (post-t/2677 pruned lexicon),
// which t/2713 does NOT change, so the neutral gate is expected to hold; this run confirms
// it empirically and reports the concluding-row spread (CL reproduction rule — don't assert
// un-run).
//
// Run: cd research/comp-linguist/analyses/t1771-affect && npx tsx degeneracy-check-t2713.mts

import {
  computeAffectProfile,
  AFFECT_CATEGORIES,
  type AffectProfile,
} from '../../../../lib/debate/affectSignals.js';

const MAX_DEV = 0.35; // mirrored from affectSignals.ts (not exported)

// t/2713 turn-weighted fit, concluding row (largest-remainder 2dp, sums to 1.00).
const NEW_CONCLUDING: AffectProfile = { urgency: 0.17, fear: 0.44, hope: 0.21, outrage: 0.04, empathy: 0.14 };
// Shipped (un-pruned provisional) concluding row, for before/after contrast.
const OLD_CONCLUDING: AffectProfile = { urgency: 0.09, fear: 0.30, hope: 0.10, outrage: 0.11, empathy: 0.40 };

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

const fmt = (x: number | null) => (x === null ? 'null' : x.toFixed(3));

console.log('cat order:', AFFECT_CATEGORIES.join(', '));
for (const c of CASES) {
  const p = computeAffectProfile(c.text);
  console.log(`\n### ${c.label}`);
  if (!p) { console.log('  profile = null (below MIN_WORD_COUNT)'); continue; }
  const total = AFFECT_CATEGORIES.reduce((s, cat) => s + p[cat], 0);
  console.log('  profile   :', AFFECT_CATEGORIES.map(cat => `${cat}=${p[cat].toFixed(3)}`).join(' '));
  console.log('  total     :', total.toFixed(3), total <= 0 ? '→ appropriateness=null (no-evidence)' : '');
  console.log(`  concluding  OLD=${fmt(appropriateness(p, OLD_CONCLUDING))}  NEW=${fmt(appropriateness(p, NEW_CONCLUDING))}`);
}

// Explicit gate verdict on the neutral case against the NEW concluding baseline.
const neutral = computeAffectProfile(CASES[0].text);
const neutralTotal = neutral ? AFFECT_CATEGORIES.reduce((s, c) => s + neutral[c], 0) : 0;
const neutralScore = neutral ? appropriateness(neutral, NEW_CONCLUDING) : null;
console.log('\n=== DEGENERACY GATE (concluding) ===');
if (neutral === null || neutralTotal <= 0) {
  console.log('PASS — neutral text yields null (no-evidence), not a spurious high score.');
} else if (neutralScore !== null && neutralScore >= 0.9) {
  console.log(`FAIL — neutral text scores ${neutralScore.toFixed(3)} (~1.0) against new concluding baseline → stays stipulated.`);
} else {
  console.log(`PASS — neutral text scores ${neutralScore?.toFixed(3)} (< 0.9), not a no-lose bucket.`);
}
