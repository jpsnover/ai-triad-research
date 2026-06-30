// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useRef, useState } from 'react';
import { api } from '@bridge';
import type { SupportCaseDetail as CaseDetailType } from '../../bridge/types';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

const STATUS_COLORS: Record<string, string> = {
  open: 'var(--color-info, #3b82f6)',
  'in-progress': 'var(--color-warning, #f59e0b)',
  resolved: 'var(--color-success, #22c55e)',
  closed: 'var(--text-muted, #94a3b8)',
};

const PRIORITY_LABELS: Record<string, string> = {
  high: '● High',
  medium: '◐ Medium',
  low: '○ Low',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface CaseDetailProps {
  detail: CaseDetailType;
}

export function CaseDetail({ detail }: CaseDetailProps) {
  const [showSystemInfo, setShowSystemInfo] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(new Map());
  const urlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    return () => {
      for (const url of urlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    for (const url of urlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    urlsRef.current.clear();
    setPreviewUrls(new Map());
  }, [detail.id]);

  const loadPreview = async (attachmentId: string) => {
    if (previewUrls.has(attachmentId)) return;
    try {
      const blob = (await api.downloadCaseAttachment(detail.id, attachmentId)) as Blob;
      const url = URL.createObjectURL(blob);
      urlsRef.current.set(attachmentId, url);
      setPreviewUrls(new Map(urlsRef.current));
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'case-detail',
        level: 'error',
        message: 'Failed to download attachment preview',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }
  };

  const statusColor = STATUS_COLORS[detail.status] ?? 'var(--text-muted)';

  return (
    <div style={{ padding: 16, fontSize: '0.85rem' }}>
      <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem' }}>{detail.subject}</h3>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span
          style={{
            padding: '2px 10px',
            borderRadius: 12,
            fontSize: '0.73rem',
            fontWeight: 600,
            background: statusColor,
            color: '#fff',
          }}
        >
          {detail.status}
        </span>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {PRIORITY_LABELS[detail.priority] ?? detail.priority}
        </span>
        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
          Created {formatDate(detail.createdAt)}
        </span>
        {detail.resolvedAt && (
          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
            Resolved {formatDate(detail.resolvedAt)}
          </span>
        )}
      </div>

      <div style={{ marginBottom: 16, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{detail.description}</div>

      {/* System Info (collapsible) */}
      <div style={{ marginBottom: 16 }}>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => setShowSystemInfo(!showSystemInfo)}
          style={{ fontSize: '0.76rem' }}
        >
          {showSystemInfo ? '▼' : '▶'} System Info
        </button>
        {showSystemInfo && detail.systemInfo && (
          <div
            style={{
              marginTop: 4,
              padding: 8,
              borderRadius: 6,
              background: 'var(--bg-secondary)',
              fontSize: '0.76rem',
              fontFamily: 'monospace',
            }}
          >
            <div>App: {detail.systemInfo.appVersion}</div>
            <div>Mode: {detail.systemInfo.deploymentMode}</div>
            <div>Browser: {detail.systemInfo.browser}</div>
            <div>OS: {detail.systemInfo.os}</div>
          </div>
        )}
      </div>

      {/* Attachments */}
      {detail.attachments.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: '0.88rem' }}>
            Attachments ({detail.attachments.length})
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {detail.attachments.map((att) => {
              const isImage = att.mimeType.startsWith('image/');
              const url = previewUrls.get(att.id);
              return (
                <div
                  key={att.id}
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-secondary)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 500, fontSize: '0.82rem' }}>{att.filename}</span>
                    <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                      {formatBytes(att.sizeBytes)}
                    </span>
                  </div>
                  {isImage && !url && (
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => void loadPreview(att.id)}
                      style={{ marginTop: 4, fontSize: '0.73rem' }}
                    >
                      Show preview
                    </button>
                  )}
                  {isImage && url && (
                    <img
                      src={url}
                      alt={att.filename}
                      style={{ marginTop: 6, maxWidth: '100%', maxHeight: 300, borderRadius: 4 }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Response timeline */}
      {detail.responses.length > 0 ? (
        <div>
          <h4 style={{ margin: '0 0 8px', fontSize: '0.88rem' }}>
            Responses ({detail.responses.length})
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {detail.responses.map((resp) => (
              <div
                key={resp.id}
                style={{
                  padding: 10,
                  borderRadius: 6,
                  background: 'var(--bg-secondary)',
                  borderLeft: '3px solid var(--accent, #3b82f6)',
                }}
              >
                <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  {resp.authorId} &mdash; {formatDate(resp.createdAt)}
                </div>
                <div style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{resp.body}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
          No responses yet. We&rsquo;ll get back to you soon.
        </p>
      )}
    </div>
  );
}
