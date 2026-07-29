// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { RATING_COLORS } from './constants';
import { CritiqueColumn } from './CritiqueColumn';
import type { TopicCritique } from '@lib/debate/topicCritique';
import './TopicCritiqueCard.css';

function SuggestedScoreBadges({ suggestedCritique, suggestedColor, delta }: {
  suggestedCritique: TopicCritique;
  suggestedColor: string;
  delta: number;
}) {
  return (
    <>
      <span className="critique-card-arrow">→</span>
      <span
        className="critique-card-score-badge"
        // eslint-disable-next-line local/no-inline-style -- dynamic badge color from suggested rating
        style={{ background: suggestedColor }}
      >
        {suggestedCritique.composite_score}/20
      </span>
      {delta !== 0 && (
        <span className={`critique-card-delta ${delta > 0 ? 'critique-card-delta--pos' : 'critique-card-delta--neg'}`}>
          ({delta > 0 ? '+' : ''}{delta})
        </span>
      )}
    </>
  );
}

function SuggestedTopicAction({ editingSuggested, setEditingSuggested, editedSuggested, setEditedSuggested, isLoading, hasEdits, rewrittenTopic, onUseSuggested, onReEvaluateSuggested }: {
  editingSuggested: boolean;
  setEditingSuggested: (v: boolean) => void;
  editedSuggested: string;
  setEditedSuggested: (v: string) => void;
  isLoading?: boolean;
  hasEdits: boolean;
  rewrittenTopic: string;
  onUseSuggested: (topic: string) => void;
  onReEvaluateSuggested: (editedTopic: string) => void;
}) {
  return (
    <div className="critique-card-action-col">
      {editingSuggested ? (
        <>
          <textarea
            className="critique-card-textarea"
            value={editedSuggested}
            onChange={(e) => setEditedSuggested(e.target.value)}
          />
          <div className="critique-card-btn-row">
            <button
              className="btn btn-sm btn-primary critique-card-btn-sm"
              disabled={!editedSuggested.trim() || isLoading}
              onClick={() => {
                setEditingSuggested(false);
                onReEvaluateSuggested(editedSuggested.trim());
              }}
            >
              {isLoading ? 'Evaluating...' : hasEdits ? 'Re-evaluate' : 'Re-evaluate'}
            </button>
            <button
              className="btn btn-sm critique-card-btn-sm"
              onClick={() => { setEditingSuggested(false); setEditedSuggested(rewrittenTopic); }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="critique-card-btn-row">
          <button
            className="btn btn-sm btn-primary critique-card-btn-sm"
            onClick={() => onUseSuggested(rewrittenTopic)}
          >
            Use Suggested Topic
          </button>
          <button
            className="btn btn-sm critique-card-btn-sm"
            onClick={() => setEditingSuggested(true)}
            title="Edit the suggested topic and re-evaluate its score"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

function CritiqueDetails({ critique, suggestedCritique, currentTopicText, ratingColor, suggestedColor, hasSuggestion, editingSuggested, setEditingSuggested, editedSuggested, setEditedSuggested, isLoading, hasEdits, onUseSuggested, onReEvaluateSuggested }: {
  critique: TopicCritique;
  suggestedCritique?: TopicCritique;
  currentTopicText: string;
  ratingColor: string;
  suggestedColor: string;
  hasSuggestion: boolean;
  editingSuggested: boolean;
  setEditingSuggested: (v: boolean) => void;
  editedSuggested: string;
  setEditedSuggested: (v: string) => void;
  isLoading?: boolean;
  hasEdits: boolean;
  onUseSuggested: (topic: string) => void;
  onReEvaluateSuggested: (editedTopic: string) => void;
}) {
  return (
    <div className="critique-card-details">
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
            <SuggestedTopicAction
              editingSuggested={editingSuggested}
              setEditingSuggested={setEditingSuggested}
              editedSuggested={editedSuggested}
              setEditedSuggested={setEditedSuggested}
              isLoading={isLoading}
              hasEdits={hasEdits}
              rewrittenTopic={critique.rewritten_topic ?? ''}
              onUseSuggested={onUseSuggested}
              onReEvaluateSuggested={onReEvaluateSuggested}
            />
          }
        />
      )}
    </div>
  );
}

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
    <div className="topic-critique-card">
      {/* Header */}
      <div className="critique-card-header">
        <span className="critique-card-title">Topic Quality</span>
        <span
          className="critique-card-score-badge"
          // eslint-disable-next-line local/no-inline-style -- dynamic badge color from rating
          style={{ background: ratingColor }}
        >
          {critique.composite_score}/20
        </span>
        {suggestedCritique && (
          <SuggestedScoreBadges suggestedCritique={suggestedCritique} suggestedColor={suggestedColor} delta={delta} />
        )}
        <button
          className="btn btn-sm critique-card-toggle-btn"
          onClick={() => setShowDetails(d => !d)}
        >
          {showDetails ? 'Hide Details' : 'Show Details'}
        </button>
      </div>

      {/* Expanded 2-column details */}
      {showDetails && (
        <CritiqueDetails
          critique={critique}
          suggestedCritique={suggestedCritique}
          currentTopicText={currentTopicText}
          ratingColor={ratingColor}
          suggestedColor={suggestedColor}
          hasSuggestion={hasSuggestion}
          editingSuggested={editingSuggested}
          setEditingSuggested={setEditingSuggested}
          editedSuggested={editedSuggested}
          setEditedSuggested={setEditedSuggested}
          isLoading={isLoading}
          hasEdits={hasEdits}
          onUseSuggested={onUseSuggested}
          onReEvaluateSuggested={onReEvaluateSuggested}
        />
      )}
    </div>
  );
}
