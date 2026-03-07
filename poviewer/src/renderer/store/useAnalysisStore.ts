// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import type { AnalysisStatus, AnalysisResult, RawPoint, AnalysisProgressEvent } from '../types/analysis';
import type { Point, Mapping, Source } from '../types/types';

interface SourceAnalysisState {
  status: AnalysisStatus;
  progress: number;
  error: string | null;
  stage1Result: RawPoint[] | null;
  result: AnalysisResult | null;
  startedAt: string | null;
}

interface AnalysisStoreState {
  analyses: Record<string, SourceAnalysisState>;
  hasApiKey: boolean;

  // Actions
  setHasApiKey: (has: boolean) => void;
  startAnalysis: (sourceId: string) => void;
  updateProgress: (event: AnalysisProgressEvent) => void;
  completeAnalysis: (sourceId: string, result: AnalysisResult) => void;
  cancelAnalysis: (sourceId: string) => void;
  clearAnalysis: (sourceId: string) => void;
  getSourceAnalysis: (sourceId: string) => SourceAnalysisState;
}

const defaultState: SourceAnalysisState = {
  status: 'idle',
  progress: 0,
  error: null,
  stage1Result: null,
  result: null,
  startedAt: null,
};

export const useAnalysisStore = create<AnalysisStoreState>((set, get) => ({
  analyses: {},
  hasApiKey: false,

  setHasApiKey: (has: boolean) => set({ hasApiKey: has }),

  startAnalysis: (sourceId: string) => {
    set(state => ({
      analyses: {
        ...state.analyses,
        [sourceId]: {
          ...defaultState,
          status: 'queued',
          startedAt: new Date().toISOString(),
        },
      },
    }));
  },

  updateProgress: (event: AnalysisProgressEvent) => {
    set(state => {
      const current = state.analyses[event.sourceId] || { ...defaultState };
      return {
        analyses: {
          ...state.analyses,
          [event.sourceId]: {
            ...current,
            status: event.status,
            progress: event.progress,
            error: event.error ?? current.error,
            stage1Result: event.stage1Result ?? current.stage1Result,
            result: event.result ?? current.result,
          },
        },
      };
    });
  },

  completeAnalysis: (sourceId: string, result: AnalysisResult) => {
    set(state => ({
      analyses: {
        ...state.analyses,
        [sourceId]: {
          ...state.analyses[sourceId],
          status: 'complete',
          progress: 100,
          result,
        },
      },
    }));
  },

  cancelAnalysis: (sourceId: string) => {
    set(state => ({
      analyses: {
        ...state.analyses,
        [sourceId]: {
          ...state.analyses[sourceId],
          status: 'idle',
          progress: 0,
          error: 'Cancelled',
        },
      },
    }));
  },

  clearAnalysis: (sourceId: string) => {
    set(state => {
      const next = { ...state.analyses };
      delete next[sourceId];
      return { analyses: next };
    });
  },

  getSourceAnalysis: (sourceId: string) => {
    return get().analyses[sourceId] || { ...defaultState };
  },
}));

// === Helper: Convert AnalysisResult to Source points ===

export function analysisResultToPoints(result: AnalysisResult): Point[] {
  const points: Point[] = result.points.map((rawPoint, index) => {
    const mappingsForPoint = result.mappings
      .filter(m => m.pointIndex === index)
      .map((m): Mapping => ({
        camp: m.camp,
        nodeId: m.nodeId,
        nodeLabel: m.nodeLabel,
        category: m.category,
        alignment: m.alignment,
        strength: m.strength,
        explanation: m.explanation,
      }));

    // Detect collisions: point maps to opposing camps
    const camps = new Set(mappingsForPoint.map(m => m.camp));
    const hasOpposing = camps.has('accelerationist') && camps.has('safetyist');
    const hasContradictions = mappingsForPoint.some(m => m.alignment === 'contradicts');

    return {
      id: `p-${String(index + 1).padStart(3, '0')}`,
      sourceId: result.sourceId,
      startOffset: rawPoint.startOffset,
      endOffset: rawPoint.endOffset,
      text: rawPoint.text,
      mappings: mappingsForPoint,
      isCollision: hasOpposing || (camps.size > 1 && hasContradictions),
      collisionNote: hasOpposing
        ? 'This point maps to both Accelerationist and Safetyist camps with differing interpretations.'
        : undefined,
    };
  });

  return points;
}

// === Helper: Merge analysis result into source ===

export function mergeAnalysisIntoSource(source: Source, result: AnalysisResult): Source {
  const points = analysisResultToPoints(result);
  return {
    ...source,
    status: 'analyzed',
    points,
  };
}
