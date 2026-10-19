import React, { useEffect, useState } from "react";
import { getAccounts } from "./lib/api";
import { DEFAULT_ACCOUNTS } from "./lib/constants";
import Dashboard from "./views/Dashboard";
import KeywordSearch from "./views/KeywordSearch";
import SeoAnalysis from "./views/SeoAnalysis";
import Campaigns from "./views/Campaigns";
import Trends from "./views/Trends";
import Settings from "./views/Settings";

type ViewId = "dashboard" | "keywords" | "seo" | "campaigns" | "trends" | "settings";

const NAV: { id: ViewId; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "▤" },
  { id: "keywords", label: "Keyword Search", icon: "⌕" },
  { id: "seo", label: "SEO Analyse", icon: "◈" },
  { id: "campaigns", label: "Advertenties", icon: "◧" },
  { id: "trends", label: "Google Trends", icon: "∿" },
  { id: "settings", label: "Instellingen", icon: "⚙" },
];

export default function App() {
  const [view, setView] = useState<ViewId>("dashboard");
  const [accounts, setAccounts] = useState<Record<string, string>>(DEFAULT_ACCOUNTS);

  useEffect(() => {
    getAccounts()
      .then((a) => {
        if (Object.keys(a).length > 0) setAccounts(a);
      })
      .catch(() => undefined);
  }, []);

  const views: Record<ViewId, React.ReactNode> = {
    dashboard: <Dashboard accounts={accounts} />,
    keywords: <KeywordSearch accounts={accounts} />,
    seo: <SeoAnalysis accounts={accounts} />,
    campaigns: <Campaigns accounts={accounts} />,
    trends: <Trends />,
    settings: <Settings accounts={accounts} onAccounts={setAccounts} />,
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-mark">◉</span>
          <span className="logo-text">Adlytica</span>
        </div>
        <nav>
          {NAV.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setView(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">v0.1.0 — White Vision</div>
      </aside>
      <main className="content">{views[view]}</main>
    </div>
  );
}
