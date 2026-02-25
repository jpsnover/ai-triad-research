import { useEffect, useRef, useMemo } from 'react';
import { useStore } from '../store/useStore';

export default function DocumentPane() {
  const selectedKeyPoint = useStore(s => s.selectedKeyPoint);
  const summaries = useStore(s => s.summaries);
  const snapshots = useStore(s => s.snapshots);
  const sources = useStore(s => s.sources);
  const contentRef = useRef<HTMLDivElement>(null);

  const keyPointData = useMemo(() => {
    if (!selectedKeyPoint) return null;
    const summary = summaries[selectedKeyPoint.docId];
    if (!summary?.pov_summaries?.[selectedKeyPoint.pov]) return null;
    const kp = summary.pov_summaries[selectedKeyPoint.pov].key_points[selectedKeyPoint.index];
    return kp || null;
  }, [selectedKeyPoint, summaries]);

  const snapshotText = selectedKeyPoint ? snapshots[selectedKeyPoint.docId] || '' : '';
  const source = selectedKeyPoint ? sources.find(s => s.id === selectedKeyPoint.docId) : null;

  // Find and highlight the verbatim quote in the snapshot
  const renderedContent = useMemo(() => {
    if (!snapshotText) return null;
    if (!keyPointData?.verbatim) return { before: snapshotText, match: '', after: '' };

    const verbatim = keyPointData.verbatim;
    // Try exact match first
    let matchIdx = snapshotText.indexOf(verbatim);

    // Try with normalized whitespace if exact match fails
    if (matchIdx === -1) {
      const normalizedSnapshot = snapshotText.replace(/\s+/g, ' ');
      const normalizedVerbatim = verbatim.replace(/\s+/g, ' ');
      const normalizedIdx = normalizedSnapshot.indexOf(normalizedVerbatim);

      if (normalizedIdx !== -1) {
        // Map back to original positions by counting characters
        let origPos = 0;
        let normPos = 0;
        while (normPos < normalizedIdx && origPos < snapshotText.length) {
          if (/\s/.test(snapshotText[origPos])) {
            // Skip extra whitespace in original
            origPos++;
            if (origPos < snapshotText.length && /\s/.test(snapshotText[origPos])) {
              while (origPos < snapshotText.length && /\s/.test(snapshotText[origPos])) {
                origPos++;
              }
              origPos--; // back up one — the outer loop will increment
            }
          }
          origPos++;
          normPos++;
        }
        // Find the end
        let endNormPos = normalizedIdx + normalizedVerbatim.length;
        let endOrigPos = origPos;
        while (normPos < endNormPos && endOrigPos < snapshotText.length) {
          if (/\s/.test(snapshotText[endOrigPos])) {
            endOrigPos++;
            if (endOrigPos < snapshotText.length && /\s/.test(snapshotText[endOrigPos])) {
              while (endOrigPos < snapshotText.length && /\s/.test(snapshotText[endOrigPos])) {
                endOrigPos++;
              }
              endOrigPos--;
            }
          }
          endOrigPos++;
          normPos++;
        }
        return {
          before: snapshotText.slice(0, origPos),
          match: snapshotText.slice(origPos, endOrigPos),
          after: snapshotText.slice(endOrigPos),
        };
      }

      // Try substring match (first 80 chars of verbatim)
      const snippet = verbatim.slice(0, 80);
      matchIdx = snapshotText.indexOf(snippet);
      if (matchIdx !== -1) {
        return {
          before: snapshotText.slice(0, matchIdx),
          match: snapshotText.slice(matchIdx, matchIdx + verbatim.length),
          after: snapshotText.slice(matchIdx + verbatim.length),
        };
      }

      return { before: snapshotText, match: '', after: '' };
    }

    return {
      before: snapshotText.slice(0, matchIdx),
      match: snapshotText.slice(matchIdx, matchIdx + verbatim.length),
      after: snapshotText.slice(matchIdx + verbatim.length),
    };
  }, [snapshotText, keyPointData]);

  // Scroll to highlighted match
  useEffect(() => {
    if (!renderedContent?.match) return;
    const timer = setTimeout(() => {
      const mark = contentRef.current?.querySelector('.highlight-match');
      if (mark) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [renderedContent, selectedKeyPoint]);

  if (!selectedKeyPoint) {
    return (
      <>
        <div className="pane-header">
          <h2>Document</h2>
        </div>
        <div className="pane-body">
          <div className="empty-state">
            Click a key point to view its source document
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="pane-header">
        <h2>{source?.title || selectedKeyPoint.docId}</h2>
      </div>

      {keyPointData && (
        <div className="excerpt-banner">
          <div className="excerpt-banner-label">Excerpt Context</div>
          <div className="excerpt-banner-context">{keyPointData.excerpt_context}</div>
          {keyPointData.verbatim && !renderedContent?.match && (
            <div className="excerpt-banner-quote">
              &ldquo;{keyPointData.verbatim}&rdquo;
            </div>
          )}
        </div>
      )}

      <div className="pane-body document-body" ref={contentRef}>
        {!snapshotText && (
          <div className="empty-state">No snapshot available for this source</div>
        )}

        {renderedContent && (
          <pre className="snapshot-text">
            {renderedContent.before}
            {renderedContent.match && (
              <mark className="highlight-match">{renderedContent.match}</mark>
            )}
            {renderedContent.after}
          </pre>
        )}
      </div>
    </>
  );
}
