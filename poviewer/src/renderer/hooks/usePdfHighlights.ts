import { useMemo } from 'react';
import type { Point } from '../types/types';

export interface PageHighlight {
  pageIndex: number;
  pointId: string;
  charStart: number;
  charEnd: number;
}

// Map point char offsets to page indices using page break positions
export function usePdfHighlights(
  points: Point[],
  pageBreaks: number[],
): { highlights: PageHighlight[]; getPageForOffset: (offset: number) => number } {
  const getPageForOffset = useMemo(() => {
    return (offset: number): number => {
      for (let i = 0; i < pageBreaks.length; i++) {
        if (offset < pageBreaks[i]) return i;
      }
      return pageBreaks.length;
    };
  }, [pageBreaks]);

  const highlights = useMemo(() => {
    const result: PageHighlight[] = [];
    for (const point of points) {
      const startPage = getPageForOffset(point.startOffset);
      const endPage = getPageForOffset(point.endOffset);

      for (let page = startPage; page <= endPage; page++) {
        result.push({
          pageIndex: page,
          pointId: point.id,
          charStart: point.startOffset,
          charEnd: point.endOffset,
        });
      }
    }
    return result;
  }, [points, getPageForOffset]);

  return { highlights, getPageForOffset };
}
