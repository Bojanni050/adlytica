import React, { useEffect, useMemo, useRef, useState } from "react";

export interface PaletteItem {
  id: string;
  label: string;
  icon: string;
  hint?: string;
}

interface Props {
  open: boolean;
  items: PaletteItem[];
  onNavigate: (id: string) => void;
  onClose: () => void;
}

/** Snelnavigatie met Ctrl+K (Windows) of Cmd+K (macOS). */
export default function CommandPalette({ open, items, onNavigate, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return items;
    return items.filter((item) => item.label.toLowerCase().includes(needle));
  }, [items, query]);

  useEffect(() => {
    if (active > filtered.length - 1) setActive(Math.max(0, filtered.length - 1));
  }, [filtered.length, active]);

  if (!open) return null;

  function choose(item: PaletteItem) {
    onNavigate(item.id);
    onClose();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (filtered.length === 0 ? 0 : (index + 1) % filtered.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (filtered.length === 0 ? 0 : (index - 1 + filtered.length) % filtered.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = filtered[active];
      if (item) choose(item);
    }
  }

  return (
    <div className="palette-backdrop" onClick={onClose} role="presentation">
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Snel navigeren"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Ga naar…"
          aria-label="Ga naar"
        />
        <div className="palette-list">
          {filtered.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`palette-item${index === active ? " active" : ""}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(item)}
            >
              <span className="palette-icon">{item.icon}</span>
              <span className="palette-label">{item.label}</span>
              {item.hint && <span className="palette-hint">{item.hint}</span>}
              {index === active && <span className="palette-enter">↵</span>}
            </button>
          ))}
          {filtered.length === 0 && <p className="hint" style={{ padding: "10px 14px" }}>Niets gevonden.</p>}
        </div>
        <div className="palette-foot">
          <span><b>↑↓</b> navigeren</span>
          <span><b>↵</b> openen</span>
          <span><b>Esc</b> sluiten</span>
        </div>
      </div>
    </div>
  );
}
