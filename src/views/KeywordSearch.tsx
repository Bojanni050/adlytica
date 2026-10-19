import React, { useState } from "react";
import { windsorQuery, num, fmt, dateNDaysAgo, Row } from "../lib/api";

interface Props { accounts: Record<string, string>; }

type Mode = "gsc" | "planner";

export default function KeywordSearch({ accounts }: Props) {
  const [mode, setMode] = useState<Mode>("gsc");
  const [term, setTerm] = useState("");
  const [seeds, setSeeds] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setLoading(true);
    setError(null);
    setRows([]);
    try {
      if (mode === "gsc") {
        const data = await windsorQuery({
          connector: "searchconsole", account: accounts.searchconsole,
          fields: ["query", "clicks", "impressions", "ctr", "position"],
          date_from: dateNDaysAgo(89), group_by: ["query"], limit: 5000,
        });
        setRows(
          term.trim() === ""
            ? data
            : data.filter((r) => String(r.query ?? "").toLowerCase().includes(term.trim().toLowerCase()))
        );
      } else {
        const seedList = seeds.split(",").map((s) => s.trim()).filter(Boolean);
        const options: Record<string, unknown> = {
          keyword_seeds: seedList.join(","),
          geo_target_constants: "2840",
          language: "1000",
          keyword_plan_network: "GOOGLE_SEARCH",
        };
        if (pageUrl.trim() !== "") options.page_url = pageUrl.trim();
        const data = await windsorQuery({
          connector: "google_ads", account: accounts.google_ads,
          fields: ["keyword_text", "monthly_search_volume", "competition", "low_top_of_page_bid", "high_top_of_page_bid"],
          options, limit: 500,
        });
        setRows(data);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1>Keyword Search</h1>
      <p className="subtitle">Zoek in eigen zoektermen (Search Console) of vind nieuwe ideeën (Google Ads Keyword Planner)</p>

      <div className="toolbar">
        <select value={mode} onChange={(e) => { setMode(e.target.value as Mode); setRows([]); }} style={{ width: 260 }}>
          <option value="gsc">Mijn zoektermen (Search Console)</option>
          <option value="planner">Keyword Planner (nieuwe ideeën)</option>
        </select>
        {mode === "gsc" ? (
          <input
            type="text" placeholder="Filter op zoekterm…" value={term}
            onChange={(e) => setTerm(e.target.value)} style={{ maxWidth: 320 }}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
        ) : (
          <>
            <input
              type="text" placeholder="Seed keywords, komma-gescheiden (max 20)" value={seeds}
              onChange={(e) => setSeeds(e.target.value)} style={{ maxWidth: 320 }}
            />
            <input
              type="text" placeholder="Of pagina-URL (optioneel)" value={pageUrl}
              onChange={(e) => setPageUrl(e.target.value)} style={{ maxWidth: 320 }}
            />
          </>
        )}
        <button className="primary" onClick={search} disabled={loading}>
          {loading ? "Zoeken…" : "Zoeken"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}
      {rows.length > 0 && (
        <div className="card">
          {mode === "gsc" ? (
            <table className="data">
              <thead>
                <tr>
                  <th>Zoekterm</th>
                  <th className="num">Klikken</th>
                  <th className="num">Impressies</th>
                  <th className="num">CTR</th>
                  <th className="num">Positie</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    <td>{String(r.query ?? "")}</td>
                    <td className="num">{fmt(num(r.clicks), 0)}</td>
                    <td className="num">{fmt(num(r.impressions), 0)}</td>
                    <td className="num">{fmt(num(r.ctr), 1)}%</td>
                    <td className="num">{fmt(num(r.position), 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Keyword</th>
                  <th className="num">Zoekvolume /mnd</th>
                  <th>Competitie</th>
                  <th className="num">Bied range (laag)</th>
                  <th className="num">Bied range (hoog)</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((r, i) => {
                  const kw = r.keyword_text ?? r.keyword ?? r.search_term ?? "";
                  const vol = r.monthly_search_volume ?? r.avg_monthly_searches ?? r.search_volume ?? 0;
                  const comp = r.competition ?? r.competition_level ?? "";
                  const low = r.low_top_of_page_bid ?? r.low_top_of_page_bid_micros ?? 0;
                  const high = r.high_top_of_page_bid ?? r.high_top_of_page_bid_micros ?? 0;
                  return (
                    <tr key={i}>
                      <td>{String(kw)}</td>
                      <td className="num">{fmt(num(vol), 0)}</td>
                      <td><span className={`badge ${String(comp).toLowerCase().includes("high") ? "red" : String(comp).toLowerCase().includes("low") ? "green" : "yellow"}`}>{String(comp)}</span></td>
                      <td className="num">{fmt(num(low), 2)}</td>
                      <td className="num">{fmt(num(high), 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
      {!loading && rows.length === 0 && !error && (
        <p className="hint">Voer een zoekopdracht uit om resultaten te zien.</p>
      )}
    </div>
  );
}
