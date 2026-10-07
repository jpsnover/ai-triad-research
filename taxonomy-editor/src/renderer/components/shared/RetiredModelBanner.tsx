// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useRetiredModelNotice } from '../../utils/retiredModelNotice';
import './RetiredModelBanner.css';

/** One-time notice (t/4030): the saved model was retired by a registry refresh, so another is used. */
export function RetiredModelBanner() {
  const notice = useRetiredModelNotice((s) => s.notice);
  const dismiss = useRetiredModelNotice((s) => s.dismiss);
  if (!notice) return null;
  return (
    <div className="retired-model-banner" role="status" aria-live="polite">
      <span className="retired-model-banner-text">
        Your saved model {notice.stored} is no longer available; using {notice.fallback}. Pick another in Settings to change it.
      </span>
      <button className="retired-model-banner-dismiss" onClick={dismiss} aria-label="Dismiss retired-model notice">
        &times;
      </button>
    </div>
  );
}
