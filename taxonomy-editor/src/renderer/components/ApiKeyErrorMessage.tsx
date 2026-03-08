// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { ApiKeyDialog } from './ApiKeyDialog';

interface ApiKeyErrorMessageProps {
  error: string;
}

/** Renders an error message. If it mentions "API key", appends a link to open the API key dialog. */
export function ApiKeyErrorMessage({ error }: ApiKeyErrorMessageProps) {
  const [showDialog, setShowDialog] = useState(false);
  const isApiKeyError = /api.?key/i.test(error);

  return (
    <>
      <div className="search-error">
        {error}
        {isApiKeyError && (
          <>
            {' '}
            <button
              className="api-key-error-link"
              onClick={() => setShowDialog(true)}
            >
              Configure API Key
            </button>
          </>
        )}
      </div>
      {showDialog && <ApiKeyDialog onClose={() => setShowDialog(false)} />}
    </>
  );
}
