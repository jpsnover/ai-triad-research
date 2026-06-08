// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { api } from '@bridge';
import type {
  GoldenClaim,
  ValidationResult,
  ValidationMetadata,
  Verdict,
  VerdictFilter,
  SpeakerFilter,
  ScoreRange,
} from '../types/validation';

interface ValidationStore {
  // Data
  claims: GoldenClaim[];
  results: Map<string, ValidationResult>;
  loaded: boolean;
  loading: boolean;

  // Navigation
  currentClaimIndex: number;

  // Filters
  speakerFilter: SpeakerFilter;
  scoreRange: ScoreRange;
  verdictFilter: VerdictFilter;
  beliefsOnly: boolean;

  // Actions
  loadGoldenSet: () => Promise<void>;
  setVerdict: (claimId: string, verdict: Verdict, extra?: { corrected_node?: string; corrected_category?: string; reviewer_notes?: string }) => void;
  clearVerdict: (claimId: string) => void;
  setReviewerNotes: (claimId: string, notes: string) => void;

  // Navigation actions
  goToIndex: (index: number) => void;
  nextClaim: () => void;
  prevClaim: () => void;
  nextUnreviewed: () => void;

  // Filter actions
  setSpeakerFilter: (filter: SpeakerFilter) => void;
  setScoreRange: (range: ScoreRange) => void;
  setVerdictFilter: (filter: VerdictFilter) => void;
  setBeliefsOnly: (beliefsOnly: boolean) => void;

  // Computed
  filteredClaims: () => GoldenClaim[];
  metadata: () => ValidationMetadata;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSave(results: Map<string, ValidationResult>): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const payload = {
      results: Array.from(results.values()),
      saved_at: new Date().toISOString(),
    };
    api.saveValidationResults(payload).catch((err: unknown) => {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'validation-store',
        level: 'error',
        message: 'Failed to auto-save validation results',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
    });
  }, 500);
}

function filterClaims(
  claims: GoldenClaim[],
  results: Map<string, ValidationResult>,
  speakerFilter: SpeakerFilter,
  scoreRange: ScoreRange,
  verdictFilter: VerdictFilter,
): GoldenClaim[] {
  return claims.filter(c => {
    if (speakerFilter !== 'all' && c.speaker !== speakerFilter) return false;
    if (c.similarity_score < scoreRange.min || c.similarity_score > scoreRange.max) return false;
    if (verdictFilter !== 'all') {
      const result = results.get(c.claim_id);
      if (verdictFilter === 'unreviewed') {
        if (result) return false;
      } else {
        if (!result || result.verdict !== verdictFilter) return false;
      }
    }
    return true;
  });
}

export const useValidationStore = create<ValidationStore>((set, get) => ({
  claims: [],
  results: new Map(),
  loaded: false,
  loading: false,

  currentClaimIndex: 0,

  speakerFilter: 'all',
  scoreRange: { min: 0, max: 1 },
  verdictFilter: 'all',
  beliefsOnly: true,

  loadGoldenSet: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const [goldenSet, existingResults] = await Promise.all([
        api.loadGoldenSet(),
        api.loadValidationResults(),
      ]);
      const claims: GoldenClaim[] = goldenSet?.claims ?? [];
      const restoredResults = new Map<string, ValidationResult>();
      if (existingResults?.results) {
        for (const r of existingResults.results) {
          restoredResults.set(r.claim_id, r);
        }
      }
      set({ claims, results: restoredResults, loaded: true, loading: false, currentClaimIndex: 0 });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'validation-store',
        level: 'error',
        message: 'Failed to load golden set',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      set({ loading: false });
    }
  },

  setVerdict: (claimId, verdict, extra) => {
    const { results, claims } = get();
    const claim = claims.find(c => c.claim_id === claimId);
    if (!claim) return;
    const updated = new Map(results);
    updated.set(claimId, {
      claim_id: claimId,
      original_node: claim.attributed_node,
      verdict,
      corrected_node: extra?.corrected_node,
      corrected_category: extra?.corrected_category,
      reviewer_notes: extra?.reviewer_notes ?? results.get(claimId)?.reviewer_notes,
      reviewed_at: new Date().toISOString(),
    });
    set({ results: updated });
    debouncedSave(updated);
  },

  clearVerdict: (claimId) => {
    const { results } = get();
    if (!results.has(claimId)) return;
    const updated = new Map(results);
    updated.delete(claimId);
    set({ results: updated });
    debouncedSave(updated);
  },

  setReviewerNotes: (claimId, notes) => {
    const { results } = get();
    const existing = results.get(claimId);
    if (!existing) return;
    const updated = new Map(results);
    updated.set(claimId, { ...existing, reviewer_notes: notes });
    set({ results: updated });
    debouncedSave(updated);
  },

  goToIndex: (index) => {
    const filtered = get().filteredClaims();
    if (index >= 0 && index < filtered.length) {
      set({ currentClaimIndex: index });
    }
  },

  nextClaim: () => {
    const { currentClaimIndex } = get();
    const filtered = get().filteredClaims();
    if (currentClaimIndex < filtered.length - 1) {
      set({ currentClaimIndex: currentClaimIndex + 1 });
    }
  },

  prevClaim: () => {
    const { currentClaimIndex } = get();
    if (currentClaimIndex > 0) {
      set({ currentClaimIndex: currentClaimIndex - 1 });
    }
  },

  nextUnreviewed: () => {
    const { currentClaimIndex, results } = get();
    const filtered = get().filteredClaims();
    for (let i = currentClaimIndex + 1; i < filtered.length; i++) {
      if (!results.has(filtered[i].claim_id)) {
        set({ currentClaimIndex: i });
        return;
      }
    }
    // Wrap around from start
    for (let i = 0; i < currentClaimIndex; i++) {
      if (!results.has(filtered[i].claim_id)) {
        set({ currentClaimIndex: i });
        return;
      }
    }
  },

  setSpeakerFilter: (filter) => set({ speakerFilter: filter, currentClaimIndex: 0 }),
  setScoreRange: (range) => set({ scoreRange: range, currentClaimIndex: 0 }),
  setVerdictFilter: (filter) => set({ verdictFilter: filter, currentClaimIndex: 0 }),
  setBeliefsOnly: (beliefsOnly) => set({ beliefsOnly }),

  filteredClaims: () => {
    const { claims, results, speakerFilter, scoreRange, verdictFilter } = get();
    return filterClaims(claims, results, speakerFilter, scoreRange, verdictFilter);
  },

  metadata: () => {
    const { claims, results } = get();
    let correct = 0, incorrect = 0, uncertain = 0, novel = 0;
    for (const r of results.values()) {
      switch (r.verdict) {
        case 'correct': correct++; break;
        case 'incorrect': incorrect++; break;
        case 'uncertain': uncertain++; break;
        case 'novel': novel++; break;
      }
    }
    return {
      total: claims.length,
      reviewed: results.size,
      correct,
      incorrect,
      uncertain,
      novel,
    };
  },
}));
