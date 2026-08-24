// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useTaxonomyStore, initAIModels } from '../../hooks/useTaxonomyStore';
import { useChatStore } from '../../hooks/useChatStore';
import { initDebateSessions } from '../../hooks/useDebateStore';
import { usePopoutTheme } from '../../hooks/usePopoutTheme';
import { parseHashParams } from '../../lib/parseHash';
import { api } from '@bridge';
import { ChatWorkspace } from './ChatWorkspace';
import { CommunityChatDetail } from './ChatTab';
import { useCommunityStore, type CommunityChat } from '../../hooks/useCommunityStore';
import './ChatWindow.css';

export function ChatWindow() {
  const [ready, setReady] = useState(false);
  // Community deep-link (?source=community): render the read-only detail view, not the
  // editable workspace (t/2879). { active:false } = personal chat. Once the list is fetched,
  // resolved flips true; chat is the matched row or null (removed / no longer shared).
  const [community, setCommunity] = useState<
    { active: false } | { active: true; resolved: boolean; chat: CommunityChat | null }
  >({ active: false });
  usePopoutTheme();

  useEffect(() => {
    let cancelled = false;
    let unsubChatLoad: (() => void) | undefined;
    initAIModels()
      .then(() => useTaxonomyStore.getState().loadAll())
      .then(() => {
        initDebateSessions();
        if (!cancelled) {
          setReady(true);

          const params = parseHashParams(window.location.hash);
          const chatId = params.get('id');
          const source = params.get('source');

          // t/2880 — record how the deep link resolved so a blank/empty popout is
          // diagnosable from the flight recorder (which path did we take, and why).
          getGlobalRecorder()?.record({
            type: 'user.action',
            component: 'chat-window',
            level: 'info',
            message: 'chat.deep-link.parse',
            data: { source: source ?? null, id: chatId ?? null, resolved: source === 'community' ? 'community' : 'personal' },
          });

          if (chatId && source === 'community') {
            // Community chats are read-only content the viewer doesn't own — render the same
            // read-only detail as the in-tab browser, not the editable workspace (t/2879, TL ruling a).
            // Fetch the list for the row metadata; CommunityChatDetail self-loads the full transcript by id.
            setCommunity({ active: true, resolved: false, chat: null });
            void useCommunityStore.getState().fetchChats().then(() => {
              if (cancelled) return;
              const found = useCommunityStore.getState().chats.find(c => c.id === chatId) ?? null;
              setCommunity({ active: true, resolved: true, chat: found });
            });
          } else {
            // Personal chat — dual delivery: hash param (always available) + IPC push (handles
            // did-finish-load vs React-mount race via the preload buffer). Community is web-only,
            // so the Electron IPC push path is personal-only.
            if (chatId) void useChatStore.getState().loadChat(chatId);
            unsubChatLoad = api.onChatWindowLoad((id) => {
              void useChatStore.getState().loadChat(id);
            });
          }
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
    return () => { cancelled = true; unsubChatLoad?.(); };
  }, []);

  if (!ready) {
    return (
      <div className="chat-window-loading">
        Loading...
      </div>
    );
  }

  if (community.active) {
    return (
      <div className="chat-window-root">
        {!community.resolved ? (
          <div className="chat-window-loading">Loading community chat…</div>
        ) : community.chat ? (
          <CommunityChatDetail chat={community.chat} />
        ) : (
          <div className="chat-window-loading">This community chat is no longer available.</div>
        )}
      </div>
    );
  }

  return (
    <div className="chat-window-root">
      <ChatWorkspace />
    </div>
  );
}
