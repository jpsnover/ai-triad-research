import { useEffect, useRef } from 'react';
import { usePipelineStore } from '../store';
import { ImportConfig } from './ImportConfig';
import { GitCommitConfig } from './GitCommitConfig';
import { ReviewConfig } from './ReviewConfig';
import { useRunPipeline } from './useRunPipeline';

const PHASE_COLORS: Record<string, string> = {
  Ingest: 'var(--phase-ingest)',
  Summarize: 'var(--phase-summarize)',
  Analyze: 'var(--phase-analyze)',
  Improve: 'var(--phase-improve)',
  Validate: 'var(--phase-validate)',
  Enrich: 'var(--phase-enrich)',
  Publish: 'var(--phase-publish)',
};

function LogArea({ stepId }: { stepId: string }) {
  const { steps } = usePipelineStore();
  const step = steps[stepId];
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [step?.log, step?.errorLog]);

  if (!step) return null;

  const combined = step.log + step.errorLog;
  if (!combined) {
    return (
      <div className="log-area" ref={ref}>
        <span style={{ color: 'var(--text-muted)' }}>
          {step.status === 'pending' ? 'Ready to run. Click "Run Step" to begin.' : 'No output yet.'}
        </span>
      </div>
    );
  }

  const lines = combined.split('\n');

  return (
    <div className="log-area" ref={ref}>
      {lines.map((line, i) => {
        let className = '';
        if (line.startsWith('> ') || line.startsWith('PS ')) className = 'command-line';
        else if (line.startsWith('VERBOSE:')) className = 'verbose-line';
        else if (line.startsWith('ERROR:') || line.startsWith('Exception') || line.includes('error')) className = 'error-line';
        return <div key={i} className={className}>{line}</div>;
      })}
    </div>
  );
}

function StepStatusText({ stepId }: { stepId: string }) {
  const { steps } = usePipelineStore();
  const step = steps[stepId];
  if (!step) return null;

  const statusMessages: Record<string, string> = {
    pending: 'Ready to run',
    running: 'Running...',
    success: 'Completed successfully',
    error: 'Failed — check log for details',
    skipped: 'Skipped',
    cancelled: 'Cancelled',
  };

  return <span className="step-status-text">{statusMessages[step.status]}</span>;
}

export function StepDetail({ stepId }: { stepId: string }) {
  const { definitions, steps, pipelineRunning } = usePipelineStore();
  const { runSingle, skipStep, cancel } = useRunPipeline();

  const def = definitions.find(d => d.id === stepId);
  const step = steps[stepId];
  if (!def || !step) return null;

  const isRunning = step.status === 'running';
  const canRun = !pipelineRunning && step.status !== 'running';

  return (
    <div className="step-detail">
      <div className="step-header">
        <span
          className="step-phase-badge"
          style={{
            background: `${PHASE_COLORS[def.phase]}22`,
            color: PHASE_COLORS[def.phase],
            border: `1px solid ${PHASE_COLORS[def.phase]}44`,
          }}
        >
          {def.phase}
        </span>
        <h2>{def.name}</h2>
        <p>{def.description}</p>
      </div>

      {def.id === 'import' && <ImportConfig />}
      {def.id === 'git-commit' && <GitCommitConfig />}
      {def.id === 'review' && <ReviewConfig />}

      <LogArea stepId={stepId} />

      <div className="step-actions">
        <StepStatusText stepId={stepId} />
        {isRunning ? (
          <button className="btn btn-danger" onClick={cancel}>Cancel</button>
        ) : (
          <>
            {def.canSkip && canRun && (
              <button className="btn btn-sm" onClick={() => skipStep(stepId)}>Skip</button>
            )}
            <button
              className="btn btn-primary"
              disabled={!canRun}
              onClick={() => runSingle(stepId)}
            >
              {step.status === 'error' || step.status === 'success' ? 'Re-run Step' : 'Run Step'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
