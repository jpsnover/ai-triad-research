// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback } from 'react';
import './OverflowMenu.css';

export interface OverflowItem {
  id: string;
  label: string;
  enabled: boolean;
  count?: number;
  ranEmpty?: boolean;
  tooltip?: string;
}

interface OverflowMenuProps {
  items: OverflowItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function OverflowMenu({ items, activeId, onSelect }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeOverflowItem = items.find(i => i.id === activeId);
  const triggerLabel = activeOverflowItem ? `${activeOverflowItem.label} ▾` : 'More ▾';
  const allDisabled = items.every(i => !i.enabled);

  const close = useCallback(() => {
    setOpen(false);
    setFocusIdx(-1);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  useEffect(() => {
    if (open && focusIdx >= 0 && itemRefs.current[focusIdx]) {
      itemRefs.current[focusIdx]!.focus();
    }
  }, [open, focusIdx]);

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
      setFocusIdx(0);
    }
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        setFocusIdx(prev => (prev + 1) % items.length);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        setFocusIdx(prev => (prev - 1 + items.length) % items.length);
        break;
      }
      case 'Home': {
        e.preventDefault();
        setFocusIdx(0);
        break;
      }
      case 'End': {
        e.preventDefault();
        setFocusIdx(items.length - 1);
        break;
      }
      case 'Escape': {
        e.preventDefault();
        close();
        triggerRef.current?.focus();
        break;
      }
      case 'Tab': {
        close();
        break;
      }
    }
  };

  return (
    <div className="overflow-menu" ref={menuRef}>
      <button
        ref={triggerRef}
        className={`overflow-menu__trigger${activeOverflowItem ? ' overflow-menu__trigger--active' : ''}${allDisabled ? ' overflow-menu__trigger--dimmed' : ''}`}
        onClick={() => { setOpen(!open); if (!open) setFocusIdx(0); }}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {triggerLabel}
      </button>
      {open && (
        <div
          className="overflow-menu__dropdown"
          role="menu"
          onKeyDown={handleMenuKeyDown}
        >
          {items.map((item, idx) => (
            <button
              key={item.id}
              ref={el => { itemRefs.current[idx] = el; }}
              role="menuitem"
              className={`overflow-menu__item${item.id === activeId ? ' overflow-menu__item--active' : ''}${!item.enabled ? ' overflow-menu__item--disabled' : ''}`}
              disabled={!item.enabled}
              tabIndex={focusIdx === idx ? 0 : -1}
              title={item.tooltip}
              onClick={() => {
                if (item.enabled) {
                  onSelect(item.id);
                  close();
                  triggerRef.current?.focus();
                }
              }}
            >
              {item.ranEmpty && <span className="overflow-menu__empty-marker">∅</span>}
              {item.label}
              {item.count != null && <span className="overflow-menu__count">({item.count})</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
