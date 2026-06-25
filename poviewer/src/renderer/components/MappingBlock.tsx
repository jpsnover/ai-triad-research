// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { Mapping, PovCamp } from '../types/types';
import { POV_LABELS } from '../types/types';
import { resolveDescription, type DescriptionMode } from './DescriptionToggle';

interface Props {
  mapping: Mapping;
  descMode?: DescriptionMode;
}

const BLOCK_CLASS: Record<PovCamp, string> = {
  accelerationist: 'mapping-block-acc',
  safetyist: 'mapping-block-saf',
  skeptic: 'mapping-block-skp',
  'situations': 'mapping-block-cc',
};

const CAMP_CLASS: Record<PovCamp, string> = {
  accelerationist: 'mapping-camp-acc',
  safetyist: 'mapping-camp-saf',
  skeptic: 'mapping-camp-skp',
  'situations': 'mapping-camp-cc',
};

export default function MappingBlock({ mapping, descMode = 'plain' }: Props) {
  const alignIcon = mapping.alignment === 'agrees' ? '+' : '\u2212';
  const descText = resolveDescription(mapping.nodeDescription, mapping.nodePlainDescription, descMode);

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
      {descText && (
        <div className="mapping-node-description">{descText}</div>
      )}
      <div className="mapping-category">{mapping.category}</div>
      <div className="mapping-strength">Strength: {mapping.strength}</div>
      <div className="mapping-explanation">{mapping.explanation}</div>
    </div>
  );
}
