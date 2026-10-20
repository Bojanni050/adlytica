import React, { useEffect, useState } from "react";
import { windsorQuery, num, fmt, dateNDaysAgo, Row } from "../lib/api";
import { exportPdf, PdfKpi, PdfSection } from "../lib/pdf";

const DAYS = [30, 90];

interface Block {
  id: string;
  label: string;
  detail: string;
}

const BLOCKS: Block[] = [
  { id: "summary", label: "Kerncijfers", detail: "Klikken, vertoningen, CTR en gemiddelde positie." },
  { id: "pages", label: "Top pagina's", detail: "De vijftien pagina's met de meeste klikken." },
  { id: "queries", label: "Top zoektermen", detail: "De vijftien zoektermen met de meeste klikken." },
  { id: "lhf", label: "Low-hanging fruit", detail: "Posities 11–20 met de meeste te winnen klikken." },
  { id: "ctr", label: "CTR per positie", detail: "Waar je CTR achterblijft ten opzichte van je eigen gemiddelde." },
  { id: "ads", label: "Advertenties", detail: "Kosten, klikken en conversies per campagne." },
  { id: "traffic", label: "Verkeersbronnen", detail: "Sessies per bron uit GA4." },
];

const STORAGE = "adlytica.report.blocks";

function loadSelected(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return BLOCKS.map((block) => block.id);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return BLOCKS.map((block) => block.id);
  }
}

function ctrOf(row: Row): number {
  const impressions = num(row.impressions);
  return impressions > 0 ? (num(row.clicks) / impressions) * 100 : 0;
}

function pathOf(value: unknown): string {
  try {
    const parsed = new URL(String(value));
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return String(value);
  }
}

export default function Reports({ accounts }: { accounts: Record<string, string> }) {
  const [title, setTitle] = useState(() => localStorage.getItem("adlytica.report.title") ?? "SEO-rapport");
  const [days, setDays] = useState(() => Number(localStorage.getItem("adlytica.report.days") ?? 30));
  const [selected, setSelected] = useState<string[]>(loadSelected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("adlytica.report.title", title);
    localStorage.setItem("adlytica.report.days", String(days));
    localStorage.setItem(STORAGE, JSON.stringify(selected));
  }, [title, days, selected]);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  async function build() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const from = dateNDaysAgo(days);
      const to = dateNDaysAgo(1);
      const needQueries = selected.some((id) => ["summary", "queries", "lhf", "ctr"].includes(id));
      const queries =
        needQueries || selected.includes("summary")
          ? await windsorQuery({
              connector: "searchconsole",
              account: accounts.searchconsole,
              fields: ["query", "clicks", "impressions", "ctr", "position"],
              date_from: from,
              date_to: to,
              group_by: ["query"],
              limit: 5000,
            })
          : [];

      const kpis: PdfKpi[] = [];
      const sections: PdfSection[] = [];

      if (selected.includes("summary")) {
        const clicks = queries.reduce((sum, row) => sum + num(row.clicks), 0);
        const impressions = queries.reduce((sum, row) => sum + num(row.impressions), 0);
        const weighted = queries.reduce((sum, row) => sum + num(row.position) * num(row.impressions), 0);
        kpis.push(
          { label: "Klikken", value: fmt(clicks, 0) },
          { label: "Vertoningen", value: fmt(impressions, 0) },
          { label: "CTR", value: `${fmt(impressions > 0 ? (clicks / impressions) * 100 : 0, 2)}%` },
          { label: "Gemiddelde positie", value: fmt(impressions > 0 ? weighted / impressions : 0, 1) }
        );
      }

      if (selected.includes("pages")) {
        const rows = await windsorQuery({
          connector: "searchconsole",
          account: accounts.searchconsole,
          fields: ["page", "clicks", "impressions", "position"],
          date_from: from,
          date_to: to,
          group_by: ["page"],
          limit: 2000,
        });
        sections.push({
          title: "Top pagina's",
          head: ["Pagina", "Klikken", "Vertoningen", "CTR", "Positie"],
          rows: [...rows]
            .sort((a, b) => num(b.clicks) - num(a.clicks))
            .slice(0, 15)
            .map((row) => [
              pathOf(row.page),
              fmt(num(row.clicks), 0),
              fmt(num(row.impressions), 0),
              `${fmt(ctrOf(row), 1)}%`,
              fmt(num(row.position), 1),
            ]),
        });
      }

      if (selected.includes("queries")) {
        sections.push({
          title: "Top zoektermen",
          head: ["Zoekterm", "Klikken", "Vertoningen", "CTR", "Positie"],
          rows: [...queries]
            .sort((a, b) => num(b.clicks) - num(a.clicks))
            .slice(0, 15)
            .map((row) => [
              String(row.query ?? ""),
              fmt(num(row.clicks), 0),
              fmt(num(row.impressions), 0),
              `${fmt(ctrOf(row), 1)}%`,
              fmt(num(row.position), 1),
            ]),
        });
      }

      if (selected.includes("lhf")) {
        const middle = queries.filter((row) => num(row.position) >= 6 && num(row.position) <= 10);
        const middleImpressions = middle.reduce((sum, row) => sum + num(row.impressions), 0);
        const middleClicks = middle.reduce((sum, row) => sum + num(row.clicks), 0);
        const target = middleImpressions > 0 ? (middleClicks / middleImpressions) * 100 : 3;
        const rows = queries
          .filter((row) => num(row.position) >= 11 && num(row.position) <= 20 && num(row.impressions) > 0)
          .map((row) => ({
            query: String(row.query ?? ""),
            position: num(row.position),
            impressions: num(row.impressions),
            clicks: num(row.clicks),
            gain: Math.max(0, num(row.impressions) * (target / 100) - num(row.clicks)),
          }))
          .sort((a, b) => b.gain - a.gain)
          .slice(0, 15);
        sections.push({
          title: "Low-hanging fruit",
          head: ["Zoekterm", "Positie", "Vertoningen", "Klikken", "Mogelijke winst"],
          rows: rows.map((row) => [
            row.query,
            fmt(row.position, 1),
            fmt(row.impressions, 0),
            fmt(row.clicks, 0),
            `+${fmt(row.gain, 0)}`,
          ]),
          note: `Doel-CTR ${fmt(target, 1)}%, gebaseerd op je eigen posities 6–10.`,
        });
      }

      if (selected.includes("ctr")) {
        const buckets = [
          [1, 5],
          [6, 10],
          [11, 15],
          [16, 20],
          [21, 100],
        ];
        sections.push({
          title: "CTR per positie",
          head: ["Positie", "Vertoningen", "Klikken", "CTR"],
          rows: buckets.map(([low, high]) => {
            const rows = queries.filter((row) => num(row.position) >= low && num(row.position) <= high);
            const impressions = rows.reduce((sum, row) => sum + num(row.impressions), 0);
            const clicks = rows.reduce((sum, row) => sum + num(row.clicks), 0);
            return [
              low === 21 ? "21+" : `${low}–${high}`,
              fmt(impressions, 0),
              fmt(clicks, 0),
              `${fmt(impressions > 0 ? (clicks / impressions) * 100 : 0, 1)}%`,
            ];
          }),
          note: "CTR is hier berekend uit klikken gedeeld door vertoningen.",
        });
      }

      if (selected.includes("ads") && accounts.google_ads) {
        const rows = await windsorQuery({
          connector: "google_ads",
          account: accounts.google_ads,
          fields: ["campaign_name", "spend", "clicks", "conversions"],
          date_from: from,
          date_to: to,
          group_by: ["campaign_name"],
          limit: 200,
        });
        sections.push({
          title: "Advertenties",
          head: ["Campagne", "Kosten", "Klikken", "Conversies"],
          rows: [...rows]
            .sort((a, b) => num(b.spend) - num(a.spend))
            .slice(0, 15)
            .map((row) => [
              String(row.campaign_name ?? ""),
              `€ ${fmt(num(row.spend), 2)}`,
              fmt(num(row.clicks), 0),
              fmt(num(row.conversions), 0),
            ]),
        });
      }

      if (selected.includes("traffic") && accounts.googleanalytics4) {
        const rows = await windsorQuery({
          connector: "googleanalytics4",
          account: accounts.googleanalytics4,
          fields: ["session_source", "sessions"],
          date_from: from,
          date_to: to,
          group_by: ["session_source"],
          limit: 100,
        });
        sections.push({
          title: "Verkeersbronnen",
          head: ["Bron", "Sessies"],
          rows: [...rows]
            .sort((a, b) => num(b.sessions) - num(a.sessions))
            .slice(0, 15)
            .map((row) => [String(row.session_source ?? ""), fmt(num(row.sessions), 0)]),
        });
      }

      if (sections.length === 0 && kpis.length === 0) {
        throw new Error("Kies minstens één blok voor het rapport.");
      }

      const path = await exportPdf({
        title: title.trim() || "SEO-rapport",
        subtitle: `Laatste ${days} dagen · ${new Date().toLocaleDateString("nl-NL")}`,
        kpis,
        sections,
        filename: `adlytica-rapport-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
      setSaved(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Rapport</h1>
      <p className="subtitle">
        Stel een PDF samen uit je eigen data. Kies de blokken, de periode en de titel; de rest
        rekent de app uit.
      </p>

      <div className="card">
        <div className="form-row">
          <div>
            <label className="field">Titel</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="SEO-rapport" />
          </div>
          <div>
            <label className="field">Periode</label>
            <div className="range-switch" role="group" aria-label="Periode">
              {DAYS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={days === value ? "range-option active" : "range-option"}
                  onClick={() => setDays(value)}
                  aria-pressed={days === value}
                >
                  {value} dagen
                </button>
              ))}
            </div>
          </div>
        </div>

        <h3 style={{ marginTop: 18 }}>Blokken</h3>
        <div className="report-blocks">
          {BLOCKS.map((block) => (
            <label key={block.id} className={selected.includes(block.id) ? "report-block active" : "report-block"}>
              <input
                type="checkbox"
                checked={selected.includes(block.id)}
                onChange={() => toggle(block.id)}
              />
              <span>
                <strong>{block.label}</strong>
                <span className="hint">{block.detail}</span>
              </span>
            </label>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 18 }}>
          <button className="primary" onClick={build} disabled={busy || selected.length === 0}>
            {busy ? "Bezig…" : "Rapport maken (PDF)"}
          </button>
          <span className="hint" style={{ margin: 0 }}>
            {selected.length} van {BLOCKS.length} blokken · wordt opgeslagen in Downloads
          </span>
        </div>
      </div>

      {saved && <p className="hint">Opgeslagen: {saved}</p>}
      {error && <p className="hint" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
