// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

const ICON_SIZES = { sm: 16, md: 20 } as const;

function LinkIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function CheckIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

interface CopyLinkButtonProps {
  hash: string;
  title?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function CopyLinkButton({ hash, title, size = 'sm', className }: CopyLinkButtonProps) {
  const [baseUrl, setBaseUrl] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const iconSize = ICON_SIZES[size];

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
  const label = title ?? 'Copy link';
  const tooltipText = disabled
    ? 'Deep links require the web app'
    : copied
      ? 'Copied!'
      : label;

  const handleClick = async () => {
    if (disabled) return;
    const url = `${baseUrl}${hash}`;
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
      aria-label={label}
      disabled={disabled}
    >
      {copied ? <CheckIcon size={iconSize} /> : <LinkIcon size={iconSize} />}
    </button>
  );
}
