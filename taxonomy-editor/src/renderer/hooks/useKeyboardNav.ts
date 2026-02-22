import { useEffect, useCallback } from 'react';

export function useKeyboardNav(
  orderedIds: string[],
  selectedId: string | null,
  onSelect: (id: string) => void,
): void {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (orderedIds.length === 0) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      e.preventDefault();

      const currentIndex = selectedId ? orderedIds.indexOf(selectedId) : -1;

      let nextIndex: number;
      if (e.key === 'ArrowDown') {
        nextIndex = currentIndex < orderedIds.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : orderedIds.length - 1;
      }

      onSelect(orderedIds[nextIndex]);
    },
    [orderedIds, selectedId, onSelect],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
