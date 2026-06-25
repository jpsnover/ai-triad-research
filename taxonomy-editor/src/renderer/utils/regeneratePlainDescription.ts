// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { vernacularPrompt, VERNACULAR_MODEL, VERNACULAR_TEMPERATURE, VERNACULAR_TIMEOUT, VERNACULAR_VERSION } from '../prompts/vernacular';
import type { Pov } from '../types/taxonomy';

const MIN_DESCRIPTION_LENGTH = 20;

export async function regeneratePlainDescription(
  nodeId: string,
  description: string,
  updateNode: (updates: { plain_description: string | null; plain_description_version: string | null }) => void,
): Promise<void> {
  if (!description || description.length < MIN_DESCRIPTION_LENGTH || description.startsWith('[DEPRECATED]')) {
    updateNode({ plain_description: description || null, plain_description_version: null });
    return;
  }

  try {
    const { api } = await import('@bridge');
    const result = await api.generateText(
      vernacularPrompt(description),
      VERNACULAR_MODEL,
      VERNACULAR_TIMEOUT,
      VERNACULAR_TEMPERATURE,
    );
    if (result.text) {
      const text = result.text;
      updateNode({ plain_description: text.trim(), plain_description_version: VERNACULAR_VERSION });
    }
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'regenerate-plain-description',
      level: 'warn',
      message: `Plain description generation failed for ${nodeId}`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }
}

export function triggerPovNodeRegeneration(
  pov: Pov,
  nodeId: string,
  description: string,
  updatePovNode: (pov: Pov, nodeId: string, updates: { plain_description: string | null; plain_description_version: string | null }) => void,
): void {
  void regeneratePlainDescription(nodeId, description, (updates) => updatePovNode(pov, nodeId, updates));
}

export async function generatePlainPreview(description: string): Promise<string | null> {
  if (!description || description.length < MIN_DESCRIPTION_LENGTH || description.startsWith('[DEPRECATED]')) {
    return description || null;
  }
  try {
    const { api } = await import('@bridge');
    const result = await api.generateText(
      vernacularPrompt(description),
      VERNACULAR_MODEL,
      VERNACULAR_TIMEOUT,
      VERNACULAR_TEMPERATURE,
    );
    return result.text?.trim() ?? null;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'generate-plain-preview',
      level: 'warn',
      message: 'On-demand plain preview generation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return null;
  }
}

export function triggerSituationNodeRegeneration(
  nodeId: string,
  description: string,
  updateSituationNode: (nodeId: string, updates: { plain_description: string | null; plain_description_version: string | null }) => void,
): void {
  void regeneratePlainDescription(nodeId, description, (updates) => updateSituationNode(nodeId, updates));
}
