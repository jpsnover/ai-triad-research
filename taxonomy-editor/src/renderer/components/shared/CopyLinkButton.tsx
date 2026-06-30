// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

interface CopyLinkButtonProps {
  path: string;
  className?: string;
  title?: string;
}

export function CopyLinkButton({ path, className, title }: CopyLinkButtonProps) {
  const [baseUrl, setBaseUrl] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getWebAppUrl().then(setBaseUrl).catch((err) => {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'copy-link-button',
        level: 'warn',
        message: 'Failed to resolve web app URL',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setBaseUrl(null);
    });
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (baseUrl === undefined) return null;

  const disabled = baseUrl === null;
  const tooltipText = disabled
    ? 'Deep links require the web app'
    : copied
      ? 'Copied!'
      : (title ?? 'Copy link');

  const handleClick = async () => {
    if (disabled) return;
    const url = `${baseUrl}${path}`;
    try {
      await api.clipboardWriteText(url);
      setCopied(true);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'copy-link-button',
        level: 'error',
        message: 'Failed to copy link to clipboard',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }
  };

  return (
    <button
      className={`btn-xs btn-ghost${disabled ? ' btn-disabled' : ''}${className ? ` ${className}` : ''}`}
      onClick={handleClick}
      title={tooltipText}
      disabled={disabled}
    >
      {copied ? '✓ Copied' : '🔗 Copy link'}
    </button>
  );
}
