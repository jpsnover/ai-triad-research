import { useState, useEffect } from 'react';
import { usePipelineStore } from '../store';
import type { StepDefinition, StepState } from '../types';

const PHASE_COLORS: Record<string, string> = {
  Ingest: 'var(--phase-ingest)',
  Summarize: 'var(--phase-summarize)',
  Analyze: 'var(--phase-analyze)',
  Improve: 'var(--phase-improve)',
  Validate: 'var(--phase-validate)',
  Enrich: 'var(--phase-enrich)',
  Publish: 'var(--phase-publish)',
};

function formatDuration(start?: number, end?: number): string {
  if (!start) return '';
  const elapsed = (end || Date.now()) - start;
  if (elapsed < 1000) return '<1s';
  if (elapsed < 60000) return `${Math.round(elapsed / 1000)}s`;
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.round((elapsed % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function StatusIcon({ status }: { status: string }) {
  const symbols: Record<string, string> = {
    pending: '',
    running: '\u25CF',
    success: '\u2713',
    error: '\u2717',
    skipped: '\u2014',
    cancelled: '\u25CB',
  };
  return <span>{symbols[status] || ''}</span>;
}

function RunningTimer({ startTime }: { startTime: number }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return <span>{formatDuration(startTime)}</span>;
}

export function Sidebar() {
  const { definitions, steps, expandedStepId, setExpandedStep } = usePipelineStore();

  const phases: string[] = [];
  const phaseSteps: Record<string, StepDefinition[]> = {};
  for (const def of definitions) {
    if (!phaseSteps[def.phase]) {
      phases.push(def.phase);
      phaseSteps[def.phase] = [];
    }
    phaseSteps[def.phase].push(def);
  }

  return (
    <div className="sidebar">
      {phases.map(phase => (
        <div className="phase-group" key={phase}>
          <div className="phase-label" style={{ color: PHASE_COLORS[phase] }}>
            {phase}
          </div>
          {phaseSteps[phase].map(def => {
            const step: StepState | undefined = steps[def.id];
            const status = step?.status || 'pending';
            const isActive = expandedStepId === def.id;

            return (
              <div
                key={def.id}
                className={`sidebar-step ${isActive ? 'active' : ''} ${status === 'running' ? 'running' : ''}`}
                onClick={() => setExpandedStep(def.id)}
              >
                <div className={`step-indicator ${status}`}>
                  <StatusIcon status={status} />
                </div>
                <div className="sidebar-step-info">
                  <div className="sidebar-step-name">{def.name}</div>
                  {status === 'running' && step?.startTime && (
                    <div className="sidebar-step-time running-time">
                      <RunningTimer startTime={step.startTime} />
                    </div>
                  )}
                  {status === 'success' && (
                    <div className="sidebar-step-summary">
                      {step?.summary && <span className="summary-text">{step.summary}</span>}
                      {step?.startTime && step?.endTime && (
                        <span className="summary-time">{formatDuration(step.startTime, step.endTime)}</span>
                      )}
                    </div>
                  )}
                  {status === 'error' && (
                    <div className="sidebar-step-summary error-summary">
                      <span className="summary-text">{step?.summary || 'Failed'}</span>
                      {step?.startTime && step?.endTime && (
                        <span className="summary-time">{formatDuration(step.startTime, step.endTime)}</span>
                      )}
                    </div>
                  )}
                  {status === 'skipped' && (
                    <div className="sidebar-step-summary skipped-summary">
                      <span className="summary-text">Skipped</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
