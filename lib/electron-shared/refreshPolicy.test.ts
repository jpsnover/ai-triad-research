// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3553: the pure drop-policy rules (refreshPolicy.ts). The end-to-end refresh paths are in
// modelDiscovery.dropPolicy.test.ts.

import { describe, it, expect } from 'vitest';
import {
  familyOf, curateByFamily, referenceSlots, partialCatalog, codeReferencedAbsent, CODE_LITERAL_SLOT, computeProposal, applyProposal,
  proposalHash, catalogFingerprint, diffProposals, successorOf, crossFamilyChanges, type PolicyConfig, type PolicyModel,
} from './refreshPolicy.js';

const m = (backend: string, id: string, apiModelId = id): PolicyModel => ({ backend, id, apiModelId });
const fam = (model: PolicyModel) => { const f = familyOf(model); return f ? `${f.family} v${f.version.join('.')}` : 'pass-through'; };

describe('familyOf: CL p/742#3 (vendor line + size/variant, version stripped; no version = pass-through)', () => {
  it('gemini by tier, claude by line', () => {
    expect(fam(m('gemini', 'gemini-3.1-pro-preview'))).toBe('gemini-pro v3.1');
    expect(fam(m('gemini', 'gemini-3.5-flash-lite'))).toBe('gemini-flash-lite v3.5');
    expect(fam(m('gemini', 'gemini-3.8-flash'))).toBe('gemini-flash v3.8');
    expect(fam(m('claude', 'claude-sonnet-4-6'))).toBe('claude-sonnet v4.6');
    expect(fam(m('claude', 'claude-opus-5'))).toBe('claude-opus v5.0');
    expect(fam(m('claude', 'claude-3.5-haiku'))).toBe('pass-through');
  });

  it('groq: version stripped, sizes never merged', () => {
    expect(fam(m('groq', 'groq-qwen-qwen3.6-27b', 'qwen/qwen3.6-27b'))).toBe('qwen-27b v3.6');
    expect(fam(m('groq', 'groq-qwen-qwen3.8-27b', 'qwen/qwen3.8-27b'))).toBe('qwen-27b v3.8');
    expect(fam(m('groq', 'groq-llama-3.1-8b-instant', 'llama-3.1-8b-instant'))).toBe('llama-8b-instant v3.1');
    expect(fam(m('groq', 'groq-llama-3.3-70b-versatile', 'llama-3.3-70b-versatile'))).toBe('llama-70b-versatile v3.3');
    // gpt-oss-20b and -120b carry no version: two separate pass-throughs, never one family.
    expect(fam(m('groq', 'groq-openai-gpt-oss-20b', 'openai/gpt-oss-20b'))).toBe('pass-through');
    expect(fam(m('groq', 'groq-openai-gpt-oss-120b', 'openai/gpt-oss-120b'))).toBe('pass-through');
  });

  it('deepseek: v4-flash and v4-pro are separate families; the unversioned alias is pass-through', () => {
    expect(fam(m('deepseek', 'deepseek-deepseek-v4-flash', 'deepseek-v4-flash'))).toBe('deepseek-flash v4');
    expect(fam(m('deepseek', 'deepseek-deepseek-v4-pro', 'deepseek-v4-pro'))).toBe('deepseek-pro v4');
    expect(fam(m('deepseek', 'deepseek-deepseek-flash', 'deepseek-flash'))).toBe('pass-through');
  });

  it('every other backend (ollama, manually curated) is pass-through', () => {
    expect(fam(m('ollama', 'ollama-gemma4-e4b-it-q4-k-m', 'gemma4:e4b-it-q4_K_M'))).toBe('pass-through');
    expect(fam(m('zai', 'zai-glm-5-3', 'glm-5.3'))).toBe('pass-through');
  });
});

describe('curateByFamily: latest per family, pinned ids exempt (SO e/263#2 cond 1)', () => {
  const catalog = [m('claude', 'claude-sonnet-4-6'), m('claude', 'claude-sonnet-5-5'), m('claude', 'claude-opus-4-8'), m('claude', 'claude-opus-5-5')];

  it('without pins: only the newest of each family survives', () => {
    expect(curateByFamily(catalog, new Map()).kept.map((x) => x.id)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5']);
  });

  it('a pinned older model is kept beside the newer one, and reported as an informational candidate', () => {
    const { kept, pinnedCandidates } = curateByFamily(catalog, new Map([['claude-sonnet-4-6', ['defaults.claude']]]));
    expect(kept.map((x) => x.id)).toEqual(['claude-sonnet-4-6', 'claude-sonnet-5-5', 'claude-opus-5-5']);
    expect(pinnedCandidates).toEqual([{ slots: ['defaults.claude'], pinned: 'claude-sonnet-4-6', newerInFamily: 'claude-sonnet-5-5' }]);
  });

  it('pass-through ids are always kept', () => {
    const { kept } = curateByFamily([m('groq', 'a', 'openai/gpt-oss-20b'), m('groq', 'b', 'openai/gpt-oss-120b')], new Map());
    expect(kept).toHaveLength(2);
  });
});

describe('referenceSlots: the pinned set is exactly what findDanglingRefs scans (chain KEYS are inert)', () => {
  it('collects defaults, debate-tier values and chain values; never chain keys or _comment', () => {
    const cfg: PolicyConfig = {
      models: [],
      defaults: { gemini: 'g1' },
      debateTiers: { _comment: 'x', basic: { gemini: 'g2' } },
      fallbackChains: { g1: ['g3'], orphanKey: [] },
    };
    expect(Object.fromEntries(referenceSlots(cfg))).toEqual({
      g1: ['defaults.gemini'], g2: ['debateTiers.basic.gemini'], g3: ['fallbackChains[g1]'],
    });
  });
});

describe('partialCatalog: TL t/3553#5 cond 1, measured before curation', () => {
  it('an empty catalog is suspect', () => {
    expect(partialCatalog('gemini', ['a', 'b'], new Set())).toEqual({ backend: 'gemini', registered: 2, vendorListed: 0, wouldDrop: 2 });
  });
  it('more than half of the registered models absent is suspect; exactly half is not', () => {
    expect(partialCatalog('gemini', ['a', 'b', 'c'], new Set(['a']))).not.toBeNull();
    expect(partialCatalog('gemini', ['a', 'b', 'c', 'd'], new Set(['a', 'b']))).toBeNull();
  });
  it('a healthy catalog with many newer models is not suspect', () => {
    expect(partialCatalog('gemini', ['a', 'b'], new Set(['a', 'b', 'c', 'd', 'e']))).toBeNull();
  });
});

describe('computeProposal + applyProposal', () => {
  const base = (): PolicyConfig => ({
    models: [m('gemini', 'gemini-3.6-pro'), m('gemini', 'gemini-3.5-flash-lite'), m('zai', 'zai-glm')],
    defaults: { gemini: 'gemini-3.1-pro', zai: 'zai-glm' },
    debateTiers: { basic: { gemini: 'gemini-3.5-flash-lite' } },
    fallbackChains: { 'gemini-3.1-pro': ['gemini-3.5-flash-lite'], 'zai-glm': ['gemini-3.1-pro'], 'gemini-3.5-flash-lite': ['gemini-3.1-pro', 'zai-glm'] },
  });
  const removed = [m('gemini', 'gemini-3.1-pro')];

  it('proposes the same-family successor for every slot, plus the chain re-key', () => {
    const { changes } = computeProposal(base(), removed);
    // CL e/263#5: every slot carries its family key and the reason.
    const v = { family: 'gemini-pro', reason: 'vendor-absent' };
    expect(changes).toEqual([
      { slot: 'defaults.gemini', from: 'gemini-3.1-pro', to: 'gemini-3.6-pro', ...v },
      { slot: 'fallbackChains[zai-glm]', from: ['gemini-3.1-pro'], to: ['gemini-3.6-pro'], ...v },
      { slot: 'fallbackChains[gemini-3.5-flash-lite]', from: ['gemini-3.1-pro', 'zai-glm'], to: ['gemini-3.6-pro', 'zai-glm'], ...v },
      { slot: 'fallbackChains{gemini-3.1-pro→gemini-3.6-pro}', from: 'gemini-3.1-pro', to: 'gemini-3.6-pro', ...v },
    ]);
  });

  it('applying it re-points every slot and gives the successor the old chain', () => {
    const cfg = base();
    applyProposal(cfg, computeProposal(cfg, removed).changes);
    expect(cfg.defaults.gemini).toBe('gemini-3.6-pro');
    expect(cfg.fallbackChains!['gemini-3.6-pro']).toEqual(['gemini-3.5-flash-lite']);
    expect(cfg.fallbackChains!['zai-glm']).toEqual(['gemini-3.6-pro']);
  });

  it('a default never changes family: no same-family survivor means `to: null`', () => {
    const cfg = base();
    cfg.models = cfg.models.filter((x) => x.id !== 'gemini-3.6-pro'); // only flash-lite (another family) survives
    expect(computeProposal(cfg, removed).changes.find((c) => c.slot === 'defaults.gemini')).toEqual({ slot: 'defaults.gemini', from: 'gemini-3.1-pro', to: null, family: 'gemini-pro', reason: 'vendor-absent' });
  });

  it('a dead target in a chain that stays non-empty is an automatic prune, not a proposal', () => {
    const cfg: PolicyConfig = { models: [m('gemini', 'a')], defaults: {}, fallbackChains: { a: ['a', 'gone'] } };
    const { changes, autoPrunes } = computeProposal(cfg, []);
    expect(changes).toEqual([]);
    expect(autoPrunes).toEqual(['pruned 1 dangling fallbackChains["a"] target(s)']);
  });

  it('a rolling alias is never proposed as a successor', () => {
    const removedDs = [m('deepseek', 'deepseek-deepseek-v4-flash', 'deepseek-v4-flash')];
    expect(successorOf('deepseek-deepseek-v4-flash', removedDs, [m('deepseek', 'deepseek-deepseek-flash', 'deepseek-flash')])).toBeNull();
  });
});

describe('proposal hash, fingerprint and diff (TL t/3553#5 cond 2)', () => {
  const c1 = { slot: 'defaults.gemini', from: 'a', to: 'b' };
  const c2 = { slot: 'debateTiers.basic.gemini', from: 'x', to: 'y' };
  it('the hash is order-independent and changes with any slot', () => {
    expect(proposalHash([c1, c2])).toBe(proposalHash([c2, c1]));
    expect(proposalHash([c1])).not.toBe(proposalHash([{ ...c1, to: 'c' }]));
  });
  it('the fingerprint is order-independent per backend', () => {
    expect(catalogFingerprint({ g: ['a', 'b'], c: ['x'] })).toBe(catalogFingerprint({ c: ['x'], g: ['b', 'a'] }));
  });
  it('the diff names added, removed and changed slots', () => {
    const d = diffProposals([c1, c2], [{ ...c1, to: 'z' }, { slot: 'defaults.claude', from: 'p', to: 'q' }]);
    expect(d.added.map((c) => c.slot)).toEqual(['defaults.claude']);
    expect(d.removed.map((c) => c.slot)).toEqual(['debateTiers.basic.gemini']);
    expect(d.changed.map((c) => c.slot)).toEqual(['defaults.gemini']);
  });
});

describe('crossFamilyChanges: a default or tier never changes family through refresh (CL p/742#3, TL #2984 review)', () => {
  const merged = (): PolicyConfig => ({
    models: [m('gemini', 'gemini-3.6-pro'), m('gemini', 'gemini-3.8-flash'), m('zai', 'zai-glm')],
    defaults: { gemini: 'gemini-3.1-pro', zai: 'zai-glm' },
    debateTiers: { basic: { gemini: 'gemini-3.5-flash-lite' } },
    fallbackChains: { 'zai-glm': ['gemini-3.6-pro'] },
  });
  const removed = [m('gemini', 'gemini-3.1-pro'), m('gemini', 'gemini-3.5-flash-lite')];

  it('the real successor rule never crosses families: nothing to flag', () => {
    const { changes } = computeProposal(merged(), removed);
    expect(crossFamilyChanges(changes, removed, merged().models)).toEqual([]);
  });

  it('an injected cross-family successor is caught on every default and tier slot it moves', () => {
    // A buggy successor that always picks the flash model, whatever family the old id was in.
    const crossing = () => 'gemini-3.8-flash';
    const { changes } = computeProposal(merged(), removed, crossing);
    expect(crossFamilyChanges(changes, removed, merged().models).sort()).toEqual(['debateTiers.basic.gemini', 'defaults.gemini']);
  });

  it('a successor on another backend is cross-family too, even with a matching family name', () => {
    const changes = [{ slot: 'defaults.gemini', from: 'gemini-3.1-pro', to: 'other-gemini-3.6-pro' }];
    const survivors = [{ backend: 'vertex', id: 'other-gemini-3.6-pro', apiModelId: 'gemini-3.6-pro' }];
    expect(crossFamilyChanges(changes, removed, survivors)).toEqual(['defaults.gemini']);
  });

  it('only selection slots are checked: a chain re-point is not a family move of a default or tier', () => {
    const changes = [{ slot: 'fallbackChains[zai-glm]', from: ['gemini-3.1-pro'], to: ['gemini-3.8-flash'] }];
    expect(crossFamilyChanges(changes, removed, merged().models)).toEqual([]);
  });
});

describe('code-referenced pins (TL checklist e/271#12 items 1, 2, 9; SO e/271)', () => {
  const config: PolicyConfig = { models: [m('gemini', 'gemini-3.1-pro')], defaults: { gemini: 'gemini-3.1-pro' } };

  it('item 1: each code-referenced id is pinned under slot code-literal, alongside any config slots', () => {
    const slots = referenceSlots(config, ['gemini-2.5-pro', 'gemini-3.1-pro', 'gemini-2.5-pro']);
    expect(slots.get('gemini-2.5-pro')).toEqual([CODE_LITERAL_SLOT]); // duplicates in the list collapse
    expect(slots.get('gemini-3.1-pro')).toEqual(['defaults.gemini', CODE_LITERAL_SLOT]);
    expect(CODE_LITERAL_SLOT).toBe('code-literal');
  });

  it('item 9: curation keeps a model named only in code beside a newer family member, and reports it', () => {
    const candidates = [m('gemini', 'gemini-2.5-pro'), m('gemini', 'gemini-3.1-pro')];
    const pinned = curateByFamily(candidates, referenceSlots(config, ['gemini-2.5-pro']));
    expect(pinned.kept.map((x) => x.id).sort()).toEqual(['gemini-2.5-pro', 'gemini-3.1-pro']);
    expect(pinned.pinnedCandidates).toEqual([{ slots: ['code-literal'], pinned: 'gemini-2.5-pro', newerInFamily: 'gemini-3.1-pro' }]);
    // Arm: with no code list, the same curation drops it.
    expect(curateByFamily(candidates, referenceSlots(config)).kept.map((x) => x.id)).toEqual(['gemini-3.1-pro']);
  });

  it('item 2: an authoritative catalog that no longer lists a code-referenced id reports it; a listed id does not', () => {
    const registered = [m('gemini', 'gemini-2.5-pro'), m('gemini', 'gemini-3.1-pro'), m('claude', 'claude-sonnet-4-5')];
    const listed = new Map([['gemini', new Set(['gemini-3.1-pro'])]]);
    expect(codeReferencedAbsent(['gemini-3.1-pro', 'gemini-2.5-pro'], registered, listed)).toEqual([{ id: 'gemini-2.5-pro', backend: 'gemini' }]);
    expect(codeReferencedAbsent(['gemini-3.1-pro'], registered, listed)).toEqual([]);
  });

  it('item 2: no refusal where nothing can be dropped (a non-authoritative backend, or an unregistered id)', () => {
    const registered = [m('claude', 'claude-sonnet-4-5')];
    const listed = new Map([['gemini', new Set<string>(['gemini-3.1-pro'])]]); // claude: probe or untouched
    expect(codeReferencedAbsent(['claude-sonnet-4-5', 'not-registered'], registered, listed)).toEqual([]);
  });
});
