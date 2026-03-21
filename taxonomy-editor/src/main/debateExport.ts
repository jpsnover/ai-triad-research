// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Converts a DebateSession object into TEXT, Markdown, or PDF.
 * JSON is handled directly in the IPC handler (no conversion needed).
 */

import { BrowserWindow } from 'electron';

// ── Types (mirrored from renderer — main process can't import renderer types) ──

interface TaxonomyRef {
  node_id: string;
  relevance: string;
}

interface TranscriptEntry {
  id: string;
  timestamp: string;
  type: string;
  speaker: string;
  content: string;
  taxonomy_refs: TaxonomyRef[];
  metadata?: Record<string, unknown>;
  addressing?: string;
}

interface DebateSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  phase: string;
  topic: { original: string; refined?: string | null; final?: string };
  active_povers: string[];
  user_is_pover: boolean;
  transcript: TranscriptEntry[];
  synthesis?: {
    areas_of_agreement?: unknown[];
    areas_of_disagreement?: unknown[];
    unresolved_questions?: string[];
    summary?: string;
  };
}

// ── Speaker labels ──

const SPEAKER_LABELS: Record<string, string> = {
  prometheus: 'Prometheus (Accelerationist)',
  sentinel: 'Sentinel (Safetyist)',
  cassandra: 'Cassandra (Skeptic)',
  user: 'User',
  system: 'System',
};

function speakerName(speaker: string): string {
  return SPEAKER_LABELS[speaker] || speaker;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function entryTypeLabel(type: string): string {
  const map: Record<string, string> = {
    opening: 'Opening Statement',
    statement: 'Statement',
    question: 'Question',
    answer: 'Answer',
    clarification: 'Clarification',
    synthesis: 'Synthesis',
    probing: 'Probing Questions',
    'fact-check': 'Fact Check',
    system: 'System',
  };
  return map[type] || type;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Plain Text
// ═══════════════════════════════════════════════════════════════════════════════

export function debateToText(session: DebateSession): string {
  const lines: string[] = [];
  const sep = '='.repeat(72);
  const thinSep = '-'.repeat(72);

  lines.push(sep);
  lines.push(`  ${session.title}`);
  lines.push(sep);
  lines.push('');
  lines.push(`Topic: ${session.topic.final || session.topic.refined || session.topic.original}`);
  lines.push(`Date: ${formatTimestamp(session.created_at)}`);
  lines.push(`Phase: ${session.phase}`);
  lines.push(`Debaters: ${session.active_povers.map(speakerName).join(', ')}`);
  lines.push('');
  lines.push(thinSep);
  lines.push('  TRANSCRIPT');
  lines.push(thinSep);

  for (const entry of session.transcript) {
    lines.push('');
    lines.push(`[${speakerName(entry.speaker)} — ${entryTypeLabel(entry.type)}]`);
    lines.push('');
    lines.push(entry.content);

    if (entry.taxonomy_refs && entry.taxonomy_refs.length > 0) {
      lines.push('');
      lines.push('  Taxonomy refs:');
      for (const ref of entry.taxonomy_refs) {
        const rel = ref.relevance ? ` — ${ref.relevance}` : '';
        lines.push(`    [${ref.node_id}]${rel}`);
      }
    }
  }

  if (session.synthesis) {
    lines.push('');
    lines.push(thinSep);
    lines.push('  SYNTHESIS');
    lines.push(thinSep);

    if (session.synthesis.summary) {
      lines.push('');
      lines.push(session.synthesis.summary);
    }

    if (session.synthesis.areas_of_agreement && session.synthesis.areas_of_agreement.length > 0) {
      lines.push('');
      lines.push('Areas of Agreement:');
      for (const item of session.synthesis.areas_of_agreement) {
        lines.push(`  - ${typeof item === 'string' ? item : JSON.stringify(item)}`);
      }
    }

    if (session.synthesis.areas_of_disagreement && session.synthesis.areas_of_disagreement.length > 0) {
      lines.push('');
      lines.push('Areas of Disagreement:');
      for (const item of session.synthesis.areas_of_disagreement) {
        lines.push(`  - ${typeof item === 'string' ? item : JSON.stringify(item)}`);
      }
    }

    if (session.synthesis.unresolved_questions && session.synthesis.unresolved_questions.length > 0) {
      lines.push('');
      lines.push('Unresolved Questions:');
      for (const q of session.synthesis.unresolved_questions) {
        lines.push(`  - ${q}`);
      }
    }
  }

  lines.push('');
  lines.push(sep);
  lines.push('');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Markdown
// ═══════════════════════════════════════════════════════════════════════════════

export function debateToMarkdown(session: DebateSession): string {
  const lines: string[] = [];

  lines.push(`# ${session.title}`);
  lines.push('');
  lines.push(`**Topic:** ${session.topic.final || session.topic.refined || session.topic.original}`);
  lines.push(`**Date:** ${formatTimestamp(session.created_at)}`);
  lines.push(`**Phase:** ${session.phase}`);
  lines.push(`**Debaters:** ${session.active_povers.map(speakerName).join(', ')}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Transcript');

  let currentType = '';
  for (const entry of session.transcript) {
    // Group by entry type with section headers
    if (entry.type !== currentType && entry.type !== 'system') {
      currentType = entry.type;
      lines.push('');
      lines.push(`### ${entryTypeLabel(entry.type)}`);
    }

    lines.push('');
    const label = speakerName(entry.speaker);
    if (entry.speaker === 'system') {
      lines.push(`> *${entry.content}*`);
    } else {
      lines.push(`**${label}:**`);
      lines.push('');
      lines.push(entry.content);
    }

    if (entry.taxonomy_refs && entry.taxonomy_refs.length > 0) {
      lines.push('');
      const refs = entry.taxonomy_refs.map(r => {
        const rel = r.relevance ? `: ${r.relevance}` : '';
        return `\`${r.node_id}\`${rel}`;
      });
      lines.push(`> **Taxonomy refs:** ${refs.join(' | ')}`);
    }
  }

  if (session.synthesis) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Synthesis');

    if (session.synthesis.summary) {
      lines.push('');
      lines.push(session.synthesis.summary);
    }

    if (session.synthesis.areas_of_agreement && session.synthesis.areas_of_agreement.length > 0) {
      lines.push('');
      lines.push('### Areas of Agreement');
      lines.push('');
      for (const item of session.synthesis.areas_of_agreement) {
        lines.push(`- ${typeof item === 'string' ? item : JSON.stringify(item)}`);
      }
    }

    if (session.synthesis.areas_of_disagreement && session.synthesis.areas_of_disagreement.length > 0) {
      lines.push('');
      lines.push('### Areas of Disagreement');
      lines.push('');
      for (const item of session.synthesis.areas_of_disagreement) {
        lines.push(`- ${typeof item === 'string' ? item : JSON.stringify(item)}`);
      }
    }

    if (session.synthesis.unresolved_questions && session.synthesis.unresolved_questions.length > 0) {
      lines.push('');
      lines.push('### Unresolved Questions');
      lines.push('');
      for (const q of session.synthesis.unresolved_questions) {
        lines.push(`- ${q}`);
      }
    }
  }

  lines.push('');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDF (via Electron's printToPDF)
// ═══════════════════════════════════════════════════════════════════════════════

function markdownToHtml(md: string): string {
  // Lightweight markdown-to-HTML for PDF rendering.
  // Handles: headers, bold, italic, code, blockquotes, lists, horizontal rules, paragraphs.
  let html = md
    // Escape HTML entities in content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Restore markdown syntax that uses > and *
  // Blockquotes: lines starting with &gt;
  html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  // Merge adjacent blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Paragraphs: wrap non-tag lines separated by blank lines
  html = html.replace(/\n{2,}/g, '\n\n');
  const blocks = html.split('\n\n');
  html = blocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (/^<(?:h[1-6]|ul|ol|li|blockquote|hr|table|div|p)/.test(trimmed)) return trimmed;
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  return html;
}

export async function debateToPdf(session: DebateSession): Promise<Buffer> {
  const md = debateToMarkdown(session);
  const bodyHtml = markdownToHtml(md);

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { margin: 1in; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #222;
    max-width: 100%;
  }
  h1 { font-size: 18pt; margin-top: 0; border-bottom: 2px solid #333; padding-bottom: 6px; }
  h2 { font-size: 14pt; margin-top: 24px; color: #444; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  h3 { font-size: 12pt; margin-top: 18px; color: #555; }
  p { margin: 8px 0; }
  strong { color: #111; }
  code {
    background: #f0f0f0; padding: 1px 5px; border-radius: 3px;
    font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 0.9em;
  }
  blockquote {
    margin: 8px 0; padding: 6px 12px; border-left: 3px solid #ccc;
    background: #f9f9f9; color: #555; font-size: 0.95em;
  }
  hr { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
  ul { padding-left: 20px; }
  li { margin: 4px 0; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

  const pdfWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { offscreen: true },
  });

  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fullHtml)}`);
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
    });
    return Buffer.from(pdfBuffer);
  } finally {
    pdfWindow.destroy();
  }
}
