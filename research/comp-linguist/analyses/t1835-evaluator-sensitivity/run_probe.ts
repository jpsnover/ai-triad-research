/**
 * t/1835 — Evaluator-model sensitivity probe (harness).
 *
 * Paired, same-transcript, model-family-swapped re-evaluation per PREREG-t1835.md.
 * For each archived debate: build ONE SpeakerMapping, run runNeutralEvaluation twice
 * (Arm A = Gemini family, Arm B = Claude family) with only the evaluator model differing,
 * and compute the four calibration-feeding metrics from each arm using the exact
 * production formulas (calibrationLogger.ts:433, 583-596, 749-785, 432).
 *
 * DEVIATION from prereg §5: Arm A is gemini-3.5-flash-lite, not gemini-2.5-flash — the
 * archived evaluator model is no longer in ai-models.json. The probe tests model-FAMILY
 * sensitivity and re-runs both arms fresh, so the archived model identity is moot; a current
 * registered Gemini model is the faithful "primary family" representative.
 *
 * Run: GEMINI_API_KEY=... ANTHROPIC_API_KEY=... npx tsx research/comp-linguist/analyses/t1835-evaluator-sensitivity/run_probe.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCLIAdapter } from '../../../../lib/debate/aiAdapter.js';
import { runNeutralEvaluation, buildSpeakerMapping } from '../../../../lib/debate/neutralEvaluator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../../');
const RAW_DIR = path.join(__dirname, 'raw');
const ARM_A = { label: 'gemini', model: 'gemini-3.5-flash-lite' };
const ARM_B = { label: 'claude', model: 'claude-haiku-4-5' };
const MIN_TURNS = 6;

function readJsonBom(p: string): any {
  const raw = fs.readFileSync(p, 'utf-8').replace(/^﻿/, '');
  return JSON.parse(raw);
}

/** Replicates the four evaluator-derived calibration metrics (calibrationLogger.ts). */
function computeMetrics(ev: any, session: any, mapping: any) {
  const cruxes: any[] = ev?.cruxes ?? [];
  const total = cruxes.length;
  const crux_addressed_ratio =
    total > 0 ? cruxes.filter((c) => c.status === 'addressed').length / total : null;
  const engaging: boolean | null =
    ev?.overall_assessment?.debate_is_engaging_real_disagreement ?? null;

  // crux_resolution_divergence_rate (calibrationLogger.ts:583-596), paired by index.
  const engineCruxes: any[] = Array.isArray(session.crux_tracker) ? session.crux_tracker : [];
  let crux_resolution_divergence_rate: number | null = null;
  if (total > 0 && engineCruxes.length > 0) {
    let divergences = 0;
    const minLen = Math.min(engineCruxes.length, total);
    for (let i = 0; i < minLen; i++) {
      const engineResolved =
        engineCruxes[i].status === 'resolved' || engineCruxes[i].status === 'addressed';
      const evalAddressed = cruxes[i].status === 'addressed';
      if (engineResolved !== evalAddressed) divergences++;
    }
    crux_resolution_divergence_rate = minLen > 0 ? divergences / minLen : null;
  }

  // injectedSitIds (calibrationLogger.ts:731-744): manifest.situationNodeIds only.
  const injected = new Set<string>();
  for (const e of session.transcript ?? []) {
    const man = (e.metadata as any)?.injection_manifest;
    if (man?.situationNodeIds) for (const id of man.situationNodeIds) injected.add(id);
  }
  // situation_crux_alignment (calibrationLogger.ts:749-785), reverse map = our mapping.
  let situation_crux_alignment: number | null = null;
  if (total > 0 && injected.size > 0) {
    const reverseMap: Record<string, string> = mapping.reverse ?? {};
    let aligned = 0;
    for (const crux of cruxes) {
      const cruxPovs = new Set<string>();
      for (const s of crux.speakers_involved ?? []) {
        const p = reverseMap[`Speaker ${s}`];
        if (p) cruxPovs.add(p);
      }
      let hasSitRef = false;
      for (const e of session.transcript) {
        if (e.type !== 'statement' && e.type !== 'opening') continue;
        if (!cruxPovs.has(e.speaker)) continue;
        if ((e.taxonomy_refs ?? []).some((r: any) => r.node_id?.startsWith('sit-') && injected.has(r.node_id))) {
          hasSitRef = true;
          break;
        }
      }
      if (hasSitRef) aligned++;
    }
    situation_crux_alignment = aligned / total;
  }

  return { crux_addressed_ratio, situation_crux_alignment, crux_resolution_divergence_rate, engaging, n_cruxes: total };
}

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const dir = path.join(REPO_ROOT, 'lib/debate/exp-1438-results');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('-debate.json'));
  const adapter = createCLIAdapter(REPO_ROOT);
  const rows: any[] = [];

  for (const f of files) {
    const session = readJsonBom(path.join(dir, f));
    const id = session.id ?? f;
    const transcript = session.transcript ?? [];
    if (transcript.length < MIN_TURNS) {
      rows.push({ id, excluded: `transcript ${transcript.length} < ${MIN_TURNS} turns` });
      continue;
    }
    const topic = session.topic?.final || session.topic?.original || '';
    const activePovers = (session.active_povers ?? []).filter((p: string) => p !== 'user');
    const mapping = buildSpeakerMapping(activePovers);

    try {
      const cfgBase = { adapter, topic, transcript, activePovers, speakerMapping: mapping } as any;
      const evA = await runNeutralEvaluation('final', { ...cfgBase, model: ARM_A.model });
      const evB = await runNeutralEvaluation('final', { ...cfgBase, model: ARM_B.model });
      fs.writeFileSync(path.join(RAW_DIR, `${id}.${ARM_A.label}.json`), JSON.stringify(evA, null, 2));
      fs.writeFileSync(path.join(RAW_DIR, `${id}.${ARM_B.label}.json`), JSON.stringify(evB, null, 2));
      const mA = computeMetrics(evA, session, mapping);
      const mB = computeMetrics(evB, session, mapping);
      rows.push({ id, A: mA, B: mB });
      // eslint-disable-next-line no-console
      console.log(`${id}: A eng=${mA.engaging} car=${fmt(mA.crux_addressed_ratio)} nC=${mA.n_cruxes} | B eng=${mB.engaging} car=${fmt(mB.crux_addressed_ratio)} nC=${mB.n_cruxes}`);
    } catch (err) {
      rows.push({ id, error: String((err as Error)?.message ?? err) });
      console.error(`${id}: ERROR ${String((err as Error)?.message ?? err)}`);
    }
  }

  // Summary statistics per PREREG §6.
  const cont = ['crux_addressed_ratio', 'situation_crux_alignment', 'crux_resolution_divergence_rate'] as const;
  const summary: any = {};
  for (const m of cont) {
    const deltas = rows.filter((r) => r.A && r.B && r.A[m] != null && r.B[m] != null).map((r) => Math.abs(r.A[m] - r.B[m]));
    summary[m] = { n: deltas.length, MAD: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null };
  }
  const boolRows = rows.filter((r) => r.A && r.B && r.A.engaging != null && r.B.engaging != null);
  const disagree = boolRows.filter((r) => r.A.engaging !== r.B.engaging).length;
  summary.engaging_real_disagreement = { n: boolRows.length, DR: boolRows.length ? disagree / boolRows.length : null };

  const out = { arms: { A: ARM_A, B: ARM_B }, generated_note: 'stamp added post-run', rows, summary };
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(out, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
}

function fmt(x: number | null): string {
  return x == null ? 'null' : x.toFixed(3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
