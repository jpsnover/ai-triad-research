// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback } from 'react';
import type { DebateSession } from '../types/debate';
import { POVER_INFO } from '../types/debate';
import { api } from '@bridge';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface NavigateCommand {
  entry?: string;
  tab?: string;
  overviewTab?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  navigation?: NavigateCommand;
}

interface Props {
  debate: DebateSession | null;
  selectedEntry: string | null;
  currentTab: string;
  onNavigate: (cmd: NavigateCommand) => void;
}

function getModel(): string {
  try {
    return localStorage.getItem('taxonomy-editor-gemini-model') || 'gemini-3.1-flash-lite-preview';
  } catch {
    return 'gemini-3.1-flash-lite-preview';
  }
}

interface TaxNode { id: string; label: string; category?: string; description?: string }

function buildTaxonomySection(label: string, nodes: TaxNode[]): string {
  if (nodes.length === 0) return '';
  const lines: string[] = [`\n## ${label} Taxonomy`];
  const byCategory = new Map<string, TaxNode[]>();
  for (const n of nodes) {
    const cat = n.category || 'Uncategorized';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(n);
  }
  for (const [cat, catNodes] of byCategory) {
    lines.push(`### ${cat}`);
    for (const n of catNodes) {
      lines.push(`- **${n.id}** ${n.label}${n.description ? ': ' + n.description.slice(0, 100) : ''}`);
    }
  }
  return lines.join('\n');
}

function buildDebateSnapshot(debate: DebateSession, taxonomies?: Map<string, TaxNode[]>): string {
  const lines: string[] = [];
  lines.push(`# Debate: ${debate.topic}`);
  const povers = debate.active_povers ?? [];
  lines.push(`Debaters: ${povers.map(p => POVER_INFO[p as keyof typeof POVER_INFO]?.label ?? p).join(', ')}`);
  lines.push(`Transcript entries: ${debate.transcript.length}`);
  lines.push(`Argument network: ${debate.argument_network?.nodes.length ?? 0} nodes, ${debate.argument_network?.edges.length ?? 0} edges`);

  lines.push('\n## Transcript Summary');
  for (const e of debate.transcript) {
    const speaker = POVER_INFO[e.speaker as keyof typeof POVER_INFO]?.label ?? e.speaker;
    const meta = e.metadata as Record<string, unknown> | undefined;
    const moves = meta?.move_types ? ` [moves: ${(meta.move_types as unknown[]).map(m => typeof m === 'string' ? m : (m as { move?: string }).move ?? '').join(', ')}]` : '';
    const preview = e.content.length > 200 ? e.content.slice(0, 200) + '...' : e.content;
    lines.push(`\n### ${e.id} — ${speaker} (${e.type})${moves}`);
    lines.push(preview);
  }

  if (debate.argument_network && debate.argument_network.nodes.length > 0) {
    lines.push('\n## Argument Network Nodes');
    for (const n of debate.argument_network.nodes) {
      const speaker = POVER_INFO[n.speaker as keyof typeof POVER_INFO]?.label ?? n.speaker;
      const strength = n.computed_strength != null ? ` str=${n.computed_strength.toFixed(2)}` : '';
      lines.push(`- ${n.id} (${speaker}${strength}): ${n.text.slice(0, 120)}`);
    }
    lines.push('\n## Argument Network Edges');
    for (const e of debate.argument_network.edges) {
      const label = e.type === 'attacks'
        ? `attacks(${e.attack_type ?? 'rebut'}${e.scheme ? ' via ' + e.scheme : ''})`
        : `supports${e.scheme ? ' via ' + e.scheme : ''}`;
      lines.push(`- ${e.source} → ${e.target}: ${label}`);
    }
  }

  if (debate.commitments && Object.keys(debate.commitments).length > 0) {
    lines.push('\n## Commitments');
    for (const [speaker, store] of Object.entries(debate.commitments)) {
      const label = POVER_INFO[speaker as keyof typeof POVER_INFO]?.label ?? speaker;
      lines.push(`### ${label}`);
      if (store.asserted.length) lines.push(`Asserted (${store.asserted.length}): ${store.asserted.slice(0, 5).join('; ')}${store.asserted.length > 5 ? '...' : ''}`);
      if (store.conceded.length) lines.push(`Conceded (${store.conceded.length}): ${store.conceded.join('; ')}`);
      if (store.challenged.length) lines.push(`Challenged (${store.challenged.length}): ${store.challenged.slice(0, 5).join('; ')}${store.challenged.length > 5 ? '...' : ''}`);
    }
  }

  if (debate.convergence_signals && debate.convergence_signals.length > 0) {
    lines.push('\n## Convergence Signals (latest per speaker)');
    const bySpeaker = new Map<string, typeof debate.convergence_signals[0]>();
    for (const s of debate.convergence_signals) bySpeaker.set(s.speaker, s);
    for (const [speaker, sig] of bySpeaker) {
      const label = POVER_INFO[speaker as keyof typeof POVER_INFO]?.label ?? speaker;
      lines.push(`${label}: collab=${(sig.move_disposition.ratio * 100).toFixed(0)}%, engagement=${(sig.engagement_depth.ratio * 100).toFixed(0)}%, recycling=${(sig.recycling_rate.max_self_overlap * 100).toFixed(0)}%, concession=${sig.concession_opportunity.outcome}, drift=${(sig.position_delta.drift * 100).toFixed(0)}%`);
    }
  }

  if (taxonomies) {
    const povLabels: Record<string, string> = { accelerationist: 'Accelerationist (Prometheus)', safetyist: 'Safetyist (Sentinel)', skeptic: 'Skeptic (Cassandra)' };
    for (const [pov, nodes] of taxonomies) {
      lines.push(buildTaxonomySection(povLabels[pov] ?? pov, nodes));
    }
  }

  return lines.join('\n');
}

function buildSystemPrompt(debate: DebateSession, taxonomies?: Map<string, TaxNode[]>): string {
  const entryIds = debate.transcript.map(e => e.id);
  const tabs = ['details', 'brief', 'plan', 'draft', 'cite', 'claims', 'tax-refs', 'tax-context', 'prompt', 'response'];
  const overviewTabs = ['argument-network', 'commitments', 'transcript', 'extraction', 'convergence'];

  return `You are a debate diagnostics analyst. Help the user explore the debate. Be concise — 2-3 sentences max unless they ask for detail.

CRITICAL RULE: When the user says "show", "go to", "open", or "navigate" to ANY entry or tab, you MUST include a navigate block. This is your primary function. Do it EVERY time.

## Navigation

To navigate, include this block at the END of your response:

\`\`\`navigate
{"entry": "S21", "tab": "brief"}
\`\`\`

Entry IDs are CASE-SENSITIVE and use UPPERCASE: ${entryIds.join(', ')}
When the user types "s21" or "s13", convert to uppercase: "S21", "S13".

Tabs (when entry selected): ${tabs.join(', ')}
Overview tabs (entry=null): ${overviewTabs.join(', ')}

Examples:
- "show brief for s21" → brief answer + \`\`\`navigate\n{"entry": "S21", "tab": "brief"}\n\`\`\`
- "show the argument network" → \`\`\`navigate\n{"entry": null, "overviewTab": "argument-network"}\n\`\`\`
- "go to s13 claims" → \`\`\`navigate\n{"entry": "S13", "tab": "claims"}\n\`\`\`
- "show convergence" → \`\`\`navigate\n{"entry": null, "overviewTab": "convergence"}\n\`\`\`

## Debate State

${buildDebateSnapshot(debate, taxonomies)}`;
}

function buildIncrementalUpdate(debate: DebateSession, lastSeenEntryCount: number): string | null {
  if (debate.transcript.length <= lastSeenEntryCount) return null;
  const newEntries = debate.transcript.slice(lastSeenEntryCount);
  const lines: string[] = ['[Debate update — new entries since last sync]'];
  for (const e of newEntries) {
    const speaker = POVER_INFO[e.speaker as keyof typeof POVER_INFO]?.label ?? e.speaker;
    const preview = e.content.length > 200 ? e.content.slice(0, 200) + '...' : e.content;
    lines.push(`${e.id} — ${speaker} (${e.type}): ${preview}`);
  }
  if (debate.argument_network) {
    lines.push(`Argument network now: ${debate.argument_network.nodes.length} nodes, ${debate.argument_network.edges.length} edges`);
  }
  return lines.join('\n');
}

function parseNavigation(text: string): { content: string; navigation?: NavigateCommand } {
  const navMatch = text.match(/```navigate\s*\n([\s\S]*?)\n```/);
  if (!navMatch) return { content: text };
  try {
    const nav = JSON.parse(navMatch[1]) as NavigateCommand;
    const content = text.replace(/```navigate\s*\n[\s\S]*?\n```/, '').trim();
    return { content, navigation: nav };
  } catch {
    return { content: text };
  }
}

const SESSION_MESSAGES_KEY = 'diag-chat-messages';
const SESSION_HISTORY_KEY = 'diag-chat-prompt-history';

function loadSessionMessages(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(SESSION_MESSAGES_KEY);
    return raw ? JSON.parse(raw) as ChatMessage[] : [];
  } catch { return []; }
}

function saveSessionMessages(msgs: ChatMessage[]) {
  try { sessionStorage.setItem(SESSION_MESSAGES_KEY, JSON.stringify(msgs)); } catch {}
}

function loadPromptHistory(): string[] {
  try {
    const raw = sessionStorage.getItem(SESSION_HISTORY_KEY);
    return raw ? JSON.parse(raw) as string[] : [];
  } catch { return []; }
}

function savePromptHistory(history: string[]) {
  try { sessionStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(history)); } catch {}
}

export function DiagnosticsChatSidebar({ debate, selectedEntry, currentTab, onNavigate }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [width, setWidth] = useState(360);
  const [messages, setMessages] = useState<ChatMessage[]>(loadSessionMessages);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastSeenEntryCount = useRef(0);
  const resizing = useRef(false);
  const savedWidth = useRef(360);
  const [taxonomies, setTaxonomies] = useState<Map<string, TaxNode[]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const povs = ['accelerationist', 'safetyist', 'skeptic'] as const;
      const result = new Map<string, TaxNode[]>();
      for (const pov of povs) {
        try {
          const file = await api.loadTaxonomyFile(pov) as { nodes?: { id: string; label: string; category?: string; description?: string }[] } | null;
          if (cancelled) return;
          if (file?.nodes) {
            result.set(pov, file.nodes.map(n => ({ id: n.id, label: n.label, category: n.category, description: n.description })));
          }
        } catch { /* non-fatal */ }
      }
      if (!cancelled) setTaxonomies(result);
    })();
    return () => { cancelled = true; };
  }, []);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const delta = startX - ev.clientX;
      setWidth(Math.max(280, Math.min(window.innerWidth * 0.8, startWidth + delta)));
    };
    const onUp = () => {
      resizing.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width]);

  const toggleFullscreen = useCallback(() => {
    if (fullscreen) {
      setWidth(savedWidth.current);
      setFullscreen(false);
    } else {
      savedWidth.current = width;
      setWidth(window.innerWidth);
      setFullscreen(true);
    }
  }, [fullscreen, width]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    saveSessionMessages(messages);
  }, [messages]);

  useEffect(() => {
    if (expanded && inputRef.current) inputRef.current.focus();
  }, [expanded]);

  // Inject incremental updates when debate progresses
  useEffect(() => {
    if (!debate || messages.length === 0) return;
    const update = buildIncrementalUpdate(debate, lastSeenEntryCount.current);
    if (update) {
      lastSeenEntryCount.current = debate.transcript.length;
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'system',
        content: update,
        timestamp: new Date().toISOString(),
      }]);
    }
  }, [debate?.transcript.length]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || generating) return;
    if (handleCommand(input)) {
      promptHistory.current.push(input.trim());
      savePromptHistory(promptHistory.current);
      historyIdx.current = -1;
      setInput('');
      return;
    }
    if (!debate) return;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    const isFirst = messages.length === 0;
    lastSeenEntryCount.current = debate.transcript.length;

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setGenerating(true);
    setActivity('Thinking...');

    try {
      const systemPrompt = isFirst ? buildSystemPrompt(debate, taxonomies.size > 0 ? taxonomies : undefined) : '';
      const contextNote = selectedEntry ? `\n[User is currently viewing entry ${selectedEntry}, tab: ${currentTab}]` : '\n[User is viewing the overview]';

      // Build conversation as a single prompt
      const promptParts: string[] = [];
      if (systemPrompt) promptParts.push(systemPrompt);
      for (const m of newMessages) {
        if (m.role === 'system') promptParts.push(`[System]: ${m.content}`);
        else if (m.role === 'user') promptParts.push(`[User]: ${m.content}`);
        else promptParts.push(`[Assistant]: ${m.content}`);
      }
      promptParts.push(contextNote);
      promptParts.push('[Assistant]:');

      const model = getModel();
      const unsubscribe = api.onGenerateTextProgress(() => {
        setActivity('Generating...');
      });

      const { text } = await api.generateText(promptParts.join('\n\n'), model, 60000, 0.3);
      unsubscribe();

      const { content, navigation } = parseNavigation(text);
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
        navigation,
      };

      setMessages(prev => [...prev, assistantMsg]);

      if (navigation) {
        onNavigate(navigation);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setGenerating(false);
      setActivity(null);
    }
  }, [input, debate, generating, messages, selectedEntry, currentTab, onNavigate]);

  const promptHistory = useRef<string[]>(loadPromptHistory());
  const historyIdx = useRef(-1);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim()) {
        promptHistory.current.push(input.trim());
        savePromptHistory(promptHistory.current);
        historyIdx.current = -1;
      }
      sendMessage();
    } else if (e.key === 'ArrowUp' && promptHistory.current.length > 0) {
      const textarea = e.target as HTMLTextAreaElement;
      if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        e.preventDefault();
        const newIdx = historyIdx.current === -1
          ? promptHistory.current.length - 1
          : Math.max(0, historyIdx.current - 1);
        historyIdx.current = newIdx;
        setInput(promptHistory.current[newIdx]);
      }
    } else if (e.key === 'ArrowDown' && historyIdx.current >= 0) {
      const textarea = e.target as HTMLTextAreaElement;
      if (textarea.selectionStart === textarea.value.length) {
        e.preventDefault();
        const newIdx = historyIdx.current + 1;
        if (newIdx >= promptHistory.current.length) {
          historyIdx.current = -1;
          setInput('');
        } else {
          historyIdx.current = newIdx;
          setInput(promptHistory.current[newIdx]);
        }
      }
    }
  };

  const clearChat = () => {
    setMessages([]);
    lastSeenEntryCount.current = 0;
  };

  const handleCommand = (text: string): boolean => {
    const cmd = text.trim().toLowerCase();
    if (cmd === 'clear history' || cmd === '/clear') {
      clearChat();
      return true;
    }
    return false;
  };

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        title="Open diagnostics chat"
        style={{
          position: 'fixed', right: 12, bottom: 12, zIndex: 1000,
          width: 44, height: 44, borderRadius: '50%',
          background: '#f59e0b', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          fontSize: '1.2rem', color: '#000',
        }}
      >
        ?
      </button>
    );
  }

  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, bottom: 0, zIndex: 999,
      width: fullscreen ? '100vw' : width, display: 'flex', flexDirection: 'column',
      background: 'var(--bg-primary, #1a1a2e)',
      borderLeft: fullscreen ? 'none' : '2px solid #f59e0b',
      boxShadow: '-4px 0 16px rgba(0,0,0,0.3)',
      transition: fullscreen ? 'width 0.15s ease' : 'none',
    }}>
      {/* Resize handle */}
      {!fullscreen && (
        <div
          onMouseDown={startResize}
          style={{
            position: 'absolute', left: -4, top: 0, bottom: 0, width: 8,
            cursor: 'col-resize', zIndex: 1001,
          }}
        />
      )}
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)',
      }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f59e0b', flex: 1 }}>
          Diagnostics Chat
        </span>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            title="Clear chat"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem' }}
          >Clear</button>
        )}
        <button
          onClick={toggleFullscreen}
          title={fullscreen ? 'Restore size' : 'Fullscreen'}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}
        >{fullscreen ? '⊡' : '⊞'}</button>
        <button
          onClick={() => { setExpanded(false); if (fullscreen) { setFullscreen(false); setWidth(savedWidth.current); } }}
          title="Minimize chat"
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: 0 }}
        >&times;</button>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '8px 12px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '12px 0', textAlign: 'center' }}>
            Ask questions about the debate diagnostics.
            <br /><br />
            <span style={{ fontSize: '0.68rem' }}>
              Try: "Show me the brief for S21"
              <br />"Which debater conceded the most?"
              <br />"What's the strongest attack chain?"
            </span>
          </div>
        )}
        {messages.filter(m => m.role !== 'system').map(msg => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
              padding: '6px 10px',
              borderRadius: 8,
              fontSize: '0.75rem',
              lineHeight: 1.4,
              background: msg.role === 'user' ? 'rgba(245,158,11,0.15)' : 'var(--bg-tertiary, rgba(255,255,255,0.05))',
              color: 'var(--text-primary, #e2e8f0)',
              border: msg.role === 'user' ? '1px solid rgba(245,158,11,0.3)' : '1px solid var(--border)',
            }}
          >
            {msg.role === 'assistant' ? (
              <div className="diag-chat-markdown">
                <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
              </div>
            ) : (
              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
            )}
            {msg.navigation && (
              <div style={{
                marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border)',
                fontSize: '0.65rem', color: '#f59e0b', cursor: 'pointer',
              }}
                onClick={() => msg.navigation && onNavigate(msg.navigation)}
              >
                Navigated to {msg.navigation.entry ?? 'overview'}{msg.navigation.tab ? ` → ${msg.navigation.tab}` : ''}{msg.navigation.overviewTab ? ` → ${msg.navigation.overviewTab}` : ''}
              </div>
            )}
          </div>
        ))}
        {generating && (
          <div style={{
            alignSelf: 'flex-start', padding: '6px 10px', borderRadius: 8,
            fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic',
          }}>
            {activity || 'Thinking...'}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '8px 12px', borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={debate ? 'Ask about the debate...' : 'Waiting for debate data...'}
            disabled={!debate || generating}
            rows={2}
            style={{
              flex: 1, resize: 'none',
              padding: '6px 8px', borderRadius: 6,
              fontSize: '0.75rem',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || !debate || generating}
            style={{
              padding: '0 12px', borderRadius: 6,
              background: input.trim() && debate && !generating ? '#f59e0b' : 'var(--bg-tertiary)',
              color: input.trim() && debate && !generating ? '#000' : 'var(--text-muted)',
              border: 'none', cursor: input.trim() && debate && !generating ? 'pointer' : 'not-allowed',
              fontWeight: 600, fontSize: '0.75rem',
            }}
          >Send</button>
        </div>
        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
          Enter to send, Shift+Enter for newline
        </div>
      </div>
    </div>
  );
}
