// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T4 Render — SlideModel[] → a fully self-contained HTML document for Electron
// webContents.printToPDF (PDF is Electron-only; lib only GENERATES the HTML).
// TL condition (e/113#2): the HTML MUST be self-contained — inline CSS, embedded
// logo as a data URI, NO external network references — so printToPDF is
// deterministic and works offline. All dynamic text is HTML-escaped.

import type { SlideModel, SlideBlock } from './slideModel.js';
import type { DeckTheme } from './deckTheme.js';
import { campColor } from './deckTheme.js';

export function renderHtml(slides: SlideModel[], theme: DeckTheme): string {
  const style = buildStyle(theme);
  const body = slides.map(s => renderSlide(s, theme)).join('\n');
  const logo = theme.logoDataUri
    ? `<img class="logo" alt="" src="${escapeAttr(theme.logoDataUri)}"/>`
    : '';
  return [
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    `<title>Debate Brief</title>`,
    `<style>${style}</style>`,
    '</head><body>',
    logo,
    body,
    '</body></html>',
  ].join('\n');
}

function buildStyle(theme: DeckTheme): string {
  // No @import, no url() to remote hosts, no <link> — everything inline.
  return [
    `*{box-sizing:border-box;margin:0;padding:0}`,
    `body{font-family:${cssFont(theme.fonts.body)};color:#${theme.colors.text};background:#${theme.colors.background}}`,
    `.slide{page-break-after:always;padding:48px 56px;min-height:100vh;position:relative}`,
    `.slide h2{font-family:${cssFont(theme.fonts.heading)};font-size:32px;margin-bottom:20px;color:#${theme.colors.text}}`,
    `.text{font-size:20px;margin:10px 0}`,
    `.note{font-size:14px;font-style:italic;color:#${theme.colors.subtle};margin:8px 0}`,
    `ul{margin:10px 0 10px 26px}li{font-size:18px;margin:6px 0}`,
    `.cards{display:flex;gap:16px;margin-top:12px}`,
    `.card{flex:1;border:2px solid #ccc;border-radius:8px;padding:12px}`,
    `.card h3{font-size:18px;margin-bottom:8px}`,
    `.badges{font-size:16px;color:#${theme.colors.accent};margin:10px 0}`,
    `.fork{margin:12px 0}.fork .prompt{font-weight:bold;font-size:18px}`,
    `table{border-collapse:collapse;margin:12px 0;width:100%}`,
    `th,td{border:1px solid #${theme.colors.subtle};padding:6px 10px;font-size:14px;text-align:left}`,
    `th{background:#${theme.colors.accent};color:#fff}`,
    `.watermark{position:absolute;top:40%;left:0;right:0;text-align:center;font-size:72px;font-weight:bold;color:#${theme.colors.verdict.Disputed};opacity:0.15;transform:rotate(-20deg)}`,
    `.logo{position:fixed;top:12px;right:12px;height:36px}`,
  ].join('');
}

function renderSlide(model: SlideModel, theme: DeckTheme): string {
  const blocks = model.blocks.map(b => renderBlock(b, theme)).join('\n');
  const watermark = model.watermark ? `<div class="watermark">${escapeHtml(model.watermark)}</div>` : '';
  return `<section class="slide">${watermark}<h2>${escapeHtml(model.title)}</h2>${blocks}</section>`;
}

function renderBlock(block: SlideBlock, theme: DeckTheme): string {
  switch (block.type) {
    case 'text':
      return `<p class="text">${escapeHtml(block.text)}</p>`;
    case 'note':
      return `<p class="note">${escapeHtml(block.text)}</p>`;
    case 'bullets':
      return `<ul>${block.items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    case 'card_row':
      return `<div class="cards">${block.cards.map(c =>
        `<div class="card" style="border-color:#${campColor(c.camp)}">` +
        `<h3 style="color:#${campColor(c.camp)}">${escapeHtml(c.title)}</h3>` +
        `<ul>${c.lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul></div>`).join('')}</div>`;
    case 'fork':
      return `<div class="fork"><div class="prompt">${escapeHtml(block.prompt)}</div>` +
        `<ul><li>If yes → ${escapeHtml(block.ifYes)}</li><li>If no → ${escapeHtml(block.ifNo)}</li></ul></div>`;
    case 'badge_row':
      return `<div class="badges">${block.badges.map(b => `${escapeHtml(b.label)}: ${escapeHtml(b.value)}`).join(' &nbsp; ')}</div>`;
    case 'table':
      return `<table><thead><tr>${block.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>` +
        `<tbody>${block.rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  void theme;
}

/** Quote a font-family name for CSS, with a generic fallback (no remote fonts). */
function cssFont(name: string): string {
  const generic = /serif|georgia|times/i.test(name) ? 'serif' : 'sans-serif';
  return `'${name.replace(/'/g, '')}', ${generic}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}
