// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLongPressSelectionMenu } from '../useLongPressSelectionMenu';

function touchEndEvent(x: number, y: number): React.TouchEvent {
  return { currentTarget: 'CONTAINER', changedTouches: [{ clientX: x, clientY: y }] } as unknown as React.TouchEvent;
}

describe('useLongPressSelectionMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('desktop onContextMenu builds + shows the menu when buildMenu returns non-null', () => {
    const buildMenu = vi.fn(() => ({ x: 1, y: 2, text: 'hi' }));
    const onMenu = vi.fn();
    const { result } = renderHook(() => useLongPressSelectionMenu(buildMenu, onMenu));
    const preventDefault = vi.fn();
    act(() => {
      result.current.onContextMenu({ currentTarget: 'C', clientX: 10, clientY: 20, preventDefault } as unknown as React.MouseEvent);
    });
    expect(buildMenu).toHaveBeenCalledWith('C', 10, 20);
    expect(preventDefault).toHaveBeenCalled();
    expect(onMenu).toHaveBeenCalledWith({ x: 1, y: 2, text: 'hi' });
  });

  it('desktop onContextMenu does nothing (no preventDefault) when buildMenu returns null', () => {
    const buildMenu = vi.fn(() => null);
    const onMenu = vi.fn();
    const { result } = renderHook(() => useLongPressSelectionMenu(buildMenu, onMenu));
    const preventDefault = vi.fn();
    act(() => {
      result.current.onContextMenu({ currentTarget: 'C', clientX: 10, clientY: 20, preventDefault } as unknown as React.MouseEvent);
    });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onMenu).not.toHaveBeenCalled();
  });

  it('touchend shows the menu after the settle delay when a selection survives', () => {
    const buildMenu = vi.fn(() => ({ text: 'selected' }));
    const onMenu = vi.fn();
    const { result } = renderHook(() => useLongPressSelectionMenu(buildMenu, onMenu));
    act(() => { result.current.onTouchEnd(touchEndEvent(30, 40)); });
    expect(onMenu).not.toHaveBeenCalled(); // not yet — waiting for the settle delay
    act(() => { vi.advanceTimersByTime(50); });
    expect(buildMenu).toHaveBeenCalledWith('CONTAINER', 30, 40);
    expect(onMenu).toHaveBeenCalledWith({ text: 'selected' });
  });

  it('touchend calls buildMenu but never onMenu when no selection survives', () => {
    const buildMenu = vi.fn(() => null);
    const onMenu = vi.fn();
    const { result } = renderHook(() => useLongPressSelectionMenu(buildMenu, onMenu));
    act(() => { result.current.onTouchEnd(touchEndEvent(0, 0)); });
    act(() => { vi.advanceTimersByTime(50); });
    expect(buildMenu).toHaveBeenCalled();
    expect(onMenu).not.toHaveBeenCalled();
  });

  it('a second touchend before the first settles cancels the first check (debounced)', () => {
    const buildMenu = vi.fn(() => ({ ok: true }));
    const onMenu = vi.fn();
    const { result } = renderHook(() => useLongPressSelectionMenu(buildMenu, onMenu));
    act(() => { result.current.onTouchEnd(touchEndEvent(0, 0)); });
    act(() => { vi.advanceTimersByTime(20); }); // before the first settle
    act(() => { result.current.onTouchEnd(touchEndEvent(5, 5)); });
    act(() => { vi.advanceTimersByTime(50); });
    expect(onMenu).toHaveBeenCalledTimes(1); // only the second check fires
    expect(buildMenu).toHaveBeenLastCalledWith('CONTAINER', 5, 5);
  });

  it('respects a custom settleDelayMs', () => {
    const buildMenu = vi.fn(() => ({ ok: true }));
    const onMenu = vi.fn();
    const { result } = renderHook(() => useLongPressSelectionMenu(buildMenu, onMenu, 200));
    act(() => { result.current.onTouchEnd(touchEndEvent(0, 0)); });
    act(() => { vi.advanceTimersByTime(50); });
    expect(onMenu).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(150); });
    expect(onMenu).toHaveBeenCalledTimes(1);
  });
});
