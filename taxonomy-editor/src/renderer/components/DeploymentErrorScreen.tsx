// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

interface DeploymentErrorScreenProps {
  dataRoot: string;
}

export function DeploymentErrorScreen({ dataRoot }: DeploymentErrorScreenProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', padding: 32,
      background: 'var(--bg-primary, #1a1a2e)', color: 'var(--text-primary, #e0e0e0)',
    }}>
      <div style={{ maxWidth: 600, width: '100%' }}>
        <h1 style={{ fontSize: '1.4rem', marginBottom: 8, color: '#ef4444' }}>
          Deployment Error
        </h1>
        <p style={{ fontSize: '0.9rem', marginBottom: 24, color: 'var(--text-muted, #999)' }}>
          Taxonomy data not found at the configured data root. This is not a first-run scenario — the container expected data to be present.
        </p>

        <div style={{
          background: 'var(--bg-secondary, #16213e)', borderRadius: 8,
          padding: 16, marginBottom: 16,
          border: '1px solid var(--border-color, #333)',
          fontFamily: 'monospace', fontSize: '0.8rem',
        }}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: 'var(--text-muted, #999)' }}>Data root: </span>
            <span>{dataRoot}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted, #999)' }}>Expected: </span>
            <span>{dataRoot}/taxonomy/Origin/*.json</span>
          </div>
        </div>

        <h2 style={{ fontSize: '0.95rem', marginBottom: 12 }}>Troubleshooting</h2>
        <ol style={{ fontSize: '0.85rem', lineHeight: 1.8, paddingLeft: 20, margin: 0 }}>
          <li>Check that the Azure Files share is mounted at <code>{dataRoot}</code></li>
          <li>Verify the data copy in the container entrypoint completed successfully</li>
          <li>Run <code>docker logs &lt;container&gt;</code> to check startup output</li>
          <li>Confirm taxonomy JSON files exist in <code>{dataRoot}/taxonomy/Origin/</code></li>
          <li>Check <code>/healthz</code> endpoint for diagnostic details</li>
        </ol>
      </div>
    </div>
  );
}
