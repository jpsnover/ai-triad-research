// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Line-level LCS diff algorithm with ghost-line alignment.
 * Pure function, no framework dependencies — reusable for prompt diffs,
 * taxonomy file diffs, config comparison, etc.
 */

export interface DiffLine {
  type: 'same' | 'added' | 'removed' | 'ghost';
  text: string;
  lineNumber?: number;
}

export interface DiffResult {
  left: DiffLine[];
  right: DiffLine[];
  stats: { added: number; removed: number; same: number; total: number };
}

/**
 * Compute a line-level diff between two strings using LCS (Longest Common Subsequence).
 * Returns aligned left/right arrays with ghost padding so that matching lines
 * appear at the same index in both arrays.
 *
 * Uses Myers' O(nD) algorithm for performance on similar strings.
 */
export function lineDiff(left: string, right: string): DiffResult {
  const leftLines = left.length === 0 ? [] : left.split('\n');
  const rightLines = right.length === 0 ? [] : right.split('\n');

  const lcs = myersLCS(leftLines, rightLines);
  return buildAlignedResult(leftLines, rightLines, lcs);
}

// ── Myers diff → LCS extraction ────────────────────────

interface Snake { x: number; y: number; len: number }

/**
 * Myers' O(nD) diff algorithm — returns the LCS as an array of
 * { leftIdx, rightIdx } pairs indicating matching line positions.
 */
function myersLCS(
  a: string[],
  b: string[],
): { leftIdx: number; rightIdx: number }[] {
  const n = a.length;
  const m = b.length;

  if (n === 0 || m === 0) return [];

  const max = n + m;
  // V stores the furthest-reaching x for each diagonal k.
  // Indexed as v[k + offset] where offset = max.
  const size = 2 * max + 1;
  const v = new Int32Array(size);
  v.fill(-1);
  const offset = max;
  v[1 + offset] = 0;

  // Store trace for backtracking
  const trace: Int32Array[] = [];

  outer:
  for (let d = 0; d <= max; d++) {
    const snap = new Int32Array(size);
    snap.set(v);
    trace.push(snap);

    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        x = v[k + 1 + offset]; // move down
      } else {
        x = v[k - 1 + offset] + 1; // move right
      }
      let y = x - k;

      // Follow diagonal (matching lines)
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v[k + offset] = x;

      if (x >= n && y >= m) break outer;
    }
  }

  // Backtrack to find the edit path, then extract LCS
  const matches: { leftIdx: number; rightIdx: number }[] = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d > 0; d--) {
    const prev = trace[d];
    const k = x - y;

    let prevK: number;
    if (k === -d || (k !== d && prev[k - 1 + offset] < prev[k + 1 + offset])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = prev[prevK + offset];
    const prevY = prevX - prevK;

    // Diagonal moves = matches (LCS members)
    while (x > prevX && y > prevY) {
      x--;
      y--;
      matches.push({ leftIdx: x, rightIdx: y });
    }

    x = prevX;
    y = prevY;
  }

  // Handle d=0 diagonal (initial matching)
  while (x > 0 && y > 0 && a[x - 1] === b[y - 1]) {
    x--;
    y--;
    matches.push({ leftIdx: x, rightIdx: y });
  }

  matches.reverse();
  return matches;
}

// ── Alignment builder ───────────────────────────────────

function buildAlignedResult(
  leftLines: string[],
  rightLines: string[],
  lcs: { leftIdx: number; rightIdx: number }[],
): DiffResult {
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let same = 0;

  let li = 0; // current position in leftLines
  let ri = 0; // current position in rightLines

  for (const match of lcs) {
    // Emit removed/added lines before this match
    const removedLines: DiffLine[] = [];
    const addedLines: DiffLine[] = [];

    while (li < match.leftIdx) {
      removedLines.push({ type: 'removed', text: leftLines[li], lineNumber: li + 1 });
      li++;
      removed++;
    }
    while (ri < match.rightIdx) {
      addedLines.push({ type: 'added', text: rightLines[ri], lineNumber: ri + 1 });
      ri++;
      added++;
    }

    // Interleave with ghost padding so blocks align
    emitWithGhosts(left, right, removedLines, addedLines);

    // Emit the matching line
    left.push({ type: 'same', text: leftLines[li], lineNumber: li + 1 });
    right.push({ type: 'same', text: rightLines[ri], lineNumber: ri + 1 });
    same++;
    li++;
    ri++;
  }

  // Trailing lines after last LCS match
  const trailingRemoved: DiffLine[] = [];
  const trailingAdded: DiffLine[] = [];
  while (li < leftLines.length) {
    trailingRemoved.push({ type: 'removed', text: leftLines[li], lineNumber: li + 1 });
    li++;
    removed++;
  }
  while (ri < rightLines.length) {
    trailingAdded.push({ type: 'added', text: rightLines[ri], lineNumber: ri + 1 });
    ri++;
    added++;
  }
  emitWithGhosts(left, right, trailingRemoved, trailingAdded);

  return {
    left,
    right,
    stats: { added, removed, same, total: added + removed + same },
  };
}

const GHOST: DiffLine = Object.freeze({ type: 'ghost' as const, text: '' });

function emitWithGhosts(
  left: DiffLine[],
  right: DiffLine[],
  removedLines: DiffLine[],
  addedLines: DiffLine[],
): void {
  // Pair up removed/added lines side by side, pad the shorter side with ghosts
  const maxLen = Math.max(removedLines.length, addedLines.length);
  for (let i = 0; i < maxLen; i++) {
    left.push(i < removedLines.length ? removedLines[i] : GHOST);
    right.push(i < addedLines.length ? addedLines[i] : GHOST);
  }
}
