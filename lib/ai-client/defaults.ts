// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// MUST be a registered model id in ai-models.json (enforced by the registryCompleteness gate,
// t/2687). The prior value 'gemini-flash-lite-latest' was not registered → resolveModel sent the
// raw id to Gemini, which rejected it, so any pre-init default use (e.g. op-ed create before the
// registry finished loading) silently failed. gemini-3.5-flash-lite is the registered flash-lite.
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_TEMPERATURE = 0.7;
