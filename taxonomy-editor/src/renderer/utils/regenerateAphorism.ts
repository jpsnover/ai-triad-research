// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { aphorismPrompt, APHORISM_MODEL, APHORISM_TEMPERATURE, APHORISM_TIMEOUT } from '../prompts/aphorism';

export async function generateAphorism(
  pov: string,
  category: string,
  label: string,
  description: string,
): Promise<string | null> {
  if (!label || !description) return null;
  try {
    const { api } = await import('@bridge');
    const result = await api.generateText(
      aphorismPrompt(pov, category, label, description),
      APHORISM_MODEL,
      APHORISM_TIMEOUT,
      APHORISM_TEMPERATURE,
    );
    return result.text?.trim().replace(/^["']|["']$/g, '') ?? null;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'regenerate-aphorism',
      level: 'warn',
      message: 'Aphorism generation failed (fail-open)',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return null;
  }
}
