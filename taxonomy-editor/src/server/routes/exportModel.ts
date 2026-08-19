// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Brief Export model resolution (t/2804, spec §6) — implemented HERE, once, for all
// surfaces (REST/GUI/PS). Precedence: explicit > global > server-config default.
//
// Two invariants:
//  1. The server ALWAYS validates the model id against the registry (`isRegisteredModel`,
//     backed by ai-models.json / GET /api/models). It trusts the client only for the
//     source *label* (provenance disclosure), never for what is a valid/entitled model.
//  2. Export is a BILLABLE surface (narrate + optional checker call a model), so it
//     inherits the shared entitlement path: `resolveGenerationContext` pins the free
//     tier's model + derives the backend; the caller then gates with
//     `enforceBackendAllowed` before any model call. Without this, a free tier could
//     select a premium model via the export `model` param (unmetered premium spend).

import http from 'http';
import { DEFAULT_MODEL } from '../../../../lib/ai-client/index.js';
import { isRegisteredModel } from '../ai/aiBackends.js';
import { resolveGenerationContext, type ResolvedTier } from './generationContext.js';
import { type AIBackend } from '../config.js';
import type { ModelSource } from '../../../../lib/brief/types.js';

/** The client's stated source for the model (provenance label only — never trusted for
 *  entitlement). 'global' = the GUI's "Use current model" default was untouched; 'explicit'
 *  = the user picked a specific model. Absent ⇒ Explicit if a model was sent, else Default. */
export type ClientModelSource = 'global' | 'explicit';

export type ModelResolution =
  | { ok: true; modelId: string; modelSource: ModelSource; tier: ResolvedTier; backend: AIBackend }
  | { ok: false; message: string };

/** Resolve one model (narrator or checker) with §6 precedence + registry validation +
 *  tier pinning. Does NOT write to `res` — the caller applies `enforceBackendAllowed`
 *  on the returned `{tier, backend}` and maps `{ok:false}` to a 400 ModelUnavailable. */
export function resolveExportModel(
  req: http.IncomingMessage,
  requestModel: string | null | undefined,
  sourceHint: ClientModelSource | undefined,
): ModelResolution {
  const asked = typeof requestModel === 'string' && requestModel.trim() ? requestModel.trim() : undefined;

  // Reject an unregistered id up front (like oped.ts) — resolveBackend only prefix-guesses,
  // so an unknown id would otherwise reach the provider and fail mid-generation.
  if (asked && !isRegisteredModel(asked)) {
    return { ok: false, message: `Model '${asked}' is not available — choose a model listed in /api/models.` };
  }

  const { tier, effectiveModel, backend } = resolveGenerationContext(req, asked);
  const modelId = effectiveModel || DEFAULT_MODEL;

  // Provenance label reflects where the RESOLVED model actually came from:
  //  - no ask                     → Default (server fallback)
  //  - ask honored (id unchanged) → Explicit or Global per the client hint
  //  - ask overridden by pinning  → Default (the free tier's pinned model won)
  let modelSource: ModelSource;
  if (!asked) modelSource = 'Default';
  else if (modelId === asked) modelSource = sourceHint === 'global' ? 'Global' : 'Explicit';
  else modelSource = 'Default';

  return { ok: true, modelId, modelSource, tier, backend };
}
