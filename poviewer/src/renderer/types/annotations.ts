// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export type AnnotationAction =
  | 'change_alignment'
  | 'change_strength'
  | 'dismiss_mapping'
  | 'add_mapping'
  | 'dismiss_point'
  | 'add_note'
  | 'flag_collision';

export interface Annotation {
  id: string;
  sourceId: string;
  pointId: string;
  mappingIndex?: number;
  action: AnnotationAction;
  value: unknown;
  timestamp: string;
  author: string;
}
