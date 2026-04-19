import { useState, useEffect } from 'react';
import { usePipelineStore } from '../store';

export function GitCommitConfig() {
  const { steps, setStepConfig } = usePipelineStore();
  const config = steps['git-commit']?.config || {};

  const [message, setMessage] = useState<string>(
    (config.commitMessage as string) || ''
  );
  const [diffStat, setDiffStat] = useState<string>('Loading...');

  useEffect(() => {
    window.electronAPI.getGitDiffStat().then(setDiffStat);
  }, []);

  function updateMessage(value: string) {
    setMessage(value);
    setStepConfig('git-commit', { commitMessage: value });
  }

  return (
    <div className="step-config">
      <div className="config-row">
        <label>Message</label>
        <textarea
          placeholder="chore: pipeline update — new sources ingested, taxonomy expanded"
          value={message}
          onChange={e => updateMessage(e.target.value)}
        />
      </div>
      <div className="config-row">
        <label>Changes</label>
        <div style={{ flex: 1 }}>
          <button
            className="btn btn-sm"
            onClick={() => window.electronAPI.getGitDiffStat().then(setDiffStat)}
          >
            Refresh
          </button>
          <div className="diff-preview">{diffStat}</div>
        </div>
      </div>
    </div>
  );
}
