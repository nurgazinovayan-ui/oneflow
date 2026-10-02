import { useMemo, useRef, useState } from 'react';
import { IconSearch } from './Icons';
import type { AppView, ModeDef } from '../modes';
import { useT } from '../i18n';

interface ModeSearchProps {
  modes: ModeDef[];
  onSelect: (view: AppView) => void;
}

// Header search: filters the mode list by name and description, Enter/click jumps to the mode.
// Purely local — nothing typed here leaves the browser.
export default function ModeSearch({ modes, onSelect }: ModeSearchProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return modes;
    return modes.filter((m) => m.label.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));
  }, [modes, query]);

  const choose = (m: ModeDef | undefined) => {
    if (!m) return;
    onSelect(m.value);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="mode-search" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}>
      <IconSearch size={15} />
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder={t.home.searchPlaceholder}
        aria-label={t.home.searchPlaceholder}
        role="combobox"
        aria-expanded={open}
        aria-controls="mode-search-list"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setCursor(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => Math.min(results.length - 1, c + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          } else if (e.key === 'Enter') {
            choose(results[cursor]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
      />
      {open && (
        <div className="mode-search-list" id="mode-search-list" role="listbox">
          {results.length === 0 && <div className="mode-search-empty">{t.home.searchEmpty}</div>}
          {results.map((m, i) => {
            const Icon = m.icon;
            return (
              <button
                key={m.value}
                type="button"
                role="option"
                aria-selected={i === cursor}
                className={`mode-search-item${i === cursor ? ' active' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(m)}
              >
                <span className="mode-search-icon">
                  <Icon size={16} />
                </span>
                <span className="mode-search-text">
                  <b>{m.label}</b>
                  <span>{m.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
