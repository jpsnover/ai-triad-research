// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useDebateStore } from '../store';

/** Check if an error is a daily token limit (tokens_per_day) — non-retryable. */
export function isDailyLimitError(err: unknown): boolean {
  return (err as { limitType?: string })?.limitType === 'tokens_per_day';
}

export const DAILY_LIMIT_MESSAGE = 'Daily AI usage limit reached (resets at midnight UTC). Resume tomorrow, or add your own API key in Settings to continue now.';

export let _abortController: AbortController | null = null;

/**
 * Guard against race conditions in async debate operations.
 * Captures the active debate ID at call time; returns a checker that
 * verifies the debate hasn't changed during an await.
 */
export function createDebateGuard(get: () => { activeDebateId: string | null }): () => boolean {
  const capturedId = get().activeDebateId;
  return () => {
    if (_abortController?.signal.aborted) return false;
    if (capturedId !== get().activeDebateId) {
      console.warn(`[debate] Active debate changed during async operation (was ${capturedId}, now ${get().activeDebateId}). Discarding stale results.`);
      return false;
    }
    return true;
  };
}

export function cancelAndResetAbort(): void {
  _abortController?.abort();
  _abortController = null;
}

export function newAbortController(): AbortController {
  _abortController = new AbortController();
  return _abortController;
}

// ── Single-driver guard (t/657) ────────────────────────────────────────
const _driverChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('aitriad-debate-driver') : null;
const _windowId = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : `w-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let _activeDriverWindow: string | null = null;
let _isPopoutWindow = false;

function reloadActiveDebateFromStorage(): void {
  const debateId = useDebateStore.getState().activeDebateId;
  if (debateId) {
    void useDebateStore.getState().loadDebate(debateId);
  }
}

if (_driverChannel) {
  _driverChannel.onmessage = (e: MessageEvent) => {
    const { type, windowId } = e.data as { type: string; windowId: string };
    if (type === 'claim') {
      _activeDriverWindow = windowId;
      if (windowId !== _windowId && !_isPopoutWindow) {
        useDebateStore.setState({ driverIsRemote: true });
      }
    }
    if (type === 'release' && _activeDriverWindow === windowId) {
      _activeDriverWindow = null;
      if (windowId !== _windowId) {
        useDebateStore.setState({ driverIsRemote: false });
        reloadActiveDebateFromStorage();
      }
    }
  };
}
const _beforeUnloadHandler = () => releaseDebateDriver();
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _driverChannel?.close();
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', _beforeUnloadHandler);
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', _beforeUnloadHandler);
}

export function claimDebateDriver(): boolean {
  if (_activeDriverWindow && _activeDriverWindow !== _windowId) return false;
  _activeDriverWindow = _windowId;
  _driverChannel?.postMessage({ type: 'claim', windowId: _windowId });
  return true;
}

export function releaseDebateDriver(): void {
  if (_activeDriverWindow === _windowId) {
    _activeDriverWindow = null;
    _driverChannel?.postMessage({ type: 'release', windowId: _windowId });
  }
}

function resetDebateDriverLock(): void {
  _activeDriverWindow = null;
}

export function markAsPopout(): void {
  _isPopoutWindow = true;
  _activeDriverWindow = _windowId;
  useDebateStore.setState({ driverIsRemote: false });
  _driverChannel?.postMessage({ type: 'claim', windowId: _windowId });
}

export function initDebatePopoutCloseHandler(api: { onDebatePopoutClosed: (cb: () => void) => () => void }): () => void {
  return api.onDebatePopoutClosed(() => {
    useDebateStore.setState({ driverIsRemote: false });
    reloadActiveDebateFromStorage();
  });
}
