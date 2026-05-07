// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Analytics event emitter — web-only, no-op in Electron.
 *
 * Listens to Zustand store changes for user-meaningful events, buffers them
 * in memory, and flushes to POST /api/analytics/event every 30s or on
 * beforeunload. Generates a per-tab session_id.
 */

interface AnalyticsEvent {
  user: string;
  session_id: string;
  timestamp: string;
  event_type: string;
  category: string;
  detail: Record<string, unknown>;
  duration_ms?: number;
}

const isWeb = import.meta.env.VITE_TARGET === 'web';

let sessionId = '';
let user = '_anonymous';
let buffer: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

function getSessionId(): string {
  if (!sessionId) {
    sessionId = sessionStorage.getItem('analytics_session_id') || crypto.randomUUID();
    sessionStorage.setItem('analytics_session_id', sessionId);
  }
  return sessionId;
}

function emit(eventType: string, category: string, detail: Record<string, unknown> = {}, durationMs?: number): void {
  if (!isWeb || !initialized) return;
  const evt: AnalyticsEvent = {
    user,
    session_id: getSessionId(),
    timestamp: new Date().toISOString(),
    event_type: eventType,
    category,
    detail,
  };
  if (durationMs != null) evt.duration_ms = durationMs;
  buffer.push(evt);
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  try {
    await fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
  } catch {
    // Re-queue on failure (drop if buffer gets too large)
    if (buffer.length < 500) {
      buffer.unshift(...batch);
    }
  }
}

/** Initialize analytics. Call once after app loads. No-op in Electron. */
export async function initAnalytics(): Promise<void> {
  if (!isWeb || initialized) return;
  initialized = true;

  // Resolve user identity
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json() as { user: string };
      user = data.user || '_anonymous';
    }
  } catch { /* keep _anonymous */ }

  // Session start event
  emit('session.start', 'navigation', { userAgent: navigator.userAgent });

  // Subscribe to Zustand store changes (lazy import to avoid circular deps)
  try {
    const { useTaxonomyStore } = await import('../hooks/useTaxonomyStore');
    useTaxonomyStore.subscribe(
      (state, prev) => {
        if (state.activeTab !== prev.activeTab) {
          trackTabSwitch(state.activeTab);
        }
        if (state.selectedNodeId !== prev.selectedNodeId && state.selectedNodeId) {
          trackNodeSelect(state.selectedNodeId);
        }
        if (state.toolbarPanel !== prev.toolbarPanel && state.toolbarPanel) {
          trackPanelOpen(state.toolbarPanel);
        }
      },
    );
  } catch { /* store not available yet — skip */ }

  // Flush every 30s
  flushTimer = setInterval(() => { void flush(); }, 30_000);

  // Flush on page unload
  window.addEventListener('beforeunload', () => {
    emit('session.end', 'navigation');
    // Use sendBeacon for reliable delivery on unload
    if (buffer.length > 0) {
      navigator.sendBeacon(
        '/api/analytics/event',
        new Blob([JSON.stringify({ events: buffer })], { type: 'application/json' }),
      );
      buffer = [];
    }
  });
}

/** Emit a tab switch event. */
export function trackTabSwitch(tab: string): void {
  emit('tab.switch', 'navigation', { tab });
}

/** Emit a node selection event. */
export function trackNodeSelect(nodeId: string, nodeLabel?: string): void {
  emit('node.select', 'taxonomy', { nodeId, label: nodeLabel });
}

/** Emit a toolbar panel open event. */
export function trackPanelOpen(panel: string): void {
  emit('panel.open', 'navigation', { panel });
}

/** Emit a search event. */
export function trackSearch(query: string, resultCount?: number, durationMs?: number): void {
  emit('search', 'search', { query, resultCount }, durationMs);
}

/** Emit a debate lifecycle event. */
export function trackDebateEvent(eventType: string, detail: Record<string, unknown> = {}): void {
  emit(eventType, 'debate', detail);
}

/** Emit an AI call event. */
export function trackAICall(model: string, durationMs?: number): void {
  emit('ai.call', 'ai', { model }, durationMs);
}

/** Emit a config change event. */
export function trackConfigChange(setting: string, value: unknown): void {
  emit('config.change', 'config', { setting, value });
}

/** Stop the flush timer. */
export function stopAnalytics(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  void flush();
  initialized = false;
}
