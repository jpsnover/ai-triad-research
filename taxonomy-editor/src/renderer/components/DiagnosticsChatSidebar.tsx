// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { DebateSession } from '../types/debate';
import { POVER_INFO } from '../types/debate';
import { POV_KEYS } from '@lib/debate/types';
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
  suggestions?: string[];
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

## Follow-up Suggestions

After EVERY response, suggest 2-3 follow-up questions the user might ask. Format them at the end:

\`\`\`suggestions
["What are the strongest attacks?", "Show the commitment stores", "Compare S21 and S13"]
\`\`\`

## Debate State

${buildDebateSnapshot(debate, taxonomies)}`;
}

function buildEntryContext(debate: DebateSession, entryId: string): string {
  const entry = debate.transcript.find(e => e.id === entryId);
  if (!entry) return '';
  const speaker = POVER_INFO[entry.speaker as keyof typeof POVER_INFO]?.label ?? entry.speaker;
  const meta = entry.metadata as Record<string, unknown> | undefined;
  const moves = meta?.move_types ? `\nMoves: ${JSON.stringify(meta.move_types)}` : '';
  const taxRefs = meta?.taxonomy_refs ? `\nTaxonomy refs: ${JSON.stringify(meta.taxonomy_refs)}` : '';
  return `\n[Currently viewing entry ${entryId} by ${speaker} (${entry.type})${moves}${taxRefs}]\nFull content:\n${entry.content}`;
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

function parseSuggestions(text: string): { content: string; suggestions?: string[] } {
  const sugMatch = text.match(/```suggestions\s*\n([\s\S]*?)\n```/);
  if (!sugMatch) return { content: text };
  try {
    const suggestions = JSON.parse(sugMatch[1]) as string[];
    const content = text.replace(/```suggestions\s*\n[\s\S]*?\n```/, '').trim();
    return { content, suggestions };
  } catch {
    return { content: text };
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

const COMPACTION_THRESHOLD = 25_000;
const KEEP_RECENT = 6;

function compactMessages(msgs: ChatMessage[]): ChatMessage[] {
  const totalTokens = msgs.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (totalTokens < COMPACTION_THRESHOLD || msgs.length <= KEEP_RECENT) return msgs;

  const cutoff = msgs.length - KEEP_RECENT;
  const older = msgs.slice(0, cutoff);
  const recent = msgs.slice(cutoff);

  const summaryLines: string[] = ['[Conversation summary — older messages compacted to save context]'];
  for (const m of older) {
    if (m.role === 'system') continue;
    const prefix = m.role === 'user' ? 'Q' : 'A';
    const preview = m.content.length > 150 ? m.content.slice(0, 150) + '...' : m.content;
    summaryLines.push(`${prefix}: ${preview}`);
  }

  const summaryMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'system',
    content: summaryLines.join('\n'),
    timestamp: new Date().toISOString(),
  };

  return [summaryMsg, ...recent];
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

function buildHelpText(): string {
  return [
    '**Available commands:**',
    '- `/help` or `/` or `/?` or `HELP` — Show this help',
    '- `/suggest` — Suggest questions to ask about the debate',
    '- `/clear` — Clear chat history',
    '- `/summary` — Show debate summary',
    '- `/strengths` — Show top arguments by QBAF strength',
    '- `/convergence` — Show convergence status',
    '- `/compare S21 S13` — Compare two entries',
    '',
    '**Keyboard shortcuts:**',
    '- `Ctrl+Shift+D` — Toggle chat panel',
    '- `Escape` — Minimize (or exit fullscreen)',
    '- `Ctrl+L` — Clear chat (when input focused)',
    '- `Tab` — Auto-complete commands',
    '- `Up/Down` — Prompt history',
  ].join('\n');
}

function buildSuggestText(debate: DebateSession, selectedEntry: string | null): string {
  const suggestions: string[] = ['**Suggested questions you can ask:**', ''];
  if (selectedEntry) {
    const entry = debate.transcript.find(e => e.id === selectedEntry);
    if (entry) {
      const speaker = POVER_INFO[entry.speaker as keyof typeof POVER_INFO]?.label ?? entry.speaker;
      suggestions.push(`- "What claims does ${speaker} make in ${selectedEntry}?"`)
      suggestions.push(`- "Show the brief for ${selectedEntry}"`);
      suggestions.push(`- "What attacks involve ${selectedEntry}?"`);
      const idx = debate.transcript.indexOf(entry);
      if (idx > 0) {
        suggestions.push(`- "Compare ${selectedEntry} with ${debate.transcript[idx - 1].id}"`);
      }
    }
  }
  suggestions.push('- "Which debater has the strongest arguments?"');
  suggestions.push('- "Are the debaters converging?"');
  suggestions.push('- "Who conceded the most?"');
  suggestions.push('- "Show the argument network"');
  suggestions.push('- "What are the main points of disagreement?"');
  suggestions.push('- "Summarize each debater\'s position"');

  if (debate.convergence_signals?.length) {
    suggestions.push('- "How close are the debaters to consensus?"');
  }
  if (debate.commitments && Object.values(debate.commitments).some(c => c.conceded.length > 0)) {
    suggestions.push('- "What has been conceded so far?"');
  }

  return suggestions.join('\n');
}

const SLASH_COMMANDS: Record<string, { description: string; handler: (debate: DebateSession, selectedEntry?: string | null) => string }> = {
  '/help': {
    description: 'Show available commands',
    handler: () => buildHelpText(),
  },
  '/suggest': {
    description: 'Suggest questions to ask',
    handler: (debate, selectedEntry) => buildSuggestText(debate, selectedEntry ?? null),
  },
  '/summary': {
    description: 'Debate summary',
    handler: (debate) => {
      const povers = (debate.active_povers ?? []).map(p => POVER_INFO[p as keyof typeof POVER_INFO]?.label ?? p);
      const net = debate.argument_network;
      const attacks = net?.edges.filter(e => e.type === 'attacks').length ?? 0;
      const supports = net?.edges.filter(e => e.type === 'supports').length ?? 0;
      return [
        `**Debate Summary: ${typeof debate.topic === 'string' ? debate.topic : debate.topic.final}**`,
        `- Phase: ${debate.phase}`,
        `- Debaters: ${povers.join(', ')}`,
        `- Transcript: ${debate.transcript.length} entries`,
        `- Argument network: ${net?.nodes.length ?? 0} nodes (${attacks} attacks, ${supports} supports)`,
        debate.commitments ? `- Commitments: ${Object.entries(debate.commitments).map(([s, c]) => `${POVER_INFO[s as keyof typeof POVER_INFO]?.label ?? s}: ${c.asserted.length} asserted, ${c.conceded.length} conceded`).join('; ')}` : '',
      ].filter(Boolean).join('\n');
    },
  },
  '/strengths': {
    description: 'Top arguments by strength',
    handler: (debate) => {
      const nodes = debate.argument_network?.nodes ?? [];
      if (nodes.length === 0) return 'No argument nodes yet.';
      const sorted = [...nodes]
        .filter(n => n.computed_strength != null)
        .sort((a, b) => (b.computed_strength ?? 0) - (a.computed_strength ?? 0));
      const top = sorted.slice(0, 8);
      return ['**Top arguments by QBAF strength:**', ...top.map((n, i) => {
        const speaker = POVER_INFO[n.speaker as keyof typeof POVER_INFO]?.label ?? n.speaker;
        const bdi = n.bdi_category ? ` ${n.bdi_category[0].toUpperCase()}` : '';
        const conf = n.bdi_confidence != null && n.bdi_confidence < 0.5 ? ' *' : '';
        return `${i + 1}. **${n.id}** (${speaker},${bdi}, str=${n.computed_strength?.toFixed(2)}${conf}): ${n.text.slice(0, 100)}`;
      }), '', '_* = low AI scoring confidence (Beliefs)_'].join('\n');
    },
  },
  '/convergence': {
    description: 'Convergence status',
    handler: (debate) => {
      const signals = debate.convergence_signals;
      if (!signals || signals.length === 0) return 'No convergence signals recorded yet.';
      const bySpeaker = new Map<string, typeof signals[0]>();
      for (const s of signals) bySpeaker.set(s.speaker, s);
      const lines = ['**Convergence Status:**'];
      for (const [speaker, sig] of bySpeaker) {
        const label = POVER_INFO[speaker as keyof typeof POVER_INFO]?.label ?? speaker;
        lines.push(`\n**${label}:**`);
        lines.push(`- Collaborative moves: ${(sig.move_disposition.ratio * 100).toFixed(0)}%`);
        lines.push(`- Engagement depth: ${(sig.engagement_depth.ratio * 100).toFixed(0)}%`);
        lines.push(`- Recycling rate: ${(sig.recycling_rate.max_self_overlap * 100).toFixed(0)}%`);
        lines.push(`- Concession: ${sig.concession_opportunity.outcome}`);
        lines.push(`- Position drift: ${(sig.position_delta.drift * 100).toFixed(0)}%`);
      }
      return lines.join('\n');
    },
  },
};

function handleCompareCommand(debate: DebateSession, args: string): string | null {
  const match = args.match(/\/compare\s+(\S+)\s+(\S+)/i);
  if (!match) return null;
  const [, id1, id2] = match;
  const e1 = debate.transcript.find(e => e.id.toLowerCase() === id1.toLowerCase());
  const e2 = debate.transcript.find(e => e.id.toLowerCase() === id2.toLowerCase());
  if (!e1 || !e2) return `Entry not found. Available: ${debate.transcript.map(e => e.id).join(', ')}`;
  const s1 = POVER_INFO[e1.speaker as keyof typeof POVER_INFO]?.label ?? e1.speaker;
  const s2 = POVER_INFO[e2.speaker as keyof typeof POVER_INFO]?.label ?? e2.speaker;
  const net = debate.argument_network;
  const e1Attacks = net?.edges.filter(e => e.source === e1.id && e.type === 'attacks') ?? [];
  const e2Attacks = net?.edges.filter(e => e.source === e2.id && e.type === 'attacks') ?? [];
  const e1Supports = net?.edges.filter(e => e.source === e1.id && e.type === 'supports') ?? [];
  const e2Supports = net?.edges.filter(e => e.source === e2.id && e.type === 'supports') ?? [];
  return [
    `**Comparing ${e1.id} vs ${e2.id}:**`,
    '',
    `| | ${e1.id} | ${e2.id} |`,
    `|---|---|---|`,
    `| Speaker | ${s1} | ${s2} |`,
    `| Type | ${e1.type} | ${e2.type} |`,
    `| Length | ${e1.content.length} chars | ${e2.content.length} chars |`,
    `| Attacks made | ${e1Attacks.length} | ${e2Attacks.length} |`,
    `| Supports made | ${e1Supports.length} | ${e2Supports.length} |`,
    '',
    `**${e1.id}** preview: ${e1.content.slice(0, 120)}...`,
    `**${e2.id}** preview: ${e2.content.slice(0, 120)}...`,
  ].join('\n');
}

export function DiagnosticsChatSidebar({ debate, selectedEntry, currentTab, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(loadSessionMessages);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [activity, setActivity] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastSeenEntryCount = useRef(0);
  const [taxonomies, setTaxonomies] = useState<Map<string, TaxNode[]>>(new Map());
  const promptHistory = useRef<string[]>(loadPromptHistory());
  const historyIdx = useRef(-1);

  const contextTokens = useMemo(() => {
    if (!debate) return 0;
    const systemPrompt = buildSystemPrompt(debate, taxonomies.size > 0 ? taxonomies : undefined);
    const msgTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    return estimateTokens(systemPrompt) + msgTokens;
  }, [debate, taxonomies, messages]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const povs = POV_KEYS;
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    saveSessionMessages(messages);
  }, [messages]);

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

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setOpen(prev => !prev);
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.ctrlKey && e.key === 'l') {
        if (document.activeElement === inputRef.current) {
          e.preventDefault();
          setMessages([]);
          lastSeenEntryCount.current = 0;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Auto-scroll during streaming
  useEffect(() => {
    if (streamingText) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [streamingText]);

  const handleSlashCommand = useCallback((text: string): boolean => {
    const cmd = text.trim().toLowerCase();
    if (cmd === '/clear' || cmd === 'clear history') {
      setMessages([]);
      lastSeenEntryCount.current = 0;
      return true;
    }
    if (cmd.startsWith('/compare') && debate) {
      const result = handleCompareCommand(debate, text.trim());
      if (result) {
        setMessages(prev => [...prev,
          { id: crypto.randomUUID(), role: 'user', content: text.trim(), timestamp: new Date().toISOString() },
          { id: crypto.randomUUID(), role: 'assistant', content: result, timestamp: new Date().toISOString() },
        ]);
        return true;
      }
    }
    // "/" or "/?" or "HELP" all trigger help
    if (cmd === '/' || cmd === '/?' || cmd === 'help') {
      const result = buildHelpText();
      setMessages(prev => [...prev,
        { id: crypto.randomUUID(), role: 'user', content: text.trim(), timestamp: new Date().toISOString() },
        { id: crypto.randomUUID(), role: 'assistant', content: result, timestamp: new Date().toISOString() },
      ]);
      return true;
    }
    const handler = SLASH_COMMANDS[cmd];
    if (handler && debate) {
      const result = handler.handler(debate, selectedEntry);
      setMessages(prev => [...prev,
        { id: crypto.randomUUID(), role: 'user', content: text.trim(), timestamp: new Date().toISOString() },
        { id: crypto.randomUUID(), role: 'assistant', content: result, timestamp: new Date().toISOString() },
      ]);
      return true;
    }
    return false;
  }, [debate, selectedEntry]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || generating) return;
    if (handleSlashCommand(input)) {
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

    lastSeenEntryCount.current = debate.transcript.length;

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setGenerating(true);
    setStreamingText('');
    setActivity('Checking API key...');

    const cleanups: (() => void)[] = [];
    try {
      const model = getModel();
      const backend = model.startsWith('claude') ? 'claude'
        : model.startsWith('groq') ? 'groq'
        : model.startsWith('openai') ? 'openai'
        : 'gemini';
      const hasKey = await api.hasApiKey(backend);
      if (!hasKey) {
        const names: Record<string, string> = { gemini: 'Gemini', claude: 'Claude', groq: 'Groq', openai: 'OpenAI' };
        throw new Error(`No ${names[backend] ?? backend} API key configured. Open Settings to add one.`);
      }

      setActivity(`Calling ${model}...`);

      const systemPrompt = buildSystemPrompt(debate, taxonomies.size > 0 ? taxonomies : undefined);

      const entryContext = selectedEntry ? buildEntryContext(debate, selectedEntry) : '';
      const contextNote = selectedEntry
        ? `${entryContext}\n[Current tab: ${currentTab}]`
        : '[User is viewing the overview]';

      const compacted = compactMessages(newMessages);
      if (compacted.length < newMessages.length) {
        setMessages(compacted);
      }

      const apiMessages: { role: 'user' | 'model'; content: string }[] = [];
      for (const m of compacted) {
        if (m.role === 'system') {
          apiMessages.push({ role: 'user', content: `[System update]: ${m.content}` });
          apiMessages.push({ role: 'model', content: 'Noted, I\'ll incorporate this updated state.' });
        } else if (m.role === 'user') {
          apiMessages.push({ role: 'user', content: m.content });
        } else {
          apiMessages.push({ role: 'model', content: m.content });
        }
      }

      const lastIdx = apiMessages.length - 1;
      if (lastIdx >= 0 && apiMessages[lastIdx].role === 'user') {
        apiMessages[lastIdx] = {
          ...apiMessages[lastIdx],
          content: apiMessages[lastIdx].content + '\n' + contextNote,
        };
      }

      // Register chunk listener for progressive streaming (best-effort)
      const unsubChunk = api.onChatStreamChunk((chunk) => {
        setStreamingText(prev => prev + chunk);
        setActivity('Generating...');
      });
      cleanups.push(unsubChunk);

      // Primary mechanism: invoke returns the full text directly
      // Events provide progressive display but invoke is the reliable path
      const fullText = await api.startChatStream(systemPrompt, apiMessages, model, 0.3);

      const { content: navParsed, navigation } = parseNavigation(fullText);
      const { content: finalContent, suggestions } = parseSuggestions(navParsed);

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: finalContent,
        timestamp: new Date().toISOString(),
        navigation,
        suggestions,
      };

      setMessages(prev => [...prev, assistantMsg]);
      setStreamingText('');

      if (navigation) {
        onNavigate(navigation);
      }
    } catch (err) {
      setStreamingText('');
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      for (const cleanup of cleanups) {
        try { cleanup(); } catch {}
      }
      setGenerating(false);
      setActivity(null);
    }
  }, [input, debate, generating, messages, selectedEntry, currentTab, onNavigate, taxonomies, handleSlashCommand]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim()) {
        promptHistory.current.push(input.trim());
        savePromptHistory(promptHistory.current);
        historyIdx.current = -1;
      }
      void sendMessage();
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
    } else if (e.key === 'Tab' && input.startsWith('/')) {
      e.preventDefault();
      const partial = input.toLowerCase();
      const allCmds = [...Object.keys(SLASH_COMMANDS), '/clear', '/compare', '/?'];
      const match = allCmds.find(c => c.startsWith(partial) && c !== partial);
      if (match) setInput(match === '/compare' ? '/compare ' : match);
    }
  };

  const localSuggestions = useMemo(() => {
    if (!debate) return [];
    const suggestions: string[] = [];
    if (selectedEntry) {
      const entry = debate.transcript.find(e => e.id === selectedEntry);
      if (entry) {
        const speaker = POVER_INFO[entry.speaker as keyof typeof POVER_INFO]?.label ?? entry.speaker;
        suggestions.push(`Show brief for ${selectedEntry}`);
        suggestions.push(`What claims does ${speaker} make in ${selectedEntry}?`);
        const idx = debate.transcript.indexOf(entry);
        if (idx > 0) {
          const prev = debate.transcript[idx - 1];
          suggestions.push(`Compare ${selectedEntry} with ${prev.id}`);
        }
        const attacks = debate.argument_network?.edges.filter(
          e => e.source === selectedEntry || e.target === selectedEntry
        ) ?? [];
        if (attacks.length > 0) {
          suggestions.push(`What attacks involve ${selectedEntry}?`);
        }
      }
    } else {
      suggestions.push('Which debater has the strongest arguments?');
      if (debate.convergence_signals?.length) {
        suggestions.push('Are the debaters converging?');
      }
      if (debate.commitments && Object.values(debate.commitments).some(c => c.conceded.length > 0)) {
        suggestions.push('Who conceded the most?');
      }
      suggestions.push('Show the argument network');
    }
    return suggestions.slice(0, 3);
  }, [debate, selectedEntry]);

  const handleSuggestionClick = useCallback((suggestion: string) => {
    if (generating) return;
    setInput(suggestion);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [generating]);

  const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');

  const chatContent = (
    <div className="diag-chat-sidebar" style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-primary, #1a1a2e)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)',
      }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f59e0b' }}>
          Diagnostics Chat
        </span>
        <span style={{
          fontSize: '0.6rem', color: 'var(--text-muted)',
          padding: '1px 6px', borderRadius: 4,
          background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
          flex: 1,
        }}>
          {getModel()}
        </span>
        {messages.length > 0 && (
          <button
            onClick={() => { setMessages([]); lastSeenEntryCount.current = 0; }}
            title="Clear chat (Ctrl+L)"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem' }}
          >Clear</button>
        )}
        <button
          onClick={() => setOpen(false)}
          title="Close chat (Esc)"
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1 }}
        >&times;</button>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '8px 12px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {messages.length === 0 && !generating && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '12px 0', textAlign: 'center' }}>
            Ask questions about the debate diagnostics.
            <br /><br />
            <span style={{ fontSize: '0.68rem' }}>
              Try: "Show me the brief for S21"
              <br />"Which debater conceded the most?"
              <br />"What's the strongest attack chain?"
              <br /><br />
              Type / or HELP for commands | /suggest for question ideas
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
              userSelect: 'text',
              cursor: 'text',
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
        {generating && streamingText && (
          <div style={{
            alignSelf: 'flex-start', maxWidth: '90%',
            padding: '6px 10px', borderRadius: 8,
            fontSize: '0.75rem', lineHeight: 1.4,
            background: 'var(--bg-tertiary, rgba(255,255,255,0.05))',
            color: 'var(--text-primary, #e2e8f0)',
            border: '1px solid var(--border)',
            userSelect: 'text', cursor: 'text',
          }}>
            <div className="diag-chat-markdown">
              <Markdown remarkPlugins={[remarkGfm]}>{streamingText}</Markdown>
            </div>
          </div>
        )}
        {generating && !streamingText && (
          <div style={{
            alignSelf: 'flex-start', padding: '6px 10px', borderRadius: 8,
            fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic',
          }}>
            {activity || 'Thinking...'}
          </div>
        )}
        {!generating && (() => {
          const suggestions = lastAssistantMsg?.suggestions?.length
            ? lastAssistantMsg.suggestions
            : localSuggestions;
          if (!suggestions.length) return null;
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 0' }}>
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestionClick(s)}
                  style={{
                    padding: '3px 8px', borderRadius: 12,
                    fontSize: '0.65rem', cursor: 'pointer',
                    background: 'rgba(245,158,11,0.08)',
                    color: '#f59e0b',
                    border: '1px solid rgba(245,158,11,0.2)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(245,158,11,0.18)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(245,158,11,0.08)')}
                >
                  {s}
                </button>
              ))}
            </div>
          );
        })()}
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
            placeholder={debate ? 'Ask about the debate... (/ for commands)' : 'Waiting for debate data...'}
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
            onClick={() => void sendMessage()}
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
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 4,
        }}>
          <span>~{contextTokens.toLocaleString()} tokens in context</span>
          <span>Enter send | Ctrl+L clear</span>
        </div>
      </div>
    </div>
  );

  const [width, setWidth] = useState(360);
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = width;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = dragStartX.current - ev.clientX;
      setWidth(Math.max(240, Math.min(800, dragStartW.current + delta)));
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Open diagnostics chat (Ctrl+Shift+D)"
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
      width, display: 'flex', flexShrink: 0, position: 'relative',
    }}>
      <div
        onMouseDown={onResizeStart}
        style={{
          width: 5, cursor: 'col-resize', flexShrink: 0,
          background: 'var(--border)',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#f59e0b')}
        onMouseLeave={e => { if (!dragging.current) e.currentTarget.style.background = 'var(--border)'; }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {chatContent}
      </div>
    </div>
  );
}
