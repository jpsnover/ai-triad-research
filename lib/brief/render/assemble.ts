// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T4 Render — assemble the target-neutral SlideModel[] from deck_spec + narration.
// Runs ONCE; both renderers consume the result so pptx and HTML-for-PDF cannot
// drift. Deterministic, no model.
//
// Gate integrity (TL e/113#2): content is budgeted by a FAIR uniform per-entry cap
// for readability, NOT trimmed to satisfy T5's ±20% parity. Real camp asymmetry
// surfaces to T5. Any trim is sentence-boundary-aware and warns when traced
// content is dropped, preserving the "every sentence traces to a node" invariant.

import type { DeckSpec, Narration, BriefPreset, FactCheckVerdict } from '../types.js';
import { buildTrace } from '../traceResolver.js';
import type { SlideModel, SlideBlock, CampCard, TraceRef, SlideKind } from './slideModel.js';
import { campColor } from './deckTheme.js';
import { profileFor } from './presets.js';

export interface AssembleResult {
  slides: SlideModel[];
  warnings: string[];
}

/** Options for overriding the preset's default slide selection (t/2838, T7-v2). */
export interface AssembleOptions {
  /** Slide kinds to drop from the preset's ordered list. Required slides are never dropped. */
  excludeSlides?: ReadonlySet<SlideKind>;
}

const REQUIRED_SLIDES: ReadonlySet<SlideKind> = new Set<SlideKind>([
  'title', 'question', 'provenance',
]);

export function assemble(spec: DeckSpec, narration: Narration, preset: BriefPreset, options?: AssembleOptions): AssembleResult {
  const ctx = new AssembleCtx(spec, narration, preset);
  const profile = profileFor(preset);
  const kindList = options?.excludeSlides
    ? profile.slides.filter(k => REQUIRED_SLIDES.has(k) || !options.excludeSlides!.has(k))
    : profile.slides;
  const slides: SlideModel[] = [];

  for (const kind of kindList) {
    const slide = ctx.buildSlide(kind);
    if (slide === null) continue; // graceful-omit: no content and not required
    slides.push(slide);
  }

  return { slides, warnings: ctx.warnings };
}

/** Word-count helper (shared with T5's definition of word budget). */
function countWords(text: string): number {
  const t = text.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

class AssembleCtx {
  readonly warnings: string[] = [];
  /** trace → narrated text, for compressing spec copy to slide length. */
  private readonly narratedByTrace: Map<string, string>;
  private readonly snapshot: boolean;

  constructor(
    private readonly spec: DeckSpec,
    private readonly narration: Narration,
    private readonly preset: BriefPreset,
  ) {
    this.narratedByTrace = new Map();
    for (const e of narration.entries) this.narratedByTrace.set(e.trace, e.text);
    this.snapshot = spec.meta.snapshot === true;
  }

  private watermark(): string | undefined {
    return this.snapshot ? 'IN PROGRESS' : undefined;
  }

  /**
   * Display copy for a spec node: the narrated (compressed) text when the model
   * produced one for this exact trace, else the verbatim spec text. Applies the
   * preset's uniform readability cap with sentence-boundary trimming; warns if
   * traced content is dropped.
   */
  private display(trace: string, verbatim: string): string {
    const narrated = this.narratedByTrace.get(trace) ?? verbatim;
    return this.capToSentences(narrated, trace);
  }

  private capToSentences(text: string, trace: string): string {
    const cap = profileFor(this.preset).perEntryWordCap;
    if (countWords(text) <= cap) return text;
    const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
    const kept: string[] = [];
    let words = 0;
    for (const s of sentences) {
      const w = countWords(s);
      if (words + w > cap && kept.length > 0) break;
      kept.push(s.trim());
      words += w;
    }
    const result = kept.join(' ').trim();
    if (countWords(result) < countWords(text)) {
      this.warnings.push(
        `content_trimmed: slide copy for trace "${trace}" exceeded the ${cap}-word ` +
        `cap and was trimmed at a sentence boundary (full text is in the audit trail).`,
      );
    }
    return result;
  }

  /** A speaker note carries the VERBATIM spec text + the node's own trace (never fabricated). */
  private note(trace: string, verbatim: string): TraceRef {
    return { text: verbatim, trace };
  }

  /** Finish a slide; graceful-empty per ADR-001: omit contentless optional slides, warn on required. */
  private finish(kind: SlideKind, title: string, blocks: SlideBlock[], notes: TraceRef[]): SlideModel | null {
    const hasContent = blocks.some(b => blockHasContent(b));
    if (!hasContent) {
      if (REQUIRED_SLIDES.has(kind)) {
        this.warnings.push(`empty_required_slide: "${kind}" has no content but is a required slide`);
      } else {
        return null; // graceful omit
      }
    }
    return { kind, title, blocks, speakerNotes: notes, watermark: this.watermark() };
  }

  buildSlide(kind: SlideKind): SlideModel | null {
    switch (kind) {
      case 'title': return this.title();
      case 'question': return this.question();
      case 'how_to_read': return this.howToRead();
      case 'agreements': return this.agreements();
      case 'positions': return this.positions();
      case 'empirical_cruxes': return this.cruxes('EMPIRICAL', 'Empirical Cruxes');
      case 'values_cruxes': return this.cruxes('VALUES', 'Values Crux(es)');
      case 'audience_questions': return this.audienceQuestions();
      case 'change_minds': return this.changeMinds();
      case 'evidence_shelf': return this.evidenceShelf();
      case 'provenance': return this.provenance();
      case 'framing_meta': return this.framingMeta();
      case 'glossary': return this.glossary();
      case 'open_threads_appendix': return this.openThreadsAppendix();
    }
  }

  // ── Slide builders ───────────────────────────────────────────────────────────

  private title(): SlideModel | null {
    const m = this.spec.meta;
    const blocks: SlideBlock[] = [
      { type: 'text', text: m.title },
      { type: 'note', text: `Narrated by ${this.narration.narrator_model} · ${this.preset} brief` },
    ];
    return this.finish('title', m.title, blocks, []);
  }

  private question(): SlideModel | null {
    const q = this.spec.question;
    const trace = buildTrace(['question', 'core_proposition']);
    const blocks: SlideBlock[] = [{ type: 'text', text: this.display(trace, q.core_proposition) }];
    if (q.time_horizon) blocks.push({ type: 'note', text: `Time horizon: ${q.time_horizon}` });
    if (q.tensions && q.tensions.length > 0) blocks.push({ type: 'bullets', items: q.tensions });
    return this.finish('question', 'The Question', blocks, [this.note(buildTrace(['question']), q.core_proposition)]);
  }

  private howToRead(): SlideModel | null {
    const camps = distinctCamps(this.spec.top_claims.map(c => c.camp));
    const legend: SlideBlock = {
      type: 'badge_row',
      badges: camps.map(c => ({ label: c, value: `#${campColor(c)}` })),
    };
    const kinds: SlideBlock = {
      type: 'bullets',
      items: [
        'EMPIRICAL — resolvable by evidence',
        'VALUES — a values choice, not settled by evidence',
        'Verdict badges: Supported / Disputed / Unverifiable',
      ],
    };
    return this.finish('how_to_read', 'How to Read This Debate', [legend, kinds], []);
  }

  private agreements(): SlideModel | null {
    const items: string[] = [];
    const notes: TraceRef[] = [];
    this.spec.agreements.forEach((a, i) => {
      const trace = buildTrace(['agreements', i]);
      items.push(this.display(trace, a.text));
      notes.push(this.note(trace, a.text));
    });
    return this.finish('agreements', 'Where All Camps Agree', [{ type: 'bullets', items }], notes);
  }

  private positions(): SlideModel | null {
    const camps = distinctCamps(this.spec.top_claims.map(c => c.camp));
    const notes: TraceRef[] = [];
    const cards: CampCard[] = camps.map(camp => {
      const lines: string[] = [];
      this.spec.top_claims.forEach((c, i) => {
        if (c.camp !== camp) return;
        const trace = buildTrace(['top_claims', i]);
        lines.push(this.display(trace, c.claim));
        notes.push(this.note(trace, c.claim));
      });
      return { camp, title: camp.toUpperCase(), lines };
    });
    return this.finish('positions', 'The Positions', [{ type: 'card_row', cards }], notes);
  }

  private cruxes(kind: 'EMPIRICAL' | 'VALUES', title: string): SlideModel | null {
    const blocks: SlideBlock[] = [];
    const notes: TraceRef[] = [];
    this.spec.cruxes.forEach((c, i) => {
      if (c.kind !== kind) return;
      const trace = buildTrace(['cruxes', i]);
      blocks.push({ type: 'fork', prompt: this.display(trace, c.text), ifYes: c.if_yes, ifNo: c.if_no });
      notes.push(this.note(trace, c.text));
    });
    if (kind === 'VALUES' && blocks.length > 0) {
      blocks.push({ type: 'note', text: 'These are values choices — not resolvable by evidence.' });
    }
    return this.finish(kind === 'EMPIRICAL' ? 'empirical_cruxes' : 'values_cruxes', title, blocks, notes);
  }

  private audienceQuestions(): SlideModel | null {
    const items: string[] = [];
    const notes: TraceRef[] = [];
    for (const q of this.narration.audience_questions) {
      items.push(q.question);
      notes.push(this.note(q.trace, q.question));
    }
    return this.finish('audience_questions', 'Questions to Ask Yourself', [{ type: 'bullets', items }], notes);
  }

  private changeMinds(): SlideModel | null {
    const blocks: SlideBlock[] = [];
    const notes: TraceRef[] = [];
    const falsifiers = this.spec.resolution_analysis.would_change_if ?? [];
    if (falsifiers.length > 0) {
      blocks.push({ type: 'bullets', items: falsifiers.map(f => `${f.camp.toUpperCase()}: ${f.falsifier}`) });
      falsifiers.forEach((f, i) =>
        notes.push(this.note(buildTrace(['resolution_analysis', 'would_change_if', i]), f.falsifier)));
    }
    if (this.spec.concessions.length > 0) {
      blocks.push({
        type: 'table',
        headers: ['Camp', 'Asserted', 'Conceded', 'Challenged'],
        rows: this.spec.concessions.map(c => [c.camp.toUpperCase(), String(c.asserted), String(c.conceded), String(c.challenged)]),
      });
      const zero = this.spec.concessions.filter(c => c.conceded === 0).map(c => c.camp.toUpperCase());
      if (zero.length > 0) blocks.push({ type: 'note', text: `Conceded nothing: ${zero.join(', ')}` });
    }
    return this.finish('change_minds', 'What Would Change Their Minds', blocks, notes);
  }

  private evidenceShelf(): SlideModel | null {
    const counts: Partial<Record<FactCheckVerdict, number>> = {};
    for (const fc of this.spec.fact_checks) counts[fc.verdict] = (counts[fc.verdict] ?? 0) + 1;
    const blocks: SlideBlock[] = [{
      type: 'badge_row',
      badges: (['Supported', 'Disputed', 'Unverifiable'] as FactCheckVerdict[])
        .filter(v => counts[v]).map(v => ({ label: v, value: String(counts[v]) })),
    }];
    const notes: TraceRef[] = [];
    // Disputed verdicts are ALWAYS surfaced, never dropped (spec §2.1 hygiene).
    const disputed = this.spec.fact_checks
      .map((fc, i) => ({ fc, i }))
      .filter(({ fc }) => fc.verdict === 'Disputed');
    if (disputed.length > 0) {
      blocks.push({
        type: 'bullets',
        items: disputed.map(({ fc }) => `${fc.claim}${fc.explanation ? ` — ${fc.explanation}` : ''}`),
      });
      disputed.forEach(({ fc, i }) => notes.push(this.note(buildTrace(['fact_checks', i]), fc.claim)));
    }
    return this.finish('evidence_shelf', 'The Evidence Shelf', blocks, notes);
  }

  private provenance(): SlideModel | null {
    const m = this.spec.meta;
    const fc = this.spec.framing_critique;
    const blocks: SlideBlock[] = [
      { type: 'bullets', items: [
        `Debate phase: ${m.phase}`,
        `Framing critique: ${fc.rating} (composite ${fc.composite})`,
        `Pipeline: Extract → Narrate (${this.narration.narrator_model}) → Render → Verify`,
      ] },
    ];
    if (this.spec.open_threads.length > 0) {
      blocks.push({ type: 'note', text: `Open threads: ${this.spec.open_threads.map(t => t.text).join('; ')}` });
    }
    // Live-URL disclosure (spec §10): the debate links out; warn when not in community.
    blocks.push({ type: 'note', text: 'Source debate is linked; sign-in may be required if it is not a community debate.' });
    if (this.snapshot) {
      blocks.push({ type: 'note', text: `Snapshot of an in-progress debate${m.snapshot_note ? ` — ${m.snapshot_note}` : ''}.` });
    }
    return this.finish('provenance', 'Provenance', blocks, []);
  }

  private framingMeta(): SlideModel | null {
    const fc = this.spec.framing_critique;
    const blocks: SlideBlock[] = [
      { type: 'text', text: `Motion rated: ${fc.rating} (composite ${fc.composite})` },
    ];
    if (fc.rewritten_motion) {
      blocks.push({ type: 'note', text: `Reframed motion: ${fc.rewritten_motion}` });
    }
    return this.finish('framing_meta', 'Framing Critique', blocks,
      [this.note(buildTrace(['framing_critique']), fc.rewritten_motion ?? fc.rating)]);
  }

  private glossary(): SlideModel | null {
    // deck_spec carries no glossary payload; this is a static divider pointing at
    // the Taxonomy Vocabulary System (spec §3). Not fabricated content.
    const blocks: SlideBlock[] = [
      { type: 'note', text: 'Key terms are defined in the Taxonomy Vocabulary System.' },
    ];
    return this.finish('glossary', 'Glossary', blocks, []);
  }

  private openThreadsAppendix(): SlideModel | null {
    const items: string[] = [];
    const notes: TraceRef[] = [];
    this.spec.open_threads.forEach((t, i) => {
      const trace = buildTrace(['open_threads', i]);
      items.push(t.text);
      notes.push(this.note(trace, t.text));
    });
    return this.finish('open_threads_appendix', 'Appendix: Open Threads', [{ type: 'bullets', items }], notes);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function distinctCamps(camps: string[]): string[] {
  return [...new Set(camps)].sort();
}

function blockHasContent(b: SlideBlock): boolean {
  switch (b.type) {
    case 'text': return b.text.trim() !== '';
    case 'note': return b.text.trim() !== '';
    case 'bullets': return b.items.length > 0;
    case 'card_row': return b.cards.some(c => c.lines.length > 0);
    case 'fork': return b.prompt.trim() !== '';
    case 'badge_row': return b.badges.length > 0;
    case 'table': return b.rows.length > 0;
  }
}
