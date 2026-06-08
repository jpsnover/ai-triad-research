// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GoldenClaim, ValidationResult } from '../types/validation';

const { mockApi } = vi.hoisted(() => {
  const mockApi = {
    loadGoldenSet: vi.fn().mockResolvedValue(null),
    loadValidationResults: vi.fn().mockResolvedValue(null),
    saveValidationResults: vi.fn().mockResolvedValue(undefined),
  };
  return { mockApi };
});

vi.mock('@bridge', () => ({ api: mockApi }));
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

import { useValidationStore } from './useValidationStore';

function makeClaim(overrides: Partial<GoldenClaim> = {}): GoldenClaim {
  return {
    claim_id: 'AN-1',
    claim_text: 'Test claim text',
    speaker: 'safetyist',
    attributed_node: 'saf-beliefs-126',
    similarity_score: 0.54,
    secondary_refs: [],
    debate_id: '1aa27450',
    debate_title: 'Test debate',
    node_type: '',
    turn_number: 2,
    computed_strength: 1,
    ...overrides,
  };
}

const SAMPLE_CLAIMS: GoldenClaim[] = [
  makeClaim({ claim_id: 'AN-1', speaker: 'safetyist', similarity_score: 0.54 }),
  makeClaim({ claim_id: 'AN-2', speaker: 'accelerationist', similarity_score: 0.72, attributed_node: 'acc-beliefs-011' }),
  makeClaim({ claim_id: 'AN-3', speaker: 'safetyist', similarity_score: 0.37 }),
  makeClaim({ claim_id: 'AN-4', speaker: 'skeptic', similarity_score: 0.81, attributed_node: 'skp-beliefs-005' }),
  makeClaim({ claim_id: 'AN-5', speaker: 'accelerationist', similarity_score: 0.45, attributed_node: 'acc-beliefs-022' }),
];

describe('useValidationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useValidationStore.setState({
      claims: [],
      results: new Map(),
      loaded: false,
      loading: false,
      currentClaimIndex: 0,
      speakerFilter: 'all',
      scoreRange: { min: 0, max: 1 },
      verdictFilter: 'all',
      beliefsOnly: true,
    });
  });

  describe('loadGoldenSet', () => {
    it('loads claims and restores existing results', async () => {
      const existingResult: ValidationResult = {
        claim_id: 'AN-1',
        original_node: 'saf-beliefs-126',
        verdict: 'correct',
        reviewed_at: '2026-06-07T00:00:00.000Z',
      };
      mockApi.loadGoldenSet.mockResolvedValueOnce({
        metadata: { total_claims: 5 },
        claims: SAMPLE_CLAIMS,
      });
      mockApi.loadValidationResults.mockResolvedValueOnce({
        results: [existingResult],
        saved_at: '2026-06-07T00:00:00.000Z',
      });

      await useValidationStore.getState().loadGoldenSet();

      const state = useValidationStore.getState();
      expect(state.claims).toHaveLength(5);
      expect(state.loaded).toBe(true);
      expect(state.results.size).toBe(1);
      expect(state.results.get('AN-1')?.verdict).toBe('correct');
    });

    it('handles missing golden set gracefully', async () => {
      mockApi.loadGoldenSet.mockResolvedValueOnce(null);
      mockApi.loadValidationResults.mockResolvedValueOnce(null);

      await useValidationStore.getState().loadGoldenSet();

      const state = useValidationStore.getState();
      expect(state.claims).toHaveLength(0);
      expect(state.loaded).toBe(true);
    });

    it('handles missing results file gracefully', async () => {
      mockApi.loadGoldenSet.mockResolvedValueOnce({
        metadata: { total_claims: 5 },
        claims: SAMPLE_CLAIMS,
      });
      mockApi.loadValidationResults.mockResolvedValueOnce(null);

      await useValidationStore.getState().loadGoldenSet();

      const state = useValidationStore.getState();
      expect(state.claims).toHaveLength(5);
      expect(state.results.size).toBe(0);
    });
  });

  describe('setVerdict', () => {
    beforeEach(() => {
      useValidationStore.setState({ claims: SAMPLE_CLAIMS });
    });

    it('records a verdict and triggers debounced save', () => {
      useValidationStore.getState().setVerdict('AN-1', 'correct');

      const result = useValidationStore.getState().results.get('AN-1');
      expect(result).toBeDefined();
      expect(result!.verdict).toBe('correct');
      expect(result!.original_node).toBe('saf-beliefs-126');
      expect(result!.reviewed_at).toBeTruthy();

      expect(mockApi.saveValidationResults).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(mockApi.saveValidationResults).toHaveBeenCalledTimes(1);
    });

    it('records corrected_node for incorrect verdict', () => {
      useValidationStore.getState().setVerdict('AN-2', 'incorrect', {
        corrected_node: 'acc-beliefs-050',
        corrected_category: 'desires',
      });

      const result = useValidationStore.getState().results.get('AN-2');
      expect(result!.verdict).toBe('incorrect');
      expect(result!.corrected_node).toBe('acc-beliefs-050');
      expect(result!.corrected_category).toBe('desires');
    });

    it('preserves reviewer notes when updating verdict', () => {
      useValidationStore.getState().setVerdict('AN-1', 'uncertain');
      useValidationStore.getState().setReviewerNotes('AN-1', 'Need more context');
      useValidationStore.getState().setVerdict('AN-1', 'correct');

      const result = useValidationStore.getState().results.get('AN-1');
      expect(result!.verdict).toBe('correct');
      expect(result!.reviewer_notes).toBe('Need more context');
    });

    it('ignores verdict for non-existent claim', () => {
      useValidationStore.getState().setVerdict('FAKE-999', 'correct');
      expect(useValidationStore.getState().results.size).toBe(0);
    });
  });

  describe('clearVerdict', () => {
    it('removes a verdict and triggers save', () => {
      useValidationStore.setState({ claims: SAMPLE_CLAIMS });
      useValidationStore.getState().setVerdict('AN-1', 'correct');
      vi.advanceTimersByTime(500);
      vi.clearAllMocks();

      useValidationStore.getState().clearVerdict('AN-1');
      expect(useValidationStore.getState().results.has('AN-1')).toBe(false);

      vi.advanceTimersByTime(500);
      expect(mockApi.saveValidationResults).toHaveBeenCalledTimes(1);
    });

    it('no-ops for non-existent claim', () => {
      useValidationStore.getState().clearVerdict('FAKE-999');
      vi.advanceTimersByTime(500);
      expect(mockApi.saveValidationResults).not.toHaveBeenCalled();
    });
  });

  describe('navigation', () => {
    beforeEach(() => {
      useValidationStore.setState({ claims: SAMPLE_CLAIMS });
    });

    it('nextClaim advances index', () => {
      useValidationStore.getState().nextClaim();
      expect(useValidationStore.getState().currentClaimIndex).toBe(1);
    });

    it('nextClaim stops at end', () => {
      useValidationStore.setState({ currentClaimIndex: 4 });
      useValidationStore.getState().nextClaim();
      expect(useValidationStore.getState().currentClaimIndex).toBe(4);
    });

    it('prevClaim decrements index', () => {
      useValidationStore.setState({ currentClaimIndex: 3 });
      useValidationStore.getState().prevClaim();
      expect(useValidationStore.getState().currentClaimIndex).toBe(2);
    });

    it('prevClaim stops at start', () => {
      useValidationStore.getState().prevClaim();
      expect(useValidationStore.getState().currentClaimIndex).toBe(0);
    });

    it('goToIndex navigates to valid index', () => {
      useValidationStore.getState().goToIndex(3);
      expect(useValidationStore.getState().currentClaimIndex).toBe(3);
    });

    it('goToIndex ignores out-of-range index', () => {
      useValidationStore.getState().goToIndex(99);
      expect(useValidationStore.getState().currentClaimIndex).toBe(0);
    });

    it('nextUnreviewed skips reviewed claims', () => {
      useValidationStore.getState().setVerdict('AN-2', 'correct');
      useValidationStore.getState().setVerdict('AN-3', 'incorrect', { corrected_node: 'saf-beliefs-001' });

      useValidationStore.getState().nextUnreviewed();
      // Current is 0 (AN-1), next unreviewed should be AN-4 at index 3
      // (AN-2 at 1 is reviewed, AN-3 at 2 is reviewed)
      expect(useValidationStore.getState().currentClaimIndex).toBe(3);
    });

    it('nextUnreviewed wraps around', () => {
      // Review all except AN-1
      useValidationStore.getState().setVerdict('AN-2', 'correct');
      useValidationStore.getState().setVerdict('AN-3', 'correct');
      useValidationStore.getState().setVerdict('AN-4', 'correct');
      useValidationStore.getState().setVerdict('AN-5', 'correct');
      useValidationStore.setState({ currentClaimIndex: 2 });

      useValidationStore.getState().nextUnreviewed();
      expect(useValidationStore.getState().currentClaimIndex).toBe(0);
    });
  });

  describe('filters', () => {
    beforeEach(() => {
      useValidationStore.setState({ claims: SAMPLE_CLAIMS });
    });

    it('filters by speaker', () => {
      useValidationStore.getState().setSpeakerFilter('safetyist');
      const filtered = useValidationStore.getState().filteredClaims();
      expect(filtered).toHaveLength(2);
      expect(filtered.every(c => c.speaker === 'safetyist')).toBe(true);
    });

    it('filters by score range', () => {
      useValidationStore.getState().setScoreRange({ min: 0.5, max: 1.0 });
      const filtered = useValidationStore.getState().filteredClaims();
      expect(filtered).toHaveLength(3); // AN-1 (0.54), AN-2 (0.72), AN-4 (0.81)
      expect(filtered.every(c => c.similarity_score >= 0.5)).toBe(true);
    });

    it('filters by verdict status — unreviewed', () => {
      useValidationStore.getState().setVerdict('AN-1', 'correct');
      useValidationStore.getState().setVerdictFilter('unreviewed');
      const filtered = useValidationStore.getState().filteredClaims();
      expect(filtered).toHaveLength(4);
      expect(filtered.find(c => c.claim_id === 'AN-1')).toBeUndefined();
    });

    it('filters by verdict status — specific verdict', () => {
      useValidationStore.getState().setVerdict('AN-1', 'correct');
      useValidationStore.getState().setVerdict('AN-3', 'incorrect', { corrected_node: 'saf-beliefs-001' });
      useValidationStore.getState().setVerdictFilter('correct');
      const filtered = useValidationStore.getState().filteredClaims();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].claim_id).toBe('AN-1');
    });

    it('resets currentClaimIndex when filter changes', () => {
      useValidationStore.setState({ currentClaimIndex: 3 });
      useValidationStore.getState().setSpeakerFilter('accelerationist');
      expect(useValidationStore.getState().currentClaimIndex).toBe(0);
    });

    it('combines multiple filters', () => {
      useValidationStore.getState().setSpeakerFilter('safetyist');
      useValidationStore.getState().setScoreRange({ min: 0.5, max: 1.0 });
      const filtered = useValidationStore.getState().filteredClaims();
      expect(filtered).toHaveLength(1); // AN-1 (safetyist, 0.54)
      expect(filtered[0].claim_id).toBe('AN-1');
    });
  });

  describe('metadata', () => {
    beforeEach(() => {
      useValidationStore.setState({ claims: SAMPLE_CLAIMS });
    });

    it('computes metadata with no reviews', () => {
      const meta = useValidationStore.getState().metadata();
      expect(meta).toEqual({
        total: 5,
        reviewed: 0,
        correct: 0,
        incorrect: 0,
        uncertain: 0,
        novel: 0,
      });
    });

    it('computes metadata with mixed verdicts', () => {
      useValidationStore.getState().setVerdict('AN-1', 'correct');
      useValidationStore.getState().setVerdict('AN-2', 'incorrect', { corrected_node: 'acc-beliefs-050' });
      useValidationStore.getState().setVerdict('AN-3', 'uncertain');
      useValidationStore.getState().setVerdict('AN-4', 'novel');

      const meta = useValidationStore.getState().metadata();
      expect(meta).toEqual({
        total: 5,
        reviewed: 4,
        correct: 1,
        incorrect: 1,
        uncertain: 1,
        novel: 1,
      });
    });
  });

  describe('beliefsOnly toggle', () => {
    it('defaults to true', () => {
      expect(useValidationStore.getState().beliefsOnly).toBe(true);
    });

    it('can be toggled', () => {
      useValidationStore.getState().setBeliefsOnly(false);
      expect(useValidationStore.getState().beliefsOnly).toBe(false);
    });
  });
});
