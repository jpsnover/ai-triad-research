import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useDebateStore } from '../../hooks/useDebateStore';
import './StatementProgressIndicator.css';

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function StatementProgressIndicator() {
  const { debateGenerating, debateActivity, debateGeneratingStartedAt, debateError } = useDebateStore(
    useShallow(s => ({
      debateGenerating: s.debateGenerating,
      debateActivity: s.debateActivity,
      debateGeneratingStartedAt: s.debateGeneratingStartedAt,
      debateError: s.debateError,
    }))
  );

  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (debateGenerating && debateGeneratingStartedAt !== null) {
      setElapsed(Date.now() - debateGeneratingStartedAt);
      intervalRef.current = setInterval(() => {
        setElapsed(Date.now() - (debateGeneratingStartedAt as number));
      }, 1000);
    } else {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [debateGenerating, debateGeneratingStartedAt]);

  // TL note 1: clear interval immediately when error occurs — don't wait for unmount
  useEffect(() => {
    if (debateError && intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [debateError]);

  if (!debateGenerating && !debateError) return null;

  if (debateError) {
    return (
      <div className="stmt-progress stmt-progress--error" role="alert">
        <span className="stmt-progress-icon stmt-progress-icon--error" aria-hidden="true" />
        <span className="stmt-progress-label">{debateError}</span>
      </div>
    );
  }

  return (
    <div className="stmt-progress stmt-progress--generating" aria-live="polite">
      <span className="stmt-progress-spinner" aria-hidden="true" />
      <span className="stmt-progress-label">{debateActivity ?? 'Generating…'}</span>
      <span className="stmt-progress-timer" aria-label={`Elapsed: ${formatElapsed(elapsed)}`}>
        {formatElapsed(elapsed)}
      </span>
    </div>
  );
}
