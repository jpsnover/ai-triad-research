// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { ChatEntry, ChatMode } from '../types/chat';

type Pov = 'accelerationist' | 'safetyist' | 'skeptic';

export interface ChatExportOptions {
  title: string;
  mode: ChatMode;
  pov: Pov;
}

const POV_LABELS: Record<Pov, string> = {
  accelerationist: 'Accelerationist',
  safetyist: 'Safetyist',
  skeptic: 'Skeptic',
};

const MODE_LABELS: Record<ChatMode, string> = {
  brainstorm: 'Brainstorm',
  inform: 'Inform',
  decide: 'Decide',
};

const CAMP_COLORS: Record<string, string> = {
  accelerationist: '#2563eb',
  safetyist: '#dc2626',
  skeptic: '#7c3aed',
  system: '#6b7280',
  user: '#059669',
};

function slugify(text: string, maxLen = 60): string {
  return (text || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, maxLen) || 'untitled';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch { /* telemetry — silent by design: invalid date strings fall back to raw ISO */
    return iso;
  }
}

function speakerLabel(speaker: string): string {
  return POV_LABELS[speaker as Pov] ?? speaker.charAt(0).toUpperCase() + speaker.slice(1);
}

function headerBlock(options: ChatExportOptions, entryCount: number, sep: string): string[] {
  const lines: string[] = [];
  lines.push(sep);
  lines.push(options.title || 'Untitled Chat');
  lines.push(`Perspective: ${POV_LABELS[options.pov] ?? options.pov}  |  Mode: ${MODE_LABELS[options.mode] ?? options.mode}`);
  lines.push(`Exported: ${new Date().toLocaleDateString()}  |  ${entryCount} ${entryCount === 1 ? 'message' : 'messages'}`);
  lines.push(sep);
  return lines;
}

export function chatToMarkdown(entries: ChatEntry[], options: ChatExportOptions): string {
  const lines: string[] = [];

  lines.push(`# ${options.title || 'Untitled Chat'}`);
  lines.push('');
  lines.push(`**Perspective:** ${POV_LABELS[options.pov] ?? options.pov}  ·  **Mode:** ${MODE_LABELS[options.mode] ?? options.mode}`);
  lines.push(`**Exported:** ${new Date().toLocaleDateString()}  ·  ${entries.length} ${entries.length === 1 ? 'message' : 'messages'}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const entry of entries) {
    const label = speakerLabel(entry.speaker);
    const time = formatDate(entry.timestamp);
    lines.push(`### ${label} — ${time}`);
    lines.push('');
    lines.push(entry.content);

    if (entry.taxonomy_refs.length > 0) {
      lines.push('');
      const refs = entry.taxonomy_refs
        .map(r => `${r.node_id}${r.label ? ` "${r.label}"` : ''}`)
        .join(', ');
      lines.push(`> refs: ${refs}`);
    }

    lines.push('');
  }

  lines.push('---');
  lines.push(`*Exported from AI Triad Taxonomy Editor · ${new Date().toLocaleDateString()}*`);
  lines.push('');

  return lines.join('\n');
}

export function chatToText(entries: ChatEntry[], options: ChatExportOptions): string {
  const sep = '='.repeat(72);
  const lines = headerBlock(options, entries.length, sep);
  lines.push('');

  for (const entry of entries) {
    const label = speakerLabel(entry.speaker).toUpperCase();
    const time = formatDate(entry.timestamp);
    lines.push(`${label} (${time}):`);
    lines.push(entry.content);
    lines.push('');
  }

  lines.push(sep);
  lines.push(`Exported from AI Triad Taxonomy Editor · ${new Date().toLocaleDateString()}`);
  lines.push('');

  return lines.join('\n');
}

const PRINT_STYLES = `
  @page { margin: 1in; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #222;
    max-width: 100%;
  }
  h1 { font-size: 18pt; margin-top: 0; border-bottom: 2px solid #333; padding-bottom: 6px; }
  .chat-export-meta { color: #666; font-size: 10pt; margin-bottom: 16px; }
  .chat-entry { break-inside: avoid; margin-bottom: 16px; }
  .chat-entry-speaker {
    font-size: 12pt;
    font-weight: bold;
    margin-top: 18px;
    margin-bottom: 4px;
  }
  .chat-entry-time { font-weight: normal; color: #888; font-size: 10pt; margin-left: 8px; }
  .chat-entry-content { margin: 4px 0; white-space: pre-wrap; }
  .chat-entry-refs { font-size: 9pt; color: #888; margin-top: 4px; }
  .chat-entry-system .chat-entry-speaker { color: #6b7280; }
  .chat-entry-system .chat-entry-content { color: #6b7280; font-style: italic; }
  .chat-export-footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #ddd; font-size: 9pt; color: #888; }
`;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function chatToPrintHtml(entries: ChatEntry[], options: ChatExportOptions): string {
  const entriesHtml = entries.map(entry => {
    const label = speakerLabel(entry.speaker);
    const time = formatDate(entry.timestamp);
    const color = CAMP_COLORS[entry.speaker] ?? '#222';
    const isSystem = entry.speaker === 'system';

    let refsHtml = '';
    if (entry.taxonomy_refs.length > 0) {
      const refText = entry.taxonomy_refs
        .map(r => `${escapeHtml(r.node_id)}${r.label ? ` "${escapeHtml(r.label)}"` : ''}`)
        .join(', ');
      refsHtml = `<div class="chat-entry-refs">refs: ${refText}</div>`;
    }

    return `<div class="chat-entry${isSystem ? ' chat-entry-system' : ''}">
  <div class="chat-entry-speaker" style="color: ${color}">
    ${escapeHtml(label)}<span class="chat-entry-time">${escapeHtml(time)}</span>
  </div>
  <div class="chat-entry-content">${escapeHtml(entry.content)}</div>
  ${refsHtml}
</div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(options.title || 'Chat Export')}</title>
<style>${PRINT_STYLES}</style>
</head>
<body>
<h1>${escapeHtml(options.title || 'Untitled Chat')}</h1>
<div class="chat-export-meta">
  Perspective: ${escapeHtml(POV_LABELS[options.pov] ?? options.pov)} · Mode: ${escapeHtml(MODE_LABELS[options.mode] ?? options.mode)}<br>
  Exported: ${new Date().toLocaleDateString()} · ${entries.length} ${entries.length === 1 ? 'message' : 'messages'}
</div>
${entriesHtml}
<div class="chat-export-footer">
  Exported from AI Triad Taxonomy Editor · ${new Date().toLocaleDateString()}
</div>
</body>
</html>`;
}

export function chatExportFilename(title: string, ext: string): string {
  const slug = slugify(title);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `chat-${slug}-${date}.${ext}`;
}
