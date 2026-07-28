// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import './DeploymentErrorScreen.css';

interface DeploymentErrorScreenProps {
  dataRoot: string;
}

export function DeploymentErrorScreen({ dataRoot }: DeploymentErrorScreenProps) {
  return (
    <div className="deployment-error-screen">
      <div className="deployment-error-content">
        <h1 className="deployment-error-title">
          Deployment Error
        </h1>
        <p className="deployment-error-desc">
          Taxonomy data not found at the configured data root. This is not a first-run scenario — the container expected data to be present.
        </p>

        <div className="deployment-error-code-box">
          <div className="deployment-error-row">
            <span className="deployment-error-label">Data root: </span>
            <span>{dataRoot}</span>
          </div>
          <div>
            <span className="deployment-error-label">Expected: </span>
            <span>{dataRoot}/taxonomy/Origin/*.json</span>
          </div>
        </div>

        <h2 className="deployment-error-subtitle">Troubleshooting</h2>
        <ol className="deployment-error-list">
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
