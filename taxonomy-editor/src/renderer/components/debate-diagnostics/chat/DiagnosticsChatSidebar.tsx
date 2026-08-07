// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { MessageBubble, ThinkingIndicator, StreamingBubble } from '../../shared/ChatBubble';
import type { DebateSession } from '../../../types/debate';
import { POVER_INFO } from '../../../types/debate';
import { POV_META, type PovMetaKey } from '@lib/electron-shared/povMeta';
import { POV_KEYS } from '@lib/debate/types';
import { api, isElectronMode } from '@bridge';
import { DEFAULT_MODEL } from '@lib/ai-client/defaults';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkColorizePov } from '../../../utils/colorizePovPlugin';

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
  isError?: boolean;
  navigation?: NavigateCommand;
  suggestions?: string[];
}

interface Props {
  debate: DebateSession | null;
  selectedEntry: string | null;
  currentTab: string;
  onNavigate: (cmd: NavigateCommand) => void;
  /** When true, renders inline without the floating toggle button. Parent controls visibility. */
  embedded?: boolean;
  /** Called when the user clicks close in embedded mode. */
  onClose?: () => void;
}

function getModel(): string {
  try {
    return localStorage.getItem('taxonomy-editor-gemini-model') || DEFAULT_MODEL;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'diagnostics-chat-sidebar',
      level: 'warn',
      message: 'Failed to read model from localStorage',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return DEFAULT_MODEL;
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

type ConvergenceSignal = NonNullable<DebateSession['convergence_signals']>[number];

function snapshotHeaderLines(debate: DebateSession): string[] {
  const lines: string[] = [];
  lines.push(`# Debate: ${debate.topic}`);
  const povers = debate.active_povers ?? [];
  lines.push(`Debaters: ${povers.map(p => POVER_INFO[p as keyof typeof POVER_INFO]?.label ?? p).join(', ')}`);
  lines.push(`Transcript entries: ${debate.transcript.length}`);
  lines.push(`Argument network: ${debate.argument_network?.nodes.length ?? 0} nodes, ${debate.argument_network?.edges.length ?? 0} edges`);
  return lines;
}

function transcriptSummaryLines(debate: DebateSession): string[] {
  const lines: string[] = ['\n## Transcript Summary'];
  for (const e of debate.transcript) {
    const speaker = POVER_INFO[e.speaker as keyof typeof POVER_INFO]?.label ?? e.speaker;
    const meta = e.metadata as Record<string, unknown> | undefined;
    const moves = meta?.move_types ? ` [moves: ${(meta.move_types as unknown[]).map(m => typeof m === 'string' ? m : (m as { move?: string }).move ?? '').join(', ')}]` : '';
    const preview = e.content.length > 200 ? e.content.slice(0, 200) + '...' : e.content;
    lines.push(`\n### ${e.id} — ${speaker} (${e.type})${moves}`);
    lines.push(preview);
  }
  return lines;
}

function argNetworkLines(debate: DebateSession): string[] {
  const lines: string[] = [];
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
  return lines;
}

function commitmentLines(debate: DebateSession): string[] {
  const lines: string[] = [];
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
  return lines;
}

function formatConvergenceSnapshotLine(label: string, sig: ConvergenceSignal): string {
  return `${label}: collab=${((sig.move_polarity?.ratio ?? 0) * 100).toFixed(0)}%, dialectical engagement=${((sig.dialectical_engagement?.ratio ?? 0) * 100).toFixed(0)}%, argument redundancy=${((sig.argument_redundancy?.max_self_overlap ?? 0) * 100).toFixed(0)}%, concession=${sig.concession_opportunity?.outcome ?? 'none'}, drift=${((sig.position_drift?.drift ?? 0) * 100).toFixed(0)}%`;
}

function convergenceSnapshotLines(debate: DebateSession): string[] {
  const lines: string[] = [];
  if (debate.convergence_signals && debate.convergence_signals.length > 0) {
    lines.push('\n## Convergence Signals (latest per speaker)');
    const bySpeaker = new Map<string, ConvergenceSignal>();
    for (const s of debate.convergence_signals) bySpeaker.set(s.speaker, s);
    for (const [speaker, sig] of bySpeaker) {
      const label = POVER_INFO[speaker as keyof typeof POVER_INFO]?.label ?? speaker;
      lines.push(formatConvergenceSnapshotLine(label, sig));
    }
  }
  return lines;
}

function taxonomyLines(taxonomies?: Map<string, TaxNode[]>): string[] {
  if (!taxonomies) return [];
  const lines: string[] = [];
  const povLabels: Record<string, string> = Object.fromEntries(Object.entries(POV_META).map(([k, v]) => [k, v.label]));
  for (const [pov, nodes] of taxonomies) {
    lines.push(buildTaxonomySection(povLabels[pov] ?? pov, nodes));
  }
  return lines;
}

function buildDebateSnapshot(debate: DebateSession, taxonomies?: Map<string, TaxNode[]>): string {
  return [
    ...snapshotHeaderLines(debate),
    ...transcriptSummaryLines(debate),
    ...argNetworkLines(debate),
    ...commitmentLines(debate),
    ...convergenceSnapshotLines(debate),
    ...taxonomyLines(taxonomies),
  ].join('\n');
}

function buildSystemPrompt(debate: DebateSession, taxonomies?: Map<string, TaxNode[]>): string {
  const entryIds = debate.transcript.map(e => e.id);
  const tabs = ['details', 'brief', 'plan', 'draft', 'cite', 'claims', 'tax-refs', 'tax-context', 'prompt', 'response'];
  const overviewTabs = ['argument-network', 'commitments', 'transcript', 'extraction', 'convergence'];

  return `You are a debate analyst. Help the user explore the debate. Be concise — 2-3 sentences max unless they ask for detail.

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
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'diagnostics-chat', level: 'debug', message: 'Navigation block JSON parse failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
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
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'diagnostics-chat', level: 'debug', message: 'Suggestions block JSON parse failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
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
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'diagnostics-chat-sidebar',
      level: 'warn',
      message: 'Failed to load session messages from sessionStorage',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return [];
  }
}

function saveSessionMessages(msgs: ChatMessage[]) {
  try { sessionStorage.setItem(SESSION_MESSAGES_KEY, JSON.stringify(msgs)); } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'diagnostics-chat-sidebar',
      level: 'warn',
      message: 'Failed to save session messages to sessionStorage',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }
}

function loadPromptHistory(): string[] {
  try {
    const raw = sessionStorage.getItem(SESSION_HISTORY_KEY);
    return raw ? JSON.parse(raw) as string[] : [];
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'diagnostics-chat-sidebar',
      level: 'warn',
      message: 'Failed to load prompt history from sessionStorage',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return [];
  }
}

function savePromptHistory(history: string[]) {
  try { sessionStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(history)); } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'diagnostics-chat-sidebar',
      level: 'warn',
      message: 'Failed to save prompt history to sessionStorage',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }
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
    '- `Ctrl+Shift+D` — Toggle Debate Chat',
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

function formatConvergenceStatusBlock(label: string, sig: ConvergenceSignal): string[] {
  return [
    `\n**${label}:**`,
    `- Collaborative moves: ${((sig.move_polarity?.ratio ?? 0) * 100).toFixed(0)}%`,
    `- Dialectical engagement: ${((sig.dialectical_engagement?.ratio ?? 0) * 100).toFixed(0)}%`,
    `- Argument redundancy: ${((sig.argument_redundancy?.max_self_overlap ?? 0) * 100).toFixed(0)}%`,
    `- Concession: ${sig.concession_opportunity?.outcome ?? 'none'}`,
    `- Position drift: ${((sig.position_drift?.drift ?? 0) * 100).toFixed(0)}%`,
  ];
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
      }), '', '_* = low scoring reliability (Beliefs)_'].join('\n');
    },
  },
  '/convergence': {
    description: 'Convergence status',
    handler: (debate) => {
      const signals = debate.convergence_signals;
      if (!signals || signals.length === 0) return 'No convergence signals recorded yet.';
      const bySpeaker = new Map<string, ConvergenceSignal>();
      for (const s of signals) bySpeaker.set(s.speaker, s);
      const lines = ['**Convergence Status:**'];
      for (const [speaker, sig] of bySpeaker) {
        const label = POVER_INFO[speaker as keyof typeof POVER_INFO]?.label ?? speaker;
        lines.push(...formatConvergenceStatusBlock(label, sig));
      }
      return lines.join('\n');
    },
  },
};

function countSourceEdges(net: DebateSession['argument_network'], id: string, type: 'attacks' | 'supports') {
  return net?.edges.filter(e => e.source === id && e.type === type) ?? [];
}

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
  const e1Attacks = countSourceEdges(net, e1.id, 'attacks');
  const e2Attacks = countSourceEdges(net, e2.id, 'attacks');
  const e1Supports = countSourceEdges(net, e1.id, 'supports');
  const e2Supports = countSourceEdges(net, e2.id, 'supports');
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

function pickBackend(model: string): string {
  return model.startsWith('claude') ? 'claude'
    : model.startsWith('groq') ? 'groq'
    : model.startsWith('openai') ? 'openai'
    : 'gemini';
}

async function ensureApiKey(backend: string): Promise<void> {
  const hasKey = await api.hasApiKey(backend);
  if (!hasKey) {
    const names: Record<string, string> = { gemini: 'Gemini', claude: 'Claude', groq: 'Groq', openai: 'OpenAI' };
    throw new Error(`No ${names[backend] ?? backend} API key configured. Open Settings to add one.`);
  }
}

function buildApiMessages(compacted: ChatMessage[], contextNote: string): { role: 'user' | 'model'; content: string }[] {
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
  return apiMessages;
}

function runCleanups(cleanups: (() => void)[]): void {
  for (const cleanup of cleanups) {
    try { cleanup(); } catch (cleanupErr) { getGlobalRecorder()?.record({ type: 'system.error', component: 'diagnostics-chat', level: 'warn', message: 'Effect cleanup failed', error: { name: (cleanupErr as Error).name ?? 'Error', message: String(cleanupErr), stack: (cleanupErr as Error).stack } }); }
  }
}

function historyPrev(promptHistory: React.MutableRefObject<string[]>, historyIdx: React.MutableRefObject<number>): string {
  const newIdx = historyIdx.current === -1
    ? promptHistory.current.length - 1
    : Math.max(0, historyIdx.current - 1);
  historyIdx.current = newIdx;
  return promptHistory.current[newIdx];
}

function historyNext(promptHistory: React.MutableRefObject<string[]>, historyIdx: React.MutableRefObject<number>): string {
  const newIdx = historyIdx.current + 1;
  if (newIdx >= promptHistory.current.length) {
    historyIdx.current = -1;
    return '';
  }
  historyIdx.current = newIdx;
  return promptHistory.current[newIdx];
}

function completeSlashCommand(input: string): string | null {
  const partial = input.toLowerCase();
  const allCmds = [...Object.keys(SLASH_COMMANDS), '/clear', '/compare', '/?'];
  const match = allCmds.find(c => c.startsWith(partial) && c !== partial);
  if (!match) return null;
  return match === '/compare' ? '/compare ' : match;
}

function CollapsedToggleButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      title="Open Debate Chat (Ctrl+Shift+D)"
      style={{
        position: 'fixed', right: 12, bottom: 12, zIndex: 1000,
        width: 44, height: 44, borderRadius: '50%',
        background: 'var(--warning)', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        fontSize: '1.2rem', color: '#000',
      }}
    >
      ?
    </button>
  );
}

function ChatHeader({ model, hasMessages, onClear, onClose }: {
  model: string;
  hasMessages: boolean;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
      borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)',
    }}>
      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--warning)' }}>
        Debate Chat
      </span>
      <span style={{
        fontSize: 'var(--text-2xs)', color: 'var(--text-muted)',
        padding: '1px 6px', borderRadius: 4,
        background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
        flex: 1,
      }}>
        {model}
      </span>
      {hasMessages && (
        <button
          onClick={onClear}
          title="Clear chat (Ctrl+L)"
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem' }}
        >Clear</button>
      )}
      <button
        onClick={onClose}
        title="Close chat (Esc)"
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1 }}
      >&times;</button>
    </div>
  );
}

function ChatEmptyState({ isWeb }: { isWeb: boolean }) {
  return isWeb ? (
    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '24px 12px', textAlign: 'center' }}>
      Debate Chat is available in the desktop app.
      <br /><br />
      <span style={{ fontSize: 'var(--text-2xs)' }}>
        AI-powered chat requires direct API access which is not supported in the web viewer.
      </span>
    </div>
  ) : (
    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '12px 0', textAlign: 'center' }}>
      Ask questions about the debate.
      <br /><br />
      <span style={{ fontSize: 'var(--text-2xs)' }}>
        Try: "Show me the brief for S21"
        <br />"Which debater conceded the most?"
        <br />"What's the strongest attack chain?"
        <br /><br />
        Type / or HELP for commands | /suggest for question ideas
      </span>
    </div>
  );
}

function NavFooter({ navigation, onNavigate }: { navigation: NavigateCommand; onNavigate: (cmd: NavigateCommand) => void }) {
  return (
    <div style={{
      marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border)',
      fontSize: 'var(--text-2xs)', color: 'var(--warning)', cursor: 'pointer',
    }}
      onClick={() => onNavigate(navigation)}
    >
      Navigated to {navigation.entry ?? 'overview'}{navigation.tab ? ` → ${navigation.tab}` : ''}{navigation.overviewTab ? ` → ${navigation.overviewTab}` : ''}
    </div>
  );
}

function SuggestionsBar({ suggestions, onSuggestionClick }: { suggestions: string[]; onSuggestionClick: (s: string) => void }) {
  if (!suggestions.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 0' }}>
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => onSuggestionClick(s)}
          style={{
            padding: '3px 8px', borderRadius: 12,
            fontSize: 'var(--text-2xs)', cursor: 'pointer',
            background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
            color: 'var(--warning)',
            border: '1px solid color-mix(in srgb, var(--warning) 20%, transparent)',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'color-mix(in srgb, var(--warning) 18%, transparent)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'color-mix(in srgb, var(--warning) 8%, transparent)')}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function ChatScrollArea({
  isWeb, messages, generating, streamingText, activity, suggestions, onNavigate, onSuggestionClick, messagesEndRef,
}: {
  isWeb: boolean;
  messages: ChatMessage[];
  generating: boolean;
  streamingText: string;
  activity: string | null;
  suggestions: string[];
  onNavigate: (cmd: NavigateCommand) => void;
  onSuggestionClick: (s: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '8px 12px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {messages.length === 0 && !generating && (
        <ChatEmptyState isWeb={isWeb} />
      )}
      {messages.filter(m => m.role !== 'system').map(msg => {
        const displayContent = msg.isError ? msg.content.replace(/^Error:\s*/i, '') : msg.content;
        return (
          <MessageBubble
            key={msg.id}
            role={msg.role as 'user' | 'assistant'}
            isError={msg.isError}
            footer={msg.navigation ? <NavFooter navigation={msg.navigation} onNavigate={onNavigate} /> : undefined}
          >
            {msg.isError || msg.role !== 'assistant' ? (
              <div style={{ whiteSpace: 'pre-wrap' }}>{displayContent}</div>
            ) : (
              <div className="diag-chat-markdown">
                <Markdown remarkPlugins={[remarkGfm, remarkColorizePov]}>{displayContent}</Markdown>
              </div>
            )}
          </MessageBubble>
        );
      })}
      {generating && streamingText && (
        <StreamingBubble content={streamingText} mdClassName="diag-chat-markdown" />
      )}
      {generating && !streamingText && (
        <ThinkingIndicator activity={activity} />
      )}
      {!generating && (
        <SuggestionsBar suggestions={suggestions} onSuggestionClick={onSuggestionClick} />
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

function ChatInputBar({
  isWeb, debate, generating, input, canSend, contextTokens, inputRef, onInputChange, onKeyDown, onSend,
}: {
  isWeb: boolean;
  debate: DebateSession | null;
  generating: boolean;
  input: string;
  canSend: boolean;
  contextTokens: number;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSend: () => void;
}) {
  return (
    <div style={{
      padding: '8px 12px', borderTop: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
    }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          placeholder={isWeb ? 'Chat available in desktop app' : debate ? 'Ask about the debate... (/ for commands)' : 'Waiting for debate data...'}
          disabled={isWeb || !debate || generating}
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
          onClick={onSend}
          disabled={isWeb || !input.trim() || !debate || generating}
          style={{
            padding: '0 12px', borderRadius: 6,
            background: canSend ? 'var(--warning)' : 'var(--bg-tertiary)',
            color: canSend ? '#000' : 'var(--text-muted)',
            border: 'none', cursor: canSend ? 'pointer' : 'not-allowed',
            fontWeight: 600, fontSize: '0.75rem',
          }}
        >Send</button>
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 4,
      }}>
        <span>~{contextTokens.toLocaleString()} tokens in context</span>
        <span>Enter send | Ctrl+L clear</span>
      </div>
    </div>
  );
}

export function DiagnosticsChatSidebar({ debate, selectedEntry, currentTab, onNavigate, embedded, onClose }: Props) {
  const isWeb = !isElectronMode();
  const [open, setOpen] = useState(!!embedded);
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
        } catch (err) {
          getGlobalRecorder()?.record({
            type: 'system.error',
            component: 'diagnostics-chat-sidebar',
            level: 'warn',
            message: `Failed to load taxonomy file for ${pov}`,
            error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
          });
        }
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
        if (embedded && onClose) onClose(); else setOpen(false);
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
      const backend = pickBackend(model);
      await ensureApiKey(backend);

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

      const apiMessages = buildApiMessages(compacted, contextNote);

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
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'diagnostics-chat-sidebar',
        level: 'error',
        message: 'Chat message generation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setStreamingText('');
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
        isError: true,
      }]);
    } finally {
      runCleanups(cleanups);
      setGenerating(false);
      setActivity(null);
    }
  }, [input, debate, generating, messages, selectedEntry, currentTab, onNavigate, taxonomies, handleSlashCommand]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const textarea = e.target as HTMLTextAreaElement;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim()) {
        promptHistory.current.push(input.trim());
        savePromptHistory(promptHistory.current);
        historyIdx.current = -1;
      }
      void sendMessage();
    } else if (e.key === 'ArrowUp' && promptHistory.current.length > 0) {
      if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        e.preventDefault();
        setInput(historyPrev(promptHistory, historyIdx));
      }
    } else if (e.key === 'ArrowDown' && historyIdx.current >= 0) {
      if (textarea.selectionStart === textarea.value.length) {
        e.preventDefault();
        setInput(historyNext(promptHistory, historyIdx));
      }
    } else if (e.key === 'Tab' && input.startsWith('/')) {
      e.preventDefault();
      const match = completeSlashCommand(input);
      if (match) setInput(match);
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

  const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
  const suggestions = lastAssistantMsg?.suggestions?.length
    ? lastAssistantMsg.suggestions
    : localSuggestions;
  const canSend = !isWeb && !!input.trim() && !!debate && !generating;
  const handleClear = () => { setMessages([]); lastSeenEntryCount.current = 0; };
  const handleHeaderClose = () => { if (embedded && onClose) onClose(); else setOpen(false); };

  const chatContent = (
    <div className="diag-chat-sidebar" style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-primary, var(--bg-secondary))',
    }}>
      {/* Header */}
      <ChatHeader
        model={getModel()}
        hasMessages={messages.length > 0}
        onClear={handleClear}
        onClose={handleHeaderClose}
      />

      {/* Messages */}
      <ChatScrollArea
        isWeb={isWeb}
        messages={messages}
        generating={generating}
        streamingText={streamingText}
        activity={activity}
        suggestions={suggestions}
        onNavigate={onNavigate}
        onSuggestionClick={handleSuggestionClick}
        messagesEndRef={messagesEndRef}
      />

      {/* Input */}
      <ChatInputBar
        isWeb={isWeb}
        debate={debate}
        generating={generating}
        input={input}
        canSend={canSend}
        contextTokens={contextTokens}
        inputRef={inputRef}
        onInputChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onSend={() => void sendMessage()}
      />
    </div>
  );

  if (!open) {
    if (embedded) return null;
    return (
      <CollapsedToggleButton onOpen={() => setOpen(true)} />
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
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--warning)')}
        onMouseLeave={e => { if (!dragging.current) e.currentTarget.style.background = 'var(--border)'; }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {chatContent}
      </div>
    </div>
  );
}
