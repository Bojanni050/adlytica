import React, { useEffect, useState } from "react";
import AdlyChat from "./AdlyChat";

const STORAGE_KEY = "adlytica.adly.open";

export default function AdlyPanel({ accounts }: { accounts: Record<string, string> }) {
  const [open, setOpen] = useState(() => localStorage.getItem(STORAGE_KEY) === "1");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
  }, [open]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOpen((current) => !current);
      }
      if (event.key === "Escape") {
        setOpen((current) => (current ? false : current));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        className={open ? "adly-tab open" : "adly-tab"}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="adly-panel"
        title={open ? "Adly sluiten (Esc)" : "Adly openen (Ctrl J)"}
      >
        <span className="adly-tab-icon">✦</span>
        <span className="adly-tab-label">Adly</span>
      </button>

      <aside
        id="adly-panel"
        className={open ? "adly-panel open" : "adly-panel"}
        aria-hidden={!open}
        aria-label="Adly"
      >
        <header className="adly-panel-head">
          <div className="adly-panel-title">
            <span className="adly-panel-mark">✦</span>
            <div>
              <strong>Adly</strong>
              <span className="adly-panel-sub">Je AI-collega voor SEO en Ads</span>
            </div>
          </div>
          <button
            type="button"
            className="ghost icon-btn"
            onClick={() => setOpen(false)}
            aria-label="Adly sluiten"
            title="Sluiten (Esc)"
          >
            ✕
          </button>
        </header>
        <div className="adly-panel-body">
          <AdlyChat accounts={accounts} compact />
        </div>
      </aside>
    </>
  );
}
