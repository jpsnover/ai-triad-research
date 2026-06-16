// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useTaxonomyStore, initAIModels } from '../hooks/useTaxonomyStore';
import { initDebateSessions } from '../hooks/useDebateStore';
import { ChatTab } from './ChatTab';

export function ChatWindow() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (!root.getAttribute('data-theme')) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    initAIModels()
      .then(() => useTaxonomyStore.getState().loadAll())
      .then(() => {
        initDebateSessions();
        if (!cancelled) setReady(true);
      })
      .catch(err => {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'chat-popout',
          level: 'error',
          message: 'Failed to initialize chat popout window',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        if (!cancelled) setReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted, #888)' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ChatTab />
    </div>
  );
}
