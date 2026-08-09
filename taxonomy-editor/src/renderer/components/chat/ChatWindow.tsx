// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useTaxonomyStore, initAIModels } from '../../hooks/useTaxonomyStore';
import { useChatStore } from '../../hooks/useChatStore';
import { initDebateSessions } from '../../hooks/useDebateStore';
import { usePopoutTheme } from '../../hooks/usePopoutTheme';
import { parseHashParams } from '../../lib/parseHash';
import { ChatTab } from './ChatTab';
import './ChatWindow.css';

export function ChatWindow() {
  const [ready, setReady] = useState(false);
  usePopoutTheme();

  useEffect(() => {
    let cancelled = false;
    initAIModels()
      .then(() => useTaxonomyStore.getState().loadAll())
      .then(() => {
        initDebateSessions();
        if (!cancelled) {
          setReady(true);
          const chatId = parseHashParams(window.location.hash).get('id');
          if (chatId) void useChatStore.getState().loadChat(chatId);
        }
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
      <div className="chat-window-loading">
        Loading...
      </div>
    );
  }

  return (
    <div className="chat-window-root">
      <ChatTab />
    </div>
  );
}
