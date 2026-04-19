import { usePipelineStore } from '../store';

export function PipelineSummary() {
  const { steps } = usePipelineStore();
  const all = Object.values(steps);
  const counts = {
    success: all.filter(s => s.status === 'success').length,
    error: all.filter(s => s.status === 'error').length,
    skipped: all.filter(s => s.status === 'skipped').length,
    pending: all.filter(s => s.status === 'pending').length,
    running: all.filter(s => s.status === 'running').length,
  };

  return (
    <div className="pipeline-summary">
      <div className="stat">
        <span className="stat-dot success" />
        {counts.success} done
      </div>
      {counts.error > 0 && (
        <div className="stat">
          <span className="stat-dot error" />
          {counts.error} failed
        </div>
      )}
      {counts.running > 0 && (
        <div className="stat">
          <span className="stat-dot" style={{ background: 'var(--accent-orange)' }} />
          {counts.running} running
        </div>
      )}
      <div className="stat">
        <span className="stat-dot pending" />
        {counts.pending} remaining
      </div>
      {counts.skipped > 0 && (
        <div className="stat">
          <span className="stat-dot skipped" />
          {counts.skipped} skipped
        </div>
      )}
    </div>
  );
}
