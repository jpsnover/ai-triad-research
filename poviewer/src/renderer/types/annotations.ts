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
