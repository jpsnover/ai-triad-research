import { useState, useEffect } from 'react';
import { usePipelineStore } from '../store';
import type { ProposalFile } from '../types';

export function ReviewConfig() {
  const { setStepConfig } = usePipelineStore();
  const [proposalFiles, setProposalFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [proposals, setProposals] = useState<ProposalFile | null>(null);

  useEffect(() => {
    window.electronAPI.listProposalFiles().then(files => {
      setProposalFiles(files);
      if (files.length > 0) {
        const latest = files[files.length - 1];
        setSelectedFile(latest);
        setStepConfig('review', { proposalPath: latest });
        loadProposals(latest);
      }
    });
  }, [setStepConfig]);

  async function loadProposals(path: string) {
    const data = await window.electronAPI.readProposalFile(path);
    setProposals(data);
  }

  function selectProposal(path: string) {
    setSelectedFile(path);
    setStepConfig('review', { proposalPath: path });
    loadProposals(path);
  }

  if (proposalFiles.length === 0) {
    return (
      <div className="step-config">
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          No proposal files found. Run "Generate Proposals" first.
        </p>
      </div>
    );
  }

  const pending = proposals?.proposals.filter(p => p.status === 'pending') || [];

  return (
    <div className="step-config">
      <div className="config-row">
        <label>Proposal</label>
        <select value={selectedFile} onChange={e => selectProposal(e.target.value)}>
          {proposalFiles.map(f => (
            <option key={f} value={f}>
              {f.split(/[\\/]/).pop()}
            </option>
          ))}
        </select>
      </div>

      {proposals && (
        <div style={{ marginTop: 12, maxHeight: 300, overflowY: 'auto' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            {pending.length} pending / {proposals.proposals.length} total proposals
            {proposals.model && ` \u00B7 ${proposals.model}`}
          </div>
          <ul className="proposal-list">
            {proposals.proposals.slice(0, 20).map((p, i) => (
              <li key={i} className="proposal-item">
                <div className="proposal-item-header">
                  <span className={`proposal-action ${p.action}`}>{p.action}</span>
                  <span className="proposal-label">{p.label}</span>
                </div>
                <div className="proposal-meta">
                  {p.pov} / {p.category}
                  {p.suggested_id && ` \u00B7 ${p.suggested_id}`}
                  {p.status !== 'pending' && (
                    <span style={{ marginLeft: 8, color: p.status === 'approved' ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      [{p.status}]
                    </span>
                  )}
                </div>
                <div className="proposal-rationale">{p.rationale}</div>
              </li>
            ))}
            {proposals.proposals.length > 20 && (
              <li style={{ padding: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                ...and {proposals.proposals.length - 20} more
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
