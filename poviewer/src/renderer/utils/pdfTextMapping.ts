/**
 * Maps global char offsets (from snapshot text) to PDF page coordinates.
 *
 * The snapshot text was built by pdfExtractor.ts using:
 *   - Items within a page joined with ' '
 *   - Pages joined with '\n\n'
 *
 * We rebuild that same concatenation from getTextContent() results,
 * recording each text item's global offset range and PDF user-space position.
 */

export interface TextItem {
  str: string;
  transform: number[]; // [scaleX, skewX, skewY, scaleY, translateX, translateY]
  width: number;
  height: number;
}

export interface IndexedTextItem {
  pageIndex: number;
  globalStart: number;
  globalEnd: number;
  x: number;      // PDF user-space X
  y: number;      // PDF user-space Y
  width: number;
  height: number;
}

export interface TextIndex {
  items: IndexedTextItem[];
  totalLength: number;
}

/**
 * Build a text index from all pages' getTextContent() results.
 * Mirrors the concatenation logic from pdfExtractor.ts exactly.
 */
export function buildTextIndex(
  pagesTextContent: Array<{ items: TextItem[] }>,
): TextIndex {
  const indexed: IndexedTextItem[] = [];
  let cursor = 0;

  for (let pageIdx = 0; pageIdx < pagesTextContent.length; pageIdx++) {
    if (pageIdx > 0) {
      cursor += 2; // '\n\n' between pages
    }

    const pageItems = pagesTextContent[pageIdx].items.filter(
      (item) => 'str' in item && typeof item.str === 'string',
    );

    for (let i = 0; i < pageItems.length; i++) {
      if (i > 0) {
        cursor += 1; // ' ' between items within a page
      }

      const item = pageItems[i];
      const str = item.str;
      const globalStart = cursor;
      const globalEnd = cursor + str.length;

      indexed.push({
        pageIndex: pageIdx,
        globalStart,
        globalEnd,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
      });

      cursor = globalEnd;
    }
  }

  return { items: indexed, totalLength: cursor };
}

export interface CanvasPosition {
  pageIndex: number;
  x: number;
  y: number;
}

/**
 * Find the PDF user-space position for a given global char offset.
 * Returns the position of the text item containing the offset.
 */
export function findPositionForOffset(
  textIndex: TextIndex,
  charOffset: number,
): CanvasPosition | null {
  if (textIndex.items.length === 0) return null;

  // Binary search for the text item containing this offset
  let lo = 0;
  let hi = textIndex.items.length - 1;
  let best = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const item = textIndex.items[mid];

    if (charOffset < item.globalStart) {
      hi = mid - 1;
    } else if (charOffset >= item.globalEnd) {
      lo = mid + 1;
    } else {
      best = mid;
      break;
    }
  }

  // If exact match not found, use closest item before the offset
  if (best === -1) {
    best = Math.min(lo, textIndex.items.length - 1);
  }

  const item = textIndex.items[best];
  return {
    pageIndex: item.pageIndex,
    x: item.x,
    y: item.y,
  };
}

/**
 * Get all points that belong to a specific page.
 * Returns positions transformed to canvas coordinates using the viewport.
 */
export function getPointsForPage(
  textIndex: TextIndex,
  pageIndex: number,
  points: Array<{ id: string; startOffset: number }>,
  viewport: { convertToViewportPoint: (x: number, y: number) => [number, number] },
): Array<{ id: string; canvasX: number; canvasY: number }> {
  const result: Array<{ id: string; canvasX: number; canvasY: number }> = [];

  for (const point of points) {
    const pos = findPositionForOffset(textIndex, point.startOffset);
    if (!pos || pos.pageIndex !== pageIndex) continue;

    const [canvasX, canvasY] = viewport.convertToViewportPoint(pos.x, pos.y);
    result.push({ id: point.id, canvasX, canvasY });
  }

  return result;
}
