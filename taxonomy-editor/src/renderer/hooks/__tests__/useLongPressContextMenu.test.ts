// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLongPressContextMenu } from '../useLongPressContextMenu';

function touchEvent(x: number, y: number): React.TouchEvent {
  return { touches: [{ clientX: x, clientY: y }] } as unknown as React.TouchEvent;
}

describe('useLongPressContextMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('desktop onContextMenu forwards directly to the handler, unchanged', () => {
    const onContextMenu = vi.fn();
    const { result } = renderHook(() => useLongPressContextMenu(onContextMenu));
    const fakeEvent = { clientX: 10, clientY: 20, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    act(() => { result.current.onContextMenu(fakeEvent as never); });
    expect(onContextMenu).toHaveBeenCalledWith(fakeEvent);
  });

  it('a touch held for the long-press duration invokes the handler with the touch coordinates', () => {
    const onContextMenu = vi.fn();
    const { result } = renderHook(() => useLongPressContextMenu(onContextMenu));
    act(() => { result.current.onTouchStart(touchEvent(30, 40)); });
    expect(onContextMenu).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(500); });
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    const call = onContextMenu.mock.calls[0][0];
    expect(call.clientX).toBe(30);
    expect(call.clientY).toBe(40);
  });

  it('releasing the touch before the duration elapses cancels the long-press', () => {
    const onContextMenu = vi.fn();
    const { result } = renderHook(() => useLongPressContextMenu(onContextMenu));
    act(() => { result.current.onTouchStart(touchEvent(0, 0)); });
    act(() => { vi.advanceTimersByTime(300); });
    act(() => { result.current.onTouchEnd(); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it('moving past the cancel threshold (scroll/drag) cancels the long-press', () => {
    const onContextMenu = vi.fn();
    const { result } = renderHook(() => useLongPressContextMenu(onContextMenu));
    act(() => { result.current.onTouchStart(touchEvent(0, 0)); });
    act(() => { result.current.onTouchMove(touchEvent(50, 0)); }); // 50px > 10px threshold
    act(() => { vi.advanceTimersByTime(500); });
    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it('a small jitter under the cancel threshold does not cancel the long-press', () => {
    const onContextMenu = vi.fn();
    const { result } = renderHook(() => useLongPressContextMenu(onContextMenu));
    act(() => { result.current.onTouchStart(touchEvent(0, 0)); });
    act(() => { result.current.onTouchMove(touchEvent(3, 3)); }); // well under 10px
    act(() => { vi.advanceTimersByTime(500); });
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('onTouchCancel clears a pending long-press', () => {
    const onContextMenu = vi.fn();
    const { result } = renderHook(() => useLongPressContextMenu(onContextMenu));
    act(() => { result.current.onTouchStart(touchEvent(0, 0)); });
    act(() => { result.current.onTouchCancel(); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(onContextMenu).not.toHaveBeenCalled();
  });
});
