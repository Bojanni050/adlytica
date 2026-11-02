import React, { useEffect, useState } from "react";
import {
  getAccounts,
  getBrand,
  getSettingsStatus,
  AlertSettings,
  DEFAULT_ALERT_SETTINGS,
  BrandConfig,
} from "./lib/api";
import { ACTIONS_EVENT, countOpenActions, loadActions } from "./lib/actions";
import { DEFAULT_ACCOUNTS } from "./lib/constants";
import { WHITE_LABEL_ENABLED } from "./lib/features";
import CommandPalette from "./components/CommandPalette";
import AdlyPanel from "./components/AdlyPanel";
import Icon, { IconName } from "./components/Icon";
import Dashboard from "./views/Dashboard";
import Actions from "./views/Actions";
import KeywordSearch from "./views/KeywordSearch";
import Rankings from "./views/Rankings";
import SeoAnalysis from "./views/SeoAnalysis";
import SeoInsights from "./views/SeoInsights";
import Campaigns from "./views/Campaigns";
import Budget from "./views/Budget";
import SearchTerms from "./views/SearchTerms";
import Trends from "./views/Trends";
import Settings from "./views/Settings";
import Audit from "./views/Audit";
import Reports from "./views/Reports";
import Competitors from "./views/Competitors";
import PageSpeed from "./views/PageSpeed";
import { DateRangeProvider, DateRangeSelector } from "./lib/dateRange";

type ViewId =
  | "dashboard" | "actions" | "keywords" | "rankings" | "seo" | "insights"
  | "reports" | "audit" | "speed" | "competitors" | "campaigns"
  | "searchterms" | "budget" | "trends" | "settings";

type SourceId = "gsc" | "ads" | "ga4" | "trends";

interface NavItem {
  id: ViewId;
  label: string;
  icon: IconName;
}

/**
 * De navigatie is gegroepeerd naar het werk dat je doet, niet naar het scherm
 * dat je opent. Vijftien losse items naast elkaar zegt niets over de vraag
 * waarmee je de app binnenkomt ("wat doet mijn organische verkeer?").
 */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overzicht",
    items: [
      { id: "dashboard", label: "Dashboard", icon: "overview" },
      { id: "actions", label: "Acties", icon: "tasks" },
    ],
  },
  {
    label: "Organisch",
    items: [
      { id: "seo", label: "SEO Analyse", icon: "page" },
      { id: "insights", label: "Zoekanalyse", icon: "pulse" },
      { id: "rankings", label: "Posities", icon: "rank" },
      { id: "audit", label: "Audit", icon: "inspect" },
      { id: "speed", label: "Snelheid", icon: "gauge" },
      { id: "competitors", label: "Concurrenten", icon: "compare" },
    ],
  },
  {
    label: "Betaald",
    items: [
      { id: "campaigns", label: "Campagnes", icon: "megaphone" },
      { id: "budget", label: "Budget", icon: "coins" },
      { id: "searchterms", label: "Zoektermen", icon: "tag" },
    ],
  },
  {
    label: "Onderzoek",
    items: [
      { id: "keywords", label: "Keyword Search", icon: "search" },
      { id: "trends", label: "Google Trends", icon: "trend" },
    ],
  },
  {
    label: "Uitvoer",
    items: [{ id: "reports", label: "Rapport", icon: "report" }],
  },
];

const SETTINGS_ITEM: NavItem = { id: "settings", label: "Instellingen", icon: "sliders" };

const ALL_NAV: NavItem[] = [...NAV_GROUPS.flatMap((group) => group.items), SETTINGS_ITEM];

/** Welke databronnen de cijfers op dit scherm leveren. Staat in de topbalk
 *  zodat je nooit hoeft te raden waar een getal vandaan komt. */
const VIEW_SOURCES: Record<ViewId, { id: SourceId; label: string; title: string }[]> = {
  dashboard: [
    { id: "gsc", label: "GSC", title: "Google Search Console" },
    { id: "ads", label: "ADS", title: "Google Ads" },
    { id: "ga4", label: "GA4", title: "Google Analytics 4" },
  ],
  actions: [],
  keywords: [
    { id: "gsc", label: "GSC", title: "Google Search Console" },
    { id: "ads", label: "ADS", title: "Google Ads Keyword Planner" },
  ],
  rankings: [{ id: "gsc", label: "GSC", title: "Google Search Console" }],
  seo: [{ id: "gsc", label: "GSC", title: "Google Search Console" }],
  insights: [
    { id: "gsc", label: "GSC", title: "Google Search Console" },
    { id: "ga4", label: "GA4", title: "Google Analytics 4" },
  ],
  reports: [
    { id: "gsc", label: "GSC", title: "Google Search Console" },
    { id: "ads", label: "ADS", title: "Google Ads" },
    { id: "ga4", label: "GA4", title: "Google Analytics 4" },
  ],
  audit: [],
  speed: [],
  competitors: [
    { id: "gsc", label: "GSC", title: "Google Search Console" },
    { id: "ads", label: "DFS", title: "DataForSEO Labs" },
  ],
  campaigns: [{ id: "ads", label: "ADS", title: "Google Ads" }],
  budget: [{ id: "ads", label: "ADS", title: "Google Ads" }],
  searchterms: [{ id: "ads", label: "ADS", title: "Google Ads" }],
  trends: [{ id: "trends", label: "TRD", title: "Google Trends" }],
  settings: [],
};

/** Bij welke bron hoort welk account, voor de werkplek-chip in de topbalk. */
const SOURCE_ACCOUNT: Record<SourceId, string> = {
  gsc: "searchconsole",
  ads: "google_ads",
  ga4: "googleanalytics4",
  trends: "",
};

/** Toont een URL als host, laat id's met rust. */
function workspaceLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

/** Het merk: drie verbonden knooppunten, dezelfde vormtaal als het logo. */
function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
        <path d="M10 4.6v6.6M10 11.2L5.4 15.4M10 11.2l4.6 4.2" stroke="#dceafd" strokeWidth="1.2" strokeLinecap="round" opacity="0.75" />
        <circle cx="10" cy="4" r="2.1" fill="#ffffff" />
        <circle cx="5.2" cy="15.9" r="1.7" fill="#cfe4fb" />
        <circle cx="14.8" cy="15.9" r="1.7" fill="#cfe4fb" />
      </svg>
    </span>
  );
}

export default function App() {
  const [view, setView] = useState<ViewId>("dashboard");
  const [accounts, setAccounts] = useState<Record<string, string>>(DEFAULT_ACCOUNTS);
  const [brand, setBrandState] = useState<BrandConfig | null>(null);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(DEFAULT_ALERT_SETTINGS);
  const [alertCount, setAlertCount] = useState(0);
  const [actionCount, setActionCount] = useState(0);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [adlyOpen, setAdlyOpen] = useState(() => localStorage.getItem("adlytica.adly.open") === "1");

  useEffect(() => {
    try {
      localStorage.setItem("adlytica.adly.open", adlyOpen ? "1" : "0");
    } catch {
      /* localStorage mag geweigerd worden; de stand van het paneel is dan alleen deze sessie */
    }
  }, [adlyOpen]);

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

  useEffect(() => {
    getAccounts()
      .then((a) => {
        if (Object.keys(a).length > 0) setAccounts(a);
      })
      .catch(() => undefined);
  }, []);

  // Alert-instellingen bij het opstarten ophalen, zodat de badge en het
  // dashboard meteen dezelfde drempels gebruiken als Instellingen.
  useEffect(() => {
    getSettingsStatus()
      .then((status) => {
        setAlertSettings(status.alerts ?? DEFAULT_ALERT_SETTINGS);
        setConnected(Boolean(status.analytics_base_url) && status.analytics_token_set);
      })
      .catch(() => setConnected(null));
  }, []);

  // Openstaande taken voor de badge in de zijbalk; elke wijziging in het
  // actiecentrum stuurt een event, zodat de teller meteen klopt.
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      loadActions()
        .then((list) => {
          if (!cancelled) setActionCount(countOpenActions(list));
        })
        .catch(() => undefined);
    }
    refresh();
    window.addEventListener(ACTIONS_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(ACTIONS_EVENT, refresh);
    };
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
    dashboard: (
      <Dashboard
        accounts={accounts}
        onNavigate={(id) => setView(id as ViewId)}
        alertSettings={alertSettings}
        onAlerts={setAlertCount}
      />
    ),
    actions: <Actions onNavigate={(id) => setView(id as ViewId)} />,
    keywords: <KeywordSearch accounts={accounts} />,
    rankings: <Rankings accounts={accounts} />,
    seo: <SeoAnalysis accounts={accounts} />,
    insights: <SeoInsights accounts={accounts} />,
    reports: <Reports accounts={accounts} />,
    audit: <Audit accounts={accounts} />,
    speed: <PageSpeed />,
    competitors: <Competitors />,
    campaigns: <Campaigns accounts={accounts} />,
    budget: <Budget accounts={accounts} />,
    searchterms: <SearchTerms accounts={accounts} />,
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
        onAlerts={setAlertSettings}
      />
    ),
  };

  const current = ALL_NAV.find((item) => item.id === view) ?? ALL_NAV[0];
  const sources = VIEW_SOURCES[view];
  const workspace = sources
    .map((source) => accounts[SOURCE_ACCOUNT[source.id]] ?? "")
    .find((value) => value !== "") ?? "";

  return (
    <DateRangeProvider>
      <div className={adlyOpen ? "app-shell adly-open" : "app-shell"}>
        <aside className="sidebar">
          <div className="logo">
            {brand?.logo ? <img className="logo-img" src={brand.logo} alt="" /> : <BrandMark />}
            <span className="brand-text">
              {brand?.name || "Adlytica"}
              {!brand && <span className="brand-sub">connect your data</span>}
            </span>
          </div>

          <nav aria-label="Hoofdnavigatie">
            {NAV_GROUPS.map((group) => (
              <React.Fragment key={group.label}>
                <span className="nav-group">{group.label}</span>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={view === item.id ? "nav-item active" : "nav-item"}
                    onClick={() => setView(item.id)}
                    aria-current={view === item.id ? "page" : undefined}
                  >
                    <span className="nav-icon">
                      <Icon name={item.icon} size={16} strokeWidth={1.5} />
                    </span>
                    {item.label}
                    {item.id === "dashboard" && alertSettings.badge && alertCount > 0 && (
                      <span
                        className="nav-badge"
                        title={`${alertCount} signaal${alertCount === 1 ? "" : "en"} op het dashboard`}
                      >
                        {alertCount}
                      </span>
                    )}
                    {item.id === "actions" && actionCount > 0 && (
                      <span
                        className="nav-badge info"
                        title={`${actionCount} openstaande taak${actionCount === 1 ? "" : "en"}`}
                      >
                        {actionCount}
                      </span>
                    )}
                  </button>
                ))}
              </React.Fragment>
            ))}

            <span className="nav-group">Systeem</span>
            <button
              type="button"
              className={view === "settings" ? "nav-item active" : "nav-item"}
              onClick={() => setView("settings")}
              aria-current={view === "settings" ? "page" : undefined}
            >
              <span className="nav-icon">
                <Icon name="sliders" size={16} strokeWidth={1.5} />
              </span>
              {SETTINGS_ITEM.label}
            </button>
          </nav>

          <button className="palette-trigger" onClick={() => setPaletteOpen(true)}>
            <Icon name="search" size={14} />
            <span>Snel naar…</span>
            <span className="kbd">Ctrl K</span>
          </button>

          <div className="sidebar-footer" title={`build ${__BUILD__.sha} · ${__BUILD__.date}`}>
            {brand?.footer || "v0.1.0"}
            <div>
              build {__BUILD__.sha}
            </div>
          </div>
        </aside>

        <main className="content">
          <header className="topbar">
            <div className="topbar-context">
              {workspace ? (
                <span className="workspace" title={`Werkplek: ${workspace}`}>
                  <Icon name="panel" size={14} />
                  {workspaceLabel(workspace)}
                </span>
              ) : (
                <span className="topbar-section">{current.label}</span>
              )}
              {sources.length > 0 && (
                <>
                  <span className="topbar-divider" aria-hidden="true" />
                  <span className="source-tags" aria-label="Databronnen">
                    {sources.map((source) => (
                      <span key={source.id} className={`source-tag ${source.id}`} title={source.title}>
                        <i aria-hidden="true" />
                        {source.label}
                      </span>
                    ))}
                  </span>
                </>
              )}
              {connected === false && (
                <>
                  <span className="topbar-divider" aria-hidden="true" />
                  <button
                    type="button"
                    className="badge yellow"
                    style={{ cursor: "pointer" }}
                    onClick={() => setView("settings")}
                    title="De databron is nog niet ingesteld — open Instellingen"
                  >
                    <Icon name="alert" size={11} strokeWidth={1.6} />
                    niet verbonden
                  </button>
                </>
              )}
            </div>
            <div className="topbar-tools">
              <DateRangeSelector />
              <span className="topbar-divider" aria-hidden="true" />
              <button
                type="button"
                className={adlyOpen ? "ghost adly-trigger open" : "ghost adly-trigger"}
                onClick={() => setAdlyOpen((open) => !open)}
                aria-expanded={adlyOpen}
                aria-controls="adly-panel"
                title={adlyOpen ? "Adly sluiten (Esc)" : "Adly openen (Ctrl J)"}
              >
                <Icon name="spark" size={14} strokeWidth={1.5} />
                Adly
              </button>
            </div>
          </header>

          <div className="view view-enter" key={view}>
            {views[view]}
          </div>
        </main>

        {adlyOpen && (
          <button
            type="button"
            className="adly-scrim"
            aria-label="Adly sluiten"
            onClick={() => setAdlyOpen(false)}
          />
        )}
        <AdlyPanel accounts={accounts} open={adlyOpen} onOpenChange={setAdlyOpen} />

        <CommandPalette
          open={paletteOpen}
          items={ALL_NAV.map((item) => ({ id: item.id, label: item.label, icon: item.icon }))}
          onNavigate={(id) => setView(id as ViewId)}
          onClose={() => setPaletteOpen(false)}
        />
      </div>
    </DateRangeProvider>
  );
}
