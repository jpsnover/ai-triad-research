// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Camp tags for the Op-Ed Studies library page (t/3703). A fixed palette per the redesign spec
// (C:\tmp\HANDOFF-library-pages.md §2) — literal oklch values, NOT theme-reactive, unlike the
// existing CampGlyph/theme-cssVar chips used elsewhere in the app. Page-specific per the t/3702/
// t/3703 shared/per-page split (Camps is a page-specific column renderer).

import type { PovKey } from '../../../../../lib/oped/types';
import { resolveCampKey } from './povResolve';
import './OpEdCampTags.css';

const CAMP_LABEL: Record<'acc' | 'saf' | 'skp', string> = {
  acc: 'ACC',
  saf: 'SAF',
  skp: 'SKP',
};

export function OpEdCampTags({ camps }: { camps: PovKey[] }) {
  return (
    <span className="oped-camptags">
      {camps.map(pov => {
        const camp = resolveCampKey(pov);
        if (!camp) return null;
        return (
          <span key={pov} className={`oped-camptag oped-camptag-${camp}`}>
            <span className="oped-camptag-dot" aria-hidden="true" />
            {CAMP_LABEL[camp]}
          </span>
        );
      })}
    </span>
  );
}
