// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OpEdTagPicker, opEdTagSelection, opEdTagBlocksStart, taggableVoices } from './OpEdTagPicker';
import type { PovKey } from '../../../../../lib/oped/types';
import type { PovNode } from '@lib/debate/taxonomyTypes';

// t/3992. Registry injected so these don't move when the committed one does.
const REGISTRY = {
  version: 1,
  povs: { skeptic: [{ id: 'critical', label: 'Critical', soul_doc: 'skeptic.critical', description: 'd' }] },
};
const tagged = (n: number): PovNode[] =>
  Array.from({ length: n }, (_, i) => ({ id: `skp-beliefs-${i}`, pov_tags: ['critical'] }) as unknown as PovNode);
const ALL: PovKey[] = ['accelerationist', 'safetyist', 'skeptic'];

describe('op-ed tag selection helpers (t/3992)', () => {
  it('only voices with registry tags are taggable', () => {
    expect(taggableVoices(ALL, REGISTRY)).toEqual(['skeptic']);
    expect(taggableVoices(['safetyist'], REGISTRY)).toEqual([]);
    expect(taggableVoices(ALL, null)).toEqual([]);
  });

  it('builds params.tagSelection only for a picked tag on a selected voice', () => {
    const choice = { pov: 'skeptic' as PovKey, seatTag: { pov_tag: 'critical', tag_mode: 'scope' as const } };
    expect(opEdTagSelection(choice, ALL)).toEqual({ pov: 'skeptic', tag: 'critical', mode: 'scope' });
    expect(opEdTagSelection({ pov: 'skeptic' }, ALL)).toBeUndefined(); // voice chosen, no tag yet
    expect(opEdTagSelection(choice, ['safetyist'])).toBeUndefined(); // voice deselected after picking
    expect(opEdTagSelection(undefined, ALL)).toBeUndefined();
  });

  it('blocks Start for Scope below the minimum and Prioritize with no tagged nodes; otherwise not', () => {
    const scope = { pov: 'skeptic' as PovKey, seatTag: { pov_tag: 'critical', tag_mode: 'scope' as const } };
    const prio = { pov: 'skeptic' as PovKey, seatTag: { pov_tag: 'critical', tag_mode: 'prioritize' as const } };
    expect(opEdTagBlocksStart(scope, ALL, () => tagged(4))).toBe(true);
    expect(opEdTagBlocksStart(scope, ALL, () => tagged(5))).toBe(false);
    expect(opEdTagBlocksStart(prio, ALL, () => [])).toBe(true);
    expect(opEdTagBlocksStart(prio, ALL, () => tagged(1))).toBe(false);
    expect(opEdTagBlocksStart(scope, ['safetyist'], () => [])).toBe(false); // stale choice never blocks
  });
});

describe('OpEdTagPicker (t/3992)', () => {
  const picker = (voices: PovKey[], choice?: Parameters<typeof OpEdTagPicker>[0]['choice']) => {
    const onChange = vi.fn();
    render(<OpEdTagPicker voices={voices} registry={REGISTRY} choice={choice} onChange={onChange} nodesFor={() => tagged(6)} />);
    return onChange;
  };

  it('shows "No POV tags yet" (not an error) when no selected voice has tags', () => {
    picker(['accelerationist', 'safetyist']);
    expect(screen.getByText('No POV tags yet for the selected voices.')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('offers only taggable selected voices, defaulting to the whole camp', () => {
    picker(ALL);
    const select = screen.getByLabelText('POV wing (optional)') as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.value)).toEqual(['', 'skeptic']);
    expect(select.value).toBe('');
  });

  it('choosing a voice reveals the tag picker for it; picking a tag reports the choice', () => {
    const onChange = picker(ALL, { pov: 'skeptic' });
    fireEvent.change(screen.getByLabelText('Tag for skeptic'), { target: { value: 'critical' } });
    expect(onChange).toHaveBeenLastCalledWith({ pov: 'skeptic', seatTag: { pov_tag: 'critical', tag_mode: 'scope' } });
  });

  it('selecting the whole camp clears the choice', () => {
    const onChange = picker(ALL, { pov: 'skeptic' });
    fireEvent.change(screen.getByLabelText('POV wing (optional)'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
