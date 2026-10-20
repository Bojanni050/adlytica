import React, { useEffect, useState } from "react";
import { getAccounts, getBrand, BrandConfig } from "./lib/api";
import { DEFAULT_ACCOUNTS } from "./lib/constants";
import { WHITE_LABEL_ENABLED } from "./lib/features";
import CommandPalette from "./components/CommandPalette";
import Dashboard from "./views/Dashboard";
import KeywordSearch from "./views/KeywordSearch";
import Rankings from "./views/Rankings";
import SeoAnalysis from "./views/SeoAnalysis";
import Campaigns from "./views/Campaigns";
import Budget from "./views/Budget";
import SearchTerms from "./views/SearchTerms";
import Trends from "./views/Trends";
import Adly from "./views/Adly";
import Settings from "./views/Settings";
import Audit from "./views/Audit";

type ViewId = "dashboard" | "keywords" | "rankings" | "seo" | "audit" | "campaigns" | "searchterms" | "budget" | "adly" | "trends" | "settings";

const NAV: { id: ViewId; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "▤" },
  { id: "keywords", label: "Keyword Search", icon: "⌕" },
  { id: "rankings", label: "Posities", icon: "↕" },
  { id: "seo", label: "SEO Analyse", icon: "◈" },
  { id: "audit", label: "Audit", icon: "⌗" },
  { id: "campaigns", label: "Advertenties", icon: "◧" },
  { id: "budget", label: "Budget", icon: "◔" },
  { id: "searchterms", label: "Zoektermen", icon: "⊘" },
  { id: "adly", label: "Adly AI", icon: "✦" },
  { id: "trends", label: "Google Trends", icon: "∿" },
  { id: "settings", label: "Instellingen", icon: "⚙" },
];

export default function App() {
  const [view, setView] = useState<ViewId>("dashboard");
  const [accounts, setAccounts] = useState<Record<string, string>>(DEFAULT_ACCOUNTS);
  const [brand, setBrandState] = useState<BrandConfig | null>(null);

  useEffect(() => {
    if (!WHITE_LABEL_ENABLED) return;
    getBrand()
      .then((b) => {
        if (!b) return;
        setBrandState(b);
        if (b.accent) document.documentElement.style.setProperty("--accent", b.accent);
      })
      .catch(() => undefined);
  }, []);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    getAccounts()
      .then((a) => {
        if (Object.keys(a).length > 0) setAccounts(a);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const views: Record<ViewId, React.ReactNode> = {
    dashboard: <Dashboard accounts={accounts} />,
    keywords: <KeywordSearch accounts={accounts} />,
    rankings: <Rankings accounts={accounts} />,
    seo: <SeoAnalysis accounts={accounts} />,
    audit: <Audit />,
    campaigns: <Campaigns accounts={accounts} />,
    budget: <Budget accounts={accounts} />,
    searchterms: <SearchTerms accounts={accounts} />,
    adly: <Adly accounts={accounts} />,
    trends: <Trends />,
    settings: (
      <Settings
        accounts={accounts}
        onAccounts={setAccounts}
        brand={brand}
        onBrand={(b) => {
          setBrandState(b);
          if (b?.accent) document.documentElement.style.setProperty("--accent", b.accent);
        }}
      />
    ),
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          {brand?.logo ? (
            <img className="logo-img" src={brand.logo} alt="" />
          ) : (
            <span className="logo-mark">◉</span>
          )}
          <span className="logo-text">{brand?.name || "Adlytica"}</span>
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
        <button className="palette-trigger" onClick={() => setPaletteOpen(true)}>
          <span>Snel naar…</span>
          <span className="kbd">Ctrl K</span>
        </button>
        <div className="sidebar-footer">{brand?.footer || "v0.1.0 — White Vision"}</div>
      </aside>
      <main className="content">{views[view]}</main>
      <CommandPalette
        open={paletteOpen}
        items={NAV.map((item) => ({ id: item.id, label: item.label, icon: item.icon }))}
        onNavigate={(id) => setView(id as ViewId)}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}
