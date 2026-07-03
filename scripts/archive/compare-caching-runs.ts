#!/usr/bin/env npx tsx
// Compare flat vs envelope caching runs from usage-summary.jsonl files.
//
// Usage:
//   npx tsx scripts/compare-caching-runs.ts [flatDir] [envelopeDir]

import fs from 'fs';
import path from 'path';

const flatDir = process.argv[2] || 'debates/baseline-flat';
const envDir = process.argv[3] || 'debates/envelope';

interface UsageRecord {
  debate: string;
  backend: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  stage?: string;
  ts?: string;
}

function loadUsage(dir: string): UsageRecord[] {
  const file = path.join(dir, 'usage-summary.jsonl');
  if (!fs.existsSync(file)) {
    console.error(`Missing: ${file}`);
    return [];
  }
  return fs.readFileSync(file, 'utf-8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l));
}

function summarize(records: UsageRecord[]) {
  let promptTokens = 0, completionTokens = 0, cachedTokens = 0, latencyMs = 0;
  for (const r of records) {
    promptTokens += r.promptTokens ?? 0;
    completionTokens += r.completionTokens ?? 0;
    cachedTokens += r.cachedTokens ?? 0;
    latencyMs += r.latencyMs ?? 0;
  }
  return { calls: records.length, promptTokens, completionTokens, cachedTokens, latencyMs };
}

function byDebate(records: UsageRecord[]) {
  const map = new Map<string, UsageRecord[]>();
  for (const r of records) {
    const arr = map.get(r.debate) || [];
    arr.push(r);
    map.set(r.debate, arr);
  }
  return map;
}

const flat = loadUsage(flatDir);
const env = loadUsage(envDir);

if (flat.length === 0 || env.length === 0) {
  console.error('Need both flat and envelope usage data. Run the baseline and envelope scripts first.');
  process.exit(1);
}

const flatStats = summarize(flat);
const envStats = summarize(env);

const pctChange = (a: number, b: number) => {
  if (a === 0) return 'n/a';
  const pct = ((b - a) / a * 100).toFixed(1);
  return `${Number(pct) > 0 ? '+' : ''}${pct}%`;
};

console.log('='.repeat(70));
console.log('  CACHING COMPARISON: Flat Prompts vs Envelope Caching');
console.log('='.repeat(70));
console.log('');
console.log(`${'Metric'.padEnd(30)} ${'Flat'.padStart(12)} ${'Envelope'.padStart(12)} ${'Change'.padStart(10)}`);
console.log('-'.repeat(70));
console.log(`${'API calls'.padEnd(30)} ${String(flatStats.calls).padStart(12)} ${String(envStats.calls).padStart(12)} ${pctChange(flatStats.calls, envStats.calls).padStart(10)}`);
console.log(`${'Prompt tokens'.padEnd(30)} ${flatStats.promptTokens.toLocaleString().padStart(12)} ${envStats.promptTokens.toLocaleString().padStart(12)} ${pctChange(flatStats.promptTokens, envStats.promptTokens).padStart(10)}`);
console.log(`${'Completion tokens'.padEnd(30)} ${flatStats.completionTokens.toLocaleString().padStart(12)} ${envStats.completionTokens.toLocaleString().padStart(12)} ${pctChange(flatStats.completionTokens, envStats.completionTokens).padStart(10)}`);
console.log(`${'Cached tokens'.padEnd(30)} ${flatStats.cachedTokens.toLocaleString().padStart(12)} ${envStats.cachedTokens.toLocaleString().padStart(12)} ${pctChange(flatStats.cachedTokens, envStats.cachedTokens).padStart(10)}`);
console.log(`${'Total API time (s)'.padEnd(30)} ${(flatStats.latencyMs / 1000).toFixed(1).padStart(12)} ${(envStats.latencyMs / 1000).toFixed(1).padStart(12)} ${pctChange(flatStats.latencyMs, envStats.latencyMs).padStart(10)}`);
console.log(`${'Avg prompt tok/call'.padEnd(30)} ${(flatStats.calls > 0 ? Math.round(flatStats.promptTokens / flatStats.calls) : 0).toLocaleString().padStart(12)} ${(envStats.calls > 0 ? Math.round(envStats.promptTokens / envStats.calls) : 0).toLocaleString().padStart(12)}`);
console.log(`${'Cache hit rate'.padEnd(30)} ${'n/a'.padStart(12)} ${(envStats.promptTokens > 0 ? (envStats.cachedTokens / envStats.promptTokens * 100).toFixed(1) + '%' : 'n/a').padStart(12)}`);
console.log('');

// Per-debate breakdown
const flatByDebate = byDebate(flat);
const envByDebate = byDebate(env);
const allDebates = new Set([...flatByDebate.keys(), ...envByDebate.keys()]);

console.log('Per-debate prompt token comparison:');
console.log(`${'Debate'.padEnd(35)} ${'Flat'.padStart(10)} ${'Envelope'.padStart(10)} ${'Change'.padStart(10)} ${'Cached'.padStart(10)}`);
console.log('-'.repeat(75));

for (const debate of [...allDebates].sort()) {
  const fRecs = flatByDebate.get(debate) || [];
  const eRecs = envByDebate.get(debate) || [];
  const fSum = summarize(fRecs);
  const eSum = summarize(eRecs);
  const name = debate.length > 33 ? debate.slice(0, 30) + '...' : debate;
  console.log(
    `${name.padEnd(35)} ${fSum.promptTokens.toLocaleString().padStart(10)} ${eSum.promptTokens.toLocaleString().padStart(10)} ${pctChange(fSum.promptTokens, eSum.promptTokens).padStart(10)} ${eSum.cachedTokens.toLocaleString().padStart(10)}`
  );
}

console.log('');
console.log('='.repeat(70));
