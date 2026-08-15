// t/1771 step 3 (provisional) — fit AFFECT_PHASE_BASELINES to empirical per-phase
// affect-profile SHARES recomputed from real transcripts, using the SHIPPED logic
// (computeAffectProfile + getDebatePhase). Mirrors calibrationLogger/extract-metrics.ts
// computeAffectSignals() turn-filtering exactly. Provisional: local sample only (~39
// real-prose debates with transcripts on disk). Durable fit awaits DebateTool profile logging.
//
// Run: cd research/comp-linguist/analyses/t1771-affect && npx tsx fit-baselines.mts

import fs from 'node:fs';
import path from 'node:path';
import {
  computeAffectProfile,
  AFFECT_CATEGORIES,
  AFFECT_PHASE_BASELINES,
  type AffectCategory,
} from '../../../../lib/debate/affectSignals.js';
import { getDebatePhase } from '../../../../lib/debate/types/phase.js';

const DATA_ROOT = process.env.AI_TRIAD_DATA_ROOT || 'C:/Users/jsnov/repos/ai-triad-data';
const CAL = path.join(DATA_ROOT, 'calibration/core/calibration-log.jsonl');
const DBG = path.join(DATA_ROOT, 'debates');
const MAX_ACCEPTABLE_DEVIATION_CURRENT = 0.35; // not exported; mirrored from affectSignals.ts
const PHASES = ['confrontation', 'argumentation', 'concluding'] as const;
type Phase = (typeof PHASES)[number];

// ---- 1. real-prose unique debate ids from the calibration log (MSL >= 10) ----
const realIds = new Set<string>();
for (const line of fs.readFileSync(CAL, 'utf-8').split('\n')) {
  if (!line.trim()) continue;
  let r: any;
  try { r = JSON.parse(line); } catch { continue; }
  if ((r.clarity_mean_sentence_length ?? 0) >= 10 && r.debate_id) realIds.add(r.debate_id);
}

// ---- 2. transcripts on disk ----
const files = fs.readdirSync(DBG)
  .filter(f => f.startsWith('debate-') && f.endsWith('.json') &&
    !f.includes('comments') && !f.includes('-partial') && !f.includes('.tmp'));

// ---- 3. faithful per-turn share accumulation (mirror computeAffectSignals) ----
const shareByPhase: Record<Phase, number[][]> = { confrontation: [], argumentation: [], concluding: [] };
const turnsByPhase: Record<Phase, number> = { confrontation: 0, argumentation: 0, concluding: 0 };
let debatesUsed = 0;

for (const f of files) {
  let d: any;
  try { d = JSON.parse(fs.readFileSync(path.join(DBG, f), 'utf-8')); } catch { continue; }
  if (!d.id || !realIds.has(d.id)) continue;              // intersection: real-prose AND on disk
  const transcript: any[] = d.transcript ?? [];
  if (!transcript.length) continue;
  // rounds = max round metadata over statement/opening turns (faithful debate length)
  const rounds = Math.max(1, ...transcript.map(t => (t.metadata?.round as number) || 0));
  let contributed = false;
  for (const entry of transcript) {
    if (entry.type !== 'opening' && entry.type !== 'statement') continue;
    if (entry.speaker === 'system' || entry.speaker === 'moderator') continue;
    if (!entry.content) continue;
    const profile = computeAffectProfile(entry.content);
    if (!profile) continue;
    const entryRound = (entry.metadata?.round as number) ?? 1;
    const phase = getDebatePhase(entryRound, rounds);
    if (phase === 'terminated') continue;
    const total = AFFECT_CATEGORIES.reduce((s, c) => s + profile[c], 0);
    if (total <= 0) continue;                              // matches approp null-guard
    const shares = AFFECT_CATEGORIES.map(c => profile[c] / total);
    shareByPhase[phase as Phase].push(shares);
    turnsByPhase[phase as Phase]++;
    contributed = true;
  }
  if (contributed) debatesUsed++;
}

// ---- 4. aggregate: mean & median share vector per phase = empirical baseline ----
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
};
const round2 = (x: number) => Math.round(x * 100) / 100;

const fitted: Record<string, Record<AffectCategory, number>> = {};
console.log(`\n=== SAMPLE ===`);
console.log(`real-prose unique ids (calib): ${realIds.size} | transcripts on disk: ${files.length} | debates used (intersection, contributing turns): ${debatesUsed}`);

for (const phase of PHASES) {
  const rows = shareByPhase[phase];
  console.log(`\n=== PHASE ${phase} — ${turnsByPhase[phase]} turns ===`);
  if (!rows.length) { console.log('  (no turns)'); continue; }
  const meanVec = {} as Record<AffectCategory, number>;
  AFFECT_CATEGORIES.forEach((c, i) => { meanVec[c] = mean(rows.map(r => r[i])); });
  // normalize mean vector to sum 1 (shares already ~1 per turn, mean stays ~1 but enforce)
  const s = AFFECT_CATEGORIES.reduce((a, c) => a + meanVec[c], 0);
  AFFECT_CATEGORIES.forEach(c => { meanVec[c] = meanVec[c] / s; });
  fitted[phase] = meanVec;
  console.log('  CURRENT baseline:', JSON.stringify(AFFECT_PHASE_BASELINES[phase]));
  console.log('  FITTED  (mean share, renorm):', JSON.stringify(Object.fromEntries(AFFECT_CATEGORIES.map(c => [c, round2(meanVec[c])]))));
}

// ---- 5. deviation distributions: current baseline vs fitted baseline ----
function deviations(baseline: Record<string, Record<AffectCategory, number>>) {
  const devs: number[] = [];
  for (const phase of PHASES) {
    const b = baseline[phase]; if (!b) continue;
    for (const shares of shareByPhase[phase]) {
      const dev = AFFECT_CATEGORIES.reduce((sum, c, i) => sum + Math.abs(shares[i] - b[c]), 0) / AFFECT_CATEGORIES.length;
      devs.push(dev);
    }
  }
  return devs;
}
const curBaseObj = Object.fromEntries(PHASES.map(p => [p, AFFECT_PHASE_BASELINES[p]]));
const devCur = deviations(curBaseObj as any);
const devFit = deviations(fitted);

function report(label: string, devs: number[]) {
  if (!devs.length) return;
  console.log(`\n=== DEVIATION vs ${label} (n=${devs.length} turns) ===`);
  for (const p of [0.5, 0.75, 0.9, 0.95]) console.log(`  p${p * 100}: ${round2(pct(devs, p))}`);
  console.log(`  mean: ${round2(mean(devs))}`);
  // appropriateness under current MAX_DEV and a candidate that puts the median turn at ~0.60
  const scoreAt = (dev: number, maxDev: number) => Math.max(0, 1 - dev / maxDev);
  const medDev = pct(devs, 0.5);
  const candidateMaxDev = round2(medDev / 0.4); // median turn scores 0.60  => 1 - medDev/maxDev = 0.6
  const apprCur = devs.map(dvv => scoreAt(dvv, MAX_ACCEPTABLE_DEVIATION_CURRENT));
  const apprCand = devs.map(dvv => scoreAt(dvv, candidateMaxDev));
  console.log(`  appropriateness w/ MAX_DEV=0.35 (current): mean ${round2(mean(apprCur))} median ${round2(pct(apprCur, 0.5))} below0.60 ${apprCur.filter(v => v < 0.6).length}/${apprCur.length}`);
  console.log(`  candidate MAX_DEV=${candidateMaxDev} (median→0.60): mean ${round2(mean(apprCand))} median ${round2(pct(apprCand, 0.5))} below0.60 ${apprCand.filter(v => v < 0.6).length}/${apprCand.length}`);
}
report('CURRENT baselines', devCur);
report('FITTED baselines', devFit);

// ---- 6. emit machine-readable fitted values ----
fs.writeFileSync(
  path.join(import.meta.dirname, 'fitted-baselines.json'),
  JSON.stringify({ generated: 'provisional', debatesUsed, turnsByPhase, fitted }, null, 2),
);
console.log('\nwrote fitted-baselines.json');
