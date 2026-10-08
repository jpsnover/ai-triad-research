// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Model-registry refresh policy (t/3553). PURE: no I/O, no logger, so every rule here is unit-testable and the
 * refresh orchestrator (modelDiscovery.ts) only wires it to the network and the file.
 *
 * Design: t/3553#6 (TL t/3553#5; SO e/263#2, #4; TL e/263#3; CL p/742#3). In one line: a replace-mode refresh
 * curates each vendor catalog to the latest model per FAMILY, but it never moves a selection surface on its own.
 * Anything that would change a `defaults` / `debateTiers` value, or re-point or empty a `fallbackChains` entry, is
 * returned as a PROPOSAL, and only an explicit accept of that exact proposal writes it.
 *
 *   - Family key (CL p/742#3): vendor model line + size/variant, version stripped. Sizes never merge (gpt-oss-20b vs
 *     -120b, llama 8b vs 70b are different tiers). An id with no version is a rolling alias: pass-through, and never
 *     a successor. Unknown shapes are pass-through.
 *   - Pinned set (SO e/263#2 cond 1): every id the config REFERENCES (the same three surfaces findDanglingRefs scans:
 *     defaults values, debateTiers values, fallbackChains VALUES) is exempt from family curation. Only vendor absence
 *     can make a reference dangle. A pinned id kept beside a newer family member is reported in `pinnedCandidates`
 *     (TL e/263#3), never in the proposal (SO e/263#4), so it can't make an accept fail. Every id CODE names as a
 *     literal (`lib/ai-config/codeReferencedModels.json`) is pinned too, under slot `code-literal`. If the vendor
 *     drops one, the refresh refuses as `code-referenced-absent`, because no proposal can fix code (e/271#12 1-2).
 *   - A default or debate tier never changes family through refresh (CL p/742#3): a successor is always the newest
 *     surviving member of the SAME family on the SAME backend, or there is none and a human decides.
 *   - An ACCEPTED change to a default or debate tier starts a calibration epoch (CL e/263#5): the refresh records
 *     who, why, when and old→new in `result.signoff` and the flight recorder.
 *     NOT ENFORCED (SO e/263#6): a HAND edit of `defaults`/`debateTiers` in ai-models.json (e.g. adopting a
 *     `pinnedCandidates` upgrade) bypasses this tool, so nothing records the epoch. Manual edits must add the
 *     calibration-register entry by hand until a verify:config check exists (follow-up t/4032).
 */

import { createHash } from 'node:crypto';
import { KNOWN_VERBATIM } from '../ai-config/validate.js';

export interface PolicyModel {
  id: string;
  apiModelId: string;
  backend: string;
}

export interface PolicyConfig {
  models: PolicyModel[];
  defaults: Record<string, string>;
  debateTiers?: Record<string, string | Record<string, string>>;
  fallbackChains?: Record<string, string[]>;
}

// ── Family keys ──────────────────────────────────────────────────────────────────────────────────

export interface Family {
  family: string;
  version: number[];
}

const GEMINI_RE = /^gemini-(\d+(?:\.\d+)*)-(pro|flash-lite|flash)(?:-|$)/;
const CLAUDE_RE = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?$/;
const VERSION_TOKEN_RE = /^v?(\d+(?:\.\d+)*)$/;
const NAME_VERSION_TOKEN_RE = /^([a-z]+)(\d+(?:\.\d+)*)$/;
const SIZE_TOKEN_RE = /^\d+(?:\.\d+)?[bm]$/;

const parseVersion = (s: string): number[] => s.split('.').map(Number);

/**
 * CL's generic rule for vendors without a tier scheme (groq, deepseek): strip the org prefix, then split on '-'.
 * A pure version token (`3.3`, `v4`) or a trailing version glued to a name (`qwen3.6`) is the version; size tokens
 * (`27b`, `120b`) and words stay in the family. No version found means a rolling alias: null (pass-through).
 */
function genericFamily(apiModelId: string): Family | null {
  const tokens = apiModelId.toLowerCase().replace(/^[^/]+\//, '').split('-').filter(Boolean);
  const familyParts: string[] = [];
  let version: number[] | null = null;
  for (const t of tokens) {
    if (SIZE_TOKEN_RE.test(t)) { familyParts.push(t); continue; }
    const v = VERSION_TOKEN_RE.exec(t);
    if (v && version === null) { version = parseVersion(v[1]); continue; }
    const nv = NAME_VERSION_TOKEN_RE.exec(t);
    if (nv && version === null) { familyParts.push(nv[1]); version = parseVersion(nv[2]); continue; }
    familyParts.push(t);
  }
  return version && familyParts.length > 0 ? { family: familyParts.join('-'), version } : null;
}

/** The model's family and version, or null when it has none (pass-through: always kept, never a successor). */
export function familyOf(model: PolicyModel): Family | null {
  switch (model.backend) {
    case 'gemini': {
      const m = GEMINI_RE.exec(model.id);
      return m ? { family: `gemini-${m[2]}`, version: parseVersion(m[1]) } : null;
    }
    case 'claude': {
      const m = CLAUDE_RE.exec(model.id);
      return m ? { family: `claude-${m[1]}`, version: [Number(m[2]), Number(m[3] ?? 0)] } : null;
    }
    case 'groq':
    case 'deepseek':
      return genericFamily(model.apiModelId);
    default:
      return null; // ollama (local installs) and every manually curated backend
  }
}

/** Newer-than comparison: higher version wins; at an equal version the shorter id (the stable alias) wins. */
function isNewer(a: { model: PolicyModel; f: Family }, b: { model: PolicyModel; f: Family }): boolean {
  const n = Math.max(a.f.version.length, b.f.version.length);
  for (let i = 0; i < n; i++) {
    const d = (a.f.version[i] ?? 0) - (b.f.version[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return a.model.id.length < b.model.id.length;
}

// ── Pinned set ───────────────────────────────────────────────────────────────────────────────────

/** The slot a code-referenced pin is reported under (TL checklist e/271#12 item 1). */
export const CODE_LITERAL_SLOT = 'code-literal';

/**
 * id -> the slots that reference it. The config surfaces are exactly the ones findDanglingRefs scans (chain KEYS are
 * inert). `codeReferenced` is `lib/ai-config/codeReferencedModels.json`'s `ids`: every registered id written as a
 * literal in code (t/3553 item 1, SO e/271). Each is pinned under the `code-literal` slot, so curation can never drop
 * a model code still names.
 */
export function referenceSlots(config: PolicyConfig, codeReferenced: readonly string[] = []): Map<string, string[]> {
  const slots = new Map<string, string[]>();
  const add = (id: string, slot: string) => slots.set(id, [...(slots.get(id) ?? []), slot]);
  for (const [backend, id] of Object.entries(config.defaults ?? {})) add(id, `defaults.${backend}`);
  for (const [tier, value] of Object.entries(config.debateTiers ?? {})) {
    if (tier === '_comment' || value === null || typeof value !== 'object') continue;
    for (const [backend, id] of Object.entries(value)) add(id, `debateTiers.${tier}.${backend}`);
  }
  for (const [key, chain] of Object.entries(config.fallbackChains ?? {})) {
    for (const id of chain) add(id, `fallbackChains[${key}]`);
  }
  for (const id of new Set(codeReferenced)) add(id, CODE_LITERAL_SLOT);
  return slots;
}

export interface CodeReferencedAbsence {
  id: string;
  backend: string;
}

/**
 * Code-referenced ids that a refresh would drop because the vendor no longer lists them (TL checklist e/271#12
 * item 2; SO e/271 cond 1). Only a registered id on a backend whose catalog is AUTHORITATIVE can be dropped, so
 * only those are checked. A probe or an untouched backend drops nothing. No proposal can fix this: the code
 * itself has to change, so the caller refuses outright. Run it AFTER `partialCatalog`, so a mass absence still
 * reads as an outage.
 */
export function codeReferencedAbsent(
  codeReferenced: readonly string[],
  registered: readonly PolicyModel[],
  vendorListedByBackend: ReadonlyMap<string, ReadonlySet<string>>,
): CodeReferencedAbsence[] {
  const backendOf = new Map(registered.map((m) => [m.id, m.backend]));
  const absent: CodeReferencedAbsence[] = [];
  for (const id of [...new Set(codeReferenced)].sort()) {
    const backend = backendOf.get(id);
    const listed = backend === undefined ? undefined : vendorListedByBackend.get(backend);
    if (backend !== undefined && listed !== undefined && !listed.has(id)) absent.push({ id, backend });
  }
  return absent;
}

// ── Curation ─────────────────────────────────────────────────────────────────────────────────────

export interface PinnedCandidate {
  /** Every config slot that pins `pinned`. */
  slots: string[];
  pinned: string;
  /** The newest member of the same family the catalog offers. */
  newerInFamily: string;
}

/**
 * Latest model per family, plus every pinned id the catalog still lists, plus every pass-through id. Returns what
 * to keep and, for each pinned id kept beside a newer family member, an informational candidate.
 */
export function curateByFamily<M extends PolicyModel>(
  candidates: M[],
  pinned: ReadonlyMap<string, string[]>,
): { kept: M[]; pinnedCandidates: PinnedCandidate[] } {
  const newest = new Map<string, { model: M; f: Family }>();
  for (const model of candidates) {
    const f = familyOf(model);
    if (!f) continue;
    const cur = newest.get(f.family);
    if (!cur || isNewer({ model, f }, cur)) newest.set(f.family, { model, f });
  }
  const kept: M[] = [];
  const pinnedCandidates: PinnedCandidate[] = [];
  for (const model of candidates) {
    const f = familyOf(model);
    const top = f ? newest.get(f.family)!.model : model;
    if (top === model) { kept.push(model); continue; }
    const slots = pinned.get(model.id);
    if (slots) {
      kept.push(model);
      pinnedCandidates.push({ slots, pinned: model.id, newerInFamily: top.id });
    }
  }
  return { kept, pinnedCandidates };
}

// ── Partial-catalog check (TL t/3553#5 cond 1, measured before curation per SO e/263#2) ─────────────

export interface PartialCatalog {
  backend: string;
  registered: number;
  vendorListed: number;
  wouldDrop: number;
}

/**
 * Suspect a partial catalog when the vendor lists nothing, or when more than half of this backend's registered
 * models are absent from what the vendor lists BEFORE curation (so curation alone never trips it).
 */
export function partialCatalog(backend: string, registered: readonly string[], vendorListed: ReadonlySet<string>): PartialCatalog | null {
  const wouldDrop = registered.filter((id) => !vendorListed.has(id)).length;
  const suspect = vendorListed.size === 0 || (registered.length > 0 && wouldDrop * 2 > registered.length);
  return suspect ? { backend, registered: registered.length, vendorListed: vendorListed.size, wouldDrop } : null;
}

// ── Proposal ─────────────────────────────────────────────────────────────────────────────────────

export interface ProposedChange {
  /** `defaults.<backend>`, `debateTiers.<tier>.<backend>`, `fallbackChains[<key>]`, or `fallbackChains{<old>→<new>}` (re-key). */
  slot: string;
  from: string | string[];
  /** null = no same-family successor exists: a human must decide, so the proposal can't be accepted. */
  to: string | string[] | null;
  /** The family the slot stays in (CL e/263#5), or null when the old id has none. Derived, so not hashed. */
  family?: string | null;
  /** Why the slot must change. Today the only cause is the vendor no longer listing the model (CL e/263#5). */
  reason?: 'vendor-absent';
}

export interface Proposal {
  /** sha256 over the per-backend vendor id lists, so a reviewer can see the catalog moved (TL t/3553#5 cond 2). */
  catalogFingerprint: string;
  /** sha256 over `changes` only: what an accept pins and compares (SO e/263#4). */
  hash: string;
  changes: ProposedChange[];
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export function catalogFingerprint(vendorIdsByBackend: Record<string, readonly string[]>): string {
  const canonical = Object.keys(vendorIdsByBackend).sort().map((b) => [b, [...vendorIdsByBackend[b]].sort()]);
  return `sha256:${sha256(JSON.stringify(canonical))}`;
}

export function proposalHash(changes: readonly ProposedChange[]): string {
  const canonical = [...changes].sort((a, b) => a.slot.localeCompare(b.slot)).map((c) => [c.slot, c.from, c.to]);
  return `sha256:${sha256(JSON.stringify(canonical))}`;
}

/** The newest surviving SAME-family model on the same backend; never a pass-through (unversioned) id. */
export function successorOf(oldId: string, removed: readonly PolicyModel[], survivors: readonly PolicyModel[]): string | null {
  const old = removed.find((m) => m.id === oldId);
  const f = old ? familyOf(old) : null;
  if (!old || !f) return null;
  let best: { model: PolicyModel; f: Family } | null = null;
  for (const model of survivors) {
    if (model.backend !== old.backend) continue;
    const mf = familyOf(model);
    if (!mf || mf.family !== f.family) continue;
    if (!best || isNewer({ model, f: mf }, best)) best = { model, f: mf };
  }
  return best ? best.model.id : null;
}

/**
 * Everything a refresh would have to change in the selection surfaces of `merged` (the config whose `models` is the
 * post-merge list). `removed` is what the merge dropped, for family lookup. Also returns the chain-target prunes that
 * leave a chain non-empty: those stay automatic (a dead target is already a no-op) and are only logged.
 */
interface ProposalContext {
  resolves: (id: string) => boolean;
  succ: (id: string) => string | null;
}

/** Selection slots (`defaults.*`, `debateTiers.*.*`) whose model no longer resolves. */
function selectionChanges(merged: PolicyConfig, ctx: ProposalContext): ProposedChange[] {
  const changes: ProposedChange[] = [];
  for (const [backend, id] of Object.entries(merged.defaults ?? {})) {
    if (!ctx.resolves(id)) changes.push({ slot: `defaults.${backend}`, from: id, to: ctx.succ(id) });
  }
  for (const [tier, value] of Object.entries(merged.debateTiers ?? {})) {
    if (tier === '_comment' || value === null || typeof value !== 'object') continue;
    for (const [backend, id] of Object.entries(value)) {
      if (!ctx.resolves(id)) changes.push({ slot: `debateTiers.${tier}.${backend}`, from: id, to: ctx.succ(id) });
    }
  }
  return changes;
}

/** One chain with dead targets: re-pointed (a proposal), emptied (a proposal, `to: null`), or pruned (automatic). */
function chainOutcome(key: string, chain: string[], ctx: ProposalContext): { change?: ProposedChange; prune?: string } {
  const next: string[] = [];
  let repointed = false;
  for (const id of chain) {
    const target = ctx.resolves(id) ? id : ctx.succ(id);
    if (target && target !== id) repointed = true;
    if (target && !next.includes(target)) next.push(target);
  }
  if (next.length === 0) return { change: { slot: `fallbackChains[${key}]`, from: chain, to: null } };
  if (repointed) return { change: { slot: `fallbackChains[${key}]`, from: chain, to: next } };
  return { prune: `pruned ${chain.length - next.length} dangling fallbackChains["${key}"] target(s)` };
}

/** A default that moves to a successor needs a chain under the successor's id (findChainlessDefaults). */
function rekeyChanges(merged: PolicyConfig, selection: readonly ProposedChange[]): ProposedChange[] {
  return selection
    .filter((c): c is ProposedChange & { from: string; to: string } => c.slot.startsWith('defaults.') && typeof c.to === 'string')
    .filter((c) => !merged.fallbackChains?.[c.to]?.length && (merged.fallbackChains?.[c.from]?.length ?? 0) > 0)
    .map((c) => ({ slot: `fallbackChains{${c.from}→${c.to}}`, from: c.from, to: c.to }));
}

export type SuccessorFn = (oldId: string, removed: readonly PolicyModel[], survivors: readonly PolicyModel[]) => string | null;

export function computeProposal(
  merged: PolicyConfig,
  removed: readonly PolicyModel[],
  successor: SuccessorFn = successorOf,
): { changes: ProposedChange[]; autoPrunes: string[] } {
  const ids = new Set(merged.models.map((m) => m.id));
  const ctx: ProposalContext = {
    resolves: (id) => ids.has(id) || KNOWN_VERBATIM.has(id),
    succ: (id) => successor(id, removed, merged.models),
  };
  const selection = selectionChanges(merged, ctx);
  const changes: ProposedChange[] = [...selection];
  const autoPrunes: string[] = [];
  for (const [key, chain] of Object.entries(merged.fallbackChains ?? {})) {
    if (chain.every(ctx.resolves)) continue;
    const { change, prune } = chainOutcome(key, chain, ctx);
    if (change) changes.push(change);
    if (prune) autoPrunes.push(prune);
  }
  changes.push(...rekeyChanges(merged, selection));
  // CL e/263#5: every write-affecting slot shows its family key and the reason. A chain slot carries the family
  // of its first dead target; a re-key carries the moved default's family.
  const familyOfId = (id: string) => { const m = removed.find((r) => r.id === id); const f = m ? familyOf(m) : null; return f ? f.family : null; };
  const firstDead = (c: ProposedChange) => (Array.isArray(c.from) ? c.from.find((id) => !ctx.resolves(id)) : c.from);
  return { changes: changes.map((c) => ({ ...c, family: familyOfId(firstDead(c) ?? ''), reason: 'vendor-absent' as const })), autoPrunes };
}

/**
 * CL p/742#3, enforced rather than assumed (TL review of #2984): a `defaults` or `debateTiers` slot must never change
 * family through refresh. successorOf only ever picks a same-family model, so today this returns []; it exists so a
 * future successor rule (or a bug in this one) can't move a calibration-bearing slot across families unnoticed.
 * Returns the offending slots. An old id with no family moving to any model also counts.
 */
export function crossFamilyChanges(
  changes: readonly ProposedChange[],
  removed: readonly PolicyModel[],
  survivors: readonly PolicyModel[],
): string[] {
  const familyKey = (id: string, pool: readonly PolicyModel[]): string | null => {
    const model = pool.find((x) => x.id === id);
    const f = model ? familyOf(model) : null;
    return model && f ? `${model.backend}:${f.family}` : null;
  };
  return changes
    .filter((c) => (c.slot.startsWith('defaults.') || c.slot.startsWith('debateTiers.')) && typeof c.from === 'string' && typeof c.to === 'string')
    .filter((c) => {
      const from = familyKey(c.from as string, removed);
      return from === null || from !== familyKey(c.to as string, survivors);
    })
    .map((c) => c.slot);
}

/**
 * Apply an accepted proposal to `merged` in place. Callers must have checked that no change has `to: null`.
 * Two phases: slot values first, then re-keys, so a re-keyed chain copies the already re-pointed targets.
 */
export function applyProposal(merged: PolicyConfig, changes: readonly ProposedChange[]): void {
  const rekeys: [string, string][] = [];
  for (const c of changes) {
    let m: RegExpExecArray | null;
    if ((m = /^defaults\.(.+)$/.exec(c.slot))) {
      merged.defaults[m[1]] = c.to as string;
    } else if ((m = /^debateTiers\.([^.]+)\.(.+)$/.exec(c.slot))) {
      (merged.debateTiers![m[1]] as Record<string, string>)[m[2]] = c.to as string;
    } else if ((m = /^fallbackChains\[(.+)\]$/.exec(c.slot))) {
      merged.fallbackChains![m[1]] = c.to as string[];
    } else if ((m = /^fallbackChains\{(.+)→(.+)\}$/.exec(c.slot))) {
      rekeys.push([m[1], m[2]]);
    }
  }
  for (const [from, to] of rekeys) {
    // The successor's chain is the old one minus the successor itself (a model never fails over to itself).
    merged.fallbackChains![to] = (merged.fallbackChains![from] ?? []).filter((id) => id !== to);
  }
}

/** Slot-level diff of an accepted proposal against the recomputed one (TL t/3553#5 cond 2). */
export function diffProposals(accepted: readonly ProposedChange[], recomputed: readonly ProposedChange[]): {
  added: ProposedChange[]; removed: ProposedChange[]; changed: { slot: string; accepted: ProposedChange; recomputed: ProposedChange }[];
} {
  const a = new Map(accepted.map((c) => [c.slot, c]));
  const r = new Map(recomputed.map((c) => [c.slot, c]));
  const same = (x: ProposedChange, y: ProposedChange) => JSON.stringify([x.from, x.to]) === JSON.stringify([y.from, y.to]);
  return {
    added: [...r.values()].filter((c) => !a.has(c.slot)),
    removed: [...a.values()].filter((c) => !r.has(c.slot)),
    changed: [...r.values()].filter((c) => a.has(c.slot) && !same(a.get(c.slot)!, c))
      .map((c) => ({ slot: c.slot, accepted: a.get(c.slot)!, recomputed: c })),
  };
}
