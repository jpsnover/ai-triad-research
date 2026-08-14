// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Wraps the Electron main-process generateText (with net.fetch + key store)
// as the shared AIAdapter interface used by lib/oped and lib/debate cores.

import { generateText } from './embeddings.js';
import type { AIAdapter, GenerateOptions } from '../../../lib/debate/aiAdapter.js';

export function makeElectronAIAdapter(): AIAdapter {
  return {
    generateText: (prompt: string, model: string, opts?: GenerateOptions): Promise<string> =>
      generateText(
        prompt,
        model,
        undefined,
        opts?.timeoutMs,
        opts?.temperature,
        opts?.signal,
        opts?.responseSchema,
      ),
  };
}
