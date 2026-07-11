import { useState, useEffect, useRef } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { api } from '@bridge';
import './ExternalEmbed.css';

const UNFRAMEABLE_DOMAINS = [
  'wikipedia.org',
  'scholar.google.com',
  'scholar.google.co.uk',
  'github.com',
  'twitter.com',
  'x.com',
];

function isUnframeable(src: string): boolean {
  try {
    const host = new URL(src).hostname;
    return UNFRAMEABLE_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch { /* telemetry — silent by design: malformed URL treated as frameable */
    return false;
  }
}

interface ExternalEmbedProps {
  src: string;
  className?: string;
  title?: string;
  onClose?: () => void;
}

const LOAD_TIMEOUT_MS = 8000;

export function ExternalEmbed({ src, className, title, onClose }: ExternalEmbedProps) {
  const isWeb = import.meta.env.VITE_TARGET === 'web';
  const blocked = isWeb && isUnframeable(src);
  const [timedOut, setTimedOut] = useState(false);
  const loadedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    loadedRef.current = false;
    setTimedOut(false);

    if (!isWeb || blocked) return;

    timerRef.current = setTimeout(() => {
      if (!loadedRef.current) {
        setTimedOut(true);
        getGlobalRecorder()?.record({
          type: 'embed.load-failure',
          component: 'external-embed',
          level: 'warn',
          message: 'Embed load timeout — frame may be blocked by X-Frame-Options',
          data: { src, reason: 'timeout' },
        });
      }
    }, LOAD_TIMEOUT_MS);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [src, isWeb, blocked]);

  const handleLoad = () => {
    loadedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const openInTab = () => void api.openExternal(src);

  if (!isWeb) {
    return (
      <div className={`external-embed ${className ?? ''}`}>
        <webview src={src} className="webview-frame" />
      </div>
    );
  }

  if (blocked) {
    return (
      <div className={`external-embed external-embed-fallback ${className ?? ''}`}>
        <div className="external-embed-fallback-card">
          <div className="external-embed-fallback-message">
            This site cannot be embedded in a preview frame.
          </div>
          <button className="btn btn-sm" onClick={openInTab}>
            Open in new tab ↗
          </button>
          {onClose && (
            <button className="btn btn-sm btn-ghost" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`external-embed ${className ?? ''}`}>
      <iframe
        src={src}
        className="webview-frame"
        sandbox="allow-scripts allow-same-origin"
        title={title ?? 'External content'}
        onLoad={handleLoad}
      />
      <div className="external-embed-toolbar">
        <button className="btn btn-sm btn-ghost" onClick={openInTab}>
          Open in new tab ↗
        </button>
        {onClose && (
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            Close
          </button>
        )}
        {timedOut && (
          <span className="external-embed-warn">
            Content may not have loaded correctly
          </span>
        )}
      </div>
    </div>
  );
}
