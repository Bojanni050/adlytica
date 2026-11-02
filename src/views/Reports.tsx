import React, { useEffect, useState } from "react";
import {
  analyticsQuery, num, fmt, Row, ReportSnapshot,
  getReportSnapshots, saveReportSnapshot, deleteReportSnapshot,
} from "../lib/api";
import { exportPdf, PdfKpi, PdfMeta, PdfSection } from "../lib/pdf";
import { useDateRange } from "../lib/dateRange";

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

function makeSnapshotId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `rapport-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatMoment(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "onbekend";
  return date.toLocaleString("nl-NL", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function longDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (!value || Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

function periodMeta(from: string, to: string): PdfMeta[] {
  return [
    { label: "Periode", value: `${longDate(from)} t/m ${longDate(to)}` },
    { label: "Gemaakt op", value: new Date().toLocaleString("nl-NL", { dateStyle: "long", timeStyle: "short" }) },
  ];
}

export default function Reports({ accounts }: { accounts: Record<string, string> }) {
  const [title, setTitle] = useState(() => localStorage.getItem("adlytica.report.title") ?? "SEO-rapport");
  const { from, to, days } = useDateRange();
  const [selected, setSelected] = useState<string[]>(loadSelected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<ReportSnapshot[]>([]);
  const [snapshotMsg, setSnapshotMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReportSnapshot | null>(null);

  useEffect(() => {
    getReportSnapshots()
      .then(setSnapshots)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    localStorage.setItem("adlytica.report.title", title);
    localStorage.setItem(STORAGE, JSON.stringify(selected));
  }, [title, selected]);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  async function build(mode: "pdf" | "snapshot" = "pdf") {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    setSnapshotMsg(null);
    try {
      const needQueries = selected.some((id) => ["summary", "queries", "lhf", "ctr"].includes(id));
      const queries =
        needQueries || selected.includes("summary")
          ? await analyticsQuery({
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
        const rows = await analyticsQuery({
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
        const rows = await analyticsQuery({
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
        const rows = await analyticsQuery({
          connector: "googleanalytics4",
          account: accounts.googleanalytics4,
          fields: ["source", "sessions"],
          date_from: from,
          date_to: to,
          group_by: ["source"],
          limit: 100,
        });
        sections.push({
          title: "Verkeersbronnen",
          head: ["Bron", "Sessies"],
          rows: [...rows]
            .sort((a, b) => num(b.sessions) - num(a.sessions))
            .slice(0, 15)
            .map((row) => [String(row.source ?? ""), fmt(num(row.sessions), 0)]),
        });
      }

      if (sections.length === 0 && kpis.length === 0) {
        throw new Error("Kies minstens één blok voor het rapport.");
      }

      // Snapshot: dezelfde berekening, maar het resultaat gaat als vaste tekst
      // de opslag in. Later opnieuw openen raakt de databron niet meer aan.
      if (mode === "snapshot") {
        const snapshot: ReportSnapshot = {
          id: makeSnapshotId(),
          title: title.trim() || "SEO-rapport",
          created_at: new Date().toISOString(),
          date_from: from,
          date_to: to,
          days,
          kpis: kpis.map((kpi) => ({ label: kpi.label, value: kpi.value })),
          sections: sections.map((section) => ({
            title: section.title,
            head: section.head,
            rows: section.rows.map((row) => row.map((cell) => String(cell))),
            note: section.note ?? null,
          })),
        };
        const stored = await saveReportSnapshot(snapshot);
        setSnapshots(stored);
        setSnapshotMsg(`Bewaard: ${snapshot.title} · ${formatMoment(snapshot.created_at)}`);
        return;
      }

      const path = await exportPdf({
        title: title.trim() || "SEO-rapport",
        subtitle: `Laatste ${days} dagen · ${new Date().toLocaleDateString("nl-NL")}`,
        kpis,
        sections,
        meta: periodMeta(from, to),
        filename: `adlytica-rapport-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
      setSaved(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openSnapshotPdf(snapshot: ReportSnapshot) {
    try {
      setError(null);
      const path = await exportPdf({
        title: snapshot.title,
        subtitle: `Bevroren rapport · de cijfers zoals ze op ${formatMoment(snapshot.created_at)} waren`,
        kpis: snapshot.kpis,
        sections: snapshot.sections.map((section) => ({
          title: section.title,
          head: section.head,
          rows: section.rows,
          note: section.note ?? undefined,
        })),
        meta: [
          { label: "Periode", value: `${longDate(snapshot.date_from)} t/m ${longDate(snapshot.date_to)}` },
          { label: "Bevroren op", value: formatMoment(snapshot.created_at) },
          { label: "PDF gemaakt op", value: new Date().toLocaleString("nl-NL", { dateStyle: "long", timeStyle: "short" }) },
        ],
        filename: `adlytica-rapport-${snapshot.date_to || new Date().toISOString().slice(0, 10)}.pdf`,
      });
      setSaved(path);
    } catch (e) {
      setError(String(e));
    }
  }

  async function removeSnapshot(snapshot: ReportSnapshot) {
    try {
      setSnapshots(await deleteReportSnapshot(snapshot.id));
      if (preview?.id === snapshot.id) setPreview(null);
      setSnapshotMsg(`Verwijderd: ${snapshot.title}`);
    } catch (e) {
      setError(String(e));
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
          <button className="primary" onClick={() => build()} disabled={busy || selected.length === 0}>
            {busy ? "Bezig…" : "Rapport maken (PDF)"}
          </button>
          <button
            className="ghost"
            onClick={() => build("snapshot")}
            disabled={busy || selected.length === 0}
            title="Bewaar de cijfers zoals ze nu zijn; een later rapport verandert ze niet meer"
          >
            Bewaar snapshot
          </button>
          <span className="hint" style={{ margin: 0 }}>
            {selected.length} van {BLOCKS.length} blokken · wordt opgeslagen in Downloads
          </span>
        </div>
      </div>

      {saved && <p className="hint">Opgeslagen: {saved}</p>}
      {snapshotMsg && <p className="hint">{snapshotMsg}</p>}
      {error && <p className="hint" style={{ color: "var(--danger)" }}>{error}</p>}

      <div className="card">
        <h3>Bewaarde rapporten</h3>
        {snapshots.length === 0 ? (
          <p className="hint">
            Nog geen snapshots. Met "Bewaar snapshot" leg je de cijfers van dit rapport vast, zodat
            een klant later precies ziet wat je toen stuurde.
          </p>
        ) : (
          <ul className="snapshot-list">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id} className="snapshot-item">
                <div className="snapshot-main">
                  <strong>{snapshot.title}</strong>
                  <span className="hint">
                    {snapshot.date_from} t/m {snapshot.date_to} · {snapshot.days} dagen
                  </span>
                  <span className="hint">
                    {snapshot.kpis.length} kerncijfers · {snapshot.sections.length} blokken · bewaard{" "}
                    {formatMoment(snapshot.created_at)}
                  </span>
                </div>
                <div className="snapshot-controls">
                  <button
                    className="ghost"
                    onClick={() => setPreview(preview?.id === snapshot.id ? null : snapshot)}
                  >
                    {preview?.id === snapshot.id ? "Sluiten" : "Bekijken"}
                  </button>
                  <button className="ghost" onClick={() => openSnapshotPdf(snapshot)}>PDF</button>
                  <button className="ghost" onClick={() => removeSnapshot(snapshot)}>Verwijderen</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {preview && (
        <div className="card snapshot-preview">
          <h3>{preview.title}</h3>
          <p className="hint">
            {preview.date_from} t/m {preview.date_to} · bevroren op {formatMoment(preview.created_at)}.
            Deze cijfers komen niet uit de databron; ze veranderen niet meer.
          </p>
          {preview.kpis.length > 0 && (
            <div className="snapshot-kpis">
              {preview.kpis.map((kpi) => (
                <div key={kpi.label} className="snapshot-kpi">
                  <span>{kpi.label}</span>
                  <strong>{kpi.value}</strong>
                </div>
              ))}
            </div>
          )}
          {preview.sections.map((section) => (
            <div key={section.title} className="snapshot-section">
              <h4>{section.title}</h4>
              <div className="snapshot-table-wrap">
                <table className="data">
                  <thead>
                    <tr>{section.head.map((cell, index) => <th key={`${cell}-${index}`}>{cell}</th>)}</tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {section.note && <p className="hint">{section.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
