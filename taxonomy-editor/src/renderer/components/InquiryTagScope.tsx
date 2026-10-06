// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { PublicInquiryShare } from '@lib/inquiry';
import { POV_META } from '@lib/electron-shared/povMeta';
import { loadPovTagRegistry, type PovTagRegistry } from '@lib/schema/povTags';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { inquiryTagScopeLines, type ResolvedTag, type TagMode } from './inquiryTagScopeText';

type Selection = { pov: string; tag: string; mode: TagMode };

function registryOrNull(): PovTagRegistry | null {
  try {
    return loadPovTagRegistry();
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'inquiry-share', level: 'warn',
      message: 'POV tag registry failed to load; showing raw tag ids on the share page (t/3983)',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return null;
  }
}

/** Resolve display labels. A tag the registry no longer has (retired after the run) shows its raw id. */
function resolve(sel: Selection, registry: PovTagRegistry | null): ResolvedTag {
  const camp = POV_META[sel.pov as keyof typeof POV_META]?.label ?? sel.pov;
  const entries = registry?.povs[sel.pov as keyof PovTagRegistry['povs']] ?? [];
  const tagLabel = entries.find(t => t.id === sel.tag)?.label ?? sel.tag;
  return { ...sel, campLabel: camp, tagLabel };
}

/** The share's POV-tag scope (t/3983). Renders nothing for an untagged share. */
export function InquiryTagScope({ doc }: { doc: PublicInquiryShare }) {
  const requested = doc.request.tagSelection as Selection | undefined;
  const applied = doc.derivation.tag as (Selection & { included: number; excludedUntagged: number }) | undefined;
  if (!requested && !applied) return null;
  const registry = registryOrNull();
  const lines = inquiryTagScopeLines(
    requested && resolve(requested, registry),
    applied && { ...resolve(applied, registry), included: applied.included, excludedUntagged: applied.excludedUntagged },
  );
  if (!lines) return null;
  return (
    <div className="pov-inquiry-scope" aria-label="Tag scope">
      <div className="pov-inquiry-scope-label">{lines.label}</div>
      {lines.detail && <div className="pov-inquiry-scope-detail">{lines.detail}</div>}
      {lines.warn && <div className="pov-inquiry-scope-warn" role="note">{lines.warn}</div>}
    </div>
  );
}
