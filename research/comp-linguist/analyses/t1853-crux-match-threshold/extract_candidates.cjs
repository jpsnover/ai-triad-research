// Extract engine/evaluator crux candidate pairs for the t/1853 match-threshold
// golden set. Reads archived sessions from the data repo; emits candidates.json
// with, per session: engine cruxes (id, description, AN node text, whether a
// stored node embedding exists and its dim) and evaluator final cruxes
// (description, status). Hand-matching happens on the emitted file; embeddings
// and threshold sweep are computed by sweep_threshold.mjs.
//
// Usage: node extract_candidates.cjs [maxSessions]
'use strict';
const fs = require('fs');
const path = require('path');

const DEBATES_DIR = 'C:/Users/jsnov/repos/ai-triad-data/debates';
const OUT = path.join(__dirname, 'candidates.json');
const MAX_SESSIONS = Number(process.argv[2] ?? 12);

const files = fs.readdirSync(DEBATES_DIR)
  .filter(f => f.endsWith('.json') && !f.includes('partial'))
  .sort(); // deterministic order — no sampling randomness to prereg around

const sessions = [];
for (const f of files) {
  if (sessions.length >= MAX_SESSIONS) break;
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(DEBATES_DIR, f), 'utf8')); } catch { continue; }
  const eng = Array.isArray(s.crux_tracker) ? s.crux_tracker : [];
  const finals = (s.neutral_evaluations || []).filter(e => e.checkpoint === 'final' && e.evaluation_invalid !== true);
  const ev = finals.length ? (finals[finals.length - 1].cruxes || []) : [];
  if (eng.length === 0 || ev.length === 0) continue;

  const nodes = (s.argument_network && s.argument_network.nodes) || [];
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const engine = eng.map(c => {
    const node = c.id ? nodeById.get(c.id) : undefined;
    return {
      id: c.id ?? null,
      description: c.description ?? null,
      state: c.state ?? c.status ?? null,
      node_text: node ? String(node.text).slice(0, 300) : null,
      node_embedding_dim: node && Array.isArray(node.embedding) ? node.embedding.length : null,
    };
  }).filter(c => c.node_text !== null); // production matching needs the AN node
  const evaluator = ev
    .filter(c => typeof c.description === 'string' && c.description.length > 0)
    .map((c, i) => ({ idx: i, description: c.description, status: c.status ?? null }));

  if (engine.length === 0 || evaluator.length === 0) continue;
  sessions.push({
    file: f,
    debate_id: s.id ?? null,
    topic: (s.topic && (s.topic.final || s.topic.original)) || null,
    engine,
    evaluator,
    // Filled by hand-labeling: array of { engine_id, evaluator_idx } pairs judged
    // to describe the SAME crux. Absence of a pair = judged not-same.
    gold_matches: [],
  });
}

fs.writeFileSync(OUT, JSON.stringify({ generated: null, source_dir: DEBATES_DIR, sessions }, null, 2));
const pairCount = sessions.reduce((n, s) => n + s.engine.length * s.evaluator.length, 0);
console.log(`sessions: ${sessions.length}, engine cruxes: ${sessions.reduce((n, s) => n + s.engine.length, 0)}, evaluator cruxes: ${sessions.reduce((n, s) => n + s.evaluator.length, 0)}, candidate pairs: ${pairCount}`);
console.log(`wrote ${OUT}`);
