// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

type WidgetState = 'idle' | 'rating' | 'text' | 'submitted' | 'cooldown';

const COOLDOWN_MS = 60_000;
const MAX_TEXT = 500;

export function FeedbackWidget() {
  const [state, setState] = useState<WidgetState>('idle');
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [text, setText] = useState('');
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const resetWidget = useCallback(() => {
    setRating(null);
    setText('');
    setState('idle');
  }, []);

  const startCooldown = useCallback(() => {
    setState('cooldown');
    setCooldownRemaining(COOLDOWN_MS / 1000);
    cooldownTimer.current = setInterval(() => {
      setCooldownRemaining(prev => {
        if (prev <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current);
          cooldownTimer.current = null;
          resetWidget();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [resetWidget]);

  useEffect(() => {
    return () => { if (cooldownTimer.current) clearInterval(cooldownTimer.current); };
  }, []);

  const submit = useCallback(async (finalRating: 'up' | 'down', finalText?: string) => {
    setState('submitted');
    try {
      await api.submitFeedback(finalRating, finalText);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'feedback-widget',
        level: 'error',
        message: 'Failed to submit feedback',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }
    setTimeout(startCooldown, 1500);
  }, [startCooldown]);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (
      popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
      buttonRef.current && !buttonRef.current.contains(e.target as Node)
    ) {
      if (rating) {
        void submit(rating);
      } else {
        setState('idle');
      }
    }
  }, [rating, submit]);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (rating) {
        void submit(rating);
      } else {
        setState('idle');
      }
    }
  }, [rating, submit]);

  useEffect(() => {
    if (state === 'rating' || state === 'text') {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [state, handleClickOutside, handleEscape]);

  const handleRating = (r: 'up' | 'down') => {
    setRating(r);
    setState('text');
  };

  const handleSend = () => {
    if (rating) void submit(rating, text.trim() || undefined);
  };

  const toggleOpen = () => {
    if (state === 'idle') setState('rating');
    else if (state === 'rating' || state === 'text') {
      if (rating) void submit(rating);
      else setState('idle');
    }
  };

  return (
    <>
      {(state === 'rating' || state === 'text') && (
        <div className="feedback-backdrop" />
      )}
      <div className="feedback-widget">
        {(state === 'rating' || state === 'text') && (
          <div className="feedback-popover" ref={popoverRef}>
            {state === 'rating' && (
              <>
                <div className="feedback-popover-title">How&apos;s your experience?</div>
                <div className="feedback-rating-row">
                  <button
                    className="feedback-rating-btn"
                    onClick={() => handleRating('up')}
                    aria-label="Thumbs up"
                  >
                    <span className="feedback-thumb">&#x1F44D;</span>
                  </button>
                  <button
                    className="feedback-rating-btn"
                    onClick={() => handleRating('down')}
                    aria-label="Thumbs down"
                  >
                    <span className="feedback-thumb">&#x1F44E;</span>
                  </button>
                </div>
              </>
            )}
            {state === 'text' && (
              <>
                <div className="feedback-popover-title">Thanks! Anything else?</div>
                <textarea
                  className="feedback-textarea"
                  rows={3}
                  maxLength={MAX_TEXT}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Optional feedback…"
                  autoFocus
                />
                <div className="feedback-text-footer">
                  <span className="feedback-char-count">{text.length}/{MAX_TEXT}</span>
                  <button className="feedback-send-btn" onClick={handleSend}>Send</button>
                </div>
              </>
            )}
          </div>
        )}
        {state === 'submitted' && (
          <div className="feedback-toast">Feedback sent — thanks!</div>
        )}
        <button
          ref={buttonRef}
          className={`feedback-fab ${state === 'cooldown' ? 'feedback-fab-cooldown' : ''}`}
          onClick={toggleOpen}
          disabled={state === 'submitted' || state === 'cooldown'}
          title={state === 'cooldown' ? `Thanks! You can send more feedback in ${cooldownRemaining}s` : undefined}
          aria-label="Send feedback"
        >
          {state === 'submitted' ? (
            <span className="feedback-fab-icon">&#x2713;</span>
          ) : (
            <span className="feedback-fab-icon">&#x1F4AC;</span>
          )}
        </button>
      </div>
    </>
  );
}
