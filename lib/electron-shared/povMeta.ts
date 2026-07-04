import { POV_KEYS, type PovKey } from '../debate/types.js';

export type PovMetaKey = PovKey | 'situations';

export interface PovMeta {
  label: string;
  shortLabel: string;
  color: string;
  cssVar: string;
  prefix: string;
}

export const POV_META: Record<PovMetaKey, PovMeta> = {
  accelerationist: { label: 'Accelerationist', shortLabel: 'Acc', color: '#16a34a', cssVar: '--color-acc', prefix: 'acc-' },
  safetyist:       { label: 'Safetyist',       shortLabel: 'Saf', color: '#dc2626', cssVar: '--color-saf', prefix: 'saf-' },
  skeptic:         { label: 'Skeptic',          shortLabel: 'Skp', color: '#ca8a04', cssVar: '--color-skp', prefix: 'skp-' },
  situations:      { label: 'Situations',       shortLabel: 'Sit', color: '#7c3aed', cssVar: '--color-sit', prefix: 'sit-' },
};

export function getPovMeta(key: PovMetaKey): PovMeta {
  return POV_META[key];
}

export function povKeyFromNodeId(nodeId: string): PovMetaKey | undefined {
  if (nodeId.startsWith('sit-')) return 'situations';
  for (const key of POV_KEYS) {
    if (nodeId.startsWith(POV_META[key].prefix)) return key;
  }
  return undefined;
}

export { POV_KEYS };
export type { PovKey };
