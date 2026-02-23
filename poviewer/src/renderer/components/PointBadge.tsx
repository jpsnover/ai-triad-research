import type { Point, PovCamp } from '../types/types';

interface Props {
  point: Point;
}

const BADGE_CLASS: Record<PovCamp, string> = {
  accelerationist: 'point-badge-acc',
  safetyist: 'point-badge-saf',
  skeptic: 'point-badge-skp',
  'cross-cutting': 'point-badge-cc',
};

export default function PointBadge({ point }: Props) {
  if (point.mappings.length === 0) {
    return <span className="point-badge point-badge-unmapped">UNMAPPED</span>;
  }

  if (point.mappings.length === 1) {
    const m = point.mappings[0];
    const icon = m.alignment === 'agrees' ? '+' : '\u2212';
    return (
      <span className={`point-badge ${BADGE_CLASS[m.camp]}`}>
        <span className="alignment-icon">{icon}</span>
      </span>
    );
  }

  // Multi-POV
  return (
    <span className="point-badge point-badge-multi">
      {point.mappings.length} POVs
    </span>
  );
}
