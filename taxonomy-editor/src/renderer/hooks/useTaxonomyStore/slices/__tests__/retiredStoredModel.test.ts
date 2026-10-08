// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4030: a saved model the registry no longer lists falls back, WARNs, and shows a notice exactly once.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRecord = vi.hoisted(() => vi.fn());
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: mockRecord }) }));

import { getStoredModel } from '../settingsSlice';
import { useRetiredModelNotice, RETIRED_MODEL_ACK_KEY, __resetRetiredModelNoticeForTests } from '../../../../utils/retiredModelNotice';

const MODEL_KEY = 'taxonomy-editor-gemini-model';
const RETIRED = 'retired-model-that-no-registry-lists';
const retiredWarns = () => mockRecord.mock.calls.filter(([e]) => e.level === 'warn' && e.data?.stored === RETIRED);

beforeEach(() => {
  localStorage.clear();
  mockRecord.mockClear();
  __resetRetiredModelNoticeForTests();
});

describe('getStoredModel with a retired saved model (t/4030)', () => {
  it('falls back to a real model, WARNs once, and raises the notice once across repeated calls', () => {
    localStorage.setItem(MODEL_KEY, RETIRED);
    const first = getStoredModel();
    const second = getStoredModel();
    getStoredModel();
    expect(first).not.toBe(RETIRED);
    expect(second).toBe(first);
    expect(retiredWarns()).toHaveLength(1);
    expect(retiredWarns()[0][0].data).toEqual({ stored: RETIRED, fallback: first });
    expect(useRetiredModelNotice.getState().notice).toEqual({ stored: RETIRED, fallback: first });
  });

  it('does not rewrite the saved choice (a model that comes back is used again)', () => {
    localStorage.setItem(MODEL_KEY, RETIRED);
    getStoredModel();
    expect(localStorage.getItem(MODEL_KEY)).toBe(RETIRED);
  });

  it('a dismissed notice stays dismissed in a later session; the WARN still fires there', () => {
    localStorage.setItem(MODEL_KEY, RETIRED);
    getStoredModel();
    useRetiredModelNotice.getState().dismiss();
    expect(localStorage.getItem(RETIRED_MODEL_ACK_KEY)).toBe(RETIRED);

    __resetRetiredModelNoticeForTests(); // a new session
    mockRecord.mockClear();
    getStoredModel();
    expect(useRetiredModelNotice.getState().notice).toBeNull();
    expect(retiredWarns()).toHaveLength(1);
  });

  it('a valid saved model, or none saved, raises nothing', () => {
    getStoredModel(); // none saved: the default is not a retirement
    const valid = getStoredModel();
    localStorage.setItem(MODEL_KEY, valid);
    expect(getStoredModel()).toBe(valid);
    expect(mockRecord.mock.calls.filter(([e]) => /no longer in the model registry/.test(e.message ?? ''))).toHaveLength(0);
    expect(useRetiredModelNotice.getState().notice).toBeNull();
  });
});
