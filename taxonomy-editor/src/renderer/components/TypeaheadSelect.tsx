import { useState, useRef, useEffect, useMemo } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';

interface TypeaheadSelectProps {
  options: string[];
  onSelect: (id: string) => void;
  placeholder?: string;
}

export function TypeaheadSelect({ options, onSelect, placeholder }: TypeaheadSelectProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { getLabelForId } = useTaxonomyStore();

  const filtered = useMemo(() => {
    if (!query) return options.slice(0, 50);
    const lower = query.toLowerCase();
    const isWildcard = lower.includes('*');
    let regex: RegExp | null = null;
    if (isWildcard) {
      try {
        const pattern = lower.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        regex = new RegExp(pattern);
      } catch { /* fall through to includes */ }
    }
    return options.filter(id => {
      const label = getLabelForId(id);
      const idLower = id.toLowerCase();
      const labelLower = label.toLowerCase();
      if (regex) {
        return regex.test(idLower) || regex.test(labelLower);
      }
      return idLower.includes(lower) || labelLower.includes(lower);
    }).slice(0, 50);
  }, [query, options, getLabelForId]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [filtered]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (open && listRef.current) {
      const item = listRef.current.children[highlightIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex, open]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (id: string) => {
    onSelect(id);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open && e.key === 'ArrowDown') {
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlightIndex]) {
        handleSelect(filtered[highlightIndex]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="typeahead" ref={containerRef}>
      <input
        ref={inputRef}
        className="typeahead-input"
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Type to search...'}
      />
      {open && filtered.length > 0 && (
        <div className="typeahead-dropdown" ref={listRef}>
          {filtered.map((id, i) => {
            const label = getLabelForId(id);
            return (
              <div
                key={id}
                className={`typeahead-option ${i === highlightIndex ? 'highlighted' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(id); }}
                onMouseEnter={() => setHighlightIndex(i)}
              >
                <span className="typeahead-option-id">{id}</span>
                {label && <span className="typeahead-option-label">{label}</span>}
              </div>
            );
          })}
        </div>
      )}
      {open && query && filtered.length === 0 && (
        <div className="typeahead-dropdown">
          <div className="typeahead-empty">No matches</div>
        </div>
      )}
    </div>
  );
}
