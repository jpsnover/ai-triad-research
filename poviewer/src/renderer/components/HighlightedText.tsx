import { useMemo, type ReactNode } from 'react';
import { useAppStore } from '../store/useAppStore';
import { buildSearchRegex } from '../utils/searchRegex';
import type { Source, Point, PovCamp } from '../types/types';
import PointBadge from './PointBadge';

interface Props {
  source: Source;
}

interface Segment {
  text: string;
  point: Point | null;
}

function getHighlightClass(point: Point): string {
  if (point.mappings.length === 0) return 'highlight-unmapped';
  if (point.mappings.length === 1) {
    const camp = point.mappings[0].camp;
    const classMap: Record<PovCamp, string> = {
      accelerationist: 'highlight-acc',
      safetyist: 'highlight-saf',
      skeptic: 'highlight-skp',
      'cross-cutting': 'highlight-cc',
    };
    return classMap[camp];
  }
  return 'highlight-multi';
}

function highlightSearchMatches(text: string, regex: RegExp | null, keyPrefix: string): ReactNode {
  if (!regex || !text) return text;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  // Reset lastIndex for global regex
  regex.lastIndex = 0;
  let match = regex.exec(text);
  let idx = 0;
  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <mark key={`${keyPrefix}-m${idx}`} className="search-match">{match[0]}</mark>
    );
    lastIndex = match.index + match[0].length;
    // Prevent infinite loop on zero-length matches
    if (match[0].length === 0) {
      regex.lastIndex++;
    }
    match = regex.exec(text);
    idx++;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

export default function HighlightedText({ source }: Props) {
  const povFilters = useAppStore(s => s.povFilters);
  const selectedPointId = useAppStore(s => s.selectedPointId);
  const selectPoint = useAppStore(s => s.selectPoint);
  const searchQuery = useAppStore(s => s.searchQuery);
  const searchMode = useAppStore(s => s.searchMode);
  const searchCaseSensitive = useAppStore(s => s.searchCaseSensitive);

  const searchRegex = useMemo(
    () => buildSearchRegex(searchQuery, searchMode, searchCaseSensitive),
    [searchQuery, searchMode, searchCaseSensitive],
  );

  const segments = useMemo(() => {
    const text = source.snapshotText;
    if (!text) return [{ text: '', point: null }];

    // Filter points by active POV filters
    const visiblePoints = source.points.filter(p => {
      if (p.mappings.length === 0) return true;
      return p.mappings.some(m => povFilters[m.camp]);
    });

    // Sort by startOffset
    const sorted = [...visiblePoints].sort((a, b) => a.startOffset - b.startOffset);

    const result: Segment[] = [];
    let cursor = 0;

    for (const point of sorted) {
      if (point.startOffset > cursor) {
        result.push({ text: text.slice(cursor, point.startOffset), point: null });
      }
      // Avoid overlapping ranges
      const start = Math.max(point.startOffset, cursor);
      if (start < point.endOffset) {
        result.push({ text: text.slice(start, point.endOffset), point });
        cursor = point.endOffset;
      }
    }

    if (cursor < text.length) {
      result.push({ text: text.slice(cursor), point: null });
    }

    return result;
  }, [source, povFilters]);

  return (
    <div className="source-text">
      {segments.map((seg, i) => {
        if (!seg.point) {
          return <span key={i}>{highlightSearchMatches(seg.text, searchRegex, `s${i}`)}</span>;
        }

        const isSelected = seg.point.id === selectedPointId;
        const highlightClass = getHighlightClass(seg.point);

        return (
          <span
            key={i}
            className={`highlight-span ${highlightClass}${isSelected ? ' selected' : ''}`}
            onClick={() => selectPoint(seg.point!.id)}
            title={`Point ${seg.point.id}`}
          >
            {highlightSearchMatches(seg.text, searchRegex, `p${i}`)}
            <PointBadge point={seg.point} />
          </span>
        );
      })}
    </div>
  );
}
