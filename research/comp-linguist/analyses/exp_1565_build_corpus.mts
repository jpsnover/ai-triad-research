// exp t/1565 — corpus builder: replay production prompt builders over real debate sessions.
// Run from repo root:  npx tsx research/comp-linguist/analyses/exp_1565_build_corpus.mts
// Output: research/comp-linguist/analyses/exp-1565-corpus.jsonl
//
// Fidelity notes (each prompt is built exactly as its production call site builds it):
//  - debate.topic-critique    -> critiqueTopicPrompt(topic, structuralContext?, audience)   [topicPipeline.ts:145]
//    structuralContext is not persisted in sessions -> passed undefined (valid production path when
//    structural analysis is unavailable). Deviation noted in report.
//  - debate.clarification-questions -> clarificationPrompt(topic, sourceContent?, audience, lineageCtx?) [topicPipeline.ts:361]
//    sourceContent/lineageCtx not persisted -> undefined (the plain-topic production path).
//  - debate.topic-synthesis   -> concludingPrompt(topic, qaPairs, audience, undefined, lineageCtx?) [topicPipeline.ts:393-394]
//    NOTE: the brief named debateSynthesisPrompt (prompts.ts:2752) for this UsageID, but the production
//    consumer of 'debate.topic-synthesis' is concludingPrompt. qaPairs reconstructed exactly as the
//    automated path does, from REAL clarification questions stored in session transcripts.
//  - debate.crux-refresh      -> cruxRefreshPrompt(activeCruxes, recentConcessions, recentTranscript, topic) [claimExtractionPipeline.ts:1165]
//    Cascade points located by replaying detectConcessionCascade over the session's real convergence_signals.
//    Production passes (topic as {text}).text ?? '' -- topic has no .text field, so production sends ''.
//    Replicated verbatim (quirk noted in report).
//  - debate.evidence-search   -> inline fallback single-verdict prompt [claimExtractionPipeline.ts:679-690]
//    (the UsageID itself is config-only; the executing prompt is this inline template). Template string
//    replicated verbatim below; inputs are real precise-belief AN claims.
//  - claim-extraction         -> extractClaimsPrompt(statement, label, priorClaims(-30), audience, topic.final) [claimExtractionPipeline.ts:764]
//  - claim-classification     -> classifyClaimsPrompt(statement, label, my_claims, priorClaims(-30), audience) [claimExtractionPipeline.ts:762]
//    debaterClaims taken from the statement's REAL persisted metadata.my_claims sketches.
//  - entailment-check         -> entailmentRepairPrompt(statement, node.text) [claimExtractionPipeline.ts:873]
//  - evidence-qbaf-classify   -> buildClassificationPrompt(node.text, evidenceItems, standardizedTerms?) [evidenceQbaf.ts:54, called at claimExtractionPipeline.ts:1380]
//    evidenceItems reconstructed from persisted node.evidence_graph.evidence_items (post-filter set;
//    standardizedTerms not persisted -> undefined). Deviations noted in report.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { critiqueTopicPrompt } from '../../../lib/debate/topicCritique.js';
import {
  clarificationPrompt,
  concludingPrompt,
  entailmentRepairPrompt,
  cruxRefreshPrompt,
} from '../../../lib/debate/prompts.js';
import { extractClaimsPrompt, classifyClaimsPrompt } from '../../../lib/debate/argumentNetwork.js';
import type { PriorClaim } from '../../../lib/debate/argumentNetwork.js';
import { buildClassificationPrompt } from '../../../lib/debate/evidenceQbaf.js';
import type { EvidenceItem } from '../../../lib/debate/evidenceRetriever.js';
import { detectConcessionCascade } from '../../../lib/debate/cruxResolution.js';
import { POVER_INFO } from '../../../lib/debate/poverInfo.js';

const DATA_DEBATES = 'C:/Users/jsnov/repos/ai-triad-data/debates';
const OUT_PATH = 'research/comp-linguist/analyses/exp-1565-corpus.jsonl';
const PER_SCHEMA_CAP = 22;          // brief: 20-25 per schema
const PER_DEBATE_CAP: Record<string, number> = {
  'debate.topic-critique': 1,
  'debate.clarification-questions': 1,
  'debate.topic-synthesis': 1,
  'debate.crux-refresh': 2,
  'debate.evidence-search': 2,      // production caps 2 precise beliefs per turn batch
  'claim-extraction': 2,
  'claim-classification': 2,
  'entailment-check': 3,
  'evidence-qbaf-classify': 2,
};
// num_predict sized from ai-usages.json maxTokens where the UsageID defines one;
// others sized to the response contract (see report).
const NUM_PREDICT: Record<string, number> = {
  'debate.topic-critique': 4096,
  'debate.clarification-questions': 2048,
  'debate.topic-synthesis': 2048,
  'debate.crux-refresh': 2048,
  'debate.evidence-search': 768,
  'claim-extraction': 4096,
  'claim-classification': 4096,
  'entailment-check': 512,
  'evidence-qbaf-classify': 1024,
};

// ── Seeded RNG (mulberry32) for reproducible sampling ──
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1565);
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Minimal session shapes ──
interface TranscriptEntry {
  id: string; type: string; speaker: string; content?: string;
  metadata?: Record<string, unknown>;
}
interface AnNode {
  id: string; text: string; speaker: string; source_entry_id?: string;
  turn_number?: number; bdi_category?: string; specificity?: string;
  evidence_graph?: { evidence_items?: { id: string; source_doc_id: string; text: string; similarity: number }[] };
}
interface AnEdge { source: string; target: string; type: string }
interface CruxItem {
  id: string; description: string; identified_turn: number; state: string;
  history?: { from: string; to: string; turn: number }[];
  support_polarity: number; disagreement_type?: string;
}
interface ConvSignal {
  entry_id: string; round: number; speaker: string;
  concession_opportunity?: { outcome?: string };
}
interface Session {
  id: string; audience?: string; source_type?: string;
  topic: { original?: string; refined?: string | null; final?: string; text?: string };
  transcript: TranscriptEntry[];
  argument_network?: { nodes: AnNode[]; edges: AnEdge[] };
  crux_tracker?: CruxItem[];
  convergence_signals?: ConvSignal[];
}

interface CorpusItem {
  schema: string;
  index: number;
  source_debate_id: string;
  prompt_chars: number;
  num_predict: number;
  meta: Record<string, unknown>;
  prompt: string;
}

type Candidate = Omit<CorpusItem, 'index' | 'prompt_chars' | 'num_predict'>;
const pools: Record<string, Candidate[]> = {};
function addCandidate(schema: string, debateId: string, prompt: string, meta: Record<string, unknown>) {
  if (!prompt || prompt.length < 50) return;
  (pools[schema] ??= []).push({ schema, source_debate_id: debateId, prompt, meta });
}

const speakerLabel = (s: string): string =>
  (POVER_INFO as Record<string, { label?: string }>)[s]?.label ?? s;

// Verbatim replica of the inline fallback fact-check prompt (claimExtractionPipeline.ts:679-690)
function evidenceSearchFallbackPrompt(claimText: string): string {
  return `Verify this empirical claim using web search evidence.

Claim: "${claimText}"

Assess whether available evidence supports, disputes, or cannot verify this claim.

Return ONLY JSON (no markdown, no code fences):
{
  "verdict": "verified" or "disputed" or "unverifiable",
  "evidence": "1-2 sentence summary of the most relevant evidence found",
  "confidence": "high" or "medium" or "low"
}`;
}

// Crux state at a given turn, replayed from its transition history
function cruxStateAtTurn(c: CruxItem, turn: number): string {
  if (c.identified_turn > turn) return 'not_yet';
  let state = 'identified';
  for (const h of c.history ?? []) {
    if (h.turn <= turn) state = h.to;
  }
  return state;
}

function processSession(s: Session): void {
  const debateId = s.id;
  const audience = s.audience as never; // DebateAudience — passed through as production does
  const topicOriginal = s.topic?.original ?? s.topic?.final ?? '';
  const topicFinal = s.topic?.final ?? topicOriginal;
  if (!topicOriginal) return;

  // 1. debate.topic-critique — critique runs on the pre-refinement topic
  addCandidate('debate.topic-critique', debateId,
    critiqueTopicPrompt(topicOriginal, undefined, audience),
    { audience: s.audience ?? null, topic: topicOriginal.slice(0, 120) });

  // 2. debate.clarification-questions — plain-topic path only (document/url/situations use other builders)
  if (!['document', 'url', 'situations'].includes(s.source_type ?? '')) {
    addCandidate('debate.clarification-questions', debateId,
      clarificationPrompt(topicOriginal, undefined, audience, undefined),
      { audience: s.audience ?? null });
  }

  // 3. debate.topic-synthesis — needs real clarification questions from the session
  const clarEntry = s.transcript?.find(e => e.type === 'clarification'
    && Array.isArray((e.metadata as { questions?: unknown[] } | undefined)?.questions));
  if (clarEntry) {
    const questions = ((clarEntry.metadata as { questions: ({ question?: string } | string)[] }).questions)
      .map(q => (typeof q === 'string' ? q : q.question ?? ''))
      .filter(q => q.length > 0);
    if (questions.length > 0) {
      // exact automated-answer formatting from topicPipeline.ts:393
      const qaPairs = questions
        .map(q => `Q: ${q}\nA: [Automated: The debate should explore this from all three perspectives.]`)
        .join('\n\n');
      addCandidate('debate.topic-synthesis', debateId,
        concludingPrompt(topicOriginal, qaPairs, audience, undefined, undefined),
        { audience: s.audience ?? null, n_questions: questions.length });
    }
  }

  const an = s.argument_network;
  const transcript = s.transcript ?? [];
  const entryIndex = new Map<string, number>();
  transcript.forEach((e, i) => entryIndex.set(e.id, i));

  // 4. debate.crux-refresh — replay cascade detection over real convergence signals
  if (s.crux_tracker?.length && s.convergence_signals?.length) {
    let taken = 0;
    let prevDetected = false;
    const sigs = s.convergence_signals.filter(x => x?.concession_opportunity);
    for (let i = 1; i < sigs.length && taken < PER_DEBATE_CAP['debate.crux-refresh']; i++) {
      const cascade = detectConcessionCascade(
        sigs.slice(0, i + 1) as never);
      if (!cascade.detected) { prevDetected = false; continue; }
      if (prevDetected) continue; // only the cascade onset, as production fires per new cascade
      prevDetected = true;
      const round = sigs[i].round;
      const active = s.crux_tracker
        .map(c => ({ c, state: cruxStateAtTurn(c, round) }))
        .filter(x => x.state !== 'not_yet' && x.state !== 'resolved' && x.state !== 'irreducible')
        .map(x => x.c);
      if (active.length === 0) continue;
      const recentConcessions = cascade.concessions.map(cc => {
        const entry = transcript.find(e => e.id === cc.entry_id);
        return { speaker: cc.speaker, conceded_text: entry?.content?.slice(0, 300) ?? '' };
      });
      const endIdx = entryIndex.get(sigs[i].entry_id);
      const upTo = endIdx !== undefined ? transcript.slice(0, endIdx + 1) : transcript;
      const recentTranscript = upTo.slice(-6)
        .map(e => `[${e.speaker}]: ${e.content?.slice(0, 200) ?? ''}`)
        .join('\n');
      // production: (this.ctx.session.topic as { text?: string })?.text ?? '' — replicated verbatim
      const topicArg = (s.topic as { text?: string })?.text ?? '';
      addCandidate('debate.crux-refresh', debateId,
        cruxRefreshPrompt(
          active.map(c => ({ id: c.id, description: c.description, polarity: c.support_polarity, disagreement_type: c.disagreement_type })),
          recentConcessions,
          recentTranscript,
          topicArg,
        ),
        { round, n_active_cruxes: active.length, n_concessions: recentConcessions.length, topic_arg_empty: topicArg === '' });
      taken++;
    }
  }

  if (!an?.nodes?.length) return;

  // 5. debate.evidence-search — precise belief claims (production filter), max 2 (production slice(0,2) per batch)
  const preciseBeliefs = an.nodes.filter(n => n.bdi_category === 'belief' && n.specificity === 'precise');
  for (const n of shuffle(preciseBeliefs).slice(0, PER_DEBATE_CAP['debate.evidence-search'])) {
    addCandidate('debate.evidence-search', debateId,
      evidenceSearchFallbackPrompt(n.text),
      { claim_id: n.id, speaker: n.speaker });
  }

  // Statements by debaters (opening + statement types), with their AN context
  const debaterEntries = transcript
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => (e.type === 'statement' || e.type === 'opening')
      && e.speaker in POVER_INFO && !!e.content);

  const nodesByEntry = new Map<string, AnNode[]>();
  for (const n of an.nodes) {
    if (!n.source_entry_id) continue;
    (nodesByEntry.get(n.source_entry_id) ?? nodesByEntry.set(n.source_entry_id, []).get(n.source_entry_id)!)
      .push(n);
  }

  function priorClaimsFor(entryIdx: number): PriorClaim[] {
    // production: all AN nodes existing before this turn, mapped to labels, capped at last 30
    const priors: PriorClaim[] = [];
    for (const n of an!.nodes) {
      const srcIdx = n.source_entry_id !== undefined ? entryIndex.get(n.source_entry_id) : undefined;
      if (srcIdx !== undefined && srcIdx < entryIdx) {
        priors.push({ id: n.id, text: n.text, speaker: speakerLabel(n.speaker) });
      }
    }
    return priors.slice(-30);
  }

  // Prefer a spread of early and late turns
  const pickedEntries = debaterEntries.length <= 2
    ? debaterEntries
    : [debaterEntries[0], debaterEntries[debaterEntries.length - 1]];

  // 6. claim-extraction
  for (const { e, i } of pickedEntries) {
    const priors = priorClaimsFor(i);
    addCandidate('claim-extraction', debateId,
      extractClaimsPrompt(e.content!, speakerLabel(e.speaker), priors, s.audience, topicFinal),
      { entry_id: e.id, entry_type: e.type, speaker: e.speaker, audience: s.audience ?? null, n_prior_claims: priors.length, topic_passed: !!topicFinal });
  }

  // 7. claim-classification — needs real my_claims sketches
  const sketchEntries = debaterEntries.filter(({ e }) => {
    const mc = (e.metadata as { my_claims?: { claim?: string; targets?: string[] }[] } | undefined)?.my_claims;
    return Array.isArray(mc) && mc.length > 0 && mc.every(c => typeof c?.claim === 'string');
  });
  const pickedSketch = sketchEntries.length <= 2
    ? sketchEntries
    : [sketchEntries[0], sketchEntries[sketchEntries.length - 1]];
  for (const { e, i } of pickedSketch) {
    const mc = (e.metadata as { my_claims: { claim: string; targets?: string[] }[] }).my_claims
      .map(c => ({ claim: c.claim, targets: Array.isArray(c.targets) ? c.targets : [] }));
    const priors = priorClaimsFor(i);
    addCandidate('claim-classification', debateId,
      classifyClaimsPrompt(e.content!, speakerLabel(e.speaker), mc, priors, s.audience),
      { entry_id: e.id, speaker: e.speaker, audience: s.audience ?? null, n_sketches: mc.length, n_prior_claims: priors.length });
  }

  // 8. entailment-check — real (statement, extracted-claim) pairs
  const entailCands: { stmt: string; node: AnNode }[] = [];
  for (const { e } of debaterEntries) {
    for (const n of nodesByEntry.get(e.id) ?? []) {
      entailCands.push({ stmt: e.content!, node: n });
    }
  }
  for (const { stmt, node } of shuffle(entailCands).slice(0, PER_DEBATE_CAP['entailment-check'])) {
    addCandidate('entailment-check', debateId,
      entailmentRepairPrompt(stmt, node.text),
      { claim_id: node.id, bdi_category: node.bdi_category ?? null });
  }

  // 9. evidence-qbaf-classify — persisted evidence graphs
  const withEvidence = an.nodes.filter(n => (n.evidence_graph?.evidence_items?.length ?? 0) > 0);
  for (const n of shuffle(withEvidence).slice(0, PER_DEBATE_CAP['evidence-qbaf-classify'])) {
    const items: EvidenceItem[] = n.evidence_graph!.evidence_items!.map(it => ({
      id: it.id, source_doc_id: it.source_doc_id, text: it.text, similarity_score: it.similarity,
    }));
    addCandidate('evidence-qbaf-classify', debateId,
      buildClassificationPrompt(n.text, items, undefined),
      { claim_id: n.id, evidence_count: items.length });
  }
}

// ── Main ──
const files = shuffle(fs.readdirSync(DATA_DEBATES).filter(f => /^debate-[0-9a-f-]+\.json$/.test(f)));
console.log(`Scanning ${files.length} session files...`);
let parsed = 0, failed = 0;
for (const f of files) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(DATA_DEBATES, f), 'utf8')) as Session;
    processSession(s);
    parsed++;
  } catch (err) {
    failed++;
    console.warn(`  skip ${f}: ${(err as Error).message.slice(0, 120)}`);
  }
}
console.log(`Parsed ${parsed} sessions (${failed} failed).`);

// Final selection: round-robin across debates for diversity, up to PER_SCHEMA_CAP
const out: CorpusItem[] = [];
for (const schema of Object.keys(PER_DEBATE_CAP)) {
  const cands = pools[schema] ?? [];
  const byDebate = new Map<string, Candidate[]>();
  for (const c of cands) {
    (byDebate.get(c.source_debate_id) ?? byDebate.set(c.source_debate_id, []).get(c.source_debate_id)!)
      .push(c);
  }
  const debates = shuffle([...byDebate.keys()]);
  const selected: Candidate[] = [];
  let depth = 0;
  while (selected.length < PER_SCHEMA_CAP) {
    let addedAny = false;
    for (const d of debates) {
      const list = byDebate.get(d)!;
      if (depth < list.length && selected.length < PER_SCHEMA_CAP) {
        selected.push(list[depth]);
        addedAny = true;
      }
    }
    if (!addedAny) break;
    depth++;
  }
  selected.forEach((c, idx) => out.push({
    schema, index: idx, source_debate_id: c.source_debate_id,
    prompt_chars: c.prompt.length, num_predict: NUM_PREDICT[schema],
    meta: c.meta, prompt: c.prompt,
  }));
  const nDebates = new Set(selected.map(c => c.source_debate_id)).size;
  console.log(`${schema}: ${selected.length} prompts from ${nDebates} debates (pool ${cands.length}); ` +
    `chars min/med/max = ${Math.min(...selected.map(c => c.prompt.length))}/` +
    `${selected.map(c => c.prompt.length).sort((a, b) => a - b)[Math.floor(selected.length / 2)] ?? 0}/` +
    `${Math.max(...selected.map(c => c.prompt.length))}`);
}

fs.writeFileSync(OUT_PATH, out.map(o => JSON.stringify(o)).join('\n') + '\n', 'utf8');
console.log(`Wrote ${out.length} prompts -> ${OUT_PATH}`);
