// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { BrowserWindow } from 'electron';
import { getApiKey } from './apiKeyStore';
import {
  getDefaultTemplates,
  buildStage1Prompt,
  buildStage2Prompt,
} from './promptTemplates';
import { loadPromptOverrides, loadAiSettings } from './fileIO';
import type { RawPoint, RawMapping, AnalysisResult, AnalysisStatus } from './analysisTypes';

// Re-export types for convenience
export type { RawPoint, RawMapping, AnalysisResult };

const activeAbortControllers = new Map<string, AbortController>();

function emitProgress(
  sourceId: string,
  status: AnalysisStatus,
  progress: number,
  extra?: { error?: string; stage1Result?: RawPoint[]; result?: AnalysisResult },
): void {
  const windows = BrowserWindow.getAllWindows();
  const payload = { sourceId, status, progress, ...extra };
  for (const win of windows) {
    win.webContents.send('analysis-progress', payload);
  }
}

async function callGemini(
  prompt: string,
  model: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<string> {
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (signal.aborted) throw new Error('Analysis cancelled');

    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const text = response.text;
      if (!text) throw new Error('Empty response from Gemini');
      return text;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on cancellation or auth errors
      if (signal.aborted) throw lastError;
      if (lastError.message.includes('401') || lastError.message.includes('403')) {
        throw lastError;
      }

      // Exponential backoff for rate limiting
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error('All retries exhausted');
}

function parseJsonArray<T>(raw: string): T[] {
  // Strip markdown fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) {
    throw new Error('Expected JSON array from AI response');
  }
  return parsed as T[];
}

// ── Validation helpers ──

const VALID_ALIGNMENTS = new Set(['agrees', 'contradicts', 'extends', 'qualifies']);

const ALIGNMENT_KEYWORDS: Record<string, string[]> = {
  agrees: ['agrees', 'agree', 'supports', 'support', 'aligns', 'align', 'affirms', 'endorses', 'consistent'],
  contradicts: ['contradicts', 'contradict', 'opposes', 'oppose', 'disagrees', 'conflicts', 'challenges', 'refutes', 'denies', 'rejects'],
  extends: ['extends', 'extend', 'expands', 'builds', 'elaborates', 'broadens', 'adds to', 'supplements'],
  qualifies: ['qualifies', 'qualify', 'nuances', 'limits', 'conditions', 'restricts', 'caveats', 'partially'],
};

function normalizeAlignment(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (VALID_ALIGNMENTS.has(lower)) return lower;
  for (const [alignment, keywords] of Object.entries(ALIGNMENT_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return alignment;
    }
  }
  return 'agrees';
}

function extractNodeIds(taxonomyJson: string): Set<string> {
  const ids = new Set<string>();
  try {
    const taxonomy = JSON.parse(taxonomyJson);
    if (Array.isArray(taxonomy)) {
      for (const node of taxonomy) {
        if (node.id) ids.add(node.id);
      }
    } else if (typeof taxonomy === 'object') {
      for (const key of Object.keys(taxonomy)) {
        const group = taxonomy[key];
        if (group?.nodes && Array.isArray(group.nodes)) {
          for (const node of group.nodes) {
            if (node.id) ids.add(node.id);
          }
        }
      }
    }
  } catch { /* taxonomy parse failed — skip validation */ }
  return ids;
}

export async function runAnalysis(
  sourceId: string,
  sourceText: string,
  taxonomyJson: string,
): Promise<AnalysisResult> {
  // Cancel any existing analysis for this source
  cancelAnalysis(sourceId);

  const controller = new AbortController();
  activeAbortControllers.set(sourceId, controller);
  const { signal } = controller;

  try {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('No API key configured');

    const settings = loadAiSettings();
    const model = settings.model || 'gemini-3.1-flash-lite-preview';

    const promptOverrides = loadPromptOverrides();
    const defaults = getDefaultTemplates();
    const stage1Template = promptOverrides?.stage1 || defaults.stage1;
    const stage2Template = promptOverrides?.stage2 || defaults.stage2;

    // === Stage 1: Segmentation ===
    emitProgress(sourceId, 'stage1_running', 10);

    const stage1Prompt = buildStage1Prompt(stage1Template, sourceText);
    const stage1Raw = await callGemini(stage1Prompt, model, apiKey, signal);

    if (signal.aborted) throw new Error('Analysis cancelled');

    const points = parseJsonArray<RawPoint>(stage1Raw);

    // Validate and clamp offsets
    for (const p of points) {
      p.startOffset = Math.max(0, Math.min(p.startOffset, sourceText.length));
      p.endOffset = Math.max(p.startOffset, Math.min(p.endOffset, sourceText.length));
      if (!p.text) {
        p.text = sourceText.slice(p.startOffset, p.endOffset);
      }
    }

    emitProgress(sourceId, 'stage1_complete', 40, { stage1Result: points });

    // === Stage 2: Mapping ===
    emitProgress(sourceId, 'stage2_running', 50);

    const pointsSummary = points.map((p, i) => ({
      index: i,
      text: p.text,
    }));

    const stage2Prompt = buildStage2Prompt(
      stage2Template,
      JSON.stringify(pointsSummary, null, 2),
      taxonomyJson,
    );
    const stage2Raw = await callGemini(stage2Prompt, model, apiKey, signal);

    if (signal.aborted) throw new Error('Analysis cancelled');

    let mappings = parseJsonArray<RawMapping>(stage2Raw);

    // Validate node IDs and normalize alignment
    const validIds = extractNodeIds(taxonomyJson);
    if (validIds.size > 0) {
      mappings = mappings.filter(m => validIds.has(m.nodeId));
    }
    for (const m of mappings) {
      m.alignment = normalizeAlignment(m.alignment) as RawMapping['alignment'];
    }

    emitProgress(sourceId, 'stage2_complete', 80);

    // === Merge ===
    emitProgress(sourceId, 'merging', 90);

    const result: AnalysisResult = {
      sourceId,
      points,
      mappings,
      completedAt: new Date().toISOString(),
      model,
    };

    emitProgress(sourceId, 'complete', 100, { result });

    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    emitProgress(sourceId, 'error', 0, { error: message });
    throw err;
  } finally {
    activeAbortControllers.delete(sourceId);
  }
}

export function cancelAnalysis(sourceId: string): void {
  const controller = activeAbortControllers.get(sourceId);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(sourceId);
  }
}

export function getAnalysisStatus(sourceId: string): { running: boolean } {
  return { running: activeAbortControllers.has(sourceId) };
}

// === Quick Excerpt Analysis ===

export interface ExcerptMapping {
  nodeId: string;
  nodeLabel: string;
  category: string;
  camp: string;
  alignment: 'agrees' | 'contradicts' | 'extends' | 'qualifies';
  strength: 'strong' | 'moderate' | 'weak';
  explanation: string;
}

const EXCERPT_PROMPT = `You are an expert policy analyst. Given a short excerpt from an AI governance document and a taxonomy of perspectives, determine which taxonomy nodes this excerpt maps to.

For each mapping, specify the taxonomy node, camp, alignment, strength, and a brief explanation.

If the excerpt does not clearly map to any taxonomy node, return an empty array.

Excerpt:
{{excerpt}}

Taxonomy:
{{taxonomy}}

Return a JSON array:
[
  {
    "nodeId": "acc-desires-001",
    "nodeLabel": "Node label",
    "category": "Category",
    "camp": "accelerationist",
    "alignment": "agrees",
    "strength": "strong",
    "explanation": "Brief rationale"
  }
]`;

export async function analyzeExcerpt(
  excerptText: string,
  taxonomyJson: string,
): Promise<ExcerptMapping[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No API key configured');

  const settings = loadAiSettings();
  const model = settings.model || 'gemini-2.5-flash';

  const prompt = EXCERPT_PROMPT
    .replace('{{excerpt}}', excerptText)
    .replace('{{taxonomy}}', taxonomyJson);

  const controller = new AbortController();
  const raw = await callGemini(prompt, model, apiKey, controller.signal);
  let results = parseJsonArray<ExcerptMapping>(raw);

  const validIds = extractNodeIds(taxonomyJson);
  if (validIds.size > 0) {
    results = results.filter(m => validIds.has(m.nodeId));
  }
  for (const m of results) {
    m.alignment = normalizeAlignment(m.alignment) as ExcerptMapping['alignment'];
  }

  return results;
}
