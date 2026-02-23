import type { Mapping, PovCamp } from '../types/types';
import { POV_LABELS } from '../types/types';

interface Props {
  mapping: Mapping;
}

const BLOCK_CLASS: Record<PovCamp, string> = {
  accelerationist: 'mapping-block-acc',
  safetyist: 'mapping-block-saf',
  skeptic: 'mapping-block-skp',
  'cross-cutting': 'mapping-block-cc',
};

const CAMP_CLASS: Record<PovCamp, string> = {
  accelerationist: 'mapping-camp-acc',
  safetyist: 'mapping-camp-saf',
  skeptic: 'mapping-camp-skp',
  'cross-cutting': 'mapping-camp-cc',
};

export default function MappingBlock({ mapping }: Props) {
  const alignIcon = mapping.alignment === 'agrees' ? '+' : '\u2212';

  return (
    <div className={`mapping-block ${BLOCK_CLASS[mapping.camp]}`}>
      <div className="mapping-header">
        <span className={`mapping-camp-label ${CAMP_CLASS[mapping.camp]}`}>
          {POV_LABELS[mapping.camp]}
        </span>
        <span className={`mapping-alignment ${mapping.alignment}`}>
          {alignIcon} {mapping.alignment}
        </span>
      </div>
      <div className="mapping-node-id">{mapping.nodeId}</div>
      <div className="mapping-node-label">{mapping.nodeLabel}</div>
      <div className="mapping-category">{mapping.category}</div>
      <div className="mapping-strength">Strength: {mapping.strength}</div>
      <div className="mapping-explanation">{mapping.explanation}</div>
    </div>
  );
}
