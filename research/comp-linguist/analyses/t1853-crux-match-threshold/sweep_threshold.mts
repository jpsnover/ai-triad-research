// t/1853 threshold sweep — scores the shipped greedy 1:1 matcher against the
// hand-labeled gold set (gold.json) per PREREG-t1853.md. Embeddings via the
// production model path (all-MiniLM-L6-v2, ONNX), engine side over
// node_text.slice(0,300), evaluator side over description.slice(0,300) —
// byte-identical inputs to the production instrument.
//
// Run from the worktree root:  npx tsx research/comp-linguist/analyses/t1853-crux-match-threshold/sweep_threshold.mts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tryWarmup, computeEmbeddings, getExecutionProvider } from '../../../../lib/embeddings/onnxEmbedding.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = JSON.parse(fs.readFileSync(path.join(here, 'candidates.json'), 'utf8'));
const gold = JSON.parse(fs.readFileSync(path.join(here, 'gold.json'), 'utf8'));

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 0 ? dot / d : 0;
}

// Same algorithm as computeCruxSemanticDivergence: pairs >= theta, sort desc, greedy 1:1.
function greedyMatch(sims: { e: number; v: number; sim: number }[], theta: number): Map<number, number> {
  const cand = sims.filter(p => p.sim >= theta).sort((a, b) => b.sim - a.sim);
  const usedE = new Set<number>(), usedV = new Set<number>();
  const out = new Map<number, number>(); // v -> e
  for (const { e, v } of cand) {
    if (usedE.has(e) || usedV.has(v)) continue;
    usedE.add(e); usedV.add(v); out.set(v, e);
  }
  return out;
}

const ok = await tryWarmup();
if (!ok) { console.error('ONNX embedding unavailable — cannot run sweep faithfully.'); process.exit(1); }
console.log('embedding provider:', getExecutionProvider());

type SessionSims = { file: string; sims: { e: number; v: number; sim: number }[]; engineIds: (string | null)[] };
const sessions: SessionSims[] = [];
const goldPairSims: number[] = [];
const nonGoldPairSims: number[] = [];

for (const s of candidates.sessions) {
  // T1853_ENGINE_SIDE=description runs the EXPLORATORY variant (engine crux
  // description instead of AN node text) — not part of the prereg'd analysis.
  const engTexts = s.engine.map((e: any) => String(
    process.env.T1853_ENGINE_SIDE === 'description' ? (e.description ?? e.node_text) : e.node_text,
  ).slice(0, 300));
  const evTexts = s.evaluator.map((v: any) => String(v.description).slice(0, 300));
  const engVecs = await computeEmbeddings(engTexts);
  const evVecs = await computeEmbeddings(evTexts);
  const sims: { e: number; v: number; sim: number }[] = [];
  const labels = new Map<number, Set<string>>(
    (gold.sessions[s.file] ?? []).map((g: any) => [g.evaluator_idx, new Set(g.engine_ids)]),
  );
  for (let e = 0; e < engVecs.length; e++) {
    for (let v = 0; v < evVecs.length; v++) {
      const sim = cosine(engVecs[e], evVecs[v]);
      sims.push({ e, v, sim });
      const gset = labels.get(s.evaluator[v].idx);
      if (gset) (gset.has(s.engine[e].id) ? goldPairSims : nonGoldPairSims).push(sim);
    }
  }
  sessions.push({ file: s.file, sims, engineIds: s.engine.map((e: any) => e.id) });
}

function score(theta: number, confFilter: (c: string) => boolean) {
  let predicted = 0, correct = 0, labeledCruxes = 0, recovered = 0;
  for (const s of sessions) {
    const cs = candidates.sessions.find((c: any) => c.file === s.file);
    const labels = (gold.sessions[s.file] ?? []).filter((g: any) => confFilter(g.confidence));
    if (labels.length === 0) continue;
    const byIdx = new Map<number, Set<string>>(labels.map((g: any) => [g.evaluator_idx, new Set(g.engine_ids)]));
    const match = greedyMatch(s.sims, theta);
    labeledCruxes += labels.length;
    for (const [vPos, ePos] of match) {
      const vIdx = cs.evaluator[vPos].idx;
      const gset = byIdx.get(vIdx);
      if (!gset) continue; // unlabeled evaluator crux — uncertain, excluded
      predicted++;
      if (gset.has(s.engineIds[ePos]!)) { correct++; recovered++; }
    }
  }
  return {
    theta,
    precision: predicted > 0 ? correct / predicted : null,
    recall: labeledCruxes > 0 ? recovered / labeledCruxes : null,
    predicted, correct, labeledCruxes,
  };
}

const thetas = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70];
const results = {
  provider: getExecutionProvider(),
  gold_pair_sim: {
    n: goldPairSims.length,
    mean: goldPairSims.reduce((a, b) => a + b, 0) / Math.max(1, goldPairSims.length),
    min: Math.min(...goldPairSims), max: Math.max(...goldPairSims),
  },
  non_gold_pair_sim: {
    n: nonGoldPairSims.length,
    mean: nonGoldPairSims.reduce((a, b) => a + b, 0) / Math.max(1, nonGoldPairSims.length),
    p95: [...nonGoldPairSims].sort((a, b) => a - b)[Math.floor(nonGoldPairSims.length * 0.95)],
  },
  high_confidence: thetas.map(t => score(t, c => c === 'high')),
  all_labeled: thetas.map(t => score(t, () => true)),
};

const outName = process.env.T1853_ENGINE_SIDE === 'description' ? 'results-exploratory-desc.json' : 'results.json';
fs.writeFileSync(path.join(here, outName), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 1));
