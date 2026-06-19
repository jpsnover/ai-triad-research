// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '@bridge';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

type FeedbackCategory = 'bug' | 'feature_request' | 'confusing' | 'general';
type FeedbackStep = 'rating' | 'text' | 'submitted' | 'cooldown';

const COOLDOWN_MS = 60_000;
const MAX_TEXT = 500;

const CATEGORY_CHIPS: { value: FeedbackCategory; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'bug', label: 'Bug' },
  { value: 'feature_request', label: 'Feature' },
  { value: 'confusing', label: 'Confusing' },
];

interface FeedbackPopoverProps {
  onClose: () => void;
}

export function FeedbackPopover({ onClose }: FeedbackPopoverProps) {
  const [step, setStep] = useState<FeedbackStep>('rating');
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [category, setCategory] = useState<FeedbackCategory>('general');
  const [text, setText] = useState('');
  const [includeSnapshot, setIncludeSnapshot] = useState(true);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const popoverRef = useRef<HTMLDivElement>(null);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { activeTab, toolbarPanel, selectedNodeId, colorScheme } = useTaxonomyStore();
  const breakpoint = useBreakpoint();

  const buildContext = useCallback((): Record<string, unknown> | undefined => {
    if (!includeSnapshot) return undefined;
    return {
      activeTab,
      toolbarPanel,
      selectedNodeId,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      colorScheme,
      breakpoint,
    };
  }, [includeSnapshot, activeTab, toolbarPanel, selectedNodeId, colorScheme, breakpoint]);

  const resetAndClose = useCallback(() => {
    setRating(null);
    setCategory('general');
    setText('');
    setStep('rating');
    onClose();
  }, [onClose]);

  const startCooldown = useCallback(() => {
    setStep('cooldown');
    setCooldownRemaining(COOLDOWN_MS / 1000);
    cooldownTimer.current = setInterval(() => {
      setCooldownRemaining(prev => {
        if (prev <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current);
          cooldownTimer.current = null;
          resetAndClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [resetAndClose]);

  useEffect(() => {
    return () => { if (cooldownTimer.current) clearInterval(cooldownTimer.current); };
  }, []);

  const submit = useCallback(async (finalRating: 'up' | 'down', finalText?: string) => {
    setStep('submitted');
    try {
      await api.submitFeedback(finalRating, finalText, category, buildContext());
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'feedback-popover',
        level: 'error',
        message: 'Failed to submit feedback',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
    }
    setTimeout(startCooldown, 1500);
  }, [category, buildContext, startCooldown]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        if (rating) {
          void submit(rating);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [rating, submit, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (rating) {
          void submit(rating);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [rating, submit, onClose]);

  const handleRating = (r: 'up' | 'down') => {
    setRating(r);
    setStep('text');
  };

  const handleSend = () => {
    if (rating) void submit(rating, text.trim() || undefined);
  };

  if (step === 'submitted') {
    return (
      <div className="feedback-popover-toolbar" ref={popoverRef}>
        <div className="feedback-popover-title">Feedback sent — thanks!</div>
      </div>
    );
  }

  if (step === 'cooldown') {
    return (
      <div className="feedback-popover-toolbar" ref={popoverRef}>
        <div className="feedback-popover-title">
          Thanks! You can send more in {cooldownRemaining}s
        </div>
      </div>
    );
  }

  return (
    <div className="feedback-popover-toolbar" ref={popoverRef}>
      {step === 'rating' && (
        <>
          <div className="feedback-popover-title">How&apos;s your experience?</div>
          <div className="feedback-rating-row">
            <button className="feedback-rating-btn" onClick={() => handleRating('up')} aria-label="Thumbs up">
              <span className="feedback-thumb">&#x1F44D;</span>
            </button>
            <button className="feedback-rating-btn" onClick={() => handleRating('down')} aria-label="Thumbs down">
              <span className="feedback-thumb">&#x1F44E;</span>
            </button>
          </div>
          <div className="feedback-category-row">
            {CATEGORY_CHIPS.map(c => (
              <button
                key={c.value}
                className={`feedback-category-chip${category === c.value ? ' active' : ''}`}
                onClick={() => setCategory(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </>
      )}
      {step === 'text' && (
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
          <div className="feedback-snapshot-row">
            <label className="feedback-snapshot-label">
              <input
                type="checkbox"
                checked={includeSnapshot}
                onChange={e => setIncludeSnapshot(e.target.checked)}
              />
              Include page snapshot
            </label>
          </div>
          <div className="feedback-text-footer">
            <span className="feedback-char-count">{text.length}/{MAX_TEXT}</span>
            <button className="feedback-send-btn" onClick={handleSend}>Send</button>
          </div>
        </>
      )}
    </div>
  );
}
