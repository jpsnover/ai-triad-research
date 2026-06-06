// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { RATING_COLORS } from './constants';
import { CritiqueColumn } from './CritiqueColumn';
import type { TopicCritique } from '@lib/debate/topicCritique';

export function TopicCritiqueCard({ critique, suggestedCritique, currentTopicText, onUseSuggested, onReEvaluateSuggested, isLoading }: {
  critique: TopicCritique;
  suggestedCritique?: TopicCritique;
  currentTopicText: string;
  onUseSuggested: (topic: string) => void;
  onReEvaluateSuggested: (editedTopic: string) => void;
  isLoading?: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [editingSuggested, setEditingSuggested] = useState(false);
  const [editedSuggested, setEditedSuggested] = useState(critique.rewritten_topic ?? '');
  const ratingColor = RATING_COLORS[critique.rating] ?? '#888';
  const suggestedColor = suggestedCritique ? (RATING_COLORS[suggestedCritique.rating] ?? '#888') : '#888';
  const hasSuggestion = !!critique.rewritten_topic && critique.rating !== 'strong';
  const delta = suggestedCritique ? suggestedCritique.composite_score - critique.composite_score : 0;
  const hasEdits = editedSuggested.trim() !== (critique.rewritten_topic ?? '').trim();

  return (
    <div className="topic-critique-card" style={{
      borderRadius: 8,
      padding: '12px 16px',
      marginBottom: 12,
      border: '1px solid var(--border-color)',
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Topic Quality</span>
        <span style={{
          background: ratingColor, color: '#fff', padding: '1px 8px', borderRadius: 4,
          fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase',
        }}>
          {critique.composite_score}/20
        </span>
        {suggestedCritique && (
          <>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>→</span>
            <span style={{
              background: suggestedColor, color: '#fff', padding: '1px 8px', borderRadius: 4,
              fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase',
            }}>
              {suggestedCritique.composite_score}/20
            </span>
            {delta !== 0 && (
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: delta > 0 ? '#16a34a' : '#dc2626' }}>
                ({delta > 0 ? '+' : ''}{delta})
              </span>
            )}
          </>
        )}
        <button
          className="btn btn-sm"
          onClick={() => setShowDetails(d => !d)}
          style={{ marginLeft: 'auto', fontSize: '0.75rem', padding: '2px 8px' }}
        >
          {showDetails ? 'Hide Details' : 'Show Details'}
        </button>
      </div>

      {/* Expanded 2-column details */}
      {showDetails && (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 8, maxHeight: 420, overflowY: 'auto' }}>
          {/* Left: Current topic */}
          <CritiqueColumn
            critique={critique}
            label="Current Topic"
            topicText={currentTopicText}
            accentColor={ratingColor}
          />

          {/* Right: Suggested topic */}
          {hasSuggestion && (
            <CritiqueColumn
              critique={suggestedCritique ?? critique}
              label={suggestedCritique ? 'Suggested Topic' : 'Suggested Topic (scoring...)'}
              topicText={editingSuggested ? undefined : (critique.rewritten_topic)}
              accentColor={suggestedCritique ? suggestedColor : '#6b7280'}
              action={
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {editingSuggested ? (
                    <>
                      <textarea
                        value={editedSuggested}
                        onChange={(e) => setEditedSuggested(e.target.value)}
                        style={{
                          width: '100%', minHeight: 80, fontSize: '0.78rem', lineHeight: 1.5,
                          padding: '6px 10px', borderRadius: 6,
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                          fontFamily: 'inherit', resize: 'vertical',
                        }}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={!editedSuggested.trim() || isLoading}
                          onClick={() => {
                            setEditingSuggested(false);
                            onReEvaluateSuggested(editedSuggested.trim());
                          }}
                          style={{ fontSize: '0.75rem', padding: '3px 10px' }}
                        >
                          {isLoading ? 'Evaluating...' : hasEdits ? 'Re-evaluate' : 'Re-evaluate'}
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => { setEditingSuggested(false); setEditedSuggested(critique.rewritten_topic ?? ''); }}
                          style={{ fontSize: '0.75rem', padding: '3px 10px' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => onUseSuggested(critique.rewritten_topic)}
                        style={{ fontSize: '0.75rem', padding: '3px 10px' }}
                      >
                        Use Suggested Topic
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => setEditingSuggested(true)}
                        style={{ fontSize: '0.75rem', padding: '3px 10px' }}
                        title="Edit the suggested topic and re-evaluate its score"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
