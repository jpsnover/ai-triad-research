// @vitest-environment node
//
// t/2804 (T6, spec §6) — Brief-export model resolution precedence + the two
// server invariants:
//   1. the model id is ALWAYS validated against the registry (unregistered ⇒ ok:false),
//      never trusted from the client;
//   2. export is BILLABLE, so resolution flows through resolveGenerationContext (tier
//      pinning) — the returned {tier, backend} is what the route hands to
//      enforceBackendAllowed. A free tier asking for a premium id is PINNED (source
//      collapses to Default), never served the premium id.
//
// The provenance LABEL (Explicit/Global/Default) is disclosure only and derives from
// where the RESOLVED model came from — proven exhaustively below.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage } from 'http';

const { isRegisteredModel, resolveGenerationContext } = vi.hoisted(() => ({
  isRegisteredModel: vi.fn(() => true),
  resolveGenerationContext: vi.fn(),
}));
vi.mock('../ai/aiBackends.js', () => ({ isRegisteredModel }));
vi.mock('../routes/generationContext.js', () => ({ resolveGenerationContext }));
vi.mock('../../../../lib/ai-client/index.js', () => ({ DEFAULT_MODEL: 'gemini-2.5-flash' }));

import { resolveExportModel } from '../routes/exportModel.js';

const req = { url: '/x', headers: {} } as IncomingMessage;

// Default context: the asked model is honored on a platform tier (gemini backend).
function ctx(over: Partial<{ tier: unknown; effectiveModel: string; backend: string }> = {}) {
  return {
    tier: { level: 'platform', allowedBackends: ['gemini', 'claude'], pinnedModel: undefined },
    effectiveModel: 'claude-opus-4',
    backend: 'claude',
    ...over,
  };
}

describe('resolveExportModel — §6 precedence + registry + tier pinning (t/2804)', () => {
  beforeEach(() => {
    isRegisteredModel.mockReset().mockReturnValue(true);
    resolveGenerationContext.mockReset();
  });

  it('no model asked ⇒ Default, resolved to the context effectiveModel', () => {
    resolveGenerationContext.mockReturnValue(ctx({ effectiveModel: 'gemini-2.5-flash', backend: 'gemini' }));
    const r = resolveExportModel(req, null, undefined);
    expect(r).toMatchObject({ ok: true, modelId: 'gemini-2.5-flash', modelSource: 'Default', backend: 'gemini' });
    // No id asked ⇒ registry check is skipped (nothing to validate).
    expect(isRegisteredModel).not.toHaveBeenCalled();
  });

  it('asked + honored + hint "explicit" ⇒ Explicit', () => {
    resolveGenerationContext.mockReturnValue(ctx({ effectiveModel: 'claude-opus-4', backend: 'claude' }));
    const r = resolveExportModel(req, 'claude-opus-4', 'explicit');
    expect(r).toMatchObject({ ok: true, modelId: 'claude-opus-4', modelSource: 'Explicit' });
  });

  it('asked + honored + hint "global" ⇒ Global (provenance label follows the client hint)', () => {
    resolveGenerationContext.mockReturnValue(ctx({ effectiveModel: 'claude-opus-4', backend: 'claude' }));
    const r = resolveExportModel(req, 'claude-opus-4', 'global');
    expect(r).toMatchObject({ ok: true, modelId: 'claude-opus-4', modelSource: 'Global' });
  });

  it('asked but PINNED away by the tier (effectiveModel ≠ asked) ⇒ Default — no unmetered premium', () => {
    // A free tier asks for a premium id; resolveGenerationContext pins it to gemini.
    resolveGenerationContext.mockReturnValue({
      tier: { level: 'free', allowedBackends: ['gemini'], pinnedModel: 'gemini-2.5-flash' },
      effectiveModel: 'gemini-2.5-flash', backend: 'gemini',
    });
    const r = resolveExportModel(req, 'claude-opus-4', 'explicit');
    // The pinned model won ⇒ the provenance collapses to Default, NOT the client's Explicit.
    expect(r).toMatchObject({ ok: true, modelId: 'gemini-2.5-flash', modelSource: 'Default', backend: 'gemini' });
  });

  it('unregistered asked id ⇒ ok:false BEFORE resolveGenerationContext (never reaches the provider)', () => {
    isRegisteredModel.mockReturnValue(false);
    const r = resolveExportModel(req, 'not-a-real-model', 'explicit');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/not available/i);
    expect(resolveGenerationContext).not.toHaveBeenCalled();
  });

  it('whitespace/empty asked id is treated as "no ask" ⇒ Default, no registry check', () => {
    resolveGenerationContext.mockReturnValue(ctx({ effectiveModel: 'gemini-2.5-flash', backend: 'gemini' }));
    const r = resolveExportModel(req, '   ', 'explicit');
    expect(r).toMatchObject({ ok: true, modelSource: 'Default' });
    expect(isRegisteredModel).not.toHaveBeenCalled();
  });
});
