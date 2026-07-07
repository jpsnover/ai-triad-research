#!/usr/bin/env node
// One-shot WCAG 2.1 contrast verification for camp colors × themes.

function hexToRgb(hex) {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0,2),16)/255, parseInt(m.slice(2,4),16)/255, parseInt(m.slice(4,6),16)/255];
}

function luminance([r, g, b]) {
  const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(hex1, hex2) {
  const l1 = luminance(hexToRgb(hex1));
  const l2 = luminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const themes = {
  light:   { bg: '#f8fafc', acc: '#b84e13', saf: '#2b5fad', skp: '#7b4fa6' },
  dark:    { bg: '#1f2937', acc: '#e89450', saf: '#7da3d6', skp: '#a888c8' },
  bkc:     { bg: '#281f29', acc: '#cc7e45', saf: '#6d94c2', skp: '#a882be' },
  harvard: { bg: '#F3F0EB', acc: '#a35012', saf: '#275498', skp: '#6d4595' },
};

const MIN = 4.5;
let allPass = true;

console.log('Camp Color Contrast Check (WCAG 2.1 AA, ≥4.5:1 vs --bg-secondary)\n');
console.log('Theme    | Camp | Color   | bg-sec  | Ratio | Pass');
console.log('---------|------|---------|---------|-------|-----');

for (const [theme, { bg, acc, saf, skp }] of Object.entries(themes)) {
  for (const [camp, color] of [['acc', acc], ['saf', saf], ['skp', skp]]) {
    const ratio = contrastRatio(color, bg);
    const pass = ratio >= MIN;
    if (!pass) allPass = false;
    console.log(
      `${theme.padEnd(8)} | ${camp}  | ${color} | ${bg} | ${ratio.toFixed(2).padStart(5)} | ${pass ? 'PASS' : 'FAIL'}`
    );
  }
}

console.log('');
if (allPass) {
  console.log('All checks PASS.');
} else {
  console.log('SOME CHECKS FAILED — adjust colors and re-run.');
  process.exit(1);
}
