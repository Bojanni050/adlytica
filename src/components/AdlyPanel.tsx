import React, { useEffect } from "react";
import AdlyChat from "./AdlyChat";
import Icon from "./Icon";

interface Props {
  accounts: Record<string, string>;
  /** De topbalk bezit de knop; het paneel volgt die status. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AdlyPanel({ accounts, open, onOpenChange }: Props) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        onOpenChange(!open);
      }
      if (event.key === "Escape" && open) {
        onOpenChange(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  return (
    <>
      <aside
        id="adly-panel"
        className={open ? "adly-panel open" : "adly-panel"}
        aria-hidden={!open}
        aria-label="Adly"
      >
        <header className="adly-panel-head">
          <div className="adly-panel-title">
            <span className="adly-panel-mark">
              <Icon name="spark" size={15} strokeWidth={1.5} />
            </span>
            <div>
              <strong>Adly</strong>
              <span className="adly-panel-sub">Je AI-collega voor SEO en Ads</span>
            </div>
          </div>
          <button
            type="button"
            className="ghost icon-btn"
            onClick={() => onOpenChange(false)}
            aria-label="Adly sluiten"
            title="Sluiten (Esc)"
          >
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="adly-panel-body">
          <AdlyChat accounts={accounts} compact />
        </div>
      </aside>
    </>
  );
}
