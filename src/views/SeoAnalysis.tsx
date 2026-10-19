import React, { useEffect, useState } from "react";
import { windsorQuery, num, fmt, dateNDaysAgo, Row, getWpSeo, setWpSeo as writeWpSeo, WpSeo } from "../lib/api";

interface Props { accounts: Record<string, string>; }

const TITLE_MAX = 60;
const DESC_MAX = 160;

export default function SeoAnalysis({ accounts }: Props) {
  const [pages, setPages] = useState<Row[]>([]);
  const [queries, setQueries] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState<string | null>(null);

  // Rank Math-paneel: per pagina titel en omschrijving aanpassen op de WordPress-site.
  const [wpPage, setWpPage] = useState<string | null>(null);
  const [wpSeo, setWpSeo] = useState<WpSeo | null>(null);
  const [wpTitle, setWpTitle] = useState("");
  const [wpDesc, setWpDesc] = useState("");
  const [wpBusy, setWpBusy] = useState(false);
  const [wpSaved, setWpSaved] = useState(false);
  const [wpMsg, setWpMsg] = useState<string | null>(null);
  const [wpError, setWpError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [p, q] = await Promise.all([
          windsorQuery({
            connector: "searchconsole", account: accounts.searchconsole,
            fields: ["page", "clicks", "impressions", "ctr", "position"],
            date_from: dateNDaysAgo(89), group_by: ["page"], limit: 1000,
          }),
          windsorQuery({
            connector: "searchconsole", account: accounts.searchconsole,
            fields: ["query", "page", "clicks", "impressions", "ctr", "position"],
            date_from: dateNDaysAgo(89), group_by: ["query", "page"], limit: 5000,
          }),
        ]);
        setPages(p.sort((a, b) => num(b.clicks) - num(a.clicks)));
        setQueries(q);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [accounts]);

  const pageQueries = selectedPage
    ? queries.filter((r) => String(r.page) === selectedPage).sort((a, b) => num(b.clicks) - num(a.clicks))
    : [];

  async function openWp(pageUrl: string) {
    setWpPage(pageUrl);
    setWpSeo(null);
    setWpMsg(null);
    setWpError(null);
    setWpSaved(false);
    setWpBusy(true);
    try {
      const seo = await getWpSeo(pageUrl);
      setWpSeo(seo);
      setWpTitle(seo.title);
      setWpDesc(seo.description);
    } catch (e) {
      setWpError(String(e));
    } finally {
      setWpBusy(false);
    }
  }

  function closeWp() {
    setWpPage(null);
    setWpSeo(null);
    setWpMsg(null);
    setWpError(null);
    setWpSaved(false);
  }

  async function saveWp() {
    if (!wpSeo) return;
    setWpBusy(true);
    setWpMsg(null);
    setWpError(null);
    try {
      const updated = await writeWpSeo(wpSeo.post_type, wpSeo.id, wpTitle, wpDesc);
      setWpSeo(updated);
      setWpTitle(updated.title);
      setWpDesc(updated.description);
      setWpSaved(true);
      setWpMsg("Opgeslagen in Rank Math.");
    } catch (e) {
      setWpError(String(e));
    } finally {
      setWpBusy(false);
    }
  }

  function counterClass(value: string, max: number): string {
    if (value.length > max) return "wp-counter over";
    if (value.length >= max * 0.85) return "wp-counter near";
    return "wp-counter";
  }

  function opportunityBadge(r: Row): { label: string; cls: string } {    const pos = num(r.position);
    const impr = num(r.impressions);
    if (pos > 10 && impr > 500) return { label: "Zichtbaarheid winnen", cls: "yellow" };
    if (pos <= 3) return { label: "Top 3", cls: "green" };
    if (pos > 20) return { label: "Zwak", cls: "red" };
    return { label: "Stabiel", cls: "blue" };
  }

  if (loading) return <div className="loading">SEO-data laden…</div>;

  return (
    <div>
      <h1>SEO Analyse</h1>
      <p className="subtitle">Pagina- en zoektermresultaten van white-vision.nl (laatste 90 dagen)</p>
      {error && <div className="error-box">{error}</div>}

      <div className="grid cols-2">
        <div className="card">
          <h3>Best presterende pagina's</h3>
          <div style={{ maxHeight: 480, overflowY: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Pagina</th>
                  <th className="num">Klikken</th>
                  <th className="num">Impr.</th>
                  <th className="num">Pos.</th>
                  <th></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pages.slice(0, 100).map((r, i) => (
                  <tr key={i} onClick={() => setSelectedPage(selectedPage === r.page ? null : String(r.page))} style={{ cursor: "pointer" }}>
                    <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>{String(r.page ?? "")}</td>
                    <td className="num">{fmt(num(r.clicks), 0)}</td>
                    <td className="num">{fmt(num(r.impressions), 0)}</td>
                    <td className="num">{fmt(num(r.position), 1)}</td>
                    <td>
                      <button
                        className="wp-open"
                        title="Rank Math-titel en -omschrijving aanpassen"
                        onClick={(e) => {
                          e.stopPropagation();
                          openWp(String(r.page ?? ""));
                        }}
                      >
                        Rank Math
                      </button>
                    </td>
                    <td>{selectedPage === r.page ? "▲" : "▼"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3>{selectedPage ? `Zoektermen voor ${selectedPage}` : "Zoekterm-kansen (positie 5–20)"}</h3>
          {selectedPage ? (
            <div style={{ maxHeight: 480, overflowY: "auto" }}>
              {pageQueries.length === 0 && <p className="hint">Geen zoektermdata voor deze pagina.</p>}
              <table className="data">
                <thead>
                  <tr>
                    <th>Zoekterm</th>
                    <th className="num">Klikken</th>
                    <th className="num">Impr.</th>
                    <th className="num">Pos.</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageQueries.map((r, i) => {
                    const badge = opportunityBadge(r);
                    return (
                      <tr key={i}>
                        <td>{String(r.query ?? "")}</td>
                        <td className="num">{fmt(num(r.clicks), 0)}</td>
                        <td className="num">{fmt(num(r.impressions), 0)}</td>
                        <td className="num">{fmt(num(r.position), 1)}</td>
                        <td><span className={`badge ${badge.cls}`}>{badge.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ maxHeight: 480, overflowY: "auto" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Zoekterm</th>
                    <th className="num">Impr.</th>
                    <th className="num">Pos.</th>
                    <th className="num">CTR</th>
                    <th>Kans</th>
                  </tr>
                </thead>
                <tbody>
                  {queries
                    .filter((r) => num(r.position) >= 5 && num(r.position) <= 20 && num(r.impressions) > 100)
                    .sort((a, b) => num(b.impressions) - num(a.impressions))
                    .slice(0, 50)
                    .map((r, i) => (
                      <tr key={i}>
                        <td>{String(r.query ?? "")}</td>
                        <td className="num">{fmt(num(r.impressions), 0)}</td>
                        <td className="num">{fmt(num(r.position), 1)}</td>
                        <td className="num">{fmt(num(r.ctr), 1)}%</td>
                        <td>
                          <span className="badge yellow">
                            {num(r.position) <= 10 ? "Naar top 3" : "Naar pagina 1"}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {wpPage && (
        <div className="card wp-panel">
          <div className="wp-panel-head">
            <div>
              <h3>Rank Math — {wpSeo?.permalink || wpPage}</h3>
              <p className="hint">
                {wpSeo
                  ? `${wpSeo.post_type === "posts" ? "Bericht" : "Pagina"} #${wpSeo.id}${
                      wpSeo.focus_keyword ? ` · focus keyword: ${wpSeo.focus_keyword}` : ""
                    }`
                  : "Pagina opzoeken op de site…"}
              </p>
            </div>
            <button className="ghost" onClick={closeWp}>Sluiten</button>
          </div>

          {wpError && <div className="error-box">{wpError}</div>}

          {wpBusy && !wpSeo ? (
            <div className="loading">Rank Math-velden ophalen…</div>
          ) : wpSeo ? (
            <>
              <div className="form-row">
                <div style={{ flex: 1 }}>
                  <label className="field">SEO-titel</label>
                  <input type="text" value={wpTitle} onChange={(e) => setWpTitle(e.target.value)} />
                  <span className={counterClass(wpTitle, TITLE_MAX)}>
                    {wpTitle.length}/{TITLE_MAX} tekens
                  </span>
                </div>
              </div>
              <div className="form-row">
                <div style={{ flex: 1 }}>
                  <label className="field">Meta-omschrijving</label>
                  <textarea
                    rows={3} value={wpDesc} onChange={(e) => setWpDesc(e.target.value)}
                    style={{ width: "100%", resize: "vertical" }}
                  />
                  <span className={counterClass(wpDesc, DESC_MAX)}>
                    {wpDesc.length}/{DESC_MAX} tekens
                  </span>
                </div>
              </div>
              <div className="wp-panel-actions">
                <button className="primary" onClick={saveWp} disabled={wpBusy}>
                  {wpBusy ? "Opslaan…" : "Opslaan in Rank Math"}
                </button>
                <a className="link-btn" href={wpSeo.permalink} target="_blank" rel="noreferrer">
                  Pagina openen ↗
                </a>
                {wpMsg && <span className={`hint${wpSaved ? " wp-saved" : ""}`}>{wpMsg}</span>}
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
