import React, { useState } from "react";
import { windsorQuery, num, fmt, dateNDaysAgo, Row, adlyChat } from "../lib/api";
import { exportPdf } from "../lib/pdf";

interface Props { accounts: Record<string, string>; }

type Mode = "gsc" | "planner";

interface Cluster {
  name: string;
  intent: string;
  keywords: string[];
}

function keywordOf(row: Row, mode: Mode): string {
  if (mode === "planner") {
    return String(row.keyword_text ?? row.keyword ?? row.search_term ?? "");
  }
  return String(row.query ?? "");
}

function intentClass(intent: string): string {
  const value = intent.toLowerCase();
  if (value.includes("transaction")) return "badge green";
  if (value.includes("commerci")) return "badge blue";
  if (value.includes("naviga")) return "badge red";
  return "badge yellow";
}

export default function KeywordSearch({ accounts }: Props) {
  const [mode, setMode] = useState<Mode>("gsc");
  const [term, setTerm] = useState("");
  const [seeds, setSeeds] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [clustering, setClustering] = useState(false);
  const [clusterError, setClusterError] = useState<string | null>(null);
  const [activeCluster, setActiveCluster] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState<string | null>(null);

  async function search() {
    setLoading(true);
    setError(null);
    setRows([]);
    setClusters([]);
    setActiveCluster(null);
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

  async function clusterRows() {
    const words = Array.from(new Set(rows.map((row) => keywordOf(row, mode)).filter((word) => word !== "")));
    if (words.length === 0) return;
    setClustering(true);
    setClusterError(null);
    try {
      const sample = words.slice(0, 80);
      const answer = await adlyChat([
        {
          role: "user",
          content:
            `Groepeer deze zoekwoorden in 3 tot 8 thematische clusters. ` +
            `Geef per cluster een korte Nederlandse naam, de zoekintentie (informatief, commercieel, transactioneel of navigationeel) ` +
            `en de zoekwoorden precies zoals aangeleverd. Gebruik alleen woorden uit de lijst en stop elk woord in precies één cluster.\n\n` +
            sample.join("\n") +
            `\n\nAntwoord uitsluitend met geldige JSON in deze vorm: ` +
            `{"clusters":[{"name":"...","intent":"...","keywords":["..."]}]}`,
        },
      ]);
      const start = answer.indexOf("{");
      const end = answer.lastIndexOf("}");
      if (start === -1 || end <= start) throw new Error("Het antwoord bevatte geen JSON.");
      const parsed = JSON.parse(answer.slice(start, end + 1)) as { clusters?: Cluster[] };
      const list = (parsed.clusters ?? []).filter((cluster) => Array.isArray(cluster.keywords) && cluster.keywords.length > 0);
      if (list.length === 0) throw new Error("Geen clusters ontvangen.");
      setClusters(list);
      setActiveCluster(null);
    } catch (e) {
      setClusterError(`Clustering mislukt: ${e}`);
    } finally {
      setClustering(false);
    }
  }

  async function exportReport() {
    setPdfBusy(true);
    setPdfMsg(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const body = visible.map((row) => {
        if (mode === "planner") {
          return [
            keywordOf(row, mode),
            fmt(num(row.monthly_search_volume ?? row.avg_monthly_searches ?? row.search_volume ?? 0), 0),
            String(row.competition ?? row.competition_level ?? ""),
          ];
        }
        return [
          keywordOf(row, mode),
          fmt(num(row.clicks), 0),
          fmt(num(row.impressions), 0),
          `${fmt(num(row.ctr), 1)}%`,
          fmt(num(row.position), 1),
        ];
      });
      const path = await exportPdf({
        title: mode === "gsc" ? "Zoektermen" : "Keyword-ideeën",
        subtitle: mode === "gsc"
          ? `Search Console · laatste 90 dagen${term.trim() ? ` · filter "${term.trim()}"` : ""}`
          : `Keyword Planner${seeds.trim() ? ` · ${seeds.trim()}` : ""}`,
        kpis:
          mode === "gsc"
            ? [
                { label: "Zoektermen", value: String(visible.length) },
                { label: "Klikken", value: fmt(visible.reduce((sum, r) => sum + num(r.clicks), 0), 0) },
                { label: "Impressies", value: fmt(visible.reduce((sum, r) => sum + num(r.impressions), 0), 0) },
              ]
            : [{ label: "Keywords", value: String(visible.length) }],
        sections: [
          {
            title: mode === "gsc" ? "Zoektermen" : "Keyword-ideeën",
            head: mode === "gsc" ? ["Zoekterm", "Klikken", "Impressies", "CTR", "Positie"] : ["Keyword", "Volume /mnd", "Competitie"],
            rows: body,
          },
          ...(clusters.length > 0
            ? [{
                title: "Clusters (AI)",
                head: ["Cluster", "Intentie", "Aantal", "Zoekwoorden"],
                rows: clusters.map((cluster) => [
                  cluster.name,
                  cluster.intent,
                  String(cluster.keywords.length),
                  cluster.keywords.join(", "),
                ]),
              }]
            : []),
        ],
        filename: `adlytica-keywords-${stamp}.pdf`,
      });
      setPdfMsg(`Opgeslagen: ${path}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setPdfBusy(false);
    }
  }

  const visible = rows.filter((row) => {
    if (!activeCluster) return true;
    const cluster = clusters.find((item) => item.name === activeCluster);
    if (!cluster) return true;
    return cluster.keywords.includes(keywordOf(row, mode));
  });

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
        <button className="ghost" onClick={clusterRows} disabled={clustering || rows.length === 0}>
          {clustering ? "Clusteren…" : "✦ Cluster met AI"}
        </button>
        <button className="ghost" onClick={exportReport} disabled={pdfBusy || visible.length === 0}>
          {pdfBusy ? "PDF…" : "⬇ PDF"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}
      {clusterError && <div className="error-box">{clusterError}</div>}
      {pdfMsg && <p className="hint">{pdfMsg}</p>}

      {clusters.length > 0 && (
        <>
          <div className="cluster-grid">
            {clusters.map((cluster) => (
              <button
                key={cluster.name}
                type="button"
                className={activeCluster === cluster.name ? "cluster-card active" : "cluster-card"}
                onClick={() => setActiveCluster(activeCluster === cluster.name ? null : cluster.name)}
              >
                <div className="cluster-head">
                  <strong>{cluster.name}</strong>
                  <span className={intentClass(cluster.intent)}>{cluster.intent}</span>
                </div>
                <div className="hint" style={{ margin: 0 }}>{cluster.keywords.length} zoekwoord{cluster.keywords.length === 1 ? "" : "en"}</div>
                <p className="cluster-words">{cluster.keywords.slice(0, 10).join(", ")}</p>
              </button>
            ))}
          </div>
          {activeCluster && (
            <p className="hint">
              Filter actief: {activeCluster} · <button className="link" onClick={() => setActiveCluster(null)}>alles tonen</button>
            </p>
          )}
        </>
      )}
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
                {visible.slice(0, 200).map((r, i) => (
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
                {visible.slice(0, 200).map((r, i) => {
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
      {!loading && rows.length > 0 && visible.length === 0 && (
        <p className="hint">Geen zoekwoorden in dit cluster.</p>
      )}
    </div>
  );
}
