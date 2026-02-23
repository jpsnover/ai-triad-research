import { useState, useEffect, useCallback } from 'react';
import type { Annotation, AnnotationAction } from '../types/annotations';

export function useAnnotations(sourceId: string | null) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load annotations when source changes
  useEffect(() => {
    if (!sourceId) {
      setAnnotations([]);
      setLoaded(false);
      return;
    }

    setLoaded(false);
    if (window.electronAPI?.loadAnnotations) {
      window.electronAPI.loadAnnotations(sourceId)
        .then((data: unknown) => {
          setAnnotations(Array.isArray(data) ? data as Annotation[] : []);
          setLoaded(true);
        })
        .catch(() => {
          setAnnotations([]);
          setLoaded(true);
        });
    } else {
      setLoaded(true);
    }
  }, [sourceId]);

  // Save annotations whenever they change (after initial load)
  useEffect(() => {
    if (!sourceId || !loaded || annotations.length === 0) return;
    window.electronAPI?.saveAnnotations?.(sourceId, annotations);
  }, [sourceId, annotations, loaded]);

  const addAnnotation = useCallback((
    pointId: string,
    action: AnnotationAction,
    value: unknown,
    mappingIndex?: number,
  ) => {
    if (!sourceId) return;
    const annotation: Annotation = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sourceId,
      pointId,
      mappingIndex,
      action,
      value,
      timestamp: new Date().toISOString(),
      author: 'user',
    };
    setAnnotations(prev => [...prev, annotation]);
  }, [sourceId]);

  const removeAnnotation = useCallback((annotationId: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== annotationId));
  }, []);

  const getPointAnnotations = useCallback((pointId: string): Annotation[] => {
    return annotations.filter(a => a.pointId === pointId);
  }, [annotations]);

  const getMappingAnnotations = useCallback((pointId: string, mappingIndex: number): Annotation[] => {
    return annotations.filter(a => a.pointId === pointId && a.mappingIndex === mappingIndex);
  }, [annotations]);

  return {
    annotations,
    loaded,
    addAnnotation,
    removeAnnotation,
    getPointAnnotations,
    getMappingAnnotations,
  };
}
