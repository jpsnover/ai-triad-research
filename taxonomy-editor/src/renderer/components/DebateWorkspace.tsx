// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useRef, useEffect } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { POVER_INFO } from '../types/debate';
import type { PoverId, TranscriptEntry } from '../types/debate';

const PHASE_TITLES: Record<string, string> = {
  setup: 'Setting up...',
  clarification: 'Topic Refinement',
  opening: 'Opening Statements',
  debate: 'Debate',
  closed: 'Debate Closed',
};

function speakerLabel(speaker: PoverId | 'system'): string {
  if (speaker === 'system') return 'System';
  if (speaker === 'user') return 'You';
  const info = POVER_INFO[speaker as Exclude<PoverId, 'user'>];
  return info ? info.label : speaker;
}

function speakerColor(speaker: PoverId | 'system'): string | undefined {
  if (speaker === 'system' || speaker === 'user') return undefined;
  const info = POVER_INFO[speaker as Exclude<PoverId, 'user'>];
  return info?.color;
}

function StatementCard({ entry }: { entry: TranscriptEntry }) {
  const color = speakerColor(entry.speaker);
  return (
    <div className={`debate-statement debate-speaker-${entry.speaker}`}>
      <div className="debate-statement-header">
        <span className="debate-statement-speaker" style={color ? { color } : undefined}>
          {speakerLabel(entry.speaker)}
        </span>
        <span className="debate-statement-type">{entry.type}</span>
      </div>
      <div className="debate-statement-content">{entry.content}</div>
      {entry.taxonomy_refs.length > 0 && (
        <div className="debate-taxonomy-refs">
          {entry.taxonomy_refs.map((ref) => (
            <span key={ref.node_id} className="debate-taxonomy-pill" title={ref.relevance}>
              {ref.node_id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function DebateWorkspace() {
  const { activeDebate, debateLoading, debateError, debateGenerating } = useDebateStore();
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeDebate?.transcript.length]);

  if (debateLoading) {
    return <div className="debate-workspace-loading">Loading debate...</div>;
  }

  if (!activeDebate) {
    return <div className="debate-workspace-loading">No debate selected</div>;
  }

  return (
    <div className="debate-workspace">
      {/* Topic bar */}
      <div className="debate-topic-bar">
        <span className="debate-phase-indicator">
          {PHASE_TITLES[activeDebate.phase] || activeDebate.phase}
        </span>
        <span className="debate-topic-text">{activeDebate.topic.final}</span>
      </div>

      {/* Transcript */}
      <div className="debate-transcript">
        {activeDebate.transcript.length === 0 && (
          <div className="debate-transcript-empty">
            The debate is ready to begin. Clarification questions will appear here.
          </div>
        )}
        {activeDebate.transcript.map((entry) => (
          <StatementCard key={entry.id} entry={entry} />
        ))}
        {debateGenerating && (
          <div className="debate-statement debate-generating">
            <div className="debate-statement-header">
              <span className="debate-statement-speaker" style={{ color: speakerColor(debateGenerating) || undefined }}>
                {speakerLabel(debateGenerating)}
              </span>
              <span className="debate-statement-type">thinking...</span>
            </div>
            <div className="debate-generating-dots">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={transcriptEndRef} />
      </div>

      {/* Action bar */}
      <div className="debate-action-bar">
        {debateError && (
          <div className="debate-error">{debateError}</div>
        )}
        <div className="debate-action-bar-inner">
          <input
            className="debate-input"
            type="text"
            placeholder="Ask a question or direct the debate..."
            disabled={activeDebate.phase === 'closed'}
          />
          <button className="btn btn-primary debate-send-btn" disabled={activeDebate.phase === 'closed'}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
