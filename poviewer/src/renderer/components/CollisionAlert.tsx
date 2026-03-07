// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

interface Props {
  note: string;
}

export default function CollisionAlert({ note }: Props) {
  return (
    <div className="collision-alert">
      <span className="collision-icon">&#9888;</span>
      <div>
        <div className="collision-title">Vocabulary Collision Detected</div>
        <div className="collision-text">{note}</div>
      </div>
    </div>
  );
}
